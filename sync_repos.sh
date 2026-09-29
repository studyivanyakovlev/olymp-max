#!/bin/bash
# ==============================================================================
# Скрипт синхронизации Hackaton (olymp-max) и Raspberry (bots + services)
# Использование: bash sync_repos.sh [commit message]
# ==============================================================================

set -e

MSG="${1:-fix: sync changes between olymp-max and Raspberry with mini app fixes}"
HACKATON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RASPBERRY_DIR="$(cd "$HACKATON_DIR/../../Raspberry" && pwd)"

echo "=== 1. Сборка проекта в Hackaton ==="
cd "$HACKATON_DIR"
npm run build

echo "=== 2. Синхронизация файлов в Raspberry/bots ==="
if [ -d "$RASPBERRY_DIR/bots" ]; then
  rsync -av --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='build' \
    --exclude='.vite' \
    --exclude='*.pdf' \
    --exclude='systemd' \
    --exclude='tunnel_url.txt' \
    "$HACKATON_DIR/" "$RASPBERRY_DIR/bots/"
else
  echo "[!] Директория $RASPBERRY_DIR/bots не найдена!"
  exit 1
fi

echo "=== 3. Сборка в Raspberry/bots ==="
cd "$RASPBERRY_DIR/bots"
npm run build

echo "=== 4. Коммит и отправка в studyivanyakovlev/olymp-max ==="
cd "$HACKATON_DIR"
git add .
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  git commit -m "$MSG"
  git push origin HEAD
else
  echo "[*] В Hackaton нет изменений для коммита."
fi

echo "=== 5. Коммит и отправка в nazarkinra/Raspberry ==="
cd "$RASPBERRY_DIR"
git add .
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  git commit -m "$MSG"
  git push origin main
else
  echo "[*] В Raspberry нет изменений для коммита."
fi

echo "=== 6. Обновление Raspberry Pi по SSH ==="
if ssh -o ConnectTimeout=3 -o BatchMode=yes admin@192.168.0.2 "true" 2>/dev/null; then
  echo "[+] Raspberry Pi доступна по SSH. Применяем обновления..."
  ssh admin@192.168.0.2 "cd /opt/raspberry && sudo bash update.sh"
else
  echo "[*] Raspberry Pi не доступна напрямую по SSH, но raspberry-sync.timer обновит систему автоматически при следующем цикле."
fi

echo "=== [✓] Синхронизация завершена успешно! ==="
