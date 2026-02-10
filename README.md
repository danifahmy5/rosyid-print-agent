# RosyidPOS Print Agent

A production-ready Windows Local Print Agent for the RosyidPOS point-of-sale system. Enables silent printing to multiple thermal and regular printers without browser print dialogs.

## Features

- 🖨️ **Silent Printing** - Print directly from web POS without dialogs
- 🔄 **Multi-Printer Support** - Route prints to cashier, kitchen, bar, invoice printers
- 📋 **Print Queue** - Persistent queue with retry logic
- 💀 **Dead Letter Queue** - Failed prints never lost
- 🔒 **Secure** - API key authentication, rate limiting
- 🚀 **Auto-Start** - Runs as Windows Service
- 🔧 **Auto-Update** - Safe atomic updates with rollback
- 📊 **Dashboard** - Real-time monitoring UI
- ⚡ **ESC/POS** - Full thermal printer command support

## Quick Start

### Requirements

- Windows 10/11
- Node.js 18+ (for development)

### Installation from Source

```bash
# Clone and install
git clone <repo>
cd rosyid-print-agent
npm install

# Start in development mode
npm start

# Open dashboard
start http://127.0.0.1:7331/dashboard
```

### Install as Windows Service

```bash
# Run as Administrator
npm run install-service
```

The service will:
- Auto-start on Windows boot
- Auto-restart on crash
- Run in background

### Build Windows Executable

```bash
# Build standalone .exe
npm run build

# Output: dist/RosyidPrintAgent.exe
```

### Create Installer

1. Install [Inno Setup](https://jrsoftware.org/isinfo.php)
2. Open `installer.iss` in Inno Setup Compiler
3. Build installer

## Configuration

Configuration file: `data/config.json` (or `config/default.json` for defaults)

### Printer Mappings

Map logical printer names to physical Windows printer names:

```json
{
  "printers": {
    "mappings": {
      "cashier": "EPSON TM-T82",
      "kitchen": "EPSON TM-T20",
      "bar": "EPSON TM-T82III",
      "invoice": "Canon LBP2900"
    },
    "routing": {
      "food": "kitchen",
      "drinks": "bar",
      "default": "cashier"
    }
  }
}
```

### Security

```json
{
  "security": {
    "api_key": "your-secret-key",
    "allowed_origins": ["http://pos.example.com"],
    "allowed_ips": ["127.0.0.1", "192.168.1.*"],
    "enable_ip_check": false
  }
}
```

## API Reference

Base URL: `http://127.0.0.1:7331/api/v1`

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Agent health and version |
| POST | `/print` | Submit print job |
| GET | `/printers` | List available printers |
| GET | `/queue` | Active print queue |
| DELETE | `/queue/:id` | Cancel print job |
| GET | `/status` | Printer status summary |
| GET | `/dlq` | Dead letter queue |
| POST | `/dlq/:id/retry` | Retry DLQ job |
| DELETE | `/dlq/:id` | Discard DLQ job |
| GET | `/config` | Current configuration |
| POST | `/config/sync` | Sync from remote |

### Print Job Request

```http
POST /api/v1/print
Content-Type: application/json
X-RosyidPOS-Key: your-api-key
X-Idempotency-Key: order-12345-receipt-1

{
  "target": "cashier",
  "type": "escpos",
  "content": "base64-encoded-data",
  "metadata": {
    "order_id": "ORD-12345",
    "category": "food"
  }
}
```

### Response

```json
{
  "success": true,
  "job_id": "uuid",
  "status": "queued",
  "position": 1
}
```

## Dashboard

Access the monitoring dashboard at:

```
http://127.0.0.1:7331/dashboard
```

Features:
- Real-time printer status
- Queue management
- DLQ review and retry
- Log viewer
- Configuration viewer

## Integration

See documentation:
- [Laravel Integration Guide](docs/laravel-integration.md)
- [Vue Helper Example](docs/vue-helper.md)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Express API Layer                     │
│                  (Auth, Rate Limiting)                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Print Queue  │  │   Printer    │  │   Config     │   │
│  │   Manager    │  │   Service    │  │   Manager    │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Safe Mode   │  │  Monitoring  │  │   Update     │   │
│  │  Controller  │  │   Service    │  │   Manager    │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                    SQLite Database                       │
└─────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Service won't start
1. Check Windows Event Viewer for errors
2. Try running manually: `node src/index.js`
3. Check logs in `data/logs/`

### Printer not found
1. Open dashboard, check Printers tab
2. Click Refresh
3. Verify printer name matches Windows exactly

### Prints failing
1. Check DLQ in dashboard
2. Review error message
3. Test printer with Test Print button

### Safe Mode
If agent enters safe mode after crashes:
1. Check logs for crash cause
2. Fix issue
3. Restart service to exit safe mode

## License

MIT License - See LICENSE file
