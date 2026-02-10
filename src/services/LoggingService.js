/**
 * Logging Service
 * 
 * Winston-based structured logging with daily rotation.
 * Separate logs for errors and print jobs.
 */

const winston = require('winston');
const path = require('path');
const DailyRotateFile = require('winston-daily-rotate-file');

class LoggingService {
  constructor(dataPath, configManager) {
    this.dataPath = dataPath;
    this.configManager = configManager;
    this.loggers = new Map();
    this.logsPath = path.join(dataPath, 'logs');

    // Ensure logs directory exists
    const fs = require('fs');
    if (!fs.existsSync(this.logsPath)) {
      fs.mkdirSync(this.logsPath, { recursive: true });
    }

    // Create default logger
    this.createLogger('main');
  }

  /**
   * Create a named logger instance
   * @param {string} name - Logger name
   */
  createLogger(name) {
    if (this.loggers.has(name)) {
      return this.loggers.get(name);
    }

    const level = this.configManager?.get('logging.level', 'info') || 'info';
    const maxFiles = this.configManager?.get('logging.max_files', '14d') || '14d';
    const maxSize = this.configManager?.get('logging.max_size', '20m') || '20m';

    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] [${name}] ${level.toUpperCase()}: ${message}${metaStr}`;
      })
    );

    const transports = [
      // Console (always)
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          logFormat
        )
      }),

      // Combined log file
      new DailyRotateFile({
        filename: path.join(this.logsPath, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxFiles: maxFiles,
        maxSize: maxSize,
        format: logFormat
      }),

      // Error log file
      new DailyRotateFile({
        filename: path.join(this.logsPath, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxFiles: maxFiles,
        maxSize: maxSize,
        level: 'error',
        format: logFormat
      })
    ];

    // Print job specific log (only for queue logger)
    if (name === 'queue') {
      transports.push(
        new DailyRotateFile({
          filename: path.join(this.logsPath, 'print-jobs-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: maxFiles,
          maxSize: maxSize,
          format: logFormat
        })
      );
    }

    const logger = winston.createLogger({
      level: level,
      format: logFormat,
      transports: transports
    });

    this.loggers.set(name, logger);
    return logger;
  }

  /**
   * Get or create a named logger
   * @param {string} name - Logger name
   */
  getLogger(name) {
    if (!this.loggers.has(name)) {
      this.createLogger(name);
    }
    return this.loggers.get(name);
  }

  /**
   * Get logs for dashboard display
   * @param {number} lines - Number of lines to return
   * @param {string} level - Filter by level (optional)
   */
  async getRecentLogs(lines = 100, level = null) {
    const fs = require('fs').promises;
    const logs = [];

    try {
      // Read from today's combined log
      const today = new Date().toISOString().split('T')[0];
      const logFile = path.join(this.logsPath, `combined-${today}.log`);
      
      const content = await fs.readFile(logFile, 'utf8');
      const allLines = content.split('\n').filter(line => line.trim());
      
      // Get last N lines
      const recentLines = allLines.slice(-lines);
      
      for (const line of recentLines) {
        const parsed = this.parseLogLine(line);
        if (parsed && (!level || parsed.level.toLowerCase() === level.toLowerCase())) {
          logs.push(parsed);
        }
      }
    } catch (error) {
      // File might not exist yet
    }

    return logs;
  }

  /**
   * Parse a log line into structured format
   */
  parseLogLine(line) {
    const match = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[(\w+)\] (\w+): (.+)/);
    if (match) {
      return {
        timestamp: match[1],
        logger: match[2],
        level: match[3],
        message: match[4]
      };
    }
    return null;
  }
}

module.exports = { LoggingService };
