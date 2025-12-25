#!/bin/bash

# =====================================================
# Скрипт резервного копирования базы данных
# La Mirage Beauty Bot
# =====================================================

# Настройки
DB_NAME="lamiragebeauty"
DB_USER="postgres"
BACKUP_DIR="./backups"
DATE=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="$BACKUP_DIR/lamirage_backup_$DATE.sql"

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔄 Начинаем резервное копирование...${NC}"

# Создание папки для бэкапов, если её нет
if [ ! -d "$BACKUP_DIR" ]; then
    mkdir -p "$BACKUP_DIR"
    echo -e "${GREEN}✅ Создана папка $BACKUP_DIR${NC}"
fi

# Создание бэкапа
echo -e "${YELLOW}📦 Создание резервной копии базы данных...${NC}"
pg_dump -U $DB_USER $DB_NAME > "$BACKUP_FILE"

# Проверка успешности
if [ $? -eq 0 ]; then
    # Получение размера файла
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✅ Резервная копия создана успешно!${NC}"
    echo -e "${GREEN}📁 Файл: $BACKUP_FILE${NC}"
    echo -e "${GREEN}📊 Размер: $SIZE${NC}"
    
    # Сжатие резервной копии
    echo -e "${YELLOW}🗜️  Сжатие файла...${NC}"
    gzip "$BACKUP_FILE"
    
    if [ $? -eq 0 ]; then
        COMPRESSED_SIZE=$(du -h "$BACKUP_FILE.gz" | cut -f1)
        echo -e "${GREEN}✅ Файл сжат успешно!${NC}"
        echo -e "${GREEN}📊 Размер после сжатия: $COMPRESSED_SIZE${NC}"
    else
        echo -e "${RED}❌ Ошибка при сжатии${NC}"
    fi
    
    # Удаление старых бэкапов (старше 30 дней)
    echo -e "${YELLOW}🧹 Удаление старых резервных копий...${NC}"
    find "$BACKUP_DIR" -name "lamirage_backup_*.sql.gz" -mtime +30 -delete
    
    # Подсчет количества бэкапов
    BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/lamirage_backup_*.sql.gz 2>/dev/null | wc -l)
    echo -e "${GREEN}📋 Всего резервных копий: $BACKUP_COUNT${NC}"
    
else
    echo -e "${RED}❌ Ошибка при создании резервной копии!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Готово!${NC}"

# =====================================================
# Инструкция по восстановлению из бэкапа:
# =====================================================
# 1. Распаковать файл:
#    gunzip backups/lamirage_backup_2025-12-20_15-30-00.sql.gz
#
# 2. Восстановить базу:
#    psql -U postgres -d lamiragebeauty -f backups/lamirage_backup_2025-12-20_15-30-00.sql
#
# 3. Или полная замена базы:
#    dropdb -U postgres lamiragebeauty
#    createdb -U postgres lamiragebeauty
#    psql -U postgres -d lamiragebeauty -f backups/lamirage_backup_2025-12-20_15-30-00.sql
# =====================================================