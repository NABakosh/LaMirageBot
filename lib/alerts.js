// Telegram Alert Module
// Отправка критичных алертов администраторам

const TelegramBot = require('node-telegram-bot-api');
const logger = require('./logger');

// Конфигурация
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_ALERT_BOT_TOKEN;
const ALERT_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID;

// Пороговые значения для алертов
const THRESHOLDS = {
  MEMORY_WARNING: parseInt(process.env.ALERT_THRESHOLD_MEMORY_WARNING) || 70,
  MEMORY_CRITICAL: parseInt(process.env.ALERT_THRESHOLD_MEMORY_CRITICAL) || 90,
  AI_RESPONSE_TIME_WARNING: 10, // секунды
  AI_RESPONSE_TIME_CRITICAL: 30,
  CALENDAR_ERRORS_PER_MINUTE: 10,
};

// Telegram bot instance
let alertBot = null;
let isEnabled = false;

// Инициализация
function init() {
  if (!TELEGRAM_BOT_TOKEN || !ALERT_CHAT_ID) {
    logger.warn('Telegram alerts not configured. Set TELEGRAM_ALERT_BOT_TOKEN and TELEGRAM_ALERT_CHAT_ID in .env');
    return false;
  }

  try {
    alertBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
    isEnabled = true;
    logger.info('Telegram alerts initialized', { chat_id: ALERT_CHAT_ID });
    
    // Отправляем тестовое сообщение
    sendAlert('info', 'La Mirage Bot Started', 'Telegram alerts are now active');
    
    return true;
  } catch (error) {
    logger.errorWithContext('Failed to initialize Telegram alerts', error);
    return false;
  }
}

/**
 * Отправка алерта в Telegram
 * @param {string} level - critical, warning, info
 * @param {string} title - Заголовок алерта
 * @param {string} message - Описание проблемы
 * @param {Object} details - Дополнительные детали
 */
async function sendAlert(level, title, message, details = {}) {
  if (!isEnabled) return false;

  try {
    const emoji = {
      critical: '🔴',
      warning: '🟡',
      info: '✅',
    }[level] || '⚪';

    const timestamp = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' });
    
    let alertMessage = `${emoji} *${level.toUpperCase()} ALERT*\n\n`;
    alertMessage += `*Service:* La Mirage Bot\n`;
    alertMessage += `*Issue:* ${title}\n`;
    alertMessage += `*Time:* ${timestamp}\n`;
    alertMessage += `*Details:* ${message}\n`;
    
    // Добавляем дополнительные детали
    if (Object.keys(details).length > 0) {
      alertMessage += `\n*Additional Info:*\n`;
      for (const [key, value] of Object.entries(details)) {
        alertMessage += `• ${key}: ${value}\n`;
      }
    }
    
    await alertBot.sendMessage(ALERT_CHAT_ID, alertMessage, { parse_mode: 'Markdown' });
    
    logger.info('Alert sent', { level, title });
    return true;
    
  } catch (error) {
    logger.errorWithContext('Failed to send Telegram alert', error, { level, title });
    return false;
  }
}

// ===================== CRITICAL ALERTS =====================

/**
 * Алерт: Бот упал/перезапустился
 */
async function alertBotRestarted(reason) {
  return sendAlert(
    'warning',
    'Bot Restarted',
    `Bot was restarted. Reason: ${reason}`,
    {
      'Uptime': Math.floor(process.uptime()) + ' seconds',
      'Memory': Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB'
    }
  );
}

/**
 * Алерт: Database недоступна
 */
async function alertDatabaseDown(error) {
  return sendAlert(
    'critical',
    'Database Connection Lost',
    `Cannot connect to PostgreSQL database`,
    {
      'Error': error.message,
      'Action Required': 'Check PostgreSQL status and restart if needed'
    }
  );
}

/**
 * Алерт: WhatsApp отключен
 */
async function alertWhatsAppDisconnected(duration) {
  return sendAlert(
    'critical',
    'WhatsApp Disconnected',
    `WhatsApp connection lost for ${duration} seconds`,
    {
      'Action Required': 'Check WhatsApp Web session and reconnect'
    }
  );
}

/**
 * Алерт: AI не отвечает
 */
async function alertAITimeout(responseTime) {
  return sendAlert(
    'critical',
    'AI Response Timeout',
    `AI took ${responseTime} seconds to respond (threshold: ${THRESHOLDS.AI_RESPONSE_TIME_CRITICAL}s)`,
    {
      'Action Required': 'Check Vertex AI status and quota'
    }
  );
}

/**
 * Алерт: Критичная ошибка
 */
async function alertCriticalError(error, context = {}) {
  return sendAlert(
    'critical',
    'Critical Error Occurred',
    error.message || 'Unknown error',
    {
      'Error Type': error.name,
      'Stack': error.stack ? error.stack.split('\n')[0] : 'N/A',
      ...context
    }
  );
}

// ===================== WARNING ALERTS =====================

/**
 * Алерт: Высокое использование памяти
 */
async function alertHighMemory(usagePercent) {
  const level = usagePercent >= THRESHOLDS.MEMORY_CRITICAL ? 'critical' : 'warning';
  return sendAlert(
    level,
    'High Memory Usage',
    `Memory usage is at ${usagePercent}% (threshold: ${THRESHOLDS.MEMORY_WARNING}%)`,
    {
      'Heap Used': Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      'Heap Total': Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
      'Action Required': 'Monitor and consider restarting if it continues to grow'
    }
  );
}

/**
 * Алерт: Медленный AI
 */
async function alertSlowAI(avgResponseTime) {
  return sendAlert(
    'warning',
    'Slow AI Responses',
    `Average AI response time: ${avgResponseTime.toFixed(2)}s (threshold: ${THRESHOLDS.AI_RESPONSE_TIME_WARNING}s)`,
    {
      'Action Required': 'Check Vertex AI performance and quotas'
    }
  );
}

/**
 * Алерт: Много ошибок Calendar API
 */
async function alertCalendarErrors(errorCount) {
  return sendAlert(
    'warning',
    'High Calendar API Error Rate',
    `${errorCount} Calendar API errors in the last minute (threshold: ${THRESHOLDS.CALENDAR_ERRORS_PER_MINUTE})`,
    {
      'Action Required': 'Check Google Calendar API status and quotas'
    }
  );
}

/**
 * Алерт: Низкое место на диске
 */
async function alertLowDiskSpace(availableGB) {
  return sendAlert(
    'warning',
    'Low Disk Space',
    `Only ${availableGB} GB available`,
    {
      'Action Required': 'Clean up old logs and backups'
    }
  );
}

// ===================== INFO ALERTS =====================

/**
 * Алерт: Backup завершен
 */
async function alertBackupCompleted(backupInfo) {
  return sendAlert(
    'info',
    'Backup Completed',
    `Database backup created successfully`,
    {
      'Filename': backupInfo.filename,
      'Size': backupInfo.size,
      'Duration': backupInfo.duration
    }
  );
}

/**
 * Алерт: Health check failed
 */
async function alertHealthCheckFailed(checks) {
  const failedChecks = Object.entries(checks)
    .filter(([_, status]) => status !== 'ok')
    .map(([name, status]) => `${name}: ${status}`)
    .join(', ');

  return sendAlert(
    'warning',
    'Health Check Failed',
    `Some health checks are failing`,
    {
      'Failed Checks': failedChecks,
      'Action Required': 'Investigate failing services'
    }
  );
}

// Мониторинг памяти каждые 5 минут
let lastMemoryAlert = 0;
setInterval(() => {
  const memUsage = process.memoryUsage();
  const usagePercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
  
  if (usagePercent >= THRESHOLDS.MEMORY_WARNING) {
    // Отправляем алерт не чаще раза в 30 минут
    const now = Date.now();
    if (now - lastMemoryAlert > 30 * 60 * 1000) {
      alertHighMemory(usagePercent);
      lastMemoryAlert = now;
    }
  }
}, 5 * 60 * 1000);

module.exports = {
  init,
  sendAlert,
  
  // Critical alerts
  alertBotRestarted,
  alertDatabaseDown,
  alertWhatsAppDisconnected,
  alertAITimeout,
  alertCriticalError,
  
  // Warning alerts
  alertHighMemory,
  alertSlowAI,
  alertCalendarErrors,
  alertLowDiskSpace,
  
  // Info alerts
  alertBackupCompleted,
  alertHealthCheckFailed,
  
  // Config
  THRESHOLDS,
  isEnabled: () => isEnabled,
};
