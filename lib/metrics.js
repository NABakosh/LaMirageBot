// Prometheus Metrics Module
// Сбор метрик для мониторинга La Mirage Bot

const promClient = require('prom-client');

// Включаем сбор стандартных метрик (CPU, memory, etc)
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'lamirage_' });

// Создаем Registry
const register = new promClient.Registry();
promClient.register.setDefaultLabels({
  app: 'la-mirage-bot',
  environment: process.env.NODE_ENV || 'development',
});

// ===================== BUSINESS METRICS =====================

// Счетчик бронирований
const bookingsTotal = new promClient.Counter({
  name: 'lamirage_bookings_total',
  help: 'Total number of bookings created',
  labelNames: ['status', 'master', 'service'],
  registers: [register],
});

// Счетчик подтвержденных бронирований
const bookingsConfirmed = new promClient.Counter({
  name: 'lamirage_bookings_confirmed_total',
  help: 'Total number of confirmed bookings',
  labelNames: ['master'],
  registers: [register],
});

// Счетчик отменённых бронирований
const bookingsCancelled = new promClient.Counter({
  name: 'lamirage_bookings_cancelled_total',
  help: 'Total number of cancelled bookings',
  labelNames: ['master', 'reason'],
  registers: [register],
});

// Активные пользователи
const activeUsers = new promClient.Gauge({
  name: 'lamirage_active_users',
  help: 'Number of active users in last 24 hours',
  registers: [register],
});

// Активные сессии
const activeSessions = new promClient.Gauge({
  name: 'lamirage_active_sessions',
  help: 'Number of active conversation sessions',
  registers: [register],
});

// ===================== SYSTEM METRICS =====================

// Время ответа AI
const aiResponseTime = new promClient.Histogram({
  name: 'lamirage_ai_response_time_seconds',
  help: 'AI response time in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  labelNames: ['model'],
  registers: [register],
});

// Длительность запросов к БД
const dbQueryDuration = new promClient.Histogram({
  name: 'lamirage_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 2],
  labelNames: ['operation', 'table'],
  registers: [register],
});

// Ошибки Calendar API
const calendarApiErrors = new promClient.Counter({
  name: 'lamirage_calendar_api_errors_total',
  help: 'Total number of Google Calendar API errors',
  labelNames: ['error_type'],
  registers: [register],
});

// Ошибки AI
const aiErrors = new promClient.Counter({
  name: 'lamirage_ai_errors_total',
  help: 'Total number of AI errors',
  labelNames: ['error_type'],
  registers: [register],
});

// ===================== HEALTH METRICS =====================

// Uptime бота
const botUptime = new promClient.Gauge({
  name: 'lamirage_bot_uptime_seconds',
  help: 'How long the bot has been running in seconds',
  registers: [register],
});

// Статус подключения WhatsApp
const whatsappConnected = new promClient.Gauge({
  name: 'lamirage_whatsapp_connected',
  help: 'WhatsApp connection status (1=connected, 0=disconnected)',
  registers: [register],
});

// Статус подключения к БД
const databaseConnected = new promClient.Gauge({
  name: 'lamirage_database_connected',
  help: 'Database connection status (1=connected, 0=disconnected)',
  registers: [register],
});

// Memory usage в MB
const memoryUsageMb = new promClient.Gauge({
  name: 'lamirage_memory_usage_mb',
  help: 'Memory usage in megabytes',
  registers: [register],
});

// ===================== MESSAGE METRICS =====================

// Входящие сообщения
const messagesReceived = new promClient.Counter({
  name: 'lamirage_messages_received_total',
  help: 'Total number of messages received',
  labelNames: ['type'],
  registers: [register],
});

// Исходящие сообщения
const messagesSent = new promClient.Counter({
  name: 'lamirage_messages_sent_total',
  help: 'Total number of messages sent',
  labelNames: ['type'],
  registers: [register],
});

// ===================== HELPER FUNCTIONS =====================

// Обновление uptime каждую минуту
const startTime = Date.now();
setInterval(() => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  botUptime.set(uptimeSeconds);
  
  // Обновляем memory usage
  const memUsage = process.memoryUsage();
  memoryUsageMb.set(Math.round(memUsage.heapUsed / 1024 / 1024));
}, 60000);

// Инициализация начальных значений
whatsappConnected.set(0);
databaseConnected.set(0);
botUptime.set(0);

/**
 * Трекает время выполнения функции
 * @param {Function} fn - Функция для трекинга
 * @param {Object} metric - Histogram metric
 * @param {Object} labels - Label values
 */
async function trackDuration(fn, metric, labels = {}) {
  const end = metric.startTimer(labels);
  try {
    const result = await fn();
    end();
    return result;
  } catch (error) {
    end();
    throw error;
  }
}

/**
 * Безопасно инкрементирует counter
 */
function safeIncrement(counter, labels = {}, value = 1) {
  try {
    counter.inc(labels, value);
  } catch (error) {
    console.error('Metrics error:', error.message);
  }
}

/**
 * Безопасно устанавливает gauge
 */
function safeSet(gauge, value, labels = {}) {
  try {
    gauge.set(labels, value);
  } catch (error) {
    console.error('Metrics error:', error.message);
  }
}

// Экспортируем metrics и helper функции
module.exports = {
  // Registry
  register,
  
  // Business metrics
  bookingsTotal,
  bookingsConfirmed,
  bookingsCancelled,
  activeUsers,
  activeSessions,
  
  // System metrics
  aiResponseTime,
  dbQueryDuration,
  calendarApiErrors,
  aiErrors,
  
  // Health metrics
  botUptime,
  whatsappConnected,
  databaseConnected,
  memoryUsageMb,
  
  // Message metrics
  messagesReceived,
  messagesSent,
  
  // Helpers
  trackDuration,
  safeIncrement,
  safeSet,
};
