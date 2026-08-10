#!/usr/bin/env bash
# =============================================================================
# 共享函数库：被 scripts/update.sh 与 scripts/rollback.sh 引用。
# 职责：版本/SemVer、部署状态、更新锁、SQLite backup、镜像 digest、健康检查、
#       带 update_id 的统一日志（stdout + .deploy/logs/）。
# 安全：绝不写入 Secret；绝不 down -v / prune；绝不依赖 latest 升级。
# =============================================================================
set -euo pipefail

# ---- 路径常量（脚本以仓库根目录执行）----
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/.deploy"
LOG_DIR="$DEPLOY_DIR/logs"
STATE_FILE="$DEPLOY_DIR/state.json"
HISTORY_FILE="$DEPLOY_DIR/history.json"
VERSION_ENV_FILE="$DEPLOY_DIR/version.env"
LOCK_FILE="$DEPLOY_DIR/update.lock"
BACKUP_DIR="$ROOT_DIR/backups"
PROD_COMPOSE="$ROOT_DIR/docker-compose.prod.yml"

# 镜像仓库前缀（GHCR）
IMAGE_BASE="ghcr.io/jadelike-wine/enova-video"

# ---- 可配置（环境变量覆盖，见 .env.example）----
UPDATE_BACKUP_KEEP="${UPDATE_BACKUP_KEEP:-5}"
HEALTH_ATTEMPTS="${UPDATE_HEALTH_ATTEMPTS:-30}"
HEALTH_INTERVAL="${UPDATE_HEALTH_INTERVAL:-2}"
# 前端对外地址（宿主机上容器 3000 端口映射）
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"

# ---- 全局：update_id / 日志文件 / 锁 fd ----
UPDATE_ID=""
LOG_FILE=""
_LOCK_FD=""

# =============================================================================
# 日志
# =============================================================================
log() {
  local level="$1"; shift
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $level update_id=${UPDATE_ID:-none} $*"
  echo "$line"
  if [ -n "$LOG_FILE" ]; then
    echo "$line" >> "$LOG_FILE"
  fi
}
info()    { log "INFO  " "$@"; }
warn()    { log "WARN  " "$@"; }
error()   { log "ERROR " "$@"; }
critical() { log "CRITICAL" "$@"; }

# 初始化日志文件并设置 update_id
init_log() {
  local tag="${1:-update}"
  UPDATE_ID="$(generate_update_id)"
  mkdir -p "$LOG_DIR"
  LOG_FILE="$LOG_DIR/${tag}-$(date -u +%Y%m%dT%H%M%SZ)-${UPDATE_ID}.log"
  info "log_file=$LOG_FILE"
}

generate_update_id() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-Z' 'a-z'
  else
    head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# =============================================================================
# 更新锁：update 与 rollback 互斥。
# 优先 flock（Linux 服务器）；缺失时（如 macOS 开发机）回退 mkdir 原子锁。
# 目的不是防并发性能，而是防止 update/update/rollback 同时执行。
# =============================================================================
LOCK_MKDIR_DIR="$DEPLOY_DIR/update.lock.d"
_LOCK_MODE="none"

acquire_lock() {
  mkdir -p "$DEPLOY_DIR"
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK_FILE"
    if flock -n 9; then
      _LOCK_MODE="flock"
      _LOCK_FD=9
      return 0
    fi
    echo "ERROR 另一个 update/rollback 正在执行中（$LOCK_FILE 被占用），已退出。" >&2
    return 1
  fi
  # flock 不可用：mkdir 原子锁（幂等，某进程崩溃后目录残留需人工清理）
  if mkdir "$LOCK_MKDIR_DIR" 2>/dev/null; then
    _LOCK_MODE="mkdir"
    return 0
  fi
  echo "ERROR 另一个 update/rollback 正在执行中（$LOCK_MKDIR_DIR 存在），已退出。" >&2
  return 1
}
release_lock() {
  if [ "$_LOCK_MODE" = "flock" ] && [ -n "$_LOCK_FD" ]; then
    flock -u "$_LOCK_FD"
    exec "$_LOCK_FD">&-
    _LOCK_FD=""
  elif [ "$_LOCK_MODE" = "mkdir" ]; then
    rmdir "$LOCK_MKDIR_DIR" 2>/dev/null || true
  fi
  _LOCK_MODE="none"
}

# =============================================================================
# 版本 / SemVer
# =============================================================================
SEMVER_RE='^v?[0-9]+\.[0-9]+\.[0-9]+$'

validate_semver() {
  [[ "$1" =~ $SEMVER_RE ]]
}

# 去掉 v 前缀
normalize_version() {
  echo "$1" | sed 's/^v//'
}

# 比较 a b：a>b -> 1, a=b -> 0, a<b -> 2, 非法 -> 255
semver_compare() {
  local a b
  a="$(normalize_version "$1")"; b="$(normalize_version "$2")"
  validate_semver "$a" || return 255
  validate_semver "$b" || return 255
  if [[ "$a" == "$b" ]]; then return 0; fi
  local smaller="$(printf '%s\n%s\n' "$a" "$b" | sort -V | head -n1)"
  if [[ "$smaller" == "$a" ]]; then return 2; else return 1; fi
}

# =============================================================================
# 部署版本（.deploy/version.env）
# =============================================================================
# 读取当前 APP_VERSION（不带 v）
current_app_version() {
  if [ -f "$VERSION_ENV_FILE" ]; then
    local v
    v="$(grep -E '^APP_VERSION=' "$VERSION_ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '[:space:]')"
    normalize_version "${v:-unknown}"
  else
    echo "unknown"
  fi
}

write_app_version() {
  local v="$1"
  mkdir -p "$DEPLOY_DIR"
  printf 'APP_VERSION=%s\n' "$v" > "$VERSION_ENV_FILE"
}

# =============================================================================
# 部署状态（.deploy/state.json / history.json）
# =============================================================================
read_state() {
  if [ -f "$STATE_FILE" ]; then cat "$STATE_FILE"; else echo "{}"; fi
}

write_state() {
  local json="$1"
  mkdir -p "$DEPLOY_DIR"
  printf '%s\n' "$json" > "$STATE_FILE"
}

append_history() {
  local json="$1"
  mkdir -p "$DEPLOY_DIR"
  local arr="[]"
  if [ -f "$HISTORY_FILE" ]; then
    arr="$(cat "$HISTORY_FILE")"
  fi
  # 用 python 做安全 JSON 追加
  UPDATE_HISTORY_FILE="$HISTORY_FILE" UPDATE_HISTORY_ITEM="$json" python3 - <<'PY'
import json, os
p = os.environ["UPDATE_HISTORY_FILE"]
item = json.loads(os.environ["UPDATE_HISTORY_ITEM"])
try:
    arr = json.load(open(p))
    if not isinstance(arr, list):
        arr = []
except Exception:
    arr = []
arr.append(item)
# 只保留最近 50 条，避免无限增长
arr = arr[-50:]
json.dump(arr, open(p, "w"), ensure_ascii=False, indent=2)
PY
}

# =============================================================================
# 镜像 digest
# =============================================================================
# 返回镜像的第一个 RepoDigest（sha256:...），失败返回空
image_digest() {
  local name="$1"
  docker image inspect --format '{{index .RepoDigests 0}}' "$name" 2>/dev/null | sed 's/.*@//' || true
}

# =============================================================================
# SQLite 一致性 backup
# 通过 backend 容器内 sqlite3.Connection.backup() 生成一致性快照。
# 输出：backups/<utc>_v<cur>_before_v<target>.db（宿主机路径）
# =============================================================================
backup_sqlite() {
  local cur="$1" target="$2"
  local ts dbfile in_container_path
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  dbfile="$BACKUP_DIR/${ts}_v${cur}_before_v${target}.db"
  in_container_path="/backups/$(basename "$dbfile")"
  mkdir -p "$BACKUP_DIR"

  info "database_backup=started target=$in_container_path"
  if ! docker compose -f "$PROD_COMPOSE" exec -T backend python -c 'import sqlite3,sys
src="/data/app.db"; dst=sys.argv[1]
try:
    s=sqlite3.connect(src); d=sqlite3.connect(dst)
    s.backup(d); d.close(); s.close()
    print("BACKUP_OK")
except Exception as e:
    print("BACKUP_ERR", e); sys.exit(1)
' "$in_container_path"; then
    error "database_backup=failed error_code=DATABASE_BACKUP_FAILED"
    return 1
  fi

  if [ ! -s "$dbfile" ]; then
    error "database_backup=failed error_code=DATABASE_BACKUP_FAILED file_empty=1"
    return 1
  fi
  info "database_backup=completed file=$dbfile"
  echo "$dbfile"
}

# 清理旧 backup，保留最近 N 个，但绝不动 state.json 引用的当前/上一个 backup
prune_backups() {
  local keep="$UPDATE_BACKUP_KEEP"
  local protected="$1"  # 需保留的文件（当前/上一个部署仍可能需要）
  local list
  list="$(ls -1 "$BACKUP_DIR"/*.db 2>/dev/null || true)"
  [ -z "$list" ] && return 0
  # 按修改时间倒序，保留前 keep 名
  local newest
  newest="$(printf '%s\n' "$list" | sort | tail -n "$keep")"
  local f
  for f in $list; do
    if [[ "$f" != "$protected" && " $newest " != *" $f "* ]]; then
      warn "prune_backup=$f"
      rm -f "$f"
    fi
  done
}

# =============================================================================
# 健康检查（真实 HTTP，不只看容器状态）
# =============================================================================
# backend /health（容器内直连）
backend_health() {
  docker compose -f "$PROD_COMPOSE" exec -T backend python -c \
    "import urllib.request,sys
try:
    r=urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)
    sys.exit(0 if r.status==200 else 1)
except Exception:
    sys.exit(1)
"
}

# 失败时保存 new 版本的 Docker 日志（Rollback 后仍可调查）
save_failed_logs() {
  local tag="$1"
  for svc in backend frontend; do
    if docker compose -f "$PROD_COMPOSE" ps --services 2>/dev/null | grep -qx "$svc"; then
      docker compose -f "$PROD_COMPOSE" logs --tail=500 "$svc" > "$LOG_DIR/${tag}-${svc}-${UPDATE_ID}.log" 2>&1 || true
      info "failed_logs_saved svc=$svc file=${LOG_DIR}/${tag}-${svc}-${UPDATE_ID}.log"
    fi
  done
}

# 全链路健康检查：backend /health + frontend / + frontend /api/health
# 返回 0 = 全部健康；返回 1 = 失败（参数决定是否输出保存日志）
wait_healthy() {
  local attempts="$HEALTH_ATTEMPTS" interval="$HEALTH_INTERVAL"
  local i
  for ((i=1; i<=attempts; i++)); do
    local ok=1
    if ! backend_health; then ok=0; fi
    if ! curl -fsS --max-time 5 "$FRONTEND_URL/" >/dev/null 2>&1; then ok=0; fi
    if ! curl -fsS --max-time 5 "$FRONTEND_URL/api/health" >/dev/null 2>&1; then ok=0; fi
    if [ "$ok" -eq 1 ]; then
      info "healthcheck=ok attempts=$i backend=ok frontend=ok api_health=ok"
      return 0
    fi
    if [ "$i" -lt "$attempts" ]; then
      sleep "$interval"
    fi
  done
  info "healthcheck=failed error_code=UPDATE_HEALTHCHECK_FAILED attempts=$attempts"
  return 1
}

# =============================================================================
# 预检
# =============================================================================
precheck() {
  if ! command -v docker >/dev/null 2>&1; then error "precheck docker_missing error_code=UPDATE_PRECHECK_FAILED"; return 1; fi
  if ! docker compose -f "$PROD_COMPOSE" config -q; then error "precheck compose_invalid error_code=UPDATE_PRECHECK_FAILED"; return 1; fi
  info "precheck=ok"
  return 0
}

# =============================================================================
# 数据库恢复（仅用于回滚，非常规操作）
# =============================================================================
restore_database() {
  local file="$1"
  info "database_restore=started file=$file"
  docker compose -f "$PROD_COMPOSE" stop backend || true
  docker compose -f "$PROD_COMPOSE" run --rm --no-deps -T backend sh -c \
    "rm -f /data/app.db-wal /data/app.db-shm && cp '/backups/$(basename "$file")' /data/app.db && echo RESTORE_OK" \
    || { error "database_restore=failed error_code=DATABASE_RESTORE_FAILED"; return 1; }
  info "database_restore=completed"
  return 0
}

# =============================================================================
# 执行回滚（自动与手动共用）。restore_db: yes|no
# 成功后：补齐 health；失败则输出 CRITICAL + 恢复指引。
# =============================================================================
perform_rollback() {
  local restore_db="$1"
  local state prev db_backup frontend_img backend_img
  state="$(read_state)"
  prev="$(printf '%s' "$state" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("previous_version") or "")
except Exception:
    print("")
')"
  if [ -z "$prev" ]; then
    critical "rollback_failed error_code=UPDATE_ROLLBACK_FAILED reason=no_previous_version state=$STATE_FILE"
    return 1
  fi
  frontend_img="${IMAGE_BASE}-frontend:${prev}"
  backend_img="${IMAGE_BASE}-backend:${prev}"
  db_backup="$(printf '%s' "$state" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("database_backup") or "")
except Exception:
    print("")
')"

  info "rollback previous_version=$prev frontend_image=$frontend_img backend_image=$backend_img restore_db=$restore_db"

  # 停止当前（候选失败）版本
  info "rollback stop_current=start"
  docker compose -f "$PROD_COMPOSE" stop || warn "rollback stop warn=1"

  # 按需恢复数据库
  if [ "$restore_db" = "yes" ]; then
    if [ -z "$db_backup" ] || [ ! -f "$db_backup" ]; then
      critical "rollback_failed error_code=DATABASE_RESTORE_FAILED reason=backup_missing file=$db_backup"
      return 1
    fi
    if ! restore_database "$db_backup"; then
      critical "rollback_failed error_code=DATABASE_RESTORE_FAILED"
      return 1
    fi
  fi

  # 切换回 previous 版本
  write_app_version "$prev"
  export APP_VERSION="$prev"
  info "rollback switching=start version=$prev"
  docker compose -f "$PROD_COMPOSE" up -d --no-build \
    || { critical "rollback_failed error_code=UPDATE_ROLLBACK_FAILED compose_up_failed version=$prev"; return 1; }

  if wait_healthy; then
    info "rollback=success version=$prev"
    return 0
  else
    save_failed_logs "rollback"
    critical "rollback_failed error_code=UPDATE_ROLLBACK_FAILED reason=healthcheck version=$prev"
    return 1
  fi
}

# =============================================================================
# GitHub 最新 stable release（去 v 前缀；失败返回空）
# =============================================================================
github_latest_stable() {
  local repo="${GITHUB_REPOSITORY:-jadelike-wine/enova-video}"
  local tkn="${GITHUB_TOKEN:-}"
  local auth=()
  if [ -n "$tkn" ]; then auth=(-H "Authorization: Bearer $tkn"); fi
  local json
  json="$(curl -fsS --max-time 10 -H "Accept: application/vnd.github+json" "${auth[@]}" \
    "https://api.github.com/repos/${repo}/releases?per_page=20" 2>/dev/null || true)"
  if [ -z "$json" ]; then return 0; fi
  # 过滤 draft/prerelease，取 SemVer 最高
  printf '%s' "$json" | python3 -c '
import json,sys,re
try:
    releases=json.load(sys.stdin)
except Exception:
    sys.exit(0)
sem=re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
best=None; bestv=None
for r in releases:
    if r.get("draft") or r.get("prerelease"): continue
    tag=str(r.get("tag_name",""))
    m=sem.match(tag)
    if not m: continue
    key=tuple(int(x) for x in m.groups())
    if bestv is None or key>bestv:
        bestv=key; best=tag
if best: print(best.lstrip("v"))
'
}