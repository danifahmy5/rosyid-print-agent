/**
 * Dead Letter Queue API Routes
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/v1/dlq
 * Get all jobs in the dead letter queue
 */
router.get('/dlq', (req, res) => {
  try {
    const services = req.app.get('services');
    const queue = services?.queue;

    if (!queue) {
      return res.status(503).json({ 
        error: 'Service Unavailable', 
        message: 'Queue service not initialized' 
      });
    }

    const dlqJobs = queue.getDLQ();

    res.json({
      count: dlqJobs.length,
      jobs: dlqJobs
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

/**
 * POST /api/v1/dlq/:id/retry
 * Retry a dead letter queue job
 */
router.post('/dlq/:id/retry', (req, res) => {
  try {
    const services = req.app.get('services');
    const queue = services?.queue;

    const result = queue?.retryDLQJob(req.params.id);

    if (result?.success) {
      res.json({
        success: true,
        message: 'Job moved back to queue',
        new_job_id: result.job_id
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Not Found',
        message: result?.error || 'DLQ job not found'
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
 * DELETE /api/v1/dlq/:id
 * Discard a dead letter queue job
 */
router.delete('/dlq/:id', (req, res) => {
  try {
    const services = req.app.get('services');
    const queue = services?.queue;

    const result = queue?.discardDLQJob(req.params.id);

    if (result?.success) {
      res.json({
        success: true,
        message: 'Job discarded'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Not Found',
        message: result?.error || 'DLQ job not found'
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
 * POST /api/v1/dlq/:id/redirect
 * Redirect a DLQ job to a different printer
 */
router.post('/dlq/:id/redirect', (req, res) => {
  try {
    const services = req.app.get('services');
    const queue = services?.queue;

    const { target } = req.body;

    if (!target) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required field: target'
      });
    }

    const result = queue?.redirectDLQJob(req.params.id, target);

    if (result?.success) {
      res.json({
        success: true,
        message: `Job redirected to ${target}`,
        new_job_id: result.job_id
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Not Found',
        message: result?.error || 'DLQ job not found'
      });
    }

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

module.exports = router;
