/**
 * Health API Routes
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/v1/health
 * Returns detailed health status
 */
router.get('/health', (req, res) => {
  const services = req.app.get('services');
  const packageJson = require('../../../package.json');
  
  const safeMode = services?.safeMode;
  const config = services?.config;
  const queue = services?.queue;

  const stats = queue?.getStats() || {};

  res.json({
    status: 'ok',
    version: packageJson.version,
    mode: safeMode?.isInSafeMode() ? 'safe' : (config?.isStale() ? 'degraded' : 'normal'),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    services: {
      database: 'ok',
      printer: 'ok',
      queue: 'ok',
      configSync: config?.isStale() ? 'stale' : 'ok',
      autoUpdate: safeMode?.isInSafeMode() ? 'disabled' : 'enabled'
    },
    queue: {
      pending: stats.pending || 0,
      processing: stats.processing || 0,
      dlq: stats.dlq_count || 0
    },
    safe_mode: safeMode?.getStatus(),
    lastConfigSync: config?.getLastSyncTime()
  });
});

module.exports = router;
