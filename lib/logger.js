// Winston Logger - Structured Logging Module
// Централизованная система логирования для La Mirage Bot

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Определяем уровень логирования из переменной окружения
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_DIR = process.env.LOG_DIR || './logs';

// Формат для логов
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'service'] }),
  winston.format.json()
);

// Формат для консоли (более читаемый)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    let log = `${timestamp} [${level}]`;
    if (service) log += ` [${service}]`;
    log += `: ${message}`;
    
    // Добавляем метаданные если есть
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return log + metaString;
  })
);

// Transport для обычных логов с ротацией
const generalTransport = new DailyRotateFile({
  filename: path.join(LOG_DIR, 'combined-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  format: logFormat,
  level: LOG_LEVEL,
});

// Transport для ошибок с ротацией
const errorTransport = new DailyRotateFile({
  filename: path.join(LOG_DIR, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  format: logFormat,
  level: 'error',
});

// Создаем логгер
const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: { 
    service: 'la-mirage-bot',
    version: process.env.npm_package_version || '1.0.0'
  },
  transports: [
    generalTransport,
    errorTransport,
    // Console transport (только для development)
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env.NODE_ENV === 'production' ? 'warn' : LOG_LEVEL,
    }),
  ],
  // Обработка необработанных исключений
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
    }),
  ],
  // Обработка необработанных rejections
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
    }),
  ],
});

// Helper функции для удобного логирования

/**
 * Логирование бронирования
 */
logger.booking = function(action, bookingData, meta = {}) {
  this.info(`Booking ${action}`, {
    event: 'booking',
    action: action,
    booking_id: bookingData.id,
    user_id: bookingData.user_id,
    master: bookingData.master,
    service: bookingData.service,
    date: bookingData.date,
    time: bookingData.time,
    ...meta
  });
};

/**
 * Логирование AI взаимодействий
 */
logger.ai = function(action, data, meta = {}) {
  this.info(`AI ${action}`, {
    event: 'ai',
    action: action,
    ...data,
    ...meta
  });
};

/**
 * Логирование календарных событий
 */
logger.calendar = function(action, data, meta = {}) {
  this.info(`Calendar ${action}`, {
    event: 'calendar',
    action: action,
    ...data,
    ...meta
  });
};

/**
 * Логирование ошибок с контекстом
 */
logger.errorWithContext = function(message, error, context = {}) {
  this.error(message, {
    error_message: error.message,
    error_stack: error.stack,
    error_name: error.name,
    ...context
  });
};

/**
 * Логирование метрик производительности
 */
logger.performance = function(operation, durationMs, meta = {}) {
  this.info(`Performance: ${operation}`, {
    event: 'performance',
    operation: operation,
    duration_ms: durationMs,
    ...meta
  });
};

// Создаем директорию для логов при первом запуске
const fs = require('fs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  logger.info('Log directory created', { path: LOG_DIR });
}

logger.info('Logger initialized', { 
  level: LOG_LEVEL,
  directory: LOG_DIR,
  environment: process.env.NODE_ENV || 'development'
});

module.exports = logger;
