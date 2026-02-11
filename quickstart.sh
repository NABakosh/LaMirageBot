#!/bin/bash
# Quick Start Script для La Mirage Bot

echo "🚀 La Mirage Beauty Bot - Quick Start"
echo "======================================"
echo ""

# Проверка что мы в правильной директории
if [ ! -f "main.js" ]; then
    echo "❌ Ошибка: main.js не найден"
    echo "   Перейдите в директорию бота: cd 'c:\Nabako\La Mirage'"
    exit 1
fi

echo "✅ Директория найдена"
echo ""

# Проверка Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js не установлен"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node.js версия: $NODE_VERSION"
echo ""

# Проверка зависимостей
if [ ! -d "node_modules" ]; then
    echo "📦 Установка зависимостей..."
    npm install
fi

echo "✅ Зависимости установлены"
echo ""

# Проверка критичных файлов
echo "🔍 Проверка конфигурации..."

if [ ! -f ".env" ]; then
    echo "❌ .env файл не найден"
    exit 1
fi
echo "  ✅ .env"

if [ ! -f "credentials.json" ]; then
    echo "  ⚠️  credentials.json не найден (Google Calendar может не работать)"
else
    echo "  ✅ credentials.json"
fi

if [ ! -f "vertex_key.json" ]; then
    echo "  ⚠️  vertex_key.json не найден (AI может не работать)"
else
    echo "  ✅ vertex_key.json"
fi

echo ""
echo "🎯 Готов к запуску!"
echo ""
echo "Выберите режим запуска:"
echo "  1. Обычный запуск (npm start)"
echo "  2. Development с auto-restart (npm run dev)"
echo "  3. Production с PM2 (рекомендуется)"
echo ""
read -p "Ваш выбор (1-3): " choice

case $choice in
    1)
        echo ""
        echo "🚀 Запуск в обычном режиме..."
        npm start
        ;;
    2)
        echo ""
        echo "🔄 Запуск в режиме разработки..."
        npm run dev
        ;;
    3)
        if ! command -v pm2 &> /dev/null; then
            echo ""
            echo "📦 Установка PM2..."
            npm install -g pm2
        fi
        echo ""
        echo "🚀 Запуск через PM2..."
        pm2 start main.js --name "lamirage-bot"
        pm2 save
        echo ""
        echo "✅ Бот запущен!"
        echo ""
        echo "Полезные команды:"
        echo "  pm2 logs lamirage-bot  - просмотр логов"
        echo "  pm2 status             - статус бота"
        echo "  pm2 restart lamirage-bot - перезапуск"
        echo "  pm2 stop lamirage-bot  - остановка"
        ;;
    *)
        echo "❌ Неверный выбор"
        exit 1
        ;;
esac
