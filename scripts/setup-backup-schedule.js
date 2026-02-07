// Automated Backup Setup Script
// Настройка автоматических бэкапов через Windows Task Scheduler

require('dotenv').config();
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);

const SCRIPT_PATH = path.resolve(__dirname, 'backup-db.js');
const NODE_PATH = process.execPath; // Путь к node.exe

async function setupWindowsTask() {
  console.log('\n⚙️  Setting up automated backups on Windows...\n');
  
  const taskName = 'LaMirageBackup';
  const taskCommand = `"${NODE_PATH}" "${SCRIPT_PATH}"`;
  
  // Создаем задачу в Task Scheduler
  // Запуск каждый день в 02:00
  const scheduleCommand = `schtasks /Create /SC DAILY /TN "${taskName}" /TR "${taskCommand}" /ST 02:00 /F`;
  
  try {
    console.log('📅 Creating Windows Task Scheduler task...');
    console.log(`   Task Name: ${taskName}`);
    console.log(`   Schedule: Daily at 02:00 AM`);
    console.log(`   Command: ${taskCommand}\n`);
    
    const { stdout, stderr } = await execAsync(scheduleCommand);
    
    if (stderr && !stderr.includes('SUCCESS')) {
      throw new Error(stderr);
    }
    
    console.log('✅ Task created successfully!\n');
    console.log('To verify:');
    console.log(`   schtasks /Query /TN "${taskName}"\n`);
    console.log('To delete:');
    console.log(`   schtasks /Delete /TN "${taskName}" /F\n`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Failed to create task:', error.message);
    console.error('\n💡 You may need to run this script as Administrator\n');
    return false;
  }
}

function showLinuxCronSetup() {
  console.log('\n⚙️  Linux/Mac Cron Setup:\n');
  console.log('1. Open crontab editor:');
  console.log('   crontab -e\n');
  console.log('2. Add this line (runs daily at 2 AM):');
  console.log(`   0 2 * * * cd ${path.dirname(SCRIPT_PATH)} && ${NODE_PATH} ${SCRIPT_PATH}\n`);
  console.log('3. Save and exit\n');
  console.log('To verify:');
  console.log('   crontab -l\n');
}

function showManualSetup() {
  console.log('\n📝 Manual Setup:\n');
  console.log('You can also run backups manually whenever needed:');
  console.log(`   node ${SCRIPT_PATH}\n`);
  console.log('Or create your own schedule using:');
  console.log('   - Windows Task Scheduler (GUI)');
  console.log('   - Linux/Mac cron');
  console.log('   - PM2 cron module');
  console.log('   - node-schedule library\n');
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║         AUTOMATED BACKUP SETUP - LA MIRAGE BOT              ║
╚══════════════════════════════════════════════════════════════╝
`);

  const platform = process.platform;
  
  if (platform === 'win32') {
    const success = await setupWindowsTask();
    if (!success) {
      showManualSetup();
    }
  } else {
    console.log('Platform detected: ' + platform);
    showLinuxCronSetup();
    showManualSetup();
  }
  
  console.log('='.repeat(60));
  console.log('\n✅ Setup complete!\n');
}

main();
