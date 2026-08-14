# 备份与灾难恢复

## 概述

本文档描述 EnovaMotion 的备份策略，包括**日常灾备备份**和**版本回滚备份**两种。

| 类型 | 用途 | 脚本 | 存储位置 | 频率 |
|------|------|------|----------|------|
| 日常灾备 | 数据恢复、灾难恢复 | `scripts/backup.sh` | `backups/` + S3 | 每日定时 |
| 版本回滚 | 版本更新前备份 | `scripts/update.sh`（内置） | `.deploy/` | 每次更新 |

两种备份**互不替代**：版本回滚备份服务于代码版本管理，日常灾备服务于数据安全。

## 日常灾备备份

### 配置

| 环境变量 | 必填 | 说明 | 默认值 |
|----------|------|------|--------|
| `DATABASE_URL` | 是 | PostgreSQL 连接串 | - |
| `BACKUP_DIR` | 否 | 本地备份目录 | `./backups` |
| `BACKUP_RETENTION_DAYS` | 否 | 保留天数 | `30` |
| `BACKUP_S3_BUCKET` | 否 | S3 备份桶（设置后自动上传） | - |
| `BACKUP_S3_PREFIX` | 否 | S3 前缀 | `enova-backups` |
| `BACKUP_NOTIFY_EMAIL` | 否 | 备份失败通知邮箱 | - |

### 执行备份

```bash
# 手动执行
./scripts/backup.sh

# 列出本地备份
./scripts/backup.sh --list

# 清理过期备份
./scripts/backup.sh --cleanup
```

### 定时备份（Cron）

```bash
# 编辑 crontab
crontab -e

# 每天凌晨 3 点执行备份
0 3 * * * /opt/enova-video/scripts/backup.sh >> /var/log/enova-backup.log 2>&1
```

### S3 远程备份

设置 `BACKUP_S3_BUCKET` 后，备份脚本会自动将备份文件上传到 S3：

```bash
export BACKUP_S3_BUCKET=my-enova-backups
export BACKUP_S3_PREFIX=enova-backups
export AWS_REGION=ap-southeast-1
# 确保 AWS CLI 已配置凭证
```

S3 上的备份路径：`s3://<bucket>/<prefix>/<yyyy>/<mm>/<dd>/enova_<timestamp>.dump`

建议在 S3 桶上配置**生命周期规则**自动删除过期备份（如 90 天）。

### 备份验证

每次备份完成后自动执行完整性验证（`pg_restore --list`）。验证失败会：
1. 记录错误日志
2. 发送告警邮件（如配置了 `BACKUP_NOTIFY_EMAIL`）
3. 退出码 1（cron 可检测）

### 备份失败告警

设置 `BACKUP_NOTIFY_EMAIL` 和 SMTP 环境变量后，备份失败会自动发送邮件通知：

```bash
export BACKUP_NOTIFY_EMAIL=ops@example.com
export SMTP_HOST=smtp.example.com
export SMTP_PORT=587
export SMTP_USER=noreply@example.com
export SMTP_PASSWORD=your-smtp-password
export SMTP_FROM_EMAIL=noreply@example.com
```

## 恢复

### 从备份恢复

```bash
# 1. 停止 API 和 Worker（避免恢复期间有写入）
docker compose -f docker-compose.prod.yml stop api worker

# 2. 从备份恢复数据库
./scripts/backup.sh --restore backups/enova_20260813_030000.dump

# 3. 验证数据
PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -U enova -d enova -c "SELECT count(*) FROM users;"

# 4. 重启服务
docker compose -f docker-compose.prod.yml up -d
```

### 恢复演练

建议每月执行一次恢复演练：

1. 在 staging 环境执行 `./scripts/backup.sh`
2. 创建一个临时数据库
3. 执行 `./scripts/backup.sh --restore <file>` 到临时数据库
4. 验证数据完整性（行数、关键记录）
5. 记录恢复时间和结果
6. 清理临时数据库

## Redis 备份

Redis 在本项目中用于：
- BullMQ 队列（任务调度）
- Settings 缓存/失效广播
- Credential lease
- Rate limiting

**Redis 不需要日常备份**：
- 队列任务在 PostgreSQL 中有 Outbox 记录，Worker 重启后会重新分发
- Settings 存储在 PostgreSQL，Redis 仅做缓存
- Credential lease 有 TTL 自动过期
- Rate limiting 数据丢失只会导致限流计数重置（可接受）

如果需要 Redis 持久化（如要求队列不丢失），在 `docker-compose.prod.yml` 中 Redis 已配置 `--appendonly yes`。

## PostgreSQL 备份最佳实践

1. **频率**：至少每日一次，高频业务可增至每 4 小时
2. **保留**：本地 7 天 + S3 30 天 + 冷归档 90 天
3. **验证**：每次备份后自动验证 + 每月恢复演练
4. **安全**：备份文件不含明文密码（pg_dump 不包含密码）
5. **一致性**：使用 `--format=custom` 支持并行恢复和选择性恢复
6. **大小**：监控备份文件大小变化，异常增长可能表示数据问题

## 与版本回滚备份的区别

| | 日常灾备 | 版本回滚 |
|--|---------|---------|
| 触发 | cron 定时 | `update.sh` 执行时 |
| 目的 | 数据恢复 | 版本回滚 |
| 位置 | `backups/` | `.deploy/` |
| 包含代码 | 否 | 否（只备份数据库） |
| 恢复方式 | `backup.sh --restore` | `rollback.sh --restore-db` |
| 保留 | 按天数 | 按版本数（`UPDATE_MAX_ROLLBACK_VERSIONS`） |
