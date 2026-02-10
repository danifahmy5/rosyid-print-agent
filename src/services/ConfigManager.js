/**
 * Configuration Manager Service
 * 
 * Handles loading, saving, and merging configuration.
 * Supports remote config sync with local fallback.
 */

const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor(basePath, dataPath) {
    this.basePath = basePath;
    this.dataPath = dataPath;
    this.configPath = path.join(dataPath, 'config.json');
    this.defaultConfigPath = path.join(basePath, 'config', 'default.json');
    this.config = {};
    this.lastSyncTime = null;
  }

  /**
   * Load configuration from file
   */
  async load() {
    try {
      // Load default config
      let defaultConfig = {};
      if (fs.existsSync(this.defaultConfigPath)) {
        const defaultContent = fs.readFileSync(this.defaultConfigPath, 'utf8');
        defaultConfig = JSON.parse(defaultContent);
      }

      // Load user config (overrides defaults)
      let userConfig = {};
      if (fs.existsSync(this.configPath)) {
        const userContent = fs.readFileSync(this.configPath, 'utf8');
        userConfig = JSON.parse(userContent);
      }

      // Merge configs (user overrides default)
      this.config = this.deepMerge(defaultConfig, userConfig);

      // Ensure data directory exists
      if (!fs.existsSync(this.dataPath)) {
        fs.mkdirSync(this.dataPath, { recursive: true });
      }

    } catch (error) {
      console.error('Error loading config:', error);
      throw error;
    }
  }

  /**
   * Save current configuration to file
   */
  async save() {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(
        this.configPath, 
        JSON.stringify(this.config, null, 2),
        'utf8'
      );
    } catch (error) {
      console.error('Error saving config:', error);
      throw error;
    }
  }

  /**
   * Get configuration value by dot-notation path
   * @param {string} keyPath - Dot-notation path (e.g., 'agent.port')
   * @param {*} defaultValue - Default value if not found
   */
  get(keyPath, defaultValue = null) {
    const keys = keyPath.split('.');
    let value = this.config;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * Set configuration value by dot-notation path
   * @param {string} keyPath - Dot-notation path
   * @param {*} value - Value to set
   */
  set(keyPath, value) {
    const keys = keyPath.split('.');
    let current = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    current[keys[keys.length - 1]] = value;
  }

  /**
   * Get all configuration
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * Get printer mapping by logical name
   * @param {string} logicalName - Logical printer name (e.g., 'cashier')
   */
  getPrinterMapping(logicalName) {
    return this.get(`printers.mappings.${logicalName}`, null);
  }

  /**
   * Get category routing target
   * @param {string} category - Product category
   */
  getCategoryRoute(category) {
    const routing = this.get('printers.routing', {});
    return routing[category.toLowerCase()] || routing.default || 'cashier';
  }

  /**
   * Merge remote configuration
   * @param {Object} remoteConfig - Configuration from remote server
   */
  mergeRemoteConfig(remoteConfig) {
    // Only merge specific sections that should be remote-controlled
    const allowedSections = ['printers', 'routing'];
    
    for (const section of allowedSections) {
      if (remoteConfig[section]) {
        this.config[section] = this.deepMerge(
          this.config[section] || {},
          remoteConfig[section]
        );
      }
    }

    this.lastSyncTime = new Date();
  }

  /**
   * Deep merge two objects
   */
  deepMerge(target, source) {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  /**
   * Get last sync time
   */
  getLastSyncTime() {
    return this.lastSyncTime;
  }

  /**
   * Check if config is stale (not synced recently)
   */
  isStale() {
    if (!this.lastSyncTime) return true;
    const staleThreshold = this.get('sync.interval_minutes', 30) * 60 * 1000 * 2; // 2x interval
    return Date.now() - this.lastSyncTime.getTime() > staleThreshold;
  }
}

module.exports = { ConfigManager };
