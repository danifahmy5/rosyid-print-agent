/**
 * Safe Mode Controller
 * 
 * Detects repeated crashes and enters safe mode to prevent crash loops.
 * Disables risky subsystems when in safe mode.
 */

class SafeModeController {
  constructor(database, config, logger) {
    this.database = database;
    this.config = config;
    this.logger = logger;
    this.db = database.getDb();
    this.safeMode = false;
    this.safeModeReason = null;
    this.startTime = Date.now();
  }

  /**
   * Initialize and check if should enter safe mode
   */
  async initialize() {
    const crashThreshold = this.config.get('safe_mode.crash_threshold', 3);
    const windowMinutes = this.config.get('safe_mode.crash_window_minutes', 10);
    
    // Count recent crashes
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const crashes = this.db.prepare(`
      SELECT COUNT(*) as count FROM crash_history 
      WHERE timestamp > ?
    `).get(windowStart);

    if (crashes.count >= crashThreshold) {
      this.enterSafeMode(`${crashes.count} crashes in last ${windowMinutes} minutes`);
    }

    // Check for rollback marker (update failed)
    if (await this.checkRollbackMarker()) {
      this.enterSafeMode('Update rollback detected');
    }

    this.logger.info(`Safe mode status: ${this.safeMode ? 'ACTIVE' : 'inactive'}`);
  }

  /**
   * Record application startup
   */
  async recordStartup() {
    // Clear old crash records outside window
    const windowMinutes = this.config.get('safe_mode.crash_window_minutes', 10);
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    
    this.db.prepare('DELETE FROM crash_history WHERE timestamp < ?').run(windowStart);
  }

  /**
   * Record a crash event
   * @param {string} reason - Crash reason
   */
  recordCrash(reason) {
    try {
      this.db.prepare(`
        INSERT INTO crash_history (reason) VALUES (?)
      `).run(reason);
    } catch (error) {
      console.error('Failed to record crash:', error);
    }
  }

  /**
   * Enter safe mode
   * @param {string} reason - Reason for entering safe mode
   */
  enterSafeMode(reason) {
    this.safeMode = true;
    this.safeModeReason = reason;
    this.logger.warn(`Entering SAFE MODE: ${reason}`);
  }

  /**
   * Exit safe mode
   */
  exitSafeMode() {
    if (this.safeMode) {
      this.safeMode = false;
      this.safeModeReason = null;
      this.logger.info('Exited safe mode');
    }
  }

  /**
   * Check if currently in safe mode
   */
  isInSafeMode() {
    return this.safeMode;
  }

  /**
   * Get safe mode status with details
   */
  getStatus() {
    return {
      enabled: this.safeMode,
      reason: this.safeModeReason,
      uptime: Date.now() - this.startTime,
      canExit: this.canAutoExit()
    };
  }

  /**
   * Check if can auto-exit safe mode (stable for configured time)
   */
  canAutoExit() {
    if (!this.safeMode) return false;
    
    const autoExitHours = this.config.get('safe_mode.auto_exit_hours', 1);
    const stableTime = autoExitHours * 60 * 60 * 1000;
    
    return Date.now() - this.startTime > stableTime;
  }

  /**
   * Try to auto-exit safe mode if conditions are met
   */
  tryAutoExit() {
    if (this.canAutoExit()) {
      this.exitSafeMode();
      return true;
    }
    return false;
  }

  /**
   * Mark startup as healthy (called after health check delay)
   */
  markHealthyStartup() {
    // Remove any pending rollback markers
    this.clearRollbackMarker();
  }

  /**
   * Check for update rollback marker
   */
  async checkRollbackMarker() {
    const fs = require('fs');
    const path = require('path');
    const markerPath = path.join(this.config.dataPath || '.', '..', 'rollback-marker');
    
    return fs.existsSync(markerPath);
  }

  /**
   * Clear rollback marker after successful startup
   */
  clearRollbackMarker() {
    const fs = require('fs');
    const path = require('path');
    const markerPath = path.join(this.config.dataPath || '.', '..', 'rollback-marker');
    
    try {
      if (fs.existsSync(markerPath)) {
        fs.unlinkSync(markerPath);
        this.logger.info('Cleared rollback marker after healthy startup');
      }
    } catch (error) {
      this.logger.error('Failed to clear rollback marker', { error: error.message });
    }
  }

  /**
   * Get list of disabled features in safe mode
   */
  getDisabledFeatures() {
    if (!this.safeMode) return [];
    
    return [
      'auto_update',
      'config_sync',
      'monitoring_polling'
    ];
  }
}

module.exports = { SafeModeController };
