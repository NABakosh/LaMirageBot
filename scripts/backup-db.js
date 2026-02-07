// Automated PostgreSQL Backup Script
// Создаёт резервные копии базы данных

require('dotenv').config();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Конфигурация
const BACKUP_DIR = process.env.BACKUP_DIR || './backups';
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;
const DATABASE_URL = process.env.DATABASE_URL;

// Парсим DATABASE_URL
function parseDatabaseUrl(url) {
  const regex = /postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/;
  const match = url.match(regex);
  
  if (!match) {
    throw new Error('Invalid DATABASE_URL format');
  }
  
  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: match[4],
    database: match[5],
  };
}

/**
 * Создание директории для бэкапов
 */
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log(`✅ Backup directory created: ${BACKUP_DIR}`);
  }
}

/**
 * Создание имени файла бэкапа
 */
function generateBackupFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  
  return `backup-${year}-${month}-${day}-${hour}${minute}.sql.gz`;
}

/**
 * Создание бэкапа
 */
async function createBackup() {
  console.log('\n🔄 Starting database backup...\n');
  
  const startTime = Date.now();
  
  try {
    // Парсим DATABASE_URL
    const dbConfig = parseDatabaseUrl(DATABASE_URL);
    
    ensureBackupDir();
    
    const filename = generateBackupFilename();
    const filepath = path.join(BACKUP_DIR, filename);
    
    console.log(`📁 Backup file: ${filepath}`);
    console.log(`🗄️  Database: ${dbConfig.database}`);
    console.log(`🖥️  Host: ${dbConfig.host}:${dbConfig.port}\n`);
    
    // Конструируем команду pg_dump
    const dumpCommand = `PGPASSWORD="${dbConfig.password}" pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -F p | gzip > "${filepath}"`;
    
    // Выполняем backup
    console.log('⏳ Creating backup...');
    await execAsync(dumpCommand);
    
    // Проверяем что файл создался
    if (!fs.existsSync(filepath)) {
      throw new Error('Backup file was not created');
    }
    
    const stats = fs.statSync(filepath);
    const sizeKB = Math.round(stats.size / 1024);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    console.log('\n✅ Backup completed successfully!');
    console.log(`📦 Size: ${sizeMB} MB (${sizeKB} KB)`);
    console.log(`⏱️  Duration: ${duration} seconds`);
    console.log(`📁 Location: ${filepath}\n`);
    
    return {
      success: true,
      filename: filename,
      filepath: filepath,
      size: `${sizeMB} MB`,
      duration: `${duration}s`,
    };
    
  } catch (error) {
    console.error('\n❌ Backup failed!');
    console.error(`Error: ${error.message}\n`);
    
    if (error.message.includes('pg_dump')) {
      console.error('💡 Hint: Make sure pg_dump is installed and in your PATH');
      console.error('   On Windows: Install PostgreSQL client tools');
      console.error('   On Linux/Mac: sudo apt-get install postgresql-client (or brew install postgresql)\n');
    }
    
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Очистка старых бэкапов
 */
function cleanupOldBackups() {
  console.log('🧹 Cleaning up old backups...\n');
  
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      console.log('No backup directory found, skipping cleanup\n');
      return { deleted: 0 };
    }
    
    const files = fs.readdirSync(BACKUP_DIR);
    const backupFiles = files.filter(f => f.startsWith('backup-') && f.endsWith('.sql.gz'));
    
    if (backupFiles.length === 0) {
      console.log('No backup files found\n');
      return { deleted: 0 };
    }
    
    console.log(`📂 Found ${backupFiles.length} backup files`);
    
    const now = Date.now();
    const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
    
    let deleted = 0;
    
    for (const file of backupFiles) {
      const filepath = path.join(BACKUP_DIR, file);
      const stats = fs.statSync(filepath);
      const age = now - stats.mtimeMs;
      
      if (age > retentionMs) {
        const ageDays = Math.floor(age / (24 * 60 * 60 * 1000));
        console.log(`🗑️  Deleting ${file} (${ageDays} days old)`);
        fs.unlinkSync(filepath);
        deleted++;
      }
    }
    
    if (deleted > 0) {
      console.log(`\n✅ Deleted ${deleted} old backup(s)\n`);
    } else {
      console.log(`✅ No old backups to delete (retention: ${RETENTION_DAYS} days)\n`);
    }
    
    return { deleted };
    
  } catch (error) {
    console.error(`❌ Cleanup failed: ${error.message}\n`);
    return { deleted: 0, error: error.message };
  }
}

/**
 * Список всех бэкапов
 */
function listBackups() {
  console.log('\n📋 Available backups:\n');
  
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      console.log('No backup directory found\n');
      return [];
    }
    
    const files = fs.readdirSync(BACKUP_DIR);
    const backupFiles = files.filter(f => f.startsWith('backup-') && f.endsWith('.sql.gz'));
    
    if (backupFiles.length === 0) {
      console.log('No backup files found\n');
      return [];
    }
    
    // Сортируем по дате (новые первые)
    backupFiles.sort().reverse();
    
    const backups = [];
    
    for (const file of backupFiles) {
      const filepath = path.join(BACKUP_DIR, file);
      const stats = fs.statSync(filepath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      const date = new Date(stats.mtime);
      const dateStr = date.toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' });
      
      backups.push({ file, filepath, size: sizeMB, date: dateStr });
      
      console.log(`📦 ${file}`);
      console.log(`   Size: ${sizeMB} MB`);
      console.log(`   Date: ${dateStr}`);
      console.log('');
    }
    
    console.log(`Total: ${backups.length} backup(s)\n`);
    
    return backups;
    
  } catch (error) {
    console.error(`❌ Failed to list backups: ${error.message}\n`);
    return [];
  }
}

// Запуск при прямом вызове скрипта
if (require.main === module) {
  (async () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║           POSTGRESQL BACKUP - LA MIRAGE BOT                 ║
╚══════════════════════════════════════════════════════════════╝
`);
    
    const command = process.argv[2] || 'backup';
    
    switch (command) {
      case 'backup':
        const result = await createBackup();
        if (result.success) {
          cleanupOldBackups();
        }
        process.exit(result.success ? 0 : 1);
        break;
        
      case 'list':
        listBackups();
        break;
        
      case 'cleanup':
        cleanupOldBackups();
        break;
        
      default:
        console.log('Usage: node backup-db.js [command]');
        console.log('');
        console.log('Commands:');
        console.log('  backup   - Create a new backup (default)');
        console.log('  list     - List all available backups');
        console.log('  cleanup  - Remove old backups');
        console.log('');
        break;
    }
  })();
}

module.exports = {
  createBackup,
  cleanupOldBackups,
  listBackups,
};
