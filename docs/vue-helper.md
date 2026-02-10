# Vue Print Helper

This guide shows how to integrate the RosyidPOS Print Agent with your Vue.js frontend using a composable.

## Installation

### 1. Create Print Composable

```javascript
// resources/js/composables/usePrintAgent.js

import { ref, reactive, onMounted, onUnmounted } from 'vue';
import axios from 'axios';

/**
 * Print Agent composable for Vue 3
 */
export function usePrintAgent(options = {}) {
  const baseUrl = options.baseUrl || 'http://127.0.0.1:7331';
  const apiKey = options.apiKey || '';
  
  // State
  const isAvailable = ref(false);
  const isChecking = ref(true);
  const health = reactive({
    status: 'unknown',
    version: '',
    mode: 'normal',
    queue: { pending: 0, dlq: 0 }
  });
  const printers = ref([]);
  const lastError = ref(null);
  
  // Check interval
  let checkInterval = null;
  
  /**
   * Create axios instance with defaults
   */
  const api = axios.create({
    baseURL: baseUrl,
    timeout: 5000,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-RosyidPOS-Key': apiKey } : {})
    }
  });
  
  /**
   * Check if Print Agent is available
   */
  async function checkAvailability() {
    isChecking.value = true;
    try {
      const response = await api.get('/health');
      isAvailable.value = response.data.status === 'ok';
      Object.assign(health, response.data);
      lastError.value = null;
    } catch (error) {
      isAvailable.value = false;
      lastError.value = error.message;
    } finally {
      isChecking.value = false;
    }
    return isAvailable.value;
  }
  
  /**
   * Get list of printers
   */
  async function getPrinters() {
    try {
      const response = await api.get('/api/v1/printers');
      printers.value = response.data.printers || [];
      return printers.value;
    } catch (error) {
      console.error('Failed to get printers:', error);
      throw error;
    }
  }
  
  /**
   * Send print job
   */
  async function print(target, content, options = {}) {
    const {
      type = 'raw',
      metadata = {},
      idempotencyKey = null,
      priority = 0
    } = options;
    
    const headers = {};
    if (idempotencyKey) {
      headers['X-Idempotency-Key'] = idempotencyKey;
    }
    
    try {
      const response = await api.post('/api/v1/print', {
        target,
        type,
        content,
        metadata,
        options: { priority }
      }, { headers });
      
      return response.data;
    } catch (error) {
      console.error('Print failed:', error);
      throw error;
    }
  }
  
  /**
   * Print text content
   */
  async function printText(target, text, options = {}) {
    return print(target, text, { ...options, type: 'text' });
  }
  
  /**
   * Print base64 encoded content (e.g., ESC/POS commands)
   */
  async function printBase64(target, base64Content, options = {}) {
    return print(target, base64Content, { ...options, type: 'base64' });
  }
  
  /**
   * Test print to a specific printer
   */
  async function testPrint(printerName) {
    try {
      const response = await api.post(`/api/v1/printers/${encodeURIComponent(printerName)}/test`);
      return response.data;
    } catch (error) {
      console.error('Test print failed:', error);
      throw error;
    }
  }
  
  /**
   * Get print queue
   */
  async function getQueue() {
    try {
      const response = await api.get('/api/v1/queue');
      return response.data;
    } catch (error) {
      console.error('Failed to get queue:', error);
      throw error;
    }
  }
  
  /**
   * Cancel a print job
   */
  async function cancelJob(jobId) {
    try {
      const response = await api.delete(`/api/v1/queue/${jobId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to cancel job:', error);
      throw error;
    }
  }
  
  /**
   * Get printer status
   */
  async function getStatus() {
    try {
      const response = await api.get('/api/v1/status');
      return response.data;
    } catch (error) {
      console.error('Failed to get status:', error);
      throw error;
    }
  }
  
  /**
   * Start periodic availability checks
   */
  function startChecking(intervalMs = 30000) {
    stopChecking();
    checkAvailability();
    checkInterval = setInterval(checkAvailability, intervalMs);
  }
  
  /**
   * Stop periodic checks
   */
  function stopChecking() {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  }
  
  // Auto-start checking on mount
  onMounted(() => {
    if (options.autoCheck !== false) {
      startChecking(options.checkInterval || 30000);
    }
  });
  
  onUnmounted(() => {
    stopChecking();
  });
  
  return {
    // State
    isAvailable,
    isChecking,
    health,
    printers,
    lastError,
    
    // Methods
    checkAvailability,
    getPrinters,
    print,
    printText,
    printBase64,
    testPrint,
    getQueue,
    cancelJob,
    getStatus,
    startChecking,
    stopChecking
  };
}
```

### 2. Create Print Service (Optional - for global state)

```javascript
// resources/js/services/printService.js

import { reactive, readonly } from 'vue';
import axios from 'axios';

const state = reactive({
  isAvailable: false,
  health: null,
  printers: [],
  queue: [],
  lastCheck: null
});

const baseUrl = 'http://127.0.0.1:7331';
const api = axios.create({
  baseURL: baseUrl,
  timeout: 5000
});

// Set API key from config or meta tag
const apiKeyMeta = document.querySelector('meta[name="print-agent-key"]');
if (apiKeyMeta) {
  api.defaults.headers['X-RosyidPOS-Key'] = apiKeyMeta.content;
}

export const printService = {
  state: readonly(state),
  
  async checkHealth() {
    try {
      const { data } = await api.get('/health');
      state.isAvailable = data.status === 'ok';
      state.health = data;
      state.lastCheck = new Date();
      return data;
    } catch (error) {
      state.isAvailable = false;
      throw error;
    }
  },
  
  async print(target, content, options = {}) {
    const headers = {};
    if (options.idempotencyKey) {
      headers['X-Idempotency-Key'] = options.idempotencyKey;
    }
    
    const { data } = await api.post('/api/v1/print', {
      target,
      type: options.type || 'raw',
      content,
      metadata: options.metadata || {}
    }, { headers });
    
    return data;
  },
  
  async getPrinters() {
    const { data } = await api.get('/api/v1/printers');
    state.printers = data.printers || [];
    return state.printers;
  },
  
  async getQueue() {
    const { data } = await api.get('/api/v1/queue');
    state.queue = data.jobs || [];
    return data;
  }
};

// Start health checks
setInterval(() => printService.checkHealth().catch(() => {}), 30000);
printService.checkHealth().catch(() => {});
```

## Usage Examples

### Basic Usage with Composable

```vue
<template>
  <div>
    <!-- Printer Status Indicator -->
    <div class="printer-status" :class="{ online: isAvailable }">
      <span class="indicator"></span>
      {{ isAvailable ? 'Printer Ready' : 'Printer Offline' }}
    </div>
    
    <!-- Print Button -->
    <button 
      @click="handlePrint" 
      :disabled="!isAvailable || isPrinting"
    >
      {{ isPrinting ? 'Printing...' : 'Print Receipt' }}
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { usePrintAgent } from '@/composables/usePrintAgent';

const { isAvailable, print, printText } = usePrintAgent();
const isPrinting = ref(false);

async function handlePrint() {
  isPrinting.value = true;
  
  try {
    const result = await printText('cashier', 'Hello World!\nThis is a test print.');
    console.log('Print job queued:', result.job_id);
  } catch (error) {
    alert('Print failed: ' + error.message);
  } finally {
    isPrinting.value = false;
  }
}
</script>

<style scoped>
.printer-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  background: #fee2e2;
  color: #991b1b;
}

.printer-status.online {
  background: #dcfce7;
  color: #166534;
}

.indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
</style>
```

### Print Receipt Component

```vue
<template>
  <div class="receipt-actions">
    <button @click="printReceipt" :disabled="!canPrint">
      🖨️ Print Receipt
    </button>
    <button @click="printKitchen" :disabled="!canPrint">
      🍳 Send to Kitchen
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { usePrintAgent } from '@/composables/usePrintAgent';

const props = defineProps({
  sale: Object
});

const { isAvailable, print } = usePrintAgent();
const canPrint = computed(() => isAvailable.value && props.sale);

async function printReceipt() {
  // Build ESC/POS commands (or use Laravel to generate)
  const content = buildReceiptContent(props.sale);
  
  try {
    await print('cashier', btoa(content), {
      type: 'base64',
      metadata: { order_id: props.sale.id, type: 'receipt' },
      idempotencyKey: `receipt-${props.sale.id}`
    });
  } catch (error) {
    console.error('Print failed:', error);
  }
}

async function printKitchen() {
  // Group items by category and print to appropriate printers
  const foodItems = props.sale.items.filter(i => i.category === 'food');
  const drinkItems = props.sale.items.filter(i => i.category === 'drinks');
  
  if (foodItems.length > 0) {
    await print('kitchen', buildKitchenTicket(foodItems), {
      type: 'base64',
      metadata: { order_id: props.sale.id, category: 'food' },
      idempotencyKey: `kitchen-${props.sale.id}-food`
    });
  }
  
  if (drinkItems.length > 0) {
    await print('bar', buildKitchenTicket(drinkItems), {
      type: 'base64',
      metadata: { order_id: props.sale.id, category: 'drinks' },
      idempotencyKey: `kitchen-${props.sale.id}-drinks`
    });
  }
}

function buildReceiptContent(sale) {
  // Simplified - use ESC/POS builder for real implementation
  const lines = [
    '\x1B@',           // Initialize
    '\x1Ba\x01',       // Center
    '\x1D!\x11',       // Double size
    'ROSYIDPOS\n',
    '\x1D!\x00',       // Normal size
    'Your Store Address\n',
    '\x1Ba\x00',       // Left align
    '-'.repeat(48) + '\n',
    `Order: ${sale.order_number}\n`,
    `Date: ${new Date().toLocaleString()}\n`,
    '-'.repeat(48) + '\n',
  ];
  
  for (const item of sale.items) {
    lines.push(`${item.name}\n`);
    lines.push(`  ${item.qty}x @ ${item.price}    ${item.subtotal}\n`);
  }
  
  lines.push('-'.repeat(48) + '\n');
  lines.push(`TOTAL: Rp ${sale.total}\n`);
  lines.push('\n\nThank you!\n\n\n');
  lines.push('\x1DV\x01'); // Cut
  
  return lines.join('');
}

function buildKitchenTicket(items) {
  // Simplified kitchen ticket
  return btoa('Kitchen ticket content');
}
</script>
```

### Printer Status Dashboard

```vue
<template>
  <div class="printer-dashboard">
    <h3>Printers</h3>
    
    <div v-if="isChecking" class="loading">
      Checking printers...
    </div>
    
    <div v-else-if="!isAvailable" class="offline-warning">
      ⚠️ Print Agent is not running
    </div>
    
    <div v-else class="printer-list">
      <div 
        v-for="printer in printers" 
        :key="printer.name"
        class="printer-card"
        :class="printer.status"
      >
        <div class="printer-name">
          {{ printer.logical || printer.name }}
        </div>
        <div class="printer-physical">
          {{ printer.name }}
        </div>
        <div class="printer-status">
          <span class="status-dot"></span>
          {{ printer.status }}
        </div>
        <button @click="() => handleTestPrint(printer.name)">
          Test Print
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { usePrintAgent } from '@/composables/usePrintAgent';

const { 
  isAvailable, 
  isChecking, 
  printers, 
  getPrinters, 
  testPrint 
} = usePrintAgent();

onMounted(() => {
  getPrinters();
});

async function handleTestPrint(printerName) {
  try {
    await testPrint(printerName);
    alert('Test print sent!');
  } catch (error) {
    alert('Test print failed: ' + error.message);
  }
}
</script>

<style scoped>
.printer-list {
  display: grid;
  gap: 1rem;
}

.printer-card {
  padding: 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.printer-card.online {
  border-color: #22c55e;
}

.printer-card.offline {
  border-color: #ef4444;
  opacity: 0.7;
}

.printer-name {
  font-weight: 600;
}

.printer-physical {
  font-size: 0.875rem;
  color: #64748b;
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  margin-right: 4px;
}

.printer-card.online .status-dot { color: #22c55e; }
.printer-card.offline .status-dot { color: #ef4444; }
.printer-card.degraded .status-dot { color: #f59e0b; }
</style>
```

## Error Handling

```javascript
import { usePrintAgent } from '@/composables/usePrintAgent';

const { isAvailable, print, lastError } = usePrintAgent();

async function safePrint(target, content) {
  // Check availability first
  if (!isAvailable.value) {
    // Option 1: Queue locally for later
    localStorage.setItem('pendingPrint', JSON.stringify({ target, content }));
    return { queued: true, local: true };
  }
  
  try {
    return await print(target, content);
  } catch (error) {
    if (error.response?.status === 429) {
      // Rate limited - wait and retry
      await new Promise(r => setTimeout(r, 2000));
      return await print(target, content);
    }
    
    if (error.code === 'ECONNABORTED') {
      // Timeout - printer might be busy
      console.warn('Print timeout, job may still be processing');
    }
    
    throw error;
  }
}
```

## Notes

1. **CORS**: The Print Agent allows requests from configured origins. Make sure your POS domain is whitelisted.

2. **API Key**: For production, configure the API key in both the Print Agent and your frontend.

3. **Idempotency**: Always use idempotency keys for receipts to prevent duplicate prints on page refresh or retry.

4. **Fallback**: Consider implementing a local queue for offline scenarios.
