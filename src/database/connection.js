/**
 * Database Manager
 * 
 * SQLite database connection and schema management.
 * Uses better-sqlite3 for synchronous, fast operations.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseManager {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.dbPath = path.join(dataPath, 'database.sqlite');
    this.db = null;
  }

  /**
   * Initialize database connection and run migrations
   */
  async initialize() {
    // Ensure data directory exists
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }

    // Open database
    this.db = new Database(this.dbPath);
    
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    
    // Run migrations
    this.runMigrations();
  }

  /**
   * Run database migrations
   */
  runMigrations() {
    // Create migrations tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrations = [
      {
        name: '001_create_print_jobs',
        sql: `
          CREATE TABLE IF NOT EXISTS print_jobs (
            id TEXT PRIMARY KEY,
            idempotency_key TEXT UNIQUE,
            target TEXT NOT NULL,
            type TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT,
            status TEXT DEFAULT 'pending',
            priority INTEGER DEFAULT 0,
            attempts INTEGER DEFAULT 0,
            max_attempts INTEGER DEFAULT 3,
            last_error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            scheduled_at DATETIME,
            processing_at DATETIME,
            completed_at DATETIME,
            moved_to_dlq_at DATETIME
          );
          CREATE INDEX IF NOT EXISTS idx_jobs_status ON print_jobs(status);
          CREATE INDEX IF NOT EXISTS idx_jobs_target ON print_jobs(target);
          CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON print_jobs(scheduled_at);
          CREATE INDEX IF NOT EXISTS idx_jobs_idempotency ON print_jobs(idempotency_key);
        `
      },
      {
        name: '002_create_dead_letter_queue',
        sql: `
          CREATE TABLE IF NOT EXISTS dead_letter_queue (
            id TEXT PRIMARY KEY,
            original_job_id TEXT NOT NULL,
            target TEXT NOT NULL,
            type TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT,
            failure_reason TEXT NOT NULL,
            attempts INTEGER,
            created_at DATETIME,
            moved_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_dlq_target ON dead_letter_queue(target);
        `
      },
      {
        name: '003_create_idempotency_keys',
        sql: `
          CREATE TABLE IF NOT EXISTS idempotency_keys (
            key TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            status TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME
          );
          CREATE INDEX IF NOT EXISTS idx_idem_expires ON idempotency_keys(expires_at);
        `
      },
      {
        name: '004_create_crash_history',
        sql: `
          CREATE TABLE IF NOT EXISTS crash_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            reason TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_crash_timestamp ON crash_history(timestamp);
        `
      },
      {
        name: '005_create_config_cache',
        sql: `
          CREATE TABLE IF NOT EXISTS config_cache (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            synced_at DATETIME,
            source TEXT DEFAULT 'local'
          );
        `
      },
      {
        name: '006_create_printer_status',
        sql: `
          CREATE TABLE IF NOT EXISTS printer_status (
            name TEXT PRIMARY KEY,
            logical_name TEXT,
            status TEXT DEFAULT 'unknown',
            last_success DATETIME,
            last_error DATETIME,
            error_message TEXT,
            consecutive_failures INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `
      }
    ];

    // Check and apply migrations
    const applied = new Set(
      this.db.prepare('SELECT name FROM migrations').all().map(r => r.name)
    );

    for (const migration of migrations) {
      if (!applied.has(migration.name)) {
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
        console.log(`Applied migration: ${migration.name}`);
      }
    }
  }

  /**
   * Get database instance
   */
  getDb() {
    return this.db;
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Run cleanup tasks (idempotency keys, old logs, etc.)
   */
  runCleanup() {
    const now = new Date().toISOString();

    // Clean expired idempotency keys
    this.db.prepare('DELETE FROM idempotency_keys WHERE expires_at < ?').run(now);

    // Clean old crash history (keep last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare('DELETE FROM crash_history WHERE timestamp < ?').run(thirtyDaysAgo);

    // Clean old completed jobs (keep last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare(`
      DELETE FROM print_jobs 
      WHERE status = 'completed' AND completed_at < ?
    `).run(sevenDaysAgo);
  }
}

module.exports = { DatabaseManager };
