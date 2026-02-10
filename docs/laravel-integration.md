# Laravel Integration Guide

This guide shows how to integrate the RosyidPOS Print Agent with your Laravel application.

## Installation

### 1. Create PrintAgent Service

```php
<?php
// app/Services/PrintAgentService.php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class PrintAgentService
{
    protected string $baseUrl;
    protected string $apiKey;
    protected int $timeout;

    public function __construct()
    {
        $this->baseUrl = config('printing.agent_url', 'http://127.0.0.1:7331');
        $this->apiKey = config('printing.api_key', '');
        $this->timeout = config('printing.timeout', 10);
    }

    /**
     * Check if Print Agent is available
     */
    public function isAvailable(): bool
    {
        try {
            $response = $this->request('GET', '/health');
            return $response['status'] === 'ok';
        } catch (\Exception $e) {
            Log::warning('Print Agent not available', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Get agent health status
     */
    public function health(): array
    {
        return $this->request('GET', '/health');
    }

    /**
     * Send print job
     */
    public function print(
        string $target,
        string $content,
        string $type = 'raw',
        array $metadata = [],
        ?string $idempotencyKey = null
    ): array {
        $payload = [
            'target' => $target,
            'type' => $type,
            'content' => $type === 'base64' ? $content : $content,
            'metadata' => $metadata,
        ];

        $headers = [];
        if ($idempotencyKey) {
            $headers['X-Idempotency-Key'] = $idempotencyKey;
        }

        return $this->request('POST', '/api/v1/print', $payload, $headers);
    }

    /**
     * Print a receipt
     */
    public function printReceipt(array $sale, ?string $idempotencyKey = null): array
    {
        $content = $this->formatReceipt($sale);
        
        return $this->print(
            target: 'cashier',
            content: base64_encode($content),
            type: 'base64',
            metadata: [
                'order_id' => $sale['id'] ?? null,
                'type' => 'receipt',
            ],
            idempotencyKey: $idempotencyKey ?? 'receipt-' . ($sale['id'] ?? Str::uuid())
        );
    }

    /**
     * Print kitchen ticket
     */
    public function printKitchenTicket(array $order, string $category = 'food'): array
    {
        // Determine target based on category routing
        $target = $this->getCategoryTarget($category);
        
        $content = $this->formatKitchenTicket($order);
        
        return $this->print(
            target: $target,
            content: base64_encode($content),
            type: 'base64',
            metadata: [
                'order_id' => $order['id'] ?? null,
                'category' => $category,
                'type' => 'kitchen',
            ],
            idempotencyKey: 'kitchen-' . ($order['id'] ?? Str::uuid()) . '-' . $category
        );
    }

    /**
     * Get available printers
     */
    public function getPrinters(): array
    {
        return $this->request('GET', '/api/v1/printers');
    }

    /**
     * Get printer status
     */
    public function getStatus(): array
    {
        return $this->request('GET', '/api/v1/status');
    }

    /**
     * Get print queue
     */
    public function getQueue(): array
    {
        return $this->request('GET', '/api/v1/queue');
    }

    /**
     * Cancel a print job
     */
    public function cancelJob(string $jobId): array
    {
        return $this->request('DELETE', "/api/v1/queue/{$jobId}");
    }

    /**
     * Get dead letter queue
     */
    public function getDLQ(): array
    {
        return $this->request('GET', '/api/v1/dlq');
    }

    /**
     * Retry DLQ job
     */
    public function retryDLQ(string $dlqId): array
    {
        return $this->request('POST', "/api/v1/dlq/{$dlqId}/retry");
    }

    /**
     * Sync configuration from server
     */
    public function syncConfig(): array
    {
        return $this->request('POST', '/api/v1/config/sync');
    }

    /**
     * Format receipt for thermal printer
     */
    protected function formatReceipt(array $sale): string
    {
        $escpos = new \App\Services\EscPosBuilder();
        
        return $escpos
            ->initialize()
            ->centerAlign()
            ->doubleSize()
            ->text(config('app.name'))
            ->normalSize()
            ->text(config('printing.store_address', ''))
            ->leftAlign()
            ->hr()
            ->text('Order #: ' . ($sale['order_number'] ?? '-'))
            ->text('Date: ' . now()->format('d/m/Y H:i'))
            ->text('Cashier: ' . (auth()->user()->name ?? '-'))
            ->hr()
            ->items($sale['items'] ?? [])
            ->hr()
            ->total('TOTAL', $sale['total'] ?? 0)
            ->text('Payment: ' . ($sale['payment_method'] ?? 'Cash'))
            ->text('Paid: ' . number_format($sale['paid'] ?? 0))
            ->text('Change: ' . number_format($sale['change'] ?? 0))
            ->hr()
            ->centerAlign()
            ->text('Thank you for your purchase!')
            ->feed(3)
            ->cut()
            ->build();
    }

    /**
     * Format kitchen ticket
     */
    protected function formatKitchenTicket(array $order): string
    {
        $escpos = new \App\Services\EscPosBuilder();
        
        $builder = $escpos
            ->initialize()
            ->centerAlign()
            ->doubleSize()
            ->text('ORDER #' . ($order['order_number'] ?? '-'))
            ->normalSize();
        
        if (isset($order['table_number'])) {
            $builder->doubleSize()->text('TABLE ' . $order['table_number'])->normalSize();
        }
        
        $builder
            ->text(now()->format('H:i:s'))
            ->leftAlign()
            ->hr();
        
        foreach ($order['items'] ?? [] as $item) {
            $builder
                ->doubleSize()
                ->text($item['quantity'] . 'x ' . $item['name'])
                ->normalSize();
            
            if (!empty($item['notes'])) {
                $builder->text('   >> ' . $item['notes']);
            }
        }
        
        if (!empty($order['notes'])) {
            $builder->hr()->text('NOTES: ' . $order['notes']);
        }
        
        return $builder->feed(3)->cut()->build();
    }

    /**
     * Get target printer for category
     */
    protected function getCategoryTarget(string $category): string
    {
        $routing = config('printing.routing', [
            'food' => 'kitchen',
            'drinks' => 'bar',
            'default' => 'kitchen',
        ]);

        return $routing[strtolower($category)] ?? $routing['default'] ?? 'kitchen';
    }

    /**
     * Make HTTP request to Print Agent
     */
    protected function request(
        string $method,
        string $endpoint,
        array $data = [],
        array $headers = []
    ): array {
        $url = rtrim($this->baseUrl, '/') . '/' . ltrim($endpoint, '/');
        
        $defaultHeaders = [
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
        ];
        
        if ($this->apiKey) {
            $defaultHeaders['X-RosyidPOS-Key'] = $this->apiKey;
        }
        
        $headers = array_merge($defaultHeaders, $headers);
        
        try {
            $response = Http::withHeaders($headers)
                ->timeout($this->timeout)
                ->$method($url, $data);
            
            if ($response->failed()) {
                throw new \Exception($response->json()['message'] ?? 'Request failed');
            }
            
            return $response->json();
            
        } catch (\Exception $e) {
            Log::error('Print Agent request failed', [
                'method' => $method,
                'endpoint' => $endpoint,
                'error' => $e->getMessage(),
            ]);
            
            throw $e;
        }
    }
}
```

### 2. Create ESC/POS Builder Helper

```php
<?php
// app/Services/EscPosBuilder.php

namespace App\Services;

class EscPosBuilder
{
    protected array $buffer = [];

    public function initialize(): self
    {
        $this->buffer[] = "\x1B\x40"; // ESC @
        return $this;
    }

    public function leftAlign(): self
    {
        $this->buffer[] = "\x1B\x61\x00";
        return $this;
    }

    public function centerAlign(): self
    {
        $this->buffer[] = "\x1B\x61\x01";
        return $this;
    }

    public function rightAlign(): self
    {
        $this->buffer[] = "\x1B\x61\x02";
        return $this;
    }

    public function normalSize(): self
    {
        $this->buffer[] = "\x1D\x21\x00";
        return $this;
    }

    public function doubleSize(): self
    {
        $this->buffer[] = "\x1D\x21\x11";
        return $this;
    }

    public function bold(bool $on = true): self
    {
        $this->buffer[] = "\x1B\x45" . ($on ? "\x01" : "\x00");
        return $this;
    }

    public function text(string $text): self
    {
        $this->buffer[] = $text . "\n";
        return $this;
    }

    public function hr(string $char = '-', int $width = 48): self
    {
        $this->buffer[] = str_repeat($char, $width) . "\n";
        return $this;
    }

    public function row(string $left, string $right, int $width = 48): self
    {
        $spaces = $width - mb_strlen($left) - mb_strlen($right);
        $this->buffer[] = $left . str_repeat(' ', max(1, $spaces)) . $right . "\n";
        return $this;
    }

    public function items(array $items): self
    {
        foreach ($items as $item) {
            $name = $item['name'] ?? '';
            $qty = $item['quantity'] ?? 1;
            $price = $item['price'] ?? 0;
            $subtotal = $item['subtotal'] ?? ($qty * $price);

            $this->text($name);
            $this->row(
                "  {$qty}x @ " . number_format($price),
                number_format($subtotal)
            );
        }
        return $this;
    }

    public function total(string $label, float|int $amount): self
    {
        $this->bold();
        $this->row($label, 'Rp ' . number_format($amount));
        $this->bold(false);
        return $this;
    }

    public function feed(int $lines = 1): self
    {
        $this->buffer[] = "\x1B\x64" . chr($lines);
        return $this;
    }

    public function cut(bool $partial = true): self
    {
        $this->buffer[] = "\x1D\x56" . ($partial ? "\x01" : "\x00");
        return $this;
    }

    public function openDrawer(): self
    {
        $this->buffer[] = "\x1B\x70\x00\x19\xFA";
        return $this;
    }

    public function build(): string
    {
        return implode('', $this->buffer);
    }
}
```

### 3. Add Configuration

```php
<?php
// config/printing.php

return [
    'agent_url' => env('PRINT_AGENT_URL', 'http://127.0.0.1:7331'),
    'api_key' => env('PRINT_AGENT_KEY', ''),
    'timeout' => env('PRINT_AGENT_TIMEOUT', 10),
    
    'store_address' => env('STORE_ADDRESS', 'Jl. Example No. 123'),
    
    'routing' => [
        'food' => 'kitchen',
        'drinks' => 'bar',
        'dessert' => 'kitchen',
        'default' => 'kitchen',
    ],
];
```

### 4. Add to .env

```env
PRINT_AGENT_URL=http://127.0.0.1:7331
PRINT_AGENT_KEY=your-secret-key
PRINT_AGENT_TIMEOUT=10
STORE_ADDRESS="Your Store Name, Address"
```

### 5. Register Service Provider (Optional)

```php
<?php
// app/Providers/AppServiceProvider.php

public function register()
{
    $this->app->singleton(PrintAgentService::class, function ($app) {
        return new PrintAgentService();
    });
}
```

## Usage Examples

### Print Receipt After Sale

```php
<?php
// app/Http/Controllers/SaleController.php

use App\Services\PrintAgentService;

class SaleController extends Controller
{
    public function store(Request $request, PrintAgentService $printAgent)
    {
        // Create sale...
        $sale = Sale::create([...]);
        
        // Print receipt
        try {
            $result = $printAgent->printReceipt([
                'id' => $sale->id,
                'order_number' => $sale->order_number,
                'items' => $sale->items->map(fn($item) => [
                    'name' => $item->product->name,
                    'quantity' => $item->quantity,
                    'price' => $item->price,
                    'subtotal' => $item->subtotal,
                ])->toArray(),
                'total' => $sale->total,
                'payment_method' => $sale->payment_method,
                'paid' => $sale->paid_amount,
                'change' => $sale->change_amount,
            ]);
            
            Log::info('Receipt printed', ['job_id' => $result['job_id']]);
            
        } catch (\Exception $e) {
            // Log but don't fail the sale
            Log::warning('Failed to print receipt', ['error' => $e->getMessage()]);
        }
        
        return redirect()->route('sales.show', $sale);
    }
}
```

### Print Kitchen Tickets

```php
<?php

public function sendToKitchen(Order $order, PrintAgentService $printAgent)
{
    // Group items by category
    $groupedItems = $order->items->groupBy(fn($item) => $item->product->category);
    
    foreach ($groupedItems as $category => $items) {
        $printAgent->printKitchenTicket([
            'id' => $order->id,
            'order_number' => $order->order_number,
            'table_number' => $order->table_number,
            'items' => $items->map(fn($item) => [
                'name' => $item->product->name,
                'quantity' => $item->quantity,
                'notes' => $item->notes,
            ])->toArray(),
            'notes' => $order->kitchen_notes,
        ], $category);
    }
}
```

### Check Printer Status

```php
<?php

public function printerStatus(PrintAgentService $printAgent)
{
    if (!$printAgent->isAvailable()) {
        return response()->json([
            'available' => false,
            'message' => 'Print Agent is not running'
        ], 503);
    }
    
    return response()->json([
        'available' => true,
        'health' => $printAgent->health(),
        'printers' => $printAgent->getStatus(),
    ]);
}
```

## API Endpoints for Remote Config

Create these endpoints so the Print Agent can sync configuration:

```php
<?php
// routes/api.php

Route::prefix('print-agent')->group(function () {
    Route::get('/config', [PrintAgentController::class, 'config']);
    Route::get('/version', [PrintAgentController::class, 'version']);
});
```

```php
<?php
// app/Http/Controllers/Api/PrintAgentController.php

namespace App\Http\Controllers\Api;

class PrintAgentController extends Controller
{
    public function config(Request $request)
    {
        // Validate agent key
        if ($request->header('X-RosyidPOS-Key') !== config('printing.api_key')) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }
        
        // Return configuration for the outlet
        return response()->json([
            'printers' => [
                'mappings' => [
                    'cashier' => 'EPSON TM-T82',
                    'kitchen' => 'EPSON TM-T20',
                    'bar' => 'EPSON TM-T82III',
                ],
                'routing' => config('printing.routing'),
            ],
        ]);
    }
    
    public function version()
    {
        return response()->json([
            'latest_version' => '1.0.0',
            'download_url' => url('/downloads/print-agent/latest.zip'),
            'changelog' => 'Bug fixes and improvements',
        ]);
    }
}
```

## Error Handling

Always wrap print calls in try-catch to prevent sale failures:

```php
try {
    $printAgent->printReceipt($sale);
} catch (\Illuminate\Http\Client\ConnectionException $e) {
    // Agent not running - queue for later or notify user
    Log::warning('Print Agent unavailable', ['sale_id' => $sale->id]);
    session()->flash('warning', 'Receipt will print when printer is available');
} catch (\Exception $e) {
    Log::error('Print failed', ['error' => $e->getMessage()]);
}
```
