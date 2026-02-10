/**
 * Windows Service Uninstallation Script
 */

const path = require('path');
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'RosyidPOS Print Agent',
  script: path.join(__dirname, '..', 'src', 'index.js')
});

svc.on('uninstall', () => {
  console.log('✓ Service uninstalled successfully');
  console.log('The RosyidPOS Print Agent is no longer running as a service.');
});

svc.on('alreadyuninstalled', () => {
  console.log('⚠ Service is not installed');
});

svc.on('error', (err) => {
  console.error('✗ Error:', err);
});

console.log('Uninstalling RosyidPOS Print Agent service...');
svc.uninstall();
