#!/usr/bin/env bash
# =============================================================================
# 手动回滚脚本。
#
#   ./scripts/rollback.sh                  # 回退到上一个成功版本（code-only）
#   ./scripts/rollback.sh --code-only      # 只回滚 api/worker/web，保持当前数据库
#   ./scripts/rollback.sh --restore-db     # 回滚代码 + 恢复 pre-update PostgreSQL 备份
#
# 安全：
#   - 默认 code-only：新版本已成功运行后，绝不偷偷恢复旧 DB（避免丢新数据）。
#   - --restore-db 会删除备份之后的「新数据」，必须显式确认。
#   - 必须显式确认，除非 AUTO_CONFIRM=1（供自动化/受控场景）。
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
source "$SCRIPT_DIR/lib.sh"

MODE="code-only"

for arg in "$@"; do
  case "$arg" in
    --code-only) MODE="code-only" ;;
    --restore-db) MODE="restore-db" ;;
    -h|--help)
      echo "用法: $0 [--code-only|--restore-db]"
      echo "  --code-only    只回滚 api/worker/web（默认），保持当前数据库"
      echo "  --restore-db   回滚代码 + 恢复 pre-update PostgreSQL 备份（会丢新数据）"
      exit 0
      ;;
    --*) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

init_log "rollback"

if ! acquire_lock; then
  critical "rollback_aborted error_code=UPDATE_ROLLBACK_FAILED reason=lock_busy"
  exit 1
fi
trap 'release_lock' EXIT

# ---- 读取 state 里的 previous 版本 ----
state="$(read_state)"
prev="$(printf '%s' "$state" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("previous_version") or "")
except Exception:
    print("")
')"
if [ -z "$prev" ]; then
  critical "rollback_aborted error_code=UPDATE_ROLLBACK_FAILED reason=no_previous_version state=$STATE_FILE"
  exit 1
fi
info "rollback target_previous=$prev mode=$MODE"

# ---- 版本检查：不能把当前和 previous 混为一谈 ----
current="$(current_app_version)"
if [ "$current" = "$prev" ]; then
  warn "rollback current_equals_previous=1 version=$prev (nothing to roll back)"
  exit 0
fi

# ---- --restore-db 必须确认（数据丢失风险）----
if [ "$MODE" = "restore-db" ]; then
  echo "==========================================================" >&2
  echo "警告：--restore-db 会恢复 pre-update PostgreSQL 备份，" >&2
  echo "      将删除备份时间点之后产生的所有新数据。" >&2
  echo "==========================================================" >&2
  if [ "${AUTO_CONFIRM:-0}" != "1" ]; then
    read -r -p "确认恢复旧数据库并回滚代码？(输入 yes 继续): " ans
    if [ "$ans" != "yes" ]; then
      info "rollback_aborted reason=user_cancelled mode=restore-db"
      exit 1
    fi
  fi
  if perform_rollback "yes"; then
    info "rollback=success mode=restore-db version=$prev"
    exit 0
  fi
  critical "rollback=FAILED error_code=UPDATE_ROLLBACK_FAILED mode=restore-db"
  exit 1
fi

# ---- 默认：code-only ----
if perform_rollback "no"; then
  info "rollback=success mode=code-only version=$prev (database kept)"
  exit 0
fi
critical "rollback=FAILED error_code=UPDATE_ROLLBACK_FAILED mode=code-only"
exit 1