#!/bin/bash
# Скрипт фонового запуска ботов (MAX и Telegram) и публичного HTTPS-туннеля для Mini App
set -e
cd "$(dirname "$0")"

# 1. Загружаем переменные из .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs -d '\n')
fi

PORT="${PORT:-3000}"

# 2. Очищаем старые процессы
echo "[*] Очистка старых процессов..."
pkill -f "apps/server/dist/index.js" 2>/dev/null || true
pkill -f "nokey@localhost.run" 2>/dev/null || true
pkill -f "a.pinggy.io" 2>/dev/null || true
pkill -f "run_tunnel.sh" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
pkill -f "localtunnel" 2>/dev/null || true
sleep 1

# 3. Запуск туннеля в фоне
TUNNEL_LOG="/tmp/tunnel.log"
rm -f "$TUNNEL_LOG"
echo "[*] Запуск фонового менеджера туннелей..."
./run_tunnel.sh > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

echo "[*] Подключение HTTPS-туннеля..."
TUNNEL_URL=""
for i in {1..20}; do
  if [ -f tunnel_url.txt ]; then
    CANDIDATE=$(cat tunnel_url.txt | tr -d '\r\n')
    if [[ "$CANDIDATE" =~ ^https:// ]]; then
      TUNNEL_URL="$CANDIDATE"
      break
    fi
  fi
  sleep 1
done

if [ -n "$TUNNEL_URL" ]; then
  echo "[✓] HTTPS-туннель активен: $TUNNEL_URL"
else
  echo "⚠️ Туннель запускается в фоне, проверьте лог: $TUNNEL_LOG"
fi

# 4. Запуск сервера и ботов
BOT_LOG="/tmp/olymp-bot.log"
rm -f "$BOT_LOG"
echo "[*] Запуск сервиса (Node.js, MAX и Telegram боты)..."
node apps/server/dist/index.js >> "$BOT_LOG" 2>&1 &
SERVER_PID=$!

sleep 2

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "❌ Ошибка: Сервер завершился аварийно. Последние логи:"
  cat "$BOT_LOG"
  exit 1
fi

echo "=========================================================="
echo "🎉 Сервисы успешно запущены!"
[ -n "$TELEGRAM_BOT_TOKEN" ] && echo "🤖 Telegram бот: @olymp_pilot_test_bot"
[ -n "$BOT_TOKEN" ] && echo "💬 MAX бот: подключен (Олимпиады.ру)"
echo "🌐 Локальный API:     http://localhost:$PORT"
echo "📱 Mini App локально: http://localhost:$PORT/app"
[ -n "$TUNNEL_URL" ] && echo "🔗 Публичный Mini App: $TUNNEL_URL/app"
echo "📄 Логи бота:    tail -f /tmp/olymp-bot.log"
echo "📄 Логи туннеля: tail -f /tmp/tunnel.log"
echo "=========================================================="
