// Health Check Module
// HTTP endpoint для проверки здоровья бота

const express = require('express');
const logger = require('./logger');
const metrics = require('./metrics');

const app = express();
const PORT = process.env.HEALTH_CHECK_PORT || 3001;

// Статусы компонентов
const healthStatus = {
  database: 'unknown',
  whatsapp: 'unknown',
  ai: 'unknown',
  calendar: 'unknown',
};

// Время последней проверки каждого компонента
const lastChecks = {
  database: null,
  whatsapp: null,
  ai: null,
  calendar: null,
};

/**
 * Обновление статуса компонента
 */
function updateStatus(component, status) {
  healthStatus[component] = status;
  lastChecks[component] = new Date();
  
  logger.info(`Health status updated`, { component, status });
}

/**
 * Получение общего статуса системы
 */
function getOverallStatus() {
  const statuses = Object.values(healthStatus);
  
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('degraded')) return 'degraded';
  if (statuses.some(s => s === 'unknown')) return 'unknown';
  if (statuses.every(s => s === 'ok')) return 'healthy';
  
  return 'unknown';
}

// ===================== ENDPOINTS =====================

/**
 * GET /health
 * Основной health check endpoint
 */
app.get('/health', (req, res) => {
  const overall = getOverallStatus();
  const uptime = Math.floor(process.uptime());
  const memUsage = process.memoryUsage();
  
  const response = {
    status: overall,
    timestamp: new Date().toISOString(),
    uptime: uptime,
    service: 'la-mirage-bot',
    version: process.env.npm_package_version || '1.0.0',
    checks: {
      database: healthStatus.database,
      whatsapp: healthStatus.whatsapp,
      ai: healthStatus.ai,
      calendar: healthStatus.calendar,
    },
    metrics: {
      memory_usage_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
      memory_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
      uptime_seconds: uptime,
    },
    last_checks: lastChecks,
  };
  
  // HTTP status code базируется на общем статусе
  const statusCode = {
    'healthy': 200,
    'degraded': 200,
    'critical': 503,
    'unknown': 503,
  }[overall] || 503;
  
  res.status(statusCode).json(response);
  
  logger.info('Health check requested', { 
    status: overall,
    ip: req.ip 
  });
});

/**
 * GET /health/ready
 * Kubernetes-style readiness probe
 */
app.get('/health/ready', (req, res) => {
  const isReady = healthStatus.database === 'ok' && healthStatus.whatsapp === 'ok';
  
  if (isReady) {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ 
      status: 'not_ready',
      checks: healthStatus 
    });
  }
});

/**
 * GET /health/live
 * Kubernetes-style liveness probe
 */
app.get('/health/live', (req, res) => {
  // Простая проверка что процесс жив
  res.status(200).json({ 
    status: 'alive',
    uptime: Math.floor(process.uptime())
  });
});

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', metrics.register.contentType);
    const metricsData = await metrics.register.metrics();
    res.send(metricsData);
    
    logger.info('Metrics scraped', { ip: req.ip });
  } catch (error) {
    logger.errorWithContext('Failed to generate metrics', error);
    res.status(500).send('Error generating metrics');
  }
});

/**
 * GET /health/details
 * Детальная информация о здоровье системы
 */
app.get('/health/details', (req, res) => {
  const memUsage = process.memoryUsage();
  
  res.json({
    service: 'la-mirage-bot',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    
    components: {
      database: {
        status: healthStatus.database,
        last_check: lastChecks.database,
      },
      whatsapp: {
        status: healthStatus.whatsapp,
        last_check: lastChecks.whatsapp,
      },
      ai: {
        status: healthStatus.ai,
        last_check: lastChecks.ai,
      },
      calendar: {
        status: healthStatus.calendar,
        last_check: lastChecks.calendar,
      },
    },
    
    system: {
      platform: process.platform,
      node_version: process.version,
      memory: {
        heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss_mb: Math.round(memUsage.rss / 1024 / 1024),
        external_mb: Math.round(memUsage.external / 1024 / 1024),
      },
      cpu: process.cpuUsage(),
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.errorWithContext('Health check error', err, { path: req.path });
  res.status(500).json({ error: 'Internal server error' });
});

/**
 * Запуск HTTP сервера
 */
function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, (err) => {
      if (err) {
        logger.errorWithContext('Failed to start health check server', err);
        reject(err);
      } else {
        logger.info('Health check server started', { port: PORT });
        console.log(`✅ Health check server: http://localhost:${PORT}/health`);
        console.log(`📊 Metrics endpoint: http://localhost:${PORT}/metrics`);
        resolve(server);
      }
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down health check server');
      server.close(() => {
        logger.info('Health check server closed');
      });
    });
  });
}

module.exports = {
  startServer,
  updateStatus,
  getOverallStatus,
  healthStatus,
  app, // Для тестирования
};
