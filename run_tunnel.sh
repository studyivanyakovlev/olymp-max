#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs -d '\n')
fi

PORT="${PORT:-3000}"

update_url() {
  local URL="$1"
  echo "[✓] Established tunnel: $URL"
  echo "$URL" > tunnel_url.txt
  if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setChatMenuButton" \
      -H "Content-Type: application/json" \
      -d "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"🏆 Mini App\",\"web_app\":{\"url\":\"${URL}/app\"}}}" > /dev/null || true
    echo "[✓] Updated Telegram Menu Button to $URL/app"
  fi
}

while true; do
  echo "[*] Connecting tunnel via pinggy / localhost.run..."
  
  # 1. Пробуем pinggy.io
  ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -p 443 -R0:localhost:$PORT a.pinggy.io 2>&1 | while read -r line; do
    echo "$line"
    URL=$(echo "$line" | grep -oE "https://[a-zA-Z0-9.-]+\.free\.pinggy\.net" | head -n 1 || true)
    if [ -z "$URL" ]; then
      URL=$(echo "$line" | grep -oE "https://[a-zA-Z0-9.-]+\.run\.pinggy-free\.link" | head -n 1 || true)
    fi
    if [ -n "$URL" ]; then
      update_url "$URL"
    fi
  done || true

  echo "[-] Pinggy tunnel ended, trying localhost.run..."
  
  # 2. Запасной вариант: localhost.run
  ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -R 80:localhost:$PORT nokey@localhost.run 2>&1 | while read -r line; do
    echo "$line"
    if echo "$line" | grep -qE "https://[a-zA-Z0-9-]+\.lhr\.life"; then
      URL=$(echo "$line" | grep -oE "https://[a-zA-Z0-9-]+\.lhr\.life" | head -n 1)
      if [ -n "$URL" ]; then
        update_url "$URL"
      fi
    fi
  done || true

  echo "[-] Reconnecting tunnel in 3 seconds..."
  sleep 3
done
