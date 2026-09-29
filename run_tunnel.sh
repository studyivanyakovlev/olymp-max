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
    local res
    res=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setChatMenuButton" \
      -H "Content-Type: application/json" \
      -d "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"🏆 Mini App\",\"web_app\":{\"url\":\"${URL}/app\"}}}")
    if echo "$res" | grep -q '"ok":true'; then
      echo "[✓] Telegram Menu Button успешно настроена на $URL/app"
    else
      echo "[-] Ответ Telegram API: $res"
    fi
  fi
}

while true; do
  echo "[*] Запуск туннеля через localhost.run..."
  
  ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i ~/.ssh/id_ed25519 -R 80:localhost:$PORT localhost.run 2>&1 | while read -r line; do
    echo "$line"
    if echo "$line" | grep -qE "https://[a-zA-Z0-9-]+\.lhr\.life"; then
      URL=$(echo "$line" | grep -oE "https://[a-zA-Z0-9-]+\.lhr\.life" | head -n 1)
      if [ -n "$URL" ]; then
        update_url "$URL"
      fi
    fi
  done || true

  echo "[-] Соединение с localhost.run прервалось, переподключение через 3 секунды..."
  sleep 3
done
