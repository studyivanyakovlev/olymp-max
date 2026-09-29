#!/bin/bash
set -e
cd "$(dirname "$0")"

# Очищаем старые процессы туннелей
pkill -f "a.pinggy.io" 2>/dev/null || true
pkill -f "nokey@localhost.run" 2>/dev/null || true
pkill -f "run_tunnel.sh" 2>/dev/null || true
sleep 1

# Запускаем туннель в фоне
./run_tunnel.sh > /tmp/tunnel.log 2>&1 &
TUNNEL_PID=$!

cleanup() {
  echo "Остановка сервисов..."
  kill "$TUNNEL_PID" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Запуск бэкенда в качестве основного процесса
exec node apps/server/dist/index.js
