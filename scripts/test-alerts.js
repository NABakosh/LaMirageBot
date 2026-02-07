// Test Alerts Script
// Тестирует отправку различных типов алертов в Telegram

require('dotenv').config();
const alerts = require('../lib/alerts');
const logger = require('../lib/logger');

async function testAlerts() {
  console.log('\n🧪 Testing Telegram Alerts\n');
  console.log('='.repeat(60));
  
  // Инициализация
  const initialized = alerts.init();
  
  if (!initialized) {
    console.log('\n❌ Failed to initialize alerts');
    console.log('Make sure TELEGRAM_ALERT_BOT_TOKEN and TELEGRAM_ALERT_CHAT_ID are set in .env\n');
    return;
  }
  
  console.log('\n✅ Alerts initialized\n');
  
  const tests = [
    {
      name: 'Info Alert - Bot Started',
      fn: () => alerts.sendAlert('info', 'Test: Bot Started', 'This is a test info alert'),
    },
    {
      name: 'Warning Alert - High Memory',
      fn: () => alerts.alertHighMemory(75),
    },
    {
      name: 'Critical Alert - Database Down',
      fn: () => alerts.alertDatabaseDown(new Error('Connection timeout')),
    },
    {
      name: 'Warning Alert - Slow AI',
      fn: () => alerts.alertSlowAI(12.5),
    },
    {
      name: 'Info Alert - Backup Completed',
      fn: () => alerts.alertBackupCompleted({
        filename: 'backup-2026-02-07-0200.sql.gz',
        size: '15.2 MB',
        duration: '8s'
      }),
    },
  ];
  
  console.log(`Running ${tests.length} tests...\n`);
  
  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    console.log(`${i + 1}/${tests.length} Testing: ${test.name}`);
    
    try {
      await test.fn();
      console.log('   ✅ Sent successfully\n');
      
      // Задержка между алертами
      if (i < tests.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}\n`);
    }
  }
  
  console.log('='.repeat(60));
  console.log('\n✅ All tests completed!\n');
  console.log('Check your Telegram chat to verify alerts were received.\n');
}

// Запуск
testAlerts().catch(error => {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
});
