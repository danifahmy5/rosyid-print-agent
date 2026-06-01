/**
 * Express API Server
 * 
 * HTTP server with versioned API, authentication, rate limiting, and dashboard.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: false // Allow dashboard inline scripts
}));

// CORS configuration
app.use((req, res, next) => {
  // Allow all origins for the health check endpoint
  if (req.path === '/health') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    return next();
  }

  const services = req.app.get('services');
  const config = services?.config;
  
  const host = config?.get('agent.host', '127.0.0.1') || '127.0.0.1';
  const port = config?.get('agent.port', 7331) || 7331;
  
  const defaultAllowed = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://${host}:${port}`,
    'http://localhost',
    'http://127.0.0.1'
  ];
  
  const configuredOrigins = config?.get('security.allowed_origins', ['*']) || ['*'];
  const allowedOrigins = [...new Set([...configuredOrigins, ...defaultAllowed])];
  
  cors({
    origin: (origin, callback) => {
      const isLocal = origin && (
        origin.startsWith('http://localhost') || 
        origin.startsWith('http://127.0.0.1') ||
        origin.startsWith('http://[::1]') ||
        origin.startsWith('http://localhost:') || 
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('http://[::1]:') ||
        origin.startsWith('http://192.168.') ||
        origin.startsWith('http://10.') ||
        origin.startsWith('http://172.')
      );
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin) || isLocal) {
        callback(null, true);
      } else {
        callback(null, false); // Do not throw Error to prevent 500 Internal Server Error
      }
    },
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-RosyidPOS-Key', 'X-Idempotency-Key']
  })(req, res, next);
});

// Authentication middleware (for API routes)
const authenticate = (req, res, next) => {
  const services = req.app.get('services');
  const config = services?.config;
  
  // Skip auth for health and dashboard
  if (req.path === '/health' || req.path.startsWith('/dashboard')) {
    return next();
  }

  const apiKey = config?.get('security.api_key');
  const providedKey = req.headers['x-rosyidpos-key'];

  // Allow if no key configured (development)
  if (!apiKey || apiKey === 'change-this-secret-key') {
    return next();
  }

  if (providedKey !== apiKey) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Invalid or missing X-RosyidPOS-Key header' 
    });
  }

  next();
};

// IP whitelist middleware
const checkIP = (req, res, next) => {
  const services = req.app.get('services');
  const config = services?.config;

  if (!config?.get('security.enable_ip_check', false)) {
    return next();
  }

  const allowedIPs = config.get('security.allowed_ips', ['127.0.0.1']);
  const clientIP = req.ip || req.socket.remoteAddress;

  const isAllowed = allowedIPs.some(pattern => {
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return clientIP.startsWith(prefix);
    }
    return clientIP === pattern || clientIP === `::ffff:${pattern}`;
  });

  if (!isAllowed) {
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'IP not whitelisted' 
    });
  }

  next();
};

// Simple in-memory rate limiter for health endpoint to avoid express-rate-limit validation errors
const healthRateLimiter = {
  requests: [],
  max: 120,
  windowMs: 60000
};

const healthLimiterMiddleware = (req, res, next) => {
  const services = req.app.get('services');
  const config = services?.config;
  
  const limits = config?.get('rate_limits.health') || { max: 120, window_ms: 60000 };
  const now = Date.now();
  
  healthRateLimiter.max = limits.max;
  healthRateLimiter.windowMs = limits.window_ms;
  
  healthRateLimiter.requests = healthRateLimiter.requests.filter(t => now - t < healthRateLimiter.windowMs);
  
  if (healthRateLimiter.requests.length >= healthRateLimiter.max) {
    return res.status(429).json({ 
      error: 'Too Many Requests', 
      message: 'Rate limit exceeded. Try again later.' 
    });
  }
  
  healthRateLimiter.requests.push(now);
  next();
};

// Apply global middleware
app.use(checkIP);
app.use(authenticate);

// Serve dashboard static files
app.use('/dashboard', express.static(path.join(__dirname, '../../dashboard')));

// Health endpoint (unversioned, always available)
app.get('/health', healthLimiterMiddleware, (req, res) => {
  const services = req.app.get('services');
  const packageJson = require('../../package.json');
  
  const safeMode = services?.safeMode;
  const config = services?.config;

  res.json({
    status: 'ok',
    version: packageJson.version,
    mode: safeMode?.isInSafeMode() ? 'safe' : (config?.isStale() ? 'degraded' : 'normal'),
    uptime: process.uptime(),
    services: {
      printer: 'ok',
      queue: 'ok',
      configSync: config?.isStale() ? 'stale' : 'ok',
      autoUpdate: safeMode?.isInSafeMode() ? 'disabled' : 'enabled'
    },
    safe_mode: safeMode?.getStatus(),
    lastConfigSync: config?.getLastSyncTime()
  });
});

// Import API routes
const healthRoutes = require('./routes/health');
const printRoutes = require('./routes/print');
const printersRoutes = require('./routes/printers');
const queueRoutes = require('./routes/queue');
const statusRoutes = require('./routes/status');
const configRoutes = require('./routes/config');
const dlqRoutes = require('./routes/dlq');

// Mount versioned API routes
app.use('/api/v1', healthRoutes);
app.use('/api/v1', printRoutes);
app.use('/api/v1', printersRoutes);
app.use('/api/v1', queueRoutes);
app.use('/api/v1', statusRoutes);
app.use('/api/v1', configRoutes);
app.use('/api/v1', dlqRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  const services = req.app.get('services');
  const logger = services?.logger?.getLogger('api');
  
  logger?.error('API Error', { 
    error: err.message, 
    path: req.path, 
    method: req.method 
  });

  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Export for use in index.js
module.exports = { app, httpServer, io };
