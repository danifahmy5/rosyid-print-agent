/**
 * Windows Service Installation Script
 * 
 * Uses node-windows to install the Print Agent as a Windows Service.
 * The service will auto-start on boot and auto-restart on crash.
 */

const path = require('path');
const Service = require('node-windows').Service;

// Create service object
const svc = new Service({
  name: 'RosyidPOS Print Agent',
  description: 'Local print agent for RosyidPOS point of sale system',
  script: path.join(__dirname, '..', 'src', 'index.js'),
  nodeOptions: [
    '--max-old-space-size=256'
  ],
  workingDirectory: path.join(__dirname, '..'),
  allowServiceLogon: true
});

// Service event handlers
svc.on('install', () => {
  console.log('✓ Service installed successfully');
  console.log('Starting service...');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log('⚠ Service is already installed');
  console.log('To reinstall, run: npm run uninstall-service');
});

svc.on('start', () => {
  console.log('✓ Service started');
  console.log('');
  console.log('The RosyidPOS Print Agent is now running as a Windows Service.');
  console.log('');
  console.log('Dashboard: http://127.0.0.1:7331/dashboard');
  console.log('API:       http://127.0.0.1:7331/api/v1/health');
  console.log('');
  console.log('To manage the service:');
  console.log('  - Open Services (services.msc)');
  console.log('  - Find "RosyidPOS Print Agent"');
});

svc.on('error', (err) => {
  console.error('✗ Service error:', err);
});

svc.on('invalidinstallation', () => {
  console.error('✗ Invalid installation detected');
});

// Install the service
console.log('Installing RosyidPOS Print Agent as Windows Service...');
console.log('');
svc.install();
