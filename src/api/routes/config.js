/**
 * Config API Routes
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();

/**
 * GET /api/v1/config
 * Get current configuration (safe view)
 */
router.get('/config', (req, res) => {
  try {
    const services = req.app.get('services');
    const config = services?.config;

    // Return safe subset of config (no secrets)
    const safeConfig = {
      agent: config?.get('agent'),
      printers: config?.get('printers'),
      queue: {
        max_attempts: config?.get('queue.max_attempts'),
        idempotency_ttl_hours: config?.get('queue.idempotency_ttl_hours')
      },
      sync: {
        enabled: config?.get('sync.enabled'),
        interval_minutes: config?.get('sync.interval_minutes'),
        last_sync: config?.getLastSyncTime()
      },
      safe_mode: config?.get('safe_mode')
    };

    res.json(safeConfig);

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

/**
 * POST /api/v1/config/sync
 * Force sync configuration from remote server
 */
router.post('/config/sync', async (req, res) => {
  try {
    const services = req.app.get('services');
    const config = services?.config;
    const logger = services?.logger?.getLogger('api');

    const syncUrl = config?.get('sync.server_url');
    
    if (!syncUrl) {
      return res.status(400).json({
        success: false,
        error: 'Not Configured',
        message: 'Remote sync server URL not configured'
      });
    }

    const apiKey = config?.get('security.api_key');

    // Fetch remote config
    const response = await axios.get(`${syncUrl}/api/print-agent/config`, {
      timeout: 10000,
      headers: {
        'X-RosyidPOS-Key': apiKey,
        'X-Agent-Version': require('../../../package.json').version
      }
    });

    // Merge remote config
    config?.mergeRemoteConfig(response.data);
    await config?.save();

    logger?.info('Config synced from remote server');

    res.json({
      success: true,
      message: 'Configuration synced successfully',
      synced_at: config?.getLastSyncTime()
    });

  } catch (error) {
    const services = req.app.get('services');
    services?.logger?.getLogger('api')?.error('Config sync failed', { error: error.message });

    res.status(500).json({
      success: false,
      error: 'Sync Failed',
      message: error.message
    });
  }
});

/**
 * PUT /api/v1/config/printers
 * Update printer mappings
 */
router.put('/config/printers', async (req, res) => {
  try {
    const services = req.app.get('services');
    const config = services?.config;

    const { mappings, routing } = req.body;

    if (mappings) {
      config?.set('printers.mappings', mappings);
    }

    if (routing) {
      config?.set('printers.routing', routing);
    }

    await config?.save();

    res.json({
      success: true,
      message: 'Printer configuration updated',
      printers: config?.get('printers')
    });

  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

module.exports = router;
