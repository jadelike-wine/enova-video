#!/usr/bin/env bash
# =============================================================================
# 共享函数库：被 scripts/update.sh 与 scripts/rollback.sh 引用。
# 职责：版本/SemVer、部署状态、更新锁、PostgreSQL backup、镜像 digest、健康检查、
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
UPDATE_COMPOSE="$ROOT_DIR/docker-compose.update.yml"

# Compose does not automatically read .deploy/version.env. Load the deployment
# version into the shell before any config/up/exec invocation so interpolation
# is deterministic and never falls back to an empty image tag.
load_deployment_version() {
  if [ -n "${APP_VERSION:-}" ] || [ ! -f "$VERSION_ENV_FILE" ]; then
    return 0
  fi
  local v
  v="$(grep -E '^APP_VERSION=' "$VERSION_ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '[:space:]')"
  if [ -n "$v" ]; then
    export APP_VERSION="$v"
  fi
}

# 读取 .env 中的布尔开关（兼容带引号的 true），为 true 时返回 0
dotenv_bool() {
  local key="$1"
  [ -f "$ROOT_DIR/.env" ] || return 1
  grep -qE "^${key}=[\"']?true[\"']?[[:space:]]*$" "$ROOT_DIR/.env"
}

# ---- 更新/回滚用的 compose 文件组合（up / precheck 共用）----
# 启用后台一键更新（UPDATE_ENABLED=true，环境变量或 .env）时必须带上
# docker-compose.update.yml：否则 compose up 重建 api 容器会丢失
# /var/run/docker.sock 与 /host/repo 挂载，下一次后台更新会因连不上
# Docker daemon 而失败（见 docs/OPS.md 7.3）。
COMPOSE_UP_FILES=(-f "$PROD_COMPOSE")
if { [ "${UPDATE_ENABLED:-}" = "true" ] || dotenv_bool UPDATE_ENABLED; } && [ -f "$UPDATE_COMPOSE" ]; then
  COMPOSE_UP_FILES+=(-f "$UPDATE_COMPOSE")
fi

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
BACKUP_DATABASE_FILE=""

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
    # 引号包裹会让 bash 把 "$_LOCK_FD" 当作命令名而非 fd 重定向，须用 eval 求值。
    eval "exec ${_LOCK_FD}>&-"
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

compose_resolved_image() {
  local service="$1"
  docker compose "${COMPOSE_UP_FILES[@]}" config --format json |
    python3 -c 'import json,sys
service=sys.argv[1]
model=json.load(sys.stdin)
image=model.get("services",{}).get(service,{}).get("image","")
if not image:
    raise SystemExit(f"missing image for {service}")
print(image)' "$service"
}

verify_compose_images() {
  local expected_version="$1"
  local expected_api="${IMAGE_BASE}-api:${expected_version}"
  local expected_worker="${IMAGE_BASE}-worker:${expected_version}"
  local expected_web="${IMAGE_BASE}-web:${expected_version}"
  local api_image worker_image web_image
  api_image="$(compose_resolved_image api)" || return 1
  worker_image="$(compose_resolved_image worker)" || return 1
  web_image="$(compose_resolved_image web)" || return 1
  info "compose_resolved api_image=$api_image worker_image=$worker_image web_image=$web_image"
  [ "$api_image" = "$expected_api" ] &&
    [ "$worker_image" = "$expected_worker" ] &&
    [ "$web_image" = "$expected_web" ]
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
# PostgreSQL 一致性 backup
# 通过 postgres 容器内 pg_dump 生成一致性快照（非 SQLite）。
# 输出：backups/<utc>_v<cur>_before_v<target>.sql（宿主机路径）
# =============================================================================
backup_database() {
  local cur="$1" target="$2"
  local ts dbfile user db
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  dbfile="$BACKUP_DIR/${ts}_v${cur}_before_v${target}.sql"
  mkdir -p "$BACKUP_DIR"

  # 从 postgres 容器读取实际用户/库名（避免硬编码，兼容 .env 覆盖）
  user="$(docker compose -f "$PROD_COMPOSE" exec -T postgres printenv POSTGRES_USER 2>/dev/null | tr -d '\r' || echo enova)"
  db="$(docker compose -f "$PROD_COMPOSE" exec -T postgres printenv POSTGRES_DB 2>/dev/null | tr -d '\r' || echo enova)"

  info "database_backup=started file=$dbfile user=$user db=$db"
  if ! docker compose -f "$PROD_COMPOSE" exec -T postgres pg_dump -U "$user" -d "$db" > "$dbfile" 2>>"$LOG_FILE"; then
    error "database_backup=failed error_code=DATABASE_BACKUP_FAILED"
    rm -f "$dbfile"
    return 1
  fi
  if [ ! -s "$dbfile" ]; then
    rm -f "$dbfile"
    error "database_backup=failed error_code=DATABASE_BACKUP_FAILED file_empty=1"
    return 1
  fi
  info "database_backup=completed file=$dbfile"
  BACKUP_DATABASE_FILE="$dbfile"
}

# 清理旧 backup，保留最近 N 个，但绝不动 state.json 引用的当前/上一个 backup
prune_backups() {
  local keep="$UPDATE_BACKUP_KEEP"
  local protected="$1"  # 需保留的文件（当前/上一个部署仍可能需要）
  local list
  list="$(ls -1 "$BACKUP_DIR"/*.sql 2>/dev/null || true)"
  [ -z "$list" ] && return 0
  # 按名称排序（含 UTC 时间戳），保留前 keep 名
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
# api /health（容器内直连，验证 api 已就绪 -> 迁移已执行）
api_health() {
  docker compose -f "$PROD_COMPOSE" exec -T api sh -c \
    'wget -q -O /dev/null http://127.0.0.1:3001/api/v1/health' 2>/dev/null
}

container_diagnostics() {
  local svc="$1" id
  id="$(docker compose "${COMPOSE_UP_FILES[@]}" ps -q "$svc" 2>/dev/null || true)"
  if [ -z "$id" ]; then
    info "container_state service=$svc state=missing"
    return 0
  fi
  docker inspect --format \
    "container_state service=$svc container_id={{.Id}} image={{.Config.Image}} state={{.State.Status}} exit_code={{.State.ExitCode}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" \
    "$id" 2>/dev/null || info "container_state service=$svc state=inspect_failed"
}

wait_service_healthy() {
  local svc="$1" attempts="${HEALTH_ATTEMPTS}" interval="${HEALTH_INTERVAL}" i id state health
  for ((i=1; i<=attempts; i++)); do
    id="$(docker compose "${COMPOSE_UP_FILES[@]}" ps -q "$svc" 2>/dev/null || true)"
    state=""
    health=""
    if [ -n "$id" ]; then
      state="$(docker inspect --format '{{.State.Status}}' "$id" 2>/dev/null || true)"
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || true)"
    fi
    if [ "$state" = "running" ] && [ "$health" = "healthy" ]; then
      info "container_health=ok service=$svc attempts=$i state=$state health=$health"
      return 0
    fi
    if [ "$state" = "running" ] && [ "$health" = "none" ] && [ "$svc" = "worker" ]; then
      info "container_health=ok service=$svc attempts=$i state=$state health=$health"
      return 0
    fi
    if [ "$i" -lt "$attempts" ]; then sleep "$interval"; fi
  done
  info "container_health=failed service=$svc attempts=$attempts state=${state:-missing} health=${health:-missing}"
  container_diagnostics "$svc"
  return 1
}

compose_switch_services() {
  local version="$1"
  info "compose_command=docker compose ${COMPOSE_UP_FILES[*]} up -d --no-build --no-deps postgres redis api APP_VERSION=$version"
  if ! docker compose "${COMPOSE_UP_FILES[@]}" up -d --no-build --no-deps postgres redis api; then
    error "switch_failed error_code=UPDATE_SWITCH_FAILED phase=api"
    return 1
  fi
  if ! wait_service_healthy postgres || ! wait_service_healthy redis; then
    error "container_unhealthy error_code=UPDATE_CONTAINER_UNHEALTHY phase=dependencies"
    return 1
  fi
  if ! wait_service_healthy api; then
    error "api_healthcheck_failed error_code=UPDATE_API_HEALTHCHECK_FAILED"
    return 1
  fi

  info "compose_command=docker compose ${COMPOSE_UP_FILES[*]} up -d --no-build --no-deps web worker APP_VERSION=$version"
  if ! docker compose "${COMPOSE_UP_FILES[@]}" up -d --no-build --no-deps web worker; then
    error "switch_failed error_code=UPDATE_SWITCH_FAILED phase=web_worker"
    return 1
  fi
  if ! wait_service_healthy web || ! wait_service_healthy worker; then
    error "container_unhealthy error_code=UPDATE_CONTAINER_UNHEALTHY phase=web_worker"
    return 1
  fi
}

# 失败时保存 new 版本的 Docker 日志（Rollback 后仍可调查）
save_failed_logs() {
  local tag="$1"
  for svc in api worker web; do
    if docker compose "${COMPOSE_UP_FILES[@]}" ps --services 2>/dev/null | grep -qx "$svc"; then
      docker compose "${COMPOSE_UP_FILES[@]}" logs --no-color --tail=200 "$svc" > "$LOG_DIR/${tag}-${svc}-${UPDATE_ID}.log" 2>&1 || true
      info "failed_logs_saved svc=$svc file=${LOG_DIR}/${tag}-${svc}-${UPDATE_ID}.log"
      container_diagnostics "$svc"
    fi
  done
}

# 全链路健康检查：web / + web /api/v1/health（经 Next rewrite 代理到 api，等效检验 api）
# 返回 0 = 全部健康；返回 1 = 失败
wait_healthy() {
  local attempts="$HEALTH_ATTEMPTS" interval="$HEALTH_INTERVAL"
  local i
  for ((i=1; i<=attempts; i++)); do
    local ok=1
    if ! curl -fsS --max-time 5 "$FRONTEND_URL/" >/dev/null 2>&1; then ok=0; fi
    if ! curl -fsS --max-time 5 "$FRONTEND_URL/api/v1/health" >/dev/null 2>&1; then ok=0; fi
    if [ "$ok" -eq 1 ]; then
      info "healthcheck=ok attempts=$i web=ok api_proxy=ok"
      return 0
    fi
    if [ "$i" -lt "$attempts" ]; then
      sleep "$interval"
    fi
  done
  info "healthcheck=failed error_code=UPDATE_HEALTHCHECK_FAILED attempts=$attempts"
  return 1
}

reported_version_matches() {
  local expected="$1" actual
  actual="$(curl -fsS --max-time 5 "$FRONTEND_URL/api/v1/health" 2>/dev/null |
    python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("version", ""))
except Exception:
    print("")')"
  if [ "$actual" = "$expected" ]; then
    info "versioncheck=ok expected=$expected"
    return 0
  fi
  error "version_check_failed error_code=UPDATE_VERSION_CHECK_FAILED expected=$expected reported=${actual:-missing}"
  return 1
}

# =============================================================================
# 预检
# =============================================================================
precheck() {
  if ! command -v docker >/dev/null 2>&1; then error "precheck docker_missing error_code=UPDATE_PRECHECK_FAILED"; return 1; fi
  if [ -z "${APP_VERSION:-}" ]; then error "precheck app_version_missing error_code=UPDATE_PRECHECK_FAILED"; return 1; fi
  if ! docker compose "${COMPOSE_UP_FILES[@]}" config -q; then error "precheck compose_invalid error_code=UPDATE_PRECHECK_FAILED"; return 1; fi
  if ! verify_compose_images "$APP_VERSION"; then error "precheck image_resolution_failed error_code=UPDATE_PRECHECK_FAILED"; return 1; fi
  info "precheck=ok"
  return 0
}

# =============================================================================
# 数据库恢复（仅用于回滚，非常规操作）
# PostgreSQL：停 api/worker -> drop+recreate 库 -> 导入备份 -> 由 perform_rollback 重启。
# =============================================================================
restore_database() {
  local file="$1"
  local user db
  user="$(docker compose -f "$PROD_COMPOSE" exec -T postgres printenv POSTGRES_USER 2>/dev/null | tr -d '\r' || echo enova)"
  db="$(docker compose -f "$PROD_COMPOSE" exec -T postgres printenv POSTGRES_DB 2>/dev/null | tr -d '\r' || echo enova)"
  info "database_restore=started file=$file user=$user db=$db"

  # 先停应用容器，避免恢复期间写入
  docker compose -f "$PROD_COMPOSE" stop api worker || true

  # drop + recreate（清空旧数据，再用备份覆盖；会丢失备份之后的新数据）
  if ! docker compose -f "$PROD_COMPOSE" exec -T postgres sh -c \
    "psql -v ON_ERROR_STOP=1 -U '$user' -d postgres -c 'DROP DATABASE IF EXISTS \"$db\"' -c 'CREATE DATABASE \"$db\" OWNER \"$user\"'" >/dev/null 2>>"$LOG_FILE"; then
    error "database_restore=failed error_code=DATABASE_RESTORE_FAILED reason=drop_create"
    return 1
  fi

  if ! docker compose -f "$PROD_COMPOSE" exec -T postgres sh -c "psql -v ON_ERROR_STOP=1 -U '$user' -d '$db'" < "$file" >>"$LOG_FILE" 2>&1; then
    error "database_restore=failed error_code=DATABASE_RESTORE_FAILED reason=import"
    return 1
  fi
  info "database_restore=completed"
  return 0
}

# =============================================================================
# 执行回滚（自动与手动共用）。restore_db: yes|no
# 成功后：补齐 health；失败则输出 CRITICAL + 恢复指引。
# =============================================================================
perform_rollback() {
  local restore_db="$1"
  local state prev db_backup api_img worker_img web_img
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
  api_img="${IMAGE_BASE}-api:${prev}"
  worker_img="${IMAGE_BASE}-worker:${prev}"
  web_img="${IMAGE_BASE}-web:${prev}"
  db_backup="$(printf '%s' "$state" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("database_backup") or "")
except Exception:
    print("")
')"

  info "rollback previous_version=$prev api_image=$api_img worker_image=$worker_img web_image=$web_img restore_db=$restore_db"

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
  info "rollback switching=start version=$prev compose_files=${COMPOSE_UP_FILES[*]}"
  if ! compose_switch_services "$prev"; then
    save_failed_logs "rollback"
    critical "rollback_failed error_code=UPDATE_ROLLBACK_FAILED compose_up_failed version=$prev"
    return 1
  fi

  if wait_healthy && reported_version_matches "$prev"; then
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
