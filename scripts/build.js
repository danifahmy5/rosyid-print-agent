/**
 * Build Script
 * 
 * Compiles the Print Agent into a Windows executable using pkg.
 * Run from Linux or Windows.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

console.log('Building RosyidPOS Print Agent...');
console.log('');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy config
console.log('Copying configuration...');
const configDist = path.join(distDir, 'config');
if (!fs.existsSync(configDist)) {
  fs.mkdirSync(configDist, { recursive: true });
}
fs.copyFileSync(
  path.join(__dirname, '..', 'config', 'default.json'),
  path.join(configDist, 'default.json')
);

// Copy dashboard
console.log('Copying dashboard...');
const dashboardSrc = path.join(__dirname, '..', 'dashboard');
const dashboardDist = path.join(distDir, 'dashboard');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDir(dashboardSrc, dashboardDist);

// Build executable
console.log('Building Windows executable...');
try {
  execSync('npx pkg . --targets node18-win-x64 --output dist/RosyidPrintAgent.exe', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
  
  console.log('');
  console.log('✓ Build complete!');
  console.log('');
  console.log('Output files:');
  console.log('  dist/RosyidPrintAgent.exe');
  console.log('  dist/config/default.json');
  console.log('  dist/dashboard/');
  console.log('');
  console.log('To deploy:');
  console.log('  1. Copy the dist folder to Windows machine');
  console.log('  2. Run RosyidPrintAgent.exe to start');
  console.log('  3. Use install-service.js to install as Windows Service');
  
} catch (error) {
  console.error('✗ Build failed:', error.message);
  process.exit(1);
}
