#!/bin/bash
# ============================================================
# P0-6: 日常灾备备份脚本
#
# 功能：
#   - PostgreSQL 全量一致性备份（pg_dump --format=custom）
#   - 备份文件上传到 S3（如配置了 BACKUP_S3_BUCKET）
#   - 保留周期管理（自动删除过期备份）
#   - 原子写入：先写临时文件，成功后原子重命名
#   - 完整性验证：pg_restore --list 校验
#   - 与版本回滚备份区分（版本备份在 .deploy/，灾备在 backups/）
#
# 用法：
#   ./scripts/backup.sh                    # 执行备份
#   ./scripts/backup.sh --restore <file>   # 从备份恢复（需确认）
#   ./scripts/backup.sh --list             # 列出本地备份
#   ./scripts/backup.sh --cleanup          # 清理过期备份
#
# 环境变量：
#   BACKUP_DIR             本地备份目录（默认 ./backups）
#   BACKUP_RETENTION_DAYS  保留天数（默认 30）
#   BACKUP_S3_BUCKET       S3 备份桶（设置后强制上传，缺失则报错退出）
#   BACKUP_S3_PREFIX       S3 前缀（默认 enova-backups）
#   DATABASE_URL           PostgreSQL 连接串（生产必填，不回退默认密码）
#
# 安全：
#   - 不在日志中输出完整 DATABASE_URL、密码或密钥
#   - 生产模式禁止使用默认弱密码
#   - S3 上传失败时返回非零退出码
#   - 恢复操作需要显式确认
#
# Cron 安装（每天凌晨 3 点备份）：
#   crontab -e
#   0 3 * * * /opt/enova-video/scripts/backup.sh >> /var/log/enova-backup.log 2>&1
# 验证 cron 是否正常运行：
#   systemctl status cron  # 或 service crond status
#   tail -f /var/log/enova-backup.log
# ============================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-enova-backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# ---- 解析数据库连接（不输出密码到日志）----
if [[ -n "${DATABASE_URL:-}" ]]; then
  DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\).*/\1/p')
  DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):\([0-9]*\).*/\2/p')
  DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
  DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

  # 安全检查：禁止默认弱密码
  if [[ "${DB_PASS:-}" == "enova" ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: Refusing to use default password 'enova' in backup." >&2
    exit 1
  fi
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: DATABASE_URL is required." >&2
  exit 1
fi

# ---- 辅助函数 ----

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

# 安全日志：输出数据库信息但不输出密码
log_db_info() {
  log "  Database: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
}

# ---- 命令处理 ----

case "${1:-}" in
  --restore)
    BACKUP_FILE="${2:?Usage: backup.sh --restore <file>}"
    if [[ ! -f "$BACKUP_FILE" ]]; then
      log "ERROR: Backup file not found: $BACKUP_FILE"
      exit 1
    fi

    # 安全确认：防止误覆盖生产库（二次确认）
    echo "WARNING: This will OVERWRITE database ${DB_NAME} at ${DB_HOST}:${DB_PORT}."
    echo "  Backup file: $BACKUP_FILE"
    echo "  Target: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
    echo ""
    echo "This is a DESTRUCTIVE operation. Type the database name to confirm:"
    read -r confirmation
    if [[ "$confirmation" != "$DB_NAME" ]]; then
      log "Restore cancelled — confirmation did not match database name."
      exit 0
    fi

    log "Restoring from $BACKUP_FILE..."
    log_db_info
    PGPASSWORD="$DB_PASS" pg_restore \
      --host="$DB_HOST" \
      --port="$DB_PORT" \
      --username="$DB_USER" \
      --dbname="$DB_NAME" \
      --clean --if-exists --no-owner --no-privileges \
      --verbose \
      "$BACKUP_FILE"
    log "Restore complete."
    ;;

  --list)
    log "Local backups in $BACKUP_DIR:"
    ls -lh "$BACKUP_DIR"/enova_*.dump 2>/dev/null || echo "  (none)"
    ;;

  --cleanup)
    log "Cleaning up backups older than $BACKUP_RETENTION_DAYS days..."
    find "$BACKUP_DIR" -name "enova_*.dump" -mtime +$BACKUP_RETENTION_DAYS -delete 2>/dev/null || true
    log "Cleanup complete."
    ;;

  "")
    # ---- 执行备份 ----
    mkdir -p "$BACKUP_DIR"

    # 原子写入：先写到临时文件，成功后原子重命名
    TEMP_FILE="${BACKUP_DIR}/.enova_${TIMESTAMP}.dump.tmp"
    FINAL_FILE="${BACKUP_DIR}/enova_${TIMESTAMP}.dump"

    log "Starting PostgreSQL backup..."
    log_db_info
    log "  Output: $FINAL_FILE (via temp: $TEMP_FILE)"

    # 执行 pg_dump 到临时文件
    if ! PGPASSWORD="$DB_PASS" pg_dump \
      --host="$DB_HOST" \
      --port="$DB_PORT" \
      --username="$DB_USER" \
      --dbname="$DB_NAME" \
      --format=custom \
      --no-owner --no-privileges \
      --verbose \
      --file="$TEMP_FILE" 2>&1; then
      rm -f "$TEMP_FILE"
      log "ERROR: pg_dump failed for database ${DB_NAME}"
      exit 1
    fi

    # 验证备份完整性（在重命名之前）
    log "Verifying backup integrity..."
    if ! PGPASSWORD="$DB_PASS" pg_restore --list "$TEMP_FILE" &>/dev/null; then
      rm -f "$TEMP_FILE"
      log "ERROR: Backup verification failed (pg_restore --list)"
      exit 1
    fi
    log "Backup verification: OK"

    # 原子重命名
    mv "$TEMP_FILE" "$FINAL_FILE"

    local_size=$(stat -c%s "$FINAL_FILE" 2>/dev/null || stat -f%z "$FINAL_FILE" 2>/dev/null || echo 0)
    log "Backup created: $FINAL_FILE ($local_size bytes)"

    # ---- 上传到 S3 ----
    # 生产环境必须配置异地备份。
    if [[ -z "$BACKUP_S3_BUCKET" ]]; then
      if [[ "${NODE_ENV:-}" == "production" ]]; then
        log "ERROR: BACKUP_S3_BUCKET is required in production for offsite backup."
        log "  Set BACKUP_S3_BUCKET or run in non-production mode."
        rm -f "$FINAL_FILE"
        exit 1
      fi
      log "Warning: BACKUP_S3_BUCKET not set — local-only backup (not suitable for production)."
    else
      # AWS CLI 必须存在
      if ! command -v aws &>/dev/null; then
        log "ERROR: aws CLI not found but BACKUP_S3_BUCKET is set."
        log "  Install AWS CLI or unset BACKUP_S3_BUCKET for local-only backup."
        exit 1
      fi

      s3_key="${BACKUP_S3_PREFIX}/$(date +%Y/%m/%d)/enova_${TIMESTAMP}.dump"
      log "Uploading to s3://$BACKUP_S3_BUCKET/$s3_key..."

      if ! aws s3 cp "$FINAL_FILE" "s3://$BACKUP_S3_BUCKET/$s3_key" --no-progress; then
        log "ERROR: S3 upload failed for $FINAL_FILE"
        exit 1
      fi

      # 验证远端对象存在
      if ! aws s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$s3_key" &>/dev/null; then
        log "ERROR: S3 upload verification failed — object not found after upload"
        exit 1
      fi

      log "Upload verified: s3://$BACKUP_S3_BUCKET/$s3_key"
    fi

    # ---- 清理过期本地备份 ----
    find "$BACKUP_DIR" -name "enova_*.dump" -mtime +$BACKUP_RETENTION_DAYS -delete 2>/dev/null || true

    log "Backup completed successfully."
    ;;

  *)
    echo "Usage: $0 [--restore <file> | --list | --cleanup]"
    exit 1
    ;;
esac
