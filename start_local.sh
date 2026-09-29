#!/bin/bash
set -e

# Переходим в директорию скрипта (корень проекта)
cd "$(dirname "$0")"

echo "=========================================================="
echo "🚀 Запуск «Олимпиадного навигатора в MAX» (Локальный режим)"
echo "=========================================================="

# 1. Проверяем наличие Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Ошибка: Node.js не найден. Установите Node.js (v18+) для запуска."
    exit 1
fi

echo "✓ Node.js $(node -v) обнаружен"

# 2. Создаем .env из примера, если его еще нет
if [ ! -f .env ]; then
    echo "ℹ️ Файл .env не найден, создаем из .env.example..."
    cp .env.example .env
fi

# 3. Устанавливаем зависимости, если папка node_modules отсутствует
if [ ! -d "node_modules" ]; then
    echo "📦 Установка зависимостей (npm install)..."
    npm install
else
    echo "✓ Зависимости уже установлены"
fi

# 4. Инициализируем базу данных и загружаем датасеты
echo "📊 Загрузка олимпиад и этапов в локальную базу данных (seed)..."
npm run seed

echo ""
echo "=========================================================="
echo "🎉 Локальный сервер готов к запуску!"
echo ""
echo "Ссылки в браузере:"
echo "  🚀 Клиентский Mini App (Каталог и кабинет):  http://localhost:3000/app"
echo "  💬 Интерактивный чат бота (Playground):      http://localhost:3000/playground"
echo "  📖 Интерактивная документация API (Swagger): http://localhost:3000/docs"
echo "  🩺 Проверка работоспособности (Healthcheck): http://localhost:3000/api/health"
echo "  🏆 Каталог олимпиад (JSON):                  http://localhost:3000/api/olympiads"
echo ""
echo "Способы интерактивного тестирования:"
echo "  1. Откройте в браузере http://localhost:3000/playground и кликайте кнопки мышкой!"
echo "  2. Или во втором терминале запустите живой чат: npm run chat"
echo "=========================================================="
echo "Запуск сервера (для остановки нажмите Ctrl + C)..."
echo ""

npm run dev
