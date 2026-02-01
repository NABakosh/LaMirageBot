#!/bin/bash
# scripts/restore-db.sh
set -e

if [ -z "$1" ]; then
  echo "Использование: ./scripts/restore-db.sh <backup-file.sql.gz>"
  exit 1
fi

if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Remove carriage return and skip comments/empty lines
    line=$(echo "$line" | tr -d '\r')
    if [[ ! "$line" =~ ^# && ! -z "$line" ]]; then
      export "$line"
    fi
  done < .env
fi

echo "⚠️  ВНИМАНИЕ: Это ЗАМЕНИТ текущую базу данных!"
read -p "Вы уверены? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Отменено"
  exit 0
fi

# Decompress to temporary file
TEMP_SQL="/tmp/restore_$$.sql"
gunzip -c "$1" > "$TEMP_SQL"

echo "🔄 Восстановление базы данных..."

if [ ! -z "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" < "$TEMP_SQL"
else
  PGPASSWORD=$DB_PASSWORD psql \
    -h ${DB_HOST:-localhost} \
    -p ${DB_PORT:-5432} \
    -U ${DB_USER:-postgres} \
    -d ${DB_NAME:-lamiragebeauty} \
    < "$TEMP_SQL"
fi

rm "$TEMP_SQL"
echo "✅ База данных успешно восстановлена"
