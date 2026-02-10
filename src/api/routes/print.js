/**
 * Print API Routes
 */

const express = require('express');
const router = express.Router();

// Per-target rate limiting
const targetRateLimiters = new Map();

const getTargetRateLimiter = (target, config) => {
  if (!targetRateLimiters.has(target)) {
    const limits = config.get(`target_rate_limits.${target}`) || 
                   config.get('target_rate_limits.default') ||
                   { max: 30, window_ms: 60000 };
    
    const limiter = {
      requests: [],
      max: limits.max,
      windowMs: limits.window_ms
    };
    targetRateLimiters.set(target, limiter);
  }

  const limiter = targetRateLimiters.get(target);
  const now = Date.now();
  
  // Clean old requests
  limiter.requests = limiter.requests.filter(t => now - t < limiter.windowMs);
  
  if (limiter.requests.length >= limiter.max) {
    return false;
  }
  
  limiter.requests.push(now);
  return true;
};

/**
 * POST /api/v1/print
 * Submit a print job
 */
router.post('/print', async (req, res) => {
  try {
    const services = req.app.get('services');
    const queue = services?.queue;
    const config = services?.config;
    const logger = services?.logger?.getLogger('api');

    if (!queue) {
      return res.status(503).json({ 
        error: 'Service Unavailable', 
        message: 'Print queue not initialized' 
      });
    }

    const { target, type, content, metadata, options } = req.body;

    // Validate required fields
    if (!target) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'Missing required field: target' 
      });
    }

    if (!content) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'Missing required field: content' 
      });
    }

    // Validate type
    const validTypes = ['raw', 'escpos', 'base64', 'text', 'pdf'];
    if (type && !validTypes.includes(type)) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: `Invalid type. Must be one of: ${validTypes.join(', ')}` 
      });
    }

    // Check target rate limit
    if (!getTargetRateLimiter(target, config)) {
      logger?.warn('Target rate limit exceeded', { target });
      return res.status(429).json({ 
        error: 'Too Many Requests', 
        message: `Rate limit exceeded for target: ${target}` 
      });
    }

    // Get idempotency key
    const idempotencyKey = req.headers['x-idempotency-key'];

    // Build job
    const job = {
      target,
      type: type || 'raw',
      content,
      metadata,
      priority: options?.priority || 0,
      delay_ms: options?.delay_ms || 0
    };

    // Add to queue
    const result = await queue.addJob(job, idempotencyKey);

    // Set appropriate status code
    if (result.duplicate) {
      res.status(200).json({
        success: true,
        duplicate: true,
        job_id: result.job_id,
        original_status: result.original_status,
        message: 'Duplicate job detected'
      });
    } else {
      res.status(201).json({
        success: true,
        job_id: result.job_id,
        status: result.status,
        position: result.position
      });
    }

  } catch (error) {
    const services = req.app.get('services');
    services?.logger?.getLogger('api')?.error('Print API error', { error: error.message });
    
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

/**
 * GET /api/v1/job/:id
 * Get job status by ID
 */
router.get('/job/:id', (req, res) => {
  try {
    const services = req.app.get('services');
    const queue = services?.queue;

    const job = queue?.getJob(req.params.id);

    if (!job) {
      return res.status(404).json({ 
        error: 'Not Found', 
        message: 'Job not found' 
      });
    }

    res.json({
      id: job.id,
      target: job.target,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      created_at: job.created_at,
      completed_at: job.completed_at,
      last_error: job.last_error
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

module.exports = router;
