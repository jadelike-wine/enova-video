# 生产运维手册（OPS）

EnovaMotion 生产服务器的访问、部署、诊断与清理操作。所有命令在本仓库下的本地开发机执行。

## 1. 服务器信息

| 项 | 值 |
| --- | --- |
| 公网 IP | `54.183.160.232` |
| EC2 实例 ID | `i-0d65a2ff59f427154` |
| 实例名 | `enovaphysics` |
| 区域 / 可用区 | `us-west-1` / `us-west-1c` |
| SSH 用户 | `ubuntu` |
| 部署目录 | `/home/ubuntu/enova-video` |

> 生产部署走 GitHub Actions（`.github/workflows/deploy.yml`，使用 repo secret `DEPLOY_SSH_KEY`），不依赖下面这套本地 AWS CLI 方式。本地 AWS CLI / EC2 Instance Connect 用于诊断、查看状态、清理等临时操作。

## 2. 环境前提

- 已配置 AWS CLI（`aws sts get-caller-identity` 正常返回身份）。
- 部署所在区域为 `us-west-1`（`aws configure get region` 应为 `us-west-1`；如不是，命令加 `--region us-west-1`）。
- 本地无需持久 SSH 私钥；用 EC2 Instance Connect 临时注入公钥。

## 3. 通过 AWS CLI 连接服务器（EC2 Instance Connect）

该实例**未接入 Systems Manager(SSM)**，因此不能用 `aws ssm send-command`。改用 EC2 Instance Connect 注入临时公钥后 SSH：

```bash
# 1) 生成临时密钥（一次即可，可复用）
ssh-keygen -t ed25519 -f /tmp/enova_ec2ic -N '' -q

# 2) 把公钥注入实例（有效期约 60 秒，之后会被移除）
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-0d65a2ff59f427154 \
  --instance-os-user ubuntu \
  --ssh-public-key "file:///tmp/enova_ec2ic.pub"

# 3) SSH 连接（每条新命令都需重新执行第 2 步注入公钥）
ssh -o BatchMode=yes -o ConnectTimeout=10 \
  -i /tmp/enova_ec2ic ubuntu@54.183.160.232 '<命令>'
```

注意：公钥注入后约 60 秒失效；**每次新建 SSH 连接前都要重新执行第 2 步**。

## 4. 常用诊断命令

```bash
# 运行中容器
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'

# 本地镜像
docker images

# 部署目录与版本状态
cd /home/ubuntu/enova-video
cat VERSION                    # 版本标记
cat .deploy/version.env        # 当前 APP_VERSION（compose 实际使用）
cat .deploy/state.json         # 上次部署状态
cat .deploy/history.json       # 部署历史
ls -t .deploy/logs/ | head      # 最近部署/回滚日志

# 磁盘占用
df -h /

# 服务健康（compose 项目）
cd /home/ubuntu/enova-video && docker compose -f docker-compose.prod.yml ps
```

## 5. 清理

清理测试/调试残留镜像（保留正式镜像 `ghcr.io/jadelike-wine/enova-video-*` 与基础镜像）：

```bash
ssh -i /tmp/enova_ec2ic ubuntu@54.183.160.232 '
IMGS="enova-fix-test:latest fe-real:latest fetest-noeslint:latest fetest-minconfig:latest fetest-notypo:latest fetest-mincss:latest fetest-nofont:latest frontend-repro:latest enova-slim:test enova-builder:repro enova-frontend-repro:test enova-deps:repro"
for img in $IMGS; do docker image rm "$img" >/dev/null 2>&1 && echo "removed: $img"; done
df -h /
'
```

## 6. 安全注意

- 不删除正式版本镜像（`enova-video-{api,worker,web,deploy-tool}:<ver>`），它们用于部署与回滚。
- `docker rmi`、`docker compose down`、数据库回滚等不可逆操作前，先与用户确认。
- 服务器上的 `.env`、数据库备份、SSH 密钥等敏感内容不写入日志或提交到仓库。

## 7. 系统更新功能（后台一键更新/回滚）

系统更新功能允许管理员在管理后台通过 Web UI 一键触发版本更新或回滚，无需手动 SSH 到服务器操作。

### 7.1 工作原理

```
管理后台 → API → spawn docker → deploy-tool 容器 → scripts/update.sh
                   ↑ 需要 docker.sock 挂载        ↑ 需要 /host/repo 挂载
```

### 7.2 首次启用步骤

在服务器上执行以下操作：

**1) 确保 `.env` 中已启用**

```bash
cd /home/ubuntu/enova-video
grep UPDATE_ENABLED .env
# 应为 UPDATE_ENABLED=true
```

**2) 拉取 deploy-tool 镜像**

```bash
APP_VERSION=$(cat VERSION)
docker pull ghcr.io/jadelike-wine/enova-video-deploy-tool:${APP_VERSION}
```

**3) 创建 `/host/repo` 软链接（如不存在）**

```bash
sudo ln -s /home/ubuntu/enova-video /host/repo
```

**4) 使用 update override 重启 API 容器**

```bash
cd /home/ubuntu/enova-video
export APP_VERSION=$(cat VERSION)
docker compose -f docker-compose.prod.yml -f docker-compose.update.yml up -d api
```

`docker-compose.update.yml` 会将以下关键挂载加入 API 容器：

| 挂载 | 用途 |
| --- | --- |
| `/var/run/docker.sock` | API 通过它触发 deploy-tool 容器 |
| `/host/repo` | deploy-tool 容器内访问仓库脚本 |

**5) 验证**

```bash
# 确认 docker socket 已挂载
docker exec enova-prod-api-1 ls -la /var/run/docker.sock

# 确认 repo 已挂载
docker exec enova-prod-api-1 ls /host/repo/scripts/update.sh

# 确认 API 容器内可执行 docker
docker exec enova-prod-api-1 docker ps
```

### 7.3 后续每次部署后

每次通过 GitHub Actions 部署新版本后，需要重新拉取对应版本的 deploy-tool 镜像并重启 API：

```bash
cd /home/ubuntu/enova-video
export APP_VERSION=$(cat VERSION)
docker pull ghcr.io/jadelike-wine/enova-video-deploy-tool:${APP_VERSION}
docker compose -f docker-compose.prod.yml -f docker-compose.update.yml up -d api
```

### 7.4 环境变量参考

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `UPDATE_ENABLED` | `false` | 是否启用系统更新功能 |
| `UPDATE_GITHUB_REPOSITORY` | `jadelike-wine/enova-video` | GitHub 仓库（用于检查新版本） |
| `UPDATE_GITHUB_TOKEN` | （空） | 私有仓库需要 GitHub PAT；公开仓库不需要 |
| `UPDATE_DOCKER_SOCKET` | `/var/run/docker.sock` | Docker socket 路径 |
| `UPDATE_DEPLOY_TOOL_IMAGE` | `ghcr.io/.../deploy-tool:${APP_VERSION}` | deploy-tool 镜像 |
| `UPDATE_REPO_MOUNT` | `/host/repo` | 容器内仓库挂载路径 |
| `UPDATE_CHECK_CACHE_TTL_MS` | `1200000` | 版本检查缓存时间（20 分钟） |
| `UPDATE_EXEC_TIMEOUT_MS` | `900000` | 更新操作超时（15 分钟） |

### 7.5 故障排查

如果点击"更新到最新版本"后按钮迅速恢复且无效果：

```bash
# 1. 检查 docker socket 是否挂载
docker exec enova-prod-api-1 ls -la /var/run/docker.sock

# 2. 检查 deploy-tool 镜像是否存在
docker images | grep deploy-tool

# 3. 查看 API 容器日志
docker logs enova-prod-api-1 --tail 50 | grep -i update

# 4. 检查 compose 是否使用了 update override
docker inspect enova-prod-api-1 --format '{{json .Mounts}}' | python3 -m json.tool
# 应包含 /var/run/docker.sock 和 /host/repo 两个挂载
```