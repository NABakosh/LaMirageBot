#!/bin/bash
# scripts/backup-db.sh
set -e

# Load environment variables
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Configuration
BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"

# Parse DATABASE_URL if needed, or use separate vars
# Assuming the user might use standard PG env vars or we parse DATABASE_URL
# For simplicity, let's assume we can use the environment variables used in the app

# Generate filename with timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/lamirage_${TIMESTAMP}.sql"

echo "🔄 Создание резервной копии PostgreSQL..."

# If DATABASE_URL is present, use it
if [ ! -z "$DATABASE_URL" ]; then
  pg_dump "$DATABASE_URL" > "$BACKUP_FILE"
else
  # Fallback to separate variables
  PGPASSWORD=$DB_PASSWORD pg_dump \
    -h ${DB_HOST:-localhost} \
    -p ${DB_PORT:-5432} \
    -U ${DB_USER:-postgres} \
    -d ${DB_NAME:-lamiragebeauty} \
    > "$BACKUP_FILE"
fi

# Compress
gzip "$BACKUP_FILE"
echo "✅ Резервная копия создана: ${BACKUP_FILE}.gz"

# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete
echo "🧹 Старые копии удалены (храним за последние 7 дней)"
