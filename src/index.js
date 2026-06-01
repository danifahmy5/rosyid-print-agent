/**
 * RosyidPOS Print Agent - Main Entry Point
 * 
 * Windows Local Print Agent for silent POS printing
 */

const path = require('path');
const { app, httpServer, io } = require('./api/server');
const { ConfigManager } = require('./services/ConfigManager');
const { LoggingService } = require('./services/LoggingService');
const { DatabaseManager } = require('./database/connection');
const { PrintQueueManager } = require('./services/PrintQueueManager');
const { PrinterService } = require('./services/PrinterService');
const { MonitoringService } = require('./services/MonitoringService');
const { SafeModeController } = require('./services/SafeModeController');
const { UpdateManager } = require('./services/UpdateManager');

// Determine base path for config and data
const isPackaged = typeof process.pkg !== 'undefined';
const basePath = isPackaged 
  ? path.dirname(process.execPath)
  : path.join(__dirname, '..');

const dataPath = isPackaged
  ? path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'RosyidPOS', 'PrintAgent', 'data')
  : path.join(basePath, 'data');

/**
 * Main application class
 */
class PrintAgentApp {
  constructor() {
    this.services = {};
    this.isShuttingDown = false;
  }

  /**
   * Initialize all services
   */
  async initialize() {
    try {
      // Initialize config first
      this.services.config = new ConfigManager(basePath, dataPath);
      await this.services.config.load();

      // Initialize logging
      this.services.logger = new LoggingService(dataPath, this.services.config);
      this.logger = this.services.logger.getLogger('main');
      this.logger.info('Starting RosyidPOS Print Agent...');

      // Initialize database
      this.services.database = new DatabaseManager(dataPath);
      await this.services.database.initialize();

      // Initialize safe mode controller
      this.services.safeMode = new SafeModeController(
        this.services.database,
        this.services.config,
        this.services.logger.getLogger('safemode')
      );
      await this.services.safeMode.initialize();

      // Register startup
      await this.services.safeMode.recordStartup();

      // Initialize printer service
      this.services.printer = new PrinterService(
        this.services.config,
        this.services.logger.getLogger('printer')
      );
      await this.services.printer.initialize();

      // Initialize print queue manager
      this.services.queue = new PrintQueueManager(
        this.services.database,
        this.services.printer,
        this.services.config,
        this.services.logger.getLogger('queue')
      );
      await this.services.queue.initialize();

      // Initialize monitoring service
      this.services.monitoring = new MonitoringService(
        this.services.printer,
        this.services.queue,
        this.services.config,
        this.services.logger.getLogger('monitoring')
      );
      this.services.monitoring.setSocketIO(io);

      // Initialize update manager (if not in safe mode)
      if (!this.services.safeMode.isInSafeMode()) {
        this.services.update = new UpdateManager(
          this.services.config,
          this.services.logger.getLogger('update'),
          dataPath
        );
      }

      // Start HTTP server
      const port = this.services.config.get('agent.port', 7331);
      const host = this.services.config.get('agent.host', '127.0.0.1');

      // Pass services to Express app
      app.set('services', this.services);
      
      this.server = httpServer.listen(port, host, () => {
        this.logger.info(`Print Agent listening on http://${host}:${port}`);
        this.logger.info(`Dashboard available at http://${host}:${port}/dashboard`);
        
        if (this.services.safeMode.isInSafeMode()) {
          this.logger.warn('Running in SAFE MODE - some features disabled');
        }
      });

      // Start monitoring
      if (!this.services.safeMode.isInSafeMode()) {
        this.services.monitoring.start();
      }

      // Start queue processor
      this.services.queue.startProcessing();

      // Setup graceful shutdown
      this.setupShutdownHandlers();

      // Mark healthy startup after delay
      setTimeout(() => {
        this.services.safeMode.markHealthyStartup();
        this.logger.info('Startup verified as healthy');
      }, this.services.config.get('update.health_check_delay_ms', 60000));

    } catch (error) {
      console.error('Failed to initialize Print Agent:', error);
      if (this.services.logger) {
        this.logger.error('Initialization failed', { error: error.message });
      }
      process.exit(1);
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupShutdownHandlers() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      this.logger.info(`Received ${signal}, shutting down gracefully...`);

      try {
        // Stop accepting new requests
        if (this.server) {
          this.server.close();
        }

        // Stop queue processing
        if (this.services.queue) {
          await this.services.queue.stopProcessing();
        }

        // Stop monitoring
        if (this.services.monitoring) {
          this.services.monitoring.stop();
        }

        // Close database
        if (this.services.database) {
          await this.services.database.close();
        }

        this.logger.info('Shutdown complete');
        process.exit(0);
      } catch (error) {
        this.logger.error('Error during shutdown', { error: error.message });
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (error) => {
      if (this.services.logger) {
        this.logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      }
      console.error('Uncaught exception:', error);
      this.services.safeMode?.recordCrash('uncaughtException: ' + error.message);
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      if (this.services.logger) {
        this.logger.error('Unhandled rejection', { reason });
      }
      console.error('Unhandled rejection:', reason);
    });
  }
}

// Start the application
const agent = new PrintAgentApp();
agent.initialize();
