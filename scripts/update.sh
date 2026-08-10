#!/usr/bin/env bash
# =============================================================================
# 版本升级脚本。
#
#   ./scripts/update.sh                 # 升级到最新 stable
#   ./scripts/update.sh v1.2.0          # 升级到指定版本
#   ./scripts/update.sh --dry-run       # 只显示计划，不修改任何东西
#
# 流程（任一步失败即 abort，旧版本继续运行）：
#   lock -> 确定目标版本 -> 预检 -> 当前健康检查 -> SQLite backup
#   -> 保存 deployment state -> pull 新镜像 -> 校验 digest
#   -> 切换 APP_VERSION -> compose up -d --no-build
#   -> 全链路健康检查 -> 成功记录；失败自动回滚。
#
# 安全红线：不用 down -v / prune -a；不依赖 latest 升级；不输出任何 Secret。
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
source "$SCRIPT_DIR/lib.sh"

DRY_RUN=0
TARGET_INPUT=""

# ---- 参数解析 ----
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      echo "用法: $0 [--dry-run] [<version>]"
      echo "  --dry-run        只显示计划，不修改任何东西"
      echo "  <version>        指定 SemVer（如 v1.2.0），缺省为最新 stable"
      exit 0
      ;;
    --*) echo "未知参数: $arg" >&2; exit 2 ;;
    *) TARGET_INPUT="$arg" ;;
  esac
done

init_log "update"

# ---- 锁定（dry-run 不修改，无需锁）----
if [ "$DRY_RUN" -eq 0 ]; then
  if ! acquire_lock; then
    critical "update_aborted error_code=UPDATE_PRECHECK_FAILED reason=lock_busy"
    exit 1
  fi
  trap 'release_lock' EXIT
fi

# ---- 当前版本 ----
CURRENT="$(current_app_version)"
info "update current_version=$CURRENT"
if [ "$CURRENT" = "unknown" ]; then
  # 未初始化 deployment：默认当前为 VERSION 文件或 0.0.0
  CURRENT="$(cat "$ROOT_DIR/VERSION" 2>/dev/null | tr -d '[:space:]' | sed 's/^v//' || echo '0.0.0')"
  info "update current_version_default=$CURRENT"
fi

# ---- 目标版本 ----
TARGET=""
if [ -n "$TARGET_INPUT" ]; then
  TARGET="$(normalize_version "$TARGET_INPUT")"
  if ! validate_semver "$TARGET"; then
    critical "update_aborted error_code=UPDATE_PRECHECK_FAILED reason=invalid_semver input=$TARGET_INPUT"
    exit 1
  fi
  info "update target_version=$TARGET (explicit)"
else
  TARGET="$(github_latest_stable)"
  if [ -z "$TARGET" ]; then
    critical "update_aborted error_code=UPDATE_CHECK_FAILED reason=no_latest_stable"
    exit 1
  fi
  info "update target_version=$TARGET (latest stable)"
fi

# ---- 比较（semver_compare 返回非零会被 set -e 拦截，需用 if 捕获）----
if semver_compare "$CURRENT" "$TARGET"; then
  cmp=0
else
  cmp=$?
fi
if [ "$cmp" -eq 0 ]; then
  info "update already_latest=1 version=$CURRENT (no-op)"
  exit 0
fi
if [ "$cmp" -eq 1 ]; then
  warn "update downgrade=1 current=$CURRENT target=$TARGET (explicit downgrade allowed)"
fi

FRONTEND_IMG="${IMAGE_BASE}-frontend:${TARGET}"
BACKEND_IMG="${IMAGE_BASE}-backend:${TARGET}"

# ---- dry-run：只打印计划 ----
if [ "$DRY_RUN" -eq 1 ]; then
  info "update_plan dry_run=1 current=$CURRENT target=$TARGET"
  info "update_plan frontend_image=$FRONTEND_IMG"
  info "update_plan backend_image=$BACKEND_IMG"
  info "update_plan steps=precheck,database_backup,pull,verify,compose_up,healthcheck"
  info "update_plan database_backup_file_placeholder=backups/<utc>_v${CURRENT}_before_v${TARGET}.db"
  echo "--- DRY RUN (no changes) ---"
  echo "current: v$CURRENT"
  echo "target : v$TARGET"
  echo "frontend: $FRONTEND_IMG"
  echo "backend : $BACKEND_IMG"
  exit 0
fi

# ---- 预检 ----
if ! precheck; then
  critical "update_aborted error_code=UPDATE_PRECHECK_FAILED"
  exit 1
fi

# ---- 当前服务健康检查（更新前必须健康）----
info "update precheck_current_health=start"
if ! wait_healthy; then
  critical "update_aborted error_code=UPDATE_PRECHECK_FAILED reason=current_unhealthy"
  save_failed_logs "precheck"
  exit 1
fi

# ---- SQLite backup（必须成功才能继续）----
DB_BACKUP="$(backup_sqlite "$CURRENT" "$TARGET")" || {
  critical "update_aborted error_code=UPDATE_BACKUP_FAILED"
  exit 1
}

# ---- 保存 deployment state（记录 previous 的一切，供回滚）----
UPDATE_ID_FOR_STATE="$UPDATE_ID"
prev_frontend_digest="$(image_digest "${IMAGE_BASE}-frontend:${CURRENT}" || true)"
prev_backend_digest="$(image_digest "${IMAGE_BASE}-backend:${CURRENT}" || true)"
STATE="$(python3 -c 'import json,sys
d={
 "previous_version": sys.argv[1],
 "current_version": sys.argv[2],
 "previous_frontend_image": sys.argv[3],
 "previous_backend_image": sys.argv[4],
 "previous_frontend_digest": sys.argv[5],
 "previous_backend_digest": sys.argv[6],
 "database_backup": sys.argv[7],
 "update_id": sys.argv[8],
 "status": "in_progress",
 "started_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
}
print(json.dumps(d, ensure_ascii=False))
' "$CURRENT" "$TARGET" "${IMAGE_BASE}-frontend:${CURRENT}" "${IMAGE_BASE}-backend:${CURRENT}" \
  "$prev_frontend_digest" "$prev_backend_digest" "$DB_BACKUP" "$UPDATE_ID_FOR_STATE")"
write_state "$STATE"
info "update state_saved previous=$CURRENT target=$TARGET backup=$DB_BACKUP"

# ---- Pull 新镜像 ----
info "update frontend_pull=start image=$FRONTEND_IMG"
if ! docker pull "$FRONTEND_IMG"; then
  critical "update_failed error_code=UPDATE_PULL_FAILED image=$FRONTEND_IMG"
  exit 1
fi
info "update frontend_pull=completed image=$FRONTEND_IMG"
info "update backend_pull=start image=$BACKEND_IMG"
if ! docker pull "$BACKEND_IMG"; then
  critical "update_failed error_code=UPDATE_PULL_FAILED image=$BACKEND_IMG"
  exit 1
fi
info "update backend_pull=completed image=$BACKEND_IMG"

# ---- 校验 digest ----
frontend_digest="$(image_digest "$FRONTEND_IMG" || true)"
backend_digest="$(image_digest "$BACKEND_IMG" || true)"
info "update frontend_digest=$frontend_digest backend_digest=$backend_digest"
if [ -z "$frontend_digest" ] || [ -z "$backend_digest" ]; then
  critical "update_failed error_code=UPDATE_IMAGE_VERIFY_FAILED reason=digest_missing frontend=$frontend_digest backend=$backend_digest"
  exit 1
fi

# ---- 切换版本并启动（禁止 down -v / prune）----
write_app_version "$TARGET"
export APP_VERSION="$TARGET"
info "update switching=start version=$TARGET"
docker compose -f "$PROD_COMPOSE" up -d --no-build
info "update compose_up=completed version=$TARGET"

# ---- 全链路健康检查 ----
if wait_healthy; then
  UPDATE_SUCCESS=1
  info "update=success version=$TARGET"
  # 更新 state 为 success，并追加 history
  STATE_SUCCESS="$(python3 -c 'import json,sys
d=json.loads(sys.argv[1]); d["status"]="success"; d["completed_at"]=__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(); print(json.dumps(d, ensure_ascii=False))
' "$STATE")"
  write_state "$STATE_SUCCESS"
  append_history "$STATE_SUCCESS"
  prune_backups "$DB_BACKUP"
  info "update finished=success version=$TARGET backup=$DB_BACKUP"
  exit 0
fi

# ---- 健康检查失败：保存日志 + 自动回滚 ----
UPDATE_SUCCESS=0
error "update_healthcheck_failed error_code=UPDATE_HEALTHCHECK_FAILED version=$TARGET"
save_failed_logs "update-failed"

info "update automatic_rollback=start restore_db=yes"
if perform_rollback "yes"; then
  # 回滚成功，但本次部署失败：state 标记失败
  STATE_FAIL="$(python3 -c 'import json,sys
d=json.loads(sys.argv[1]); d["status"]="failed_rolled_back"; d["completed_at"]=__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(); print(json.dumps(d, ensure_ascii=False))
' "$STATE")"
  write_state "$STATE_FAIL"
  append_history "$STATE_FAIL"
  critical "update=FAILED error_code=UPDATE_HEALTHCHECK_FAILED version=$TARGET rolled_back=success to=$CURRENT"
else
  critical "update=FAILED error_code=UPDATE_ROLLBACK_FAILED version=$TARGET rolled_back=failed"
  echo "==========================================================" >&2
  echo "ROLLBACK FAILED" >&2
  echo "previous_version : v$CURRENT" >&2
  echo "backup_path      : $DB_BACKUP" >&2
  echo "deployment_log   : $LOG_FILE" >&2
  echo "manual recovery  : ./scripts/rollback.sh --restore-db" >&2
  echo "==========================================================" >&2
fi

# 部署失败：本次调用返回失败（即使自动回滚成功）
exit 1