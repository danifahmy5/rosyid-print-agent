/**
 * Update Manager
 * 
 * Handles automatic updates with atomic versioning and rollback support.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

class UpdateManager {
  constructor(config, logger, dataPath) {
    this.config = config;
    this.logger = logger;
    this.dataPath = dataPath;
    this.basePath = path.dirname(dataPath);
    this.versionsPath = path.join(this.basePath, 'versions');
    this.stagingPath = path.join(this.basePath, 'staging');
    this.currentLink = path.join(this.basePath, 'current');
    this.rollbackMarker = path.join(this.basePath, 'rollback-marker');
    this.checkInterval = null;
    this.updating = false;
  }

  /**
   * Start update checking
   */
  startChecking() {
    if (!this.config.get('update.enabled', true)) {
      this.logger.info('Auto-update disabled');
      return;
    }

    const intervalHours = this.config.get('update.check_interval_hours', 6);
    const intervalMs = intervalHours * 60 * 60 * 1000;

    this.checkInterval = setInterval(() => {
      this.checkForUpdate();
    }, intervalMs);

    // Check on startup (after delay)
    setTimeout(() => this.checkForUpdate(), 60000);

    this.logger.info(`Update checking enabled (every ${intervalHours}h)`);
  }

  /**
   * Stop update checking
   */
  stopChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check for available updates
   */
  async checkForUpdate() {
    if (this.updating) return;

    const serverUrl = this.config.get('update.server_url');
    if (!serverUrl) {
      this.logger.debug('No update server configured');
      return;
    }

    try {
      const currentVersion = require('../../package.json').version;
      
      const response = await axios.get(`${serverUrl}/api/print-agent/version`, {
        timeout: 10000,
        headers: {
          'X-Current-Version': currentVersion
        }
      });

      const { latest_version, download_url, changelog } = response.data;

      if (this.isNewerVersion(currentVersion, latest_version)) {
        this.logger.info(`Update available: ${currentVersion} → ${latest_version}`);
        
        // Auto-update
        if (this.config.get('update.auto_install', true)) {
          await this.performUpdate(latest_version, download_url);
        }
      }

    } catch (error) {
      this.logger.debug('Update check failed', { error: error.message });
    }
  }

  /**
   * Compare versions (semver)
   */
  isNewerVersion(current, latest) {
    const currentParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if ((latestParts[i] || 0) > (currentParts[i] || 0)) return true;
      if ((latestParts[i] || 0) < (currentParts[i] || 0)) return false;
    }
    return false;
  }

  /**
   * Perform atomic update
   */
  async performUpdate(version, downloadUrl) {
    if (this.updating) return;
    this.updating = true;

    this.logger.info(`Starting update to ${version}`);

    try {
      // 1. Download to staging
      await this.downloadToStaging(downloadUrl, version);

      // 2. Create rollback marker
      this.createRollbackMarker(version);

      // 3. Switch current symlink
      await this.switchToVersion(version);

      // 4. Trigger service restart
      this.logger.info('Update staged, service will restart');
      process.exit(0); // Service manager will restart

    } catch (error) {
      this.logger.error('Update failed', { error: error.message });
      await this.cleanupStaging();
    } finally {
      this.updating = false;
    }
  }

  /**
   * Download update to staging
   */
  async downloadToStaging(url, version) {
    // Clear staging
    if (fs.existsSync(this.stagingPath)) {
      fs.rmSync(this.stagingPath, { recursive: true });
    }
    fs.mkdirSync(this.stagingPath, { recursive: true });

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 300000 // 5 minutes
    });

    const zipPath = path.join(this.stagingPath, 'update.zip');
    fs.writeFileSync(zipPath, response.data);

    // Extract (simplified - in production use proper unzip)
    // For now, assume download is already extracted
    const versionPath = path.join(this.versionsPath, version);
    fs.mkdirSync(versionPath, { recursive: true });

    // In real implementation, extract zip to versionPath
    this.logger.info(`Downloaded update to ${versionPath}`);
  }

  /**
   * Create rollback marker with previous version
   */
  createRollbackMarker(newVersion) {
    const currentVersion = require('../../package.json').version;
    fs.writeFileSync(this.rollbackMarker, JSON.stringify({
      previous_version: currentVersion,
      new_version: newVersion,
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * Switch current symlink to new version
   */
  async switchToVersion(version) {
    const versionPath = path.join(this.versionsPath, version);

    // Remove old symlink if exists
    try {
      fs.unlinkSync(this.currentLink);
    } catch (e) {
      // Ignore
    }

    // Create new symlink
    fs.symlinkSync(versionPath, this.currentLink, 'junction');
    this.logger.info(`Switched to version ${version}`);
  }

  /**
   * Rollback to previous version
   */
  async rollback() {
    if (!fs.existsSync(this.rollbackMarker)) {
      this.logger.error('No rollback marker found');
      return false;
    }

    try {
      const marker = JSON.parse(fs.readFileSync(this.rollbackMarker, 'utf8'));
      await this.switchToVersion(marker.previous_version);
      fs.unlinkSync(this.rollbackMarker);
      this.logger.info(`Rolled back to ${marker.previous_version}`);
      return true;
    } catch (error) {
      this.logger.error('Rollback failed', { error: error.message });
      return false;
    }
  }

  /**
   * Cleanup old versions (keep last 2)
   */
  cleanupOldVersions() {
    if (!fs.existsSync(this.versionsPath)) return;

    const versions = fs.readdirSync(this.versionsPath)
      .filter(f => fs.statSync(path.join(this.versionsPath, f)).isDirectory())
      .sort()
      .reverse();

    // Keep last 2 versions
    const toDelete = versions.slice(2);
    
    for (const version of toDelete) {
      const versionPath = path.join(this.versionsPath, version);
      fs.rmSync(versionPath, { recursive: true });
      this.logger.info(`Cleaned up old version: ${version}`);
    }
  }

  /**
   * Cleanup staging directory
   */
  async cleanupStaging() {
    try {
      if (fs.existsSync(this.stagingPath)) {
        fs.rmSync(this.stagingPath, { recursive: true });
      }
    } catch (error) {
      // Ignore
    }
  }

  /**
   * Get update status
   */
  getStatus() {
    return {
      enabled: this.config.get('update.enabled', true),
      updating: this.updating,
      current_version: require('../../package.json').version,
      has_rollback: fs.existsSync(this.rollbackMarker)
    };
  }
}

module.exports = { UpdateManager };
