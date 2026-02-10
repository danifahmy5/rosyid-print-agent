/**
 * RosyidPOS Print Agent Dashboard
 * Frontend JavaScript
 */

// API Base URL
const API_BASE = '/api/v1';

// State
let socket = null;
let currentTab = 'printers';
let logs = [];
let printers = [];
let queueJobs = [];
let dlqJobs = [];
let config = {};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initSocket();
  fetchAll();
  
  // Refresh data periodically
  setInterval(fetchAll, 10000);
});

/**
 * Initialize tab switching
 */
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchTab(tabName);
    });
  });
}

/**
 * Switch to a tab
 */
function switchTab(tabName) {
  currentTab = tabName;
  
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Update tab panes
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `${tabName}-tab`);
  });
  
  // Refresh relevant data
  if (tabName === 'printers') refreshPrinters();
  else if (tabName === 'queue') refreshQueue();
  else if (tabName === 'dlq') refreshDLQ();
  else if (tabName === 'config') refreshConfig();
}

/**
 * Initialize WebSocket connection
 */
function initSocket() {
  try {
    socket = io();
    
    socket.on('connect', () => {
      updateConnectionStatus(true);
    });
    
    socket.on('disconnect', () => {
      updateConnectionStatus(false);
    });
    
    socket.on('status', (data) => {
      updateStatusFromSocket(data);
    });
    
  } catch (e) {
    console.error('WebSocket init failed:', e);
    updateConnectionStatus(false);
  }
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(connected) {
  const el = document.getElementById('connection-status');
  el.className = connected ? 'connected' : 'disconnected';
  el.textContent = connected ? '●  Connected' : '●  Disconnected';
}

/**
 * Fetch all data
 */
async function fetchAll() {
  await Promise.all([
    fetchHealth(),
    refreshPrinters(),
    refreshQueue(),
    refreshDLQ(),
    refreshConfig()
  ]);
}

/**
 * Fetch health status
 */
async function fetchHealth() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    
    updateHealthDisplay(data);
  } catch (e) {
    console.error('Health fetch failed:', e);
    document.getElementById('status-badge').textContent = 'Error';
    document.getElementById('status-badge').className = 'badge badge-offline';
  }
}

/**
 * Update health display
 */
function updateHealthDisplay(data) {
  // Version
  document.getElementById('version').textContent = `v${data.version}`;
  
  // Status badge
  const badge = document.getElementById('status-badge');
  badge.textContent = data.status.toUpperCase();
  badge.className = `badge badge-${data.mode === 'normal' ? 'ok' : data.mode}`;
  
  // Uptime
  document.getElementById('uptime').textContent = formatUptime(data.uptime);
  
  // Queue stats
  if (data.queue) {
    document.getElementById('queue-pending').textContent = data.queue.pending || 0;
    document.getElementById('dlq-count').textContent = data.queue.dlq || 0;
  }
  
  // Safe mode
  if (data.safe_mode?.enabled) {
    document.getElementById('safe-mode-banner').classList.remove('hidden');
  } else {
    document.getElementById('safe-mode-banner').classList.add('hidden');
  }
}

/**
 * Update from socket status
 */
function updateStatusFromSocket(data) {
  if (data.queue) {
    document.getElementById('queue-pending').textContent = data.queue.pending || 0;
    document.getElementById('dlq-count').textContent = data.queue.dlq_count || 0;
    document.getElementById('stat-pending').textContent = data.queue.pending || 0;
    document.getElementById('stat-processing').textContent = data.queue.processing || 0;
    document.getElementById('stat-completed').textContent = data.queue.completed || 0;
  }
}

/**
 * Refresh printers list
 */
async function refreshPrinters() {
  try {
    const res = await fetch(`${API_BASE}/printers`);
    const data = await res.json();
    
    printers = data.printers || [];
    document.getElementById('printer-count').textContent = printers.length;
    renderPrinters();
  } catch (e) {
    console.error('Printers fetch failed:', e);
  }
}

/**
 * Render printers table
 */
function renderPrinters() {
  const tbody = document.getElementById('printers-list');
  
  if (printers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">No printers detected</td></tr>';
    return;
  }
  
  tbody.innerHTML = printers.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${p.logical ? `<strong>${escapeHtml(p.logical)}</strong>` : '-'}</td>
      <td>
        <span class="status-${p.status}">● ${p.status}</span>
        ${p.confidence ? `<small class="text-muted">(${p.confidence})</small>` : ''}
      </td>
      <td>${p.lastSuccess ? formatTime(p.lastSuccess) : '-'}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="testPrint('${escapeHtml(p.name)}')">
          🖨️ Test
        </button>
      </td>
    </tr>
  `).join('');
}

/**
 * Test print to a printer
 */
async function testPrint(printerName) {
  try {
    const res = await fetch(`${API_BASE}/printers/${encodeURIComponent(printerName)}/test`, {
      method: 'POST'
    });
    
    const data = await res.json();
    
    if (data.success) {
      alert('Test print sent successfully!');
    } else {
      alert('Test print failed: ' + (data.message || 'Unknown error'));
    }
  } catch (e) {
    alert('Test print failed: ' + e.message);
  }
}

/**
 * Refresh queue
 */
async function refreshQueue() {
  try {
    const res = await fetch(`${API_BASE}/queue`);
    const data = await res.json();
    
    queueJobs = data.jobs || [];
    
    if (data.stats) {
      document.getElementById('stat-pending').textContent = data.stats.pending || 0;
      document.getElementById('stat-processing').textContent = data.stats.processing || 0;
      document.getElementById('stat-completed').textContent = data.stats.completed || 0;
    }
    
    renderQueue();
  } catch (e) {
    console.error('Queue fetch failed:', e);
  }
}

/**
 * Render queue table
 */
function renderQueue() {
  const tbody = document.getElementById('queue-list');
  
  if (queueJobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Queue is empty</td></tr>';
    return;
  }
  
  tbody.innerHTML = queueJobs.map(job => `
    <tr>
      <td><code>${job.id.substring(0, 8)}...</code></td>
      <td>${escapeHtml(job.target)}</td>
      <td>${job.type}</td>
      <td><span class="status-${job.status === 'pending' ? 'unknown' : job.status === 'processing' ? 'degraded' : 'online'}">${job.status}</span></td>
      <td>${job.attempts}/${job.max_attempts || 3}</td>
      <td>${formatTime(job.created_at)}</td>
      <td>
        ${job.status === 'pending' ? `
          <button class="btn btn-sm btn-danger" onclick="cancelJob('${job.id}')">Cancel</button>
        ` : '-'}
      </td>
    </tr>
  `).join('');
}

/**
 * Cancel a job
 */
async function cancelJob(jobId) {
  if (!confirm('Cancel this print job?')) return;
  
  try {
    await fetch(`${API_BASE}/queue/${jobId}`, { method: 'DELETE' });
    refreshQueue();
  } catch (e) {
    alert('Failed to cancel job: ' + e.message);
  }
}

/**
 * Refresh DLQ
 */
async function refreshDLQ() {
  try {
    const res = await fetch(`${API_BASE}/dlq`);
    const data = await res.json();
    
    dlqJobs = data.jobs || [];
    document.getElementById('dlq-count').textContent = dlqJobs.length;
    renderDLQ();
  } catch (e) {
    console.error('DLQ fetch failed:', e);
  }
}

/**
 * Render DLQ table
 */
function renderDLQ() {
  const tbody = document.getElementById('dlq-list');
  
  if (dlqJobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No failed jobs</td></tr>';
    return;
  }
  
  tbody.innerHTML = dlqJobs.map(job => `
    <tr>
      <td><code>${job.original_job_id.substring(0, 8)}...</code></td>
      <td>${escapeHtml(job.target)}</td>
      <td class="text-muted">${escapeHtml(job.failure_reason)}</td>
      <td>${job.attempts}</td>
      <td>${formatTime(job.moved_at)}</td>
      <td>
        <button class="btn btn-sm btn-success" onclick="retryDLQ('${job.id}')">Retry</button>
        <button class="btn btn-sm btn-danger" onclick="discardDLQ('${job.id}')">Discard</button>
      </td>
    </tr>
  `).join('');
}

/**
 * Retry DLQ job
 */
async function retryDLQ(id) {
  try {
    await fetch(`${API_BASE}/dlq/${id}/retry`, { method: 'POST' });
    refreshDLQ();
    refreshQueue();
  } catch (e) {
    alert('Failed to retry job: ' + e.message);
  }
}

/**
 * Discard DLQ job
 */
async function discardDLQ(id) {
  if (!confirm('Permanently discard this failed job?')) return;
  
  try {
    await fetch(`${API_BASE}/dlq/${id}`, { method: 'DELETE' });
    refreshDLQ();
  } catch (e) {
    alert('Failed to discard job: ' + e.message);
  }
}

/**
 * Refresh config
 */
async function refreshConfig() {
  try {
    const res = await fetch(`${API_BASE}/config`);
    config = await res.json();
    
    document.getElementById('config-json').textContent = JSON.stringify(config, null, 2);
  } catch (e) {
    console.error('Config fetch failed:', e);
  }
}

/**
 * Sync config from server
 */
async function syncConfig() {
  try {
    const res = await fetch(`${API_BASE}/config/sync`, { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      alert('Configuration synced successfully!');
      refreshConfig();
    } else {
      alert('Sync failed: ' + (data.message || 'Unknown error'));
    }
  } catch (e) {
    alert('Sync failed: ' + e.message);
  }
}

/**
 * Exit safe mode
 */
async function exitSafeMode() {
  // This would need a specific endpoint
  alert('Please restart the service to exit safe mode');
}

// Helper functions

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTime(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  return date.toLocaleTimeString('id-ID', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function filterLogs() {
  // Log filtering would be implemented here
  console.log('Filter logs by:', document.getElementById('log-level').value);
}
