/**
 * Queue API Routes
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/v1/queue
 * Get active print queue
 */
router.get('/queue', (req, res) => {
  try {
    const services = req.app.get('services');
    const queue = services?.queue;

    if (!queue) {
      return res.status(503).json({ 
        error: 'Service Unavailable', 
        message: 'Queue service not initialized' 
      });
    }

    const jobs = queue.getQueue();
    const stats = queue.getStats();

    res.json({
      stats: stats,
      jobs: jobs
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

/**
 * DELETE /api/v1/queue/:id
 * Cancel a pending job
 */
router.delete('/queue/:id', (req, res) => {
  try {
    const services = req.app.get('services');
    const queue = services?.queue;

    const result = queue?.cancelJob(req.params.id);

    if (result?.success) {
      res.json({
        success: true,
        message: 'Job cancelled'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Not Found',
        message: result?.error || 'Job not found or cannot be cancelled'
      });
    }

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

/**
 * GET /api/v1/queue/stats
 * Get queue statistics
 */
router.get('/queue/stats', (req, res) => {
  try {
    const services = req.app.get('services');
    const queue = services?.queue;

    const stats = queue?.getStats() || {};

    res.json(stats);

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

module.exports = router;
