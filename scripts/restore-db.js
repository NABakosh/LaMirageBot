// PostgreSQL Restore Script
// Восстановление базы данных из бэкапа

require('dotenv').config();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readline = require('readline');

const execAsync = promisify(exec);

const BACKUP_DIR = process.env.BACKUP_DIR || './backups';
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
 * Запрос подтверждения у пользователя
 */
function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Восстановление из бэкапа
 */
async function restoreBackup(backupFile, options = {}) {
  const { skipConfirmation = false } = options;
  
  console.log('\n🔄 Starting database restore...\n');
  
  const startTime = Date.now();
  
  try {
    // Проверяем что файл существует
    let filepath;
    
    if (path.isAbsolute(backupFile)) {
      filepath = backupFile;
    } else {
      filepath = path.join(BACKUP_DIR, backupFile);
    }
    
    if (!fs.existsSync(filepath)) {
      throw new Error(`Backup file not found: ${filepath}`);
    }
    
    const dbConfig = parseDatabaseUrl(DATABASE_URL);
    
    const stats = fs.statSync(filepath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    
    console.log(`📁 Backup file: ${filepath}`);
    console.log(`📦 Size: ${sizeMB} MB`);
    console.log(`🗄️  Target database: ${dbConfig.database}`);
    console.log(`🖥️  Host: ${dbConfig.host}:${dbConfig.port}\n`);
    
    // Предупреждение
    console.log('⚠️  WARNING: This will replace ALL data in the database!');
    console.log('⚠️  Make sure you have a current backup before proceeding.\n');
    
    if (!skipConfirmation) {
      const confirmed = await askConfirmation('Are you sure you want to continue? (yes/no): ');
      
      if (!confirmed) {
        console.log('\n❌ Restore cancelled by user\n');
        return { success: false, cancelled: true };
      }
    }
    
    console.log('\n⏳ Restoring database...\n');
    
    // Команда для восстановления
    const restoreCommand = `gunzip < "${filepath}" | PGPASSWORD="${dbConfig.password}" psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database}`;
    
    // Выполняем restore
    const { stdout, stderr } = await execAsync(restoreCommand);
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    console.log('✅ Restore completed successfully!');
    console.log(`⏱️  Duration: ${duration} seconds\n`);
    
    if (stderr && !stderr.includes('NOTICE')) {
      console.log('⚠️  Some warnings occurred:');
      console.log(stderr.substring(0, 500));
      console.log('');
    }
    
    return {
      success: true,
      duration: `${duration}s`,
    };
    
  } catch (error) {
    console.error('\n❌ Restore failed!');
    console.error(`Error: ${error.message}\n`);
    
    if (error.message.includes('psql') || error.message.includes('gunzip')) {
      console.error('💡 Hint: Make sure psql and gunzip are installed and in your PATH');
      console.error('   On Windows: Install PostgreSQL client tools + Git Bash');
      console.error('   On Linux/Mac: sudo apt-get install postgresql-client (or brew install postgresql)\n');
    }
    
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Список доступных бэкапов
 */
function listAvailableBackups() {
  console.log('\n📋 Available backups:\n');
  
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
  
  backupFiles.forEach((file, index) => {
    const filepath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(filepath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    const date = new Date(stats.mtime);
    const dateStr = date.toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' });
    
    console.log(`${index + 1}. ${file}`);
    console.log(`   Size: ${sizeMB} MB | Date: ${dateStr}`);
    console.log('');
  });
  
  return backupFiles;
}

// Запуск при прямом вызове
if (require.main === module) {
  (async () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║          POSTGRESQL RESTORE - LA MIRAGE BOT                 ║
╚══════════════════════════════════════════════════════════════╝
`);
    
    const backupFile = process.argv[2];
    
    if (!backupFile) {
      console.log('Usage: node restore-db.js <backup-file>\n');
      console.log('Example: node restore-db.js backup-2026-02-07-0200.sql.gz\n');
      
      listAvailableBackups();
      
      console.log('To restore from a specific backup, run:');
      console.log('  node restore-db.js <filename>\n');
      
      process.exit(1);
    }
    
    const result = await restoreBackup(backupFile);
    process.exit(result.success ? 0 : 1);
    
  })();
}

module.exports = {
  restoreBackup,
  listAvailableBackups,
};
