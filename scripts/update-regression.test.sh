#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

tmp_version_file="$(mktemp)"
trap 'rm -f "$tmp_version_file"' EXIT
printf 'APP_VERSION=1.7.8\n' > "$tmp_version_file"
VERSION_ENV_FILE="$tmp_version_file"
unset APP_VERSION

load_deployment_version
test "${APP_VERSION:-}" = "1.7.8"
printf 'PASS deployment version is exported before Compose interpolation\n'

docker() {
  case "$*" in
    *"ps -q postgres"*) printf 'fake-postgres-id\n' ;;
    *"inspect --format {{.State.Status}}"*) printf 'running\n' ;;
    *"inspect --format {{if .State.Health}}"*) printf 'healthy\n' ;;
    *"inspect --format container_state"*) printf 'container_state service=postgres state=running health=healthy\n' ;;
    *) return 0 ;;
  esac
}

HEALTH_ATTEMPTS=1 HEALTH_INTERVAL=1
wait_service_healthy postgres
printf 'PASS healthy dependency is accepted by the bounded wait\n'
