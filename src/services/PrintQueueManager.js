/**
 * Print Queue Manager
 * 
 * Manages print job queue with persistence, retry logic, and DLQ.
 * Implements idempotency checking and priority ordering.
 */

const { v4: uuidv4 } = require('uuid');

class PrintQueueManager {
  constructor(database, printerService, config, logger) {
    this.database = database;
    this.db = database.getDb();
    this.printerService = printerService;
    this.config = config;
    this.logger = logger;
    this.processing = false;
    this.processInterval = null;
  }

  /**
   * Initialize queue manager
   */
  async initialize() {
    // Reset any jobs stuck in 'processing' state from previous run
    this.db.prepare(`
      UPDATE print_jobs SET status = 'pending', attempts = attempts 
      WHERE status = 'processing'
    `).run();

    this.logger.info('Print queue initialized');
  }

  /**
   * Start processing queue
   */
  startProcessing() {
    if (this.processInterval) return;

    this.processInterval = setInterval(() => {
      this.processNextJob();
    }, 1000);

    this.logger.info('Queue processing started');
  }

  /**
   * Stop processing queue
   */
  async stopProcessing() {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }

    // Wait for current job to complete
    let attempts = 0;
    while (this.processing && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    this.logger.info('Queue processing stopped');
  }

  /**
   * Add a new print job to the queue
   * @param {Object} job - Print job data
   * @param {string} idempotencyKey - Optional idempotency key
   */
  async addJob(job, idempotencyKey = null) {
    // Check idempotency
    if (idempotencyKey) {
      const existing = this.checkIdempotency(idempotencyKey);
      if (existing) {
        this.logger.info('Duplicate job detected', { idempotencyKey });
        return {
          success: true,
          duplicate: true,
          job_id: existing.job_id,
          original_status: existing.status
        };
      }
    }

    const jobId = uuidv4();
    const maxAttempts = this.config.get('queue.max_attempts', 3);

    // Validate target printer
    const physicalPrinter = this.printerService.resolveLogicalName(job.target);
    if (!this.printerService.printerExists(physicalPrinter)) {
      this.logger.warn('Target printer not found, job will queue', { 
        target: job.target, 
        physical: physicalPrinter 
      });
    }

    // Insert job
    this.db.prepare(`
      INSERT INTO print_jobs (
        id, idempotency_key, target, type, content, metadata, 
        priority, max_attempts, scheduled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      idempotencyKey,
      job.target,
      job.type || 'raw',
      typeof job.content === 'string' ? job.content : JSON.stringify(job.content),
      job.metadata ? JSON.stringify(job.metadata) : null,
      job.priority || 0,
      maxAttempts,
      job.delay_ms ? new Date(Date.now() + job.delay_ms).toISOString() : null
    );

    // Store idempotency key
    if (idempotencyKey) {
      this.storeIdempotencyKey(idempotencyKey, jobId);
    }

    const position = this.getQueuePosition(jobId);

    this.logger.info('Job queued', { jobId, target: job.target, position });

    return {
      success: true,
      duplicate: false,
      job_id: jobId,
      status: 'queued',
      position: position
    };
  }

  /**
   * Check if idempotency key exists
   */
  checkIdempotency(key) {
    const result = this.db.prepare(`
      SELECT job_id, status FROM idempotency_keys WHERE key = ?
    `).get(key);

    if (result) {
      // Update status from current job
      const job = this.db.prepare('SELECT status FROM print_jobs WHERE id = ?').get(result.job_id);
      return {
        job_id: result.job_id,
        status: job?.status || result.status
      };
    }

    return null;
  }

  /**
   * Store idempotency key
   */
  storeIdempotencyKey(key, jobId) {
    const ttlHours = this.config.get('queue.idempotency_ttl_hours', 24);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

    this.db.prepare(`
      INSERT OR REPLACE INTO idempotency_keys (key, job_id, expires_at) 
      VALUES (?, ?, ?)
    `).run(key, jobId, expiresAt);
  }

  /**
   * Get queue position for a job
   */
  getQueuePosition(jobId) {
    const result = this.db.prepare(`
      SELECT COUNT(*) as position FROM print_jobs 
      WHERE status = 'pending' AND (
        priority > (SELECT priority FROM print_jobs WHERE id = ?) OR
        (priority = (SELECT priority FROM print_jobs WHERE id = ?) AND created_at < (SELECT created_at FROM print_jobs WHERE id = ?))
      )
    `).get(jobId, jobId, jobId);

    return (result?.position || 0) + 1;
  }

  /**
   * Process next job in queue
   */
  async processNextJob() {
    if (this.processing) return;

    // Get next pending job (priority DESC, created_at ASC)
    const job = this.db.prepare(`
      SELECT * FROM print_jobs 
      WHERE status = 'pending' 
        AND (scheduled_at IS NULL OR scheduled_at <= datetime('now'))
      ORDER BY priority DESC, created_at ASC 
      LIMIT 1
    `).get();

    if (!job) return;

    this.processing = true;

    try {
      // Mark as processing
      this.db.prepare(`
        UPDATE print_jobs SET status = 'processing', processing_at = datetime('now')
        WHERE id = ?
      `).run(job.id);

      // Resolve printer
      const physicalPrinter = this.printerService.resolveLogicalName(job.target);

      // Prepare content
      let content = job.content;
      if (job.type === 'base64') {
        content = Buffer.from(content, 'base64');
      }

      // Attempt print
      await this.printerService.printRaw(physicalPrinter, content);

      // Mark completed
      this.db.prepare(`
        UPDATE print_jobs SET status = 'completed', completed_at = datetime('now')
        WHERE id = ?
      `).run(job.id);

      // Update idempotency key status
      if (job.idempotency_key) {
        this.db.prepare(`
          UPDATE idempotency_keys SET status = 'completed' WHERE key = ?
        `).run(job.idempotency_key);
      }

      this.logger.info('Job completed', { jobId: job.id, target: job.target });

    } catch (error) {
      this.handleJobError(job, error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Handle job error with retry logic
   */
  handleJobError(job, error) {
    const attempts = job.attempts + 1;
    const maxAttempts = job.max_attempts || this.config.get('queue.max_attempts', 3);

    if (attempts >= maxAttempts) {
      // Move to DLQ
      this.moveToDLQ(job, error.message);
    } else {
      // Schedule retry
      const retryDelays = this.config.get('queue.retry_delays', [5000, 15000, 60000]);
      const delay = retryDelays[attempts - 1] || retryDelays[retryDelays.length - 1];
      const scheduledAt = new Date(Date.now() + delay).toISOString();

      this.db.prepare(`
        UPDATE print_jobs 
        SET status = 'pending', attempts = ?, last_error = ?, scheduled_at = ?
        WHERE id = ?
      `).run(attempts, error.message, scheduledAt, job.id);

      this.logger.warn('Job failed, will retry', { 
        jobId: job.id, 
        attempts, 
        nextRetry: scheduledAt,
        error: error.message 
      });
    }
  }

  /**
   * Move job to Dead Letter Queue
   */
  moveToDLQ(job, failureReason) {
    // Insert into DLQ
    this.db.prepare(`
      INSERT INTO dead_letter_queue (
        id, original_job_id, target, type, content, metadata, 
        failure_reason, attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      job.id,
      job.target,
      job.type,
      job.content,
      job.metadata,
      failureReason,
      job.attempts + 1,
      job.created_at
    );

    // Update original job
    this.db.prepare(`
      UPDATE print_jobs SET status = 'dead', moved_to_dlq_at = datetime('now')
      WHERE id = ?
    `).run(job.id);

    this.logger.error('Job moved to DLQ', { 
      jobId: job.id, 
      target: job.target, 
      reason: failureReason 
    });
  }

  /**
   * Get active queue (pending and processing jobs)
   */
  getQueue() {
    return this.db.prepare(`
      SELECT id, target, type, status, priority, attempts, 
             created_at, scheduled_at, last_error
      FROM print_jobs 
      WHERE status IN ('pending', 'processing')
      ORDER BY priority DESC, created_at ASC
    `).all();
  }

  /**
   * Get dead letter queue
   */
  getDLQ() {
    return this.db.prepare(`
      SELECT id, original_job_id, target, type, failure_reason, 
             attempts, created_at, moved_at
      FROM dead_letter_queue 
      ORDER BY moved_at DESC
    `).all();
  }

  /**
   * Cancel a pending job
   */
  cancelJob(jobId) {
    const result = this.db.prepare(`
      UPDATE print_jobs SET status = 'cancelled' 
      WHERE id = ? AND status = 'pending'
    `).run(jobId);

    if (result.changes > 0) {
      this.logger.info('Job cancelled', { jobId });
      return { success: true };
    }

    return { success: false, error: 'Job not found or not cancelable' };
  }

  /**
   * Retry a DLQ job
   */
  retryDLQJob(dlqId) {
    const dlqJob = this.db.prepare('SELECT * FROM dead_letter_queue WHERE id = ?').get(dlqId);
    
    if (!dlqJob) {
      return { success: false, error: 'DLQ job not found' };
    }

    // Create new job from DLQ job
    const jobId = uuidv4();
    this.db.prepare(`
      INSERT INTO print_jobs (id, target, type, content, metadata, max_attempts)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(jobId, dlqJob.target, dlqJob.type, dlqJob.content, dlqJob.metadata, 3);

    // Remove from DLQ
    this.db.prepare('DELETE FROM dead_letter_queue WHERE id = ?').run(dlqId);

    this.logger.info('DLQ job retried', { dlqId, newJobId: jobId });

    return { success: true, job_id: jobId };
  }

  /**
   * Discard a DLQ job
   */
  discardDLQJob(dlqId) {
    const result = this.db.prepare('DELETE FROM dead_letter_queue WHERE id = ?').run(dlqId);
    
    if (result.changes > 0) {
      this.logger.info('DLQ job discarded', { dlqId });
      return { success: true };
    }

    return { success: false, error: 'DLQ job not found' };
  }

  /**
   * Redirect DLQ job to different printer
   */
  redirectDLQJob(dlqId, newTarget) {
    const dlqJob = this.db.prepare('SELECT * FROM dead_letter_queue WHERE id = ?').get(dlqId);
    
    if (!dlqJob) {
      return { success: false, error: 'DLQ job not found' };
    }

    // Create new job with different target
    const jobId = uuidv4();
    this.db.prepare(`
      INSERT INTO print_jobs (id, target, type, content, metadata, max_attempts)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(jobId, newTarget, dlqJob.type, dlqJob.content, dlqJob.metadata, 3);

    // Remove from DLQ
    this.db.prepare('DELETE FROM dead_letter_queue WHERE id = ?').run(dlqId);

    this.logger.info('DLQ job redirected', { dlqId, newJobId: jobId, newTarget });

    return { success: true, job_id: jobId };
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) as dead
      FROM print_jobs
      WHERE created_at > datetime('now', '-24 hours')
    `).get();

    const dlqCount = this.db.prepare('SELECT COUNT(*) as count FROM dead_letter_queue').get();

    return {
      ...stats,
      dlq_count: dlqCount?.count || 0
    };
  }

  /**
   * Get job by ID
   */
  getJob(jobId) {
    return this.db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobId);
  }
}

module.exports = { PrintQueueManager };
