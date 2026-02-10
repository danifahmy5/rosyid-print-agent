/**
 * Monitoring Service
 * 
 * Monitors printer status and queue health.
 * Emits updates via WebSocket.
 */

class MonitoringService {
  constructor(printerService, queueManager, config, logger) {
    this.printerService = printerService;
    this.queueManager = queueManager;
    this.config = config;
    this.logger = logger;
    this.pollInterval = null;
    this.io = null;
  }

  /**
   * Set Socket.IO instance for real-time updates
   */
  setSocketIO(io) {
    this.io = io;
  }

  /**
   * Start monitoring
   */
  start() {
    const intervalMs = this.config.get('monitoring.status_poll_interval_ms', 30000);

    this.pollInterval = setInterval(() => {
      this.poll();
    }, intervalMs);

    this.logger.info('Monitoring service started');
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.logger.info('Monitoring service stopped');
  }

  /**
   * Poll for status updates
   */
  async poll() {
    try {
      // Refresh printer list
      await this.printerService.detectPrinters();

      // Get status
      const status = this.getFullStatus();

      // Emit to connected clients
      if (this.io) {
        this.io.emit('status', status);
      }

    } catch (error) {
      this.logger.error('Monitoring poll failed', { error: error.message });
    }
  }

  /**
   * Get full status for dashboard
   */
  getFullStatus() {
    return {
      timestamp: new Date().toISOString(),
      printers: this.printerService.getStatusSummary(),
      queue: this.queueManager.getStats(),
      agent: this.getAgentStatus()
    };
  }

  /**
   * Get agent health status
   */
  getAgentStatus() {
    const services = this.queueManager.database.getDb() ? 'ok' : 'error';
    
    return {
      version: require('../../package.json').version,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      services: {
        database: services,
        queue: 'ok',
        printer: 'ok'
      }
    };
  }
}

module.exports = { MonitoringService };
