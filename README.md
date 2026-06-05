# RosyidPOS Print Agent

Sebuah Windows Local Print Agent yang siap digunakan untuk produksi (production-ready) pada sistem point-of-sale RosyidPOS. Memungkinkan pencetakan senyap (silent printing) ke beberapa printer thermal dan printer biasa tanpa dialog cetak browser.

## Fitur

- 🖨️ **Pencetakan Senyap (Silent Printing)** - Mencetak langsung dari POS web tanpa dialog
- 🔄 **Dukungan Multi-Printer** - Mengarahkan cetakan ke printer kasir, dapur, bar, dan faktur
- 📋 **Antrean Cetak (Print Queue)** - Antrean persisten dengan logika percobaan ulang (retry)
- 💀 **Dead Letter Queue (DLQ)** - Cetakan yang gagal tidak akan pernah hilang
- 🔒 **Aman** - Otentikasi kunci API (API key), pembatasan laju (rate limiting)
- 🚀 **Mulai Otomatis (Auto-Start)** - Berjalan sebagai Layanan Windows (Windows Service)
- 🔧 **Pembaruan Otomatis (Auto-Update)** - Pembaruan atomik yang aman dengan fitur pengembalian (rollback)
- 📊 **Dasbor (Dashboard)** - UI pemantauan real-time
- ⚡ **ESC/POS** - Dukungan perintah printer thermal penuh

## Memulai Cepat (Quick Start)

### Persyaratan

- Windows 10/11
- Node.js 18+ (untuk pengembangan)

### Instalasi dari Sumber (Source Code)

```bash
# Kloning dan instal
git clone <repo>
cd rosyid-print-agent
npm install

# Jalankan dalam mode pengembangan
npm start

# Buka dasbor
start http://127.0.0.1:7331/dashboard
```

### Mengelola Layanan Windows (Windows Service)

Layanan ini dirancang untuk berjalan secara otomatis di latar belakang. Anda dapat menginstal, mencopot (uninstall), atau memulai ulang (restart) layanan menggunakan perintah berikut (pastikan terminal dijalankan sebagai **Administrator**):

#### Menginstal Layanan
```bash
npm run install-service
```
Layanan akan:
- Mulai otomatis saat Windows booting
- Mulai ulang otomatis jika terjadi crash
- Berjalan di latar belakang (background)

#### Mencopot (Uninstall) Layanan
```bash
npm run uninstall-service
```

#### Memulai Ulang (Restart) Layanan
* **PowerShell:**
  ```powershell
  Restart-Service -Name "RosyidPOS Print Agent"
  ```
* **Command Prompt (CMD):**
  ```cmd
  net stop "RosyidPOS Print Agent"
  net start "RosyidPOS Print Agent"
  ```
* **GUI Services:**
  Buka `services.msc` dari menu Run (`Win + R`), cari **RosyidPOS Print Agent**, lalu pilih **Restart**.

### Build Executable Windows

```bash
# Build .exe mandiri
npm run build

# Output: dist/RosyidPrintAgent.exe
```

### Membuat Installer

1. Instal [Inno Setup](https://jrsoftware.org/isinfo.php)
2. Buka `installer.iss` di Inno Setup Compiler
3. Build installer

## Konfigurasi

File konfigurasi: `data/config.json` (atau `config/default.json` untuk nilai bawaan)

### Pemetaan Printer (Printer Mappings)

Petakan nama printer logis ke nama printer fisik Windows:

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

### Keamanan (Security)

```json
{
  "security": {
    "api_key": "kunci-rahasia-anda",
    "allowed_origins": ["http://pos.example.com"],
    "allowed_ips": ["127.0.0.1", "192.168.1.*"],
    "enable_ip_check": false
  }
}
```

## Referensi API (API Reference)

URL Dasar: `http://127.0.0.1:7331/api/v1`

### Endpoint

| Metode | Endpoint | Deskripsi |
|--------|----------|-------------|
| GET | `/health` | Kesehatan dan versi agen |
| POST | `/print` | Kirim pekerjaan cetak (print job) |
| GET | `/printers` | Daftar printer yang tersedia |
| GET | `/queue` | Antrean cetak yang aktif |
| DELETE | `/queue/:id` | Batalkan pekerjaan cetak |
| GET | `/status` | Ringkasan status printer |
| GET | `/dlq` | Dead letter queue |
| POST | `/dlq/:id/retry` | Coba lagi pekerjaan DLQ |
| DELETE | `/dlq/:id` | Buang pekerjaan DLQ |
| GET | `/config` | Konfigurasi saat ini |
| POST | `/config/sync` | Sinkronisasi dari jarak jauh (remote) |

### Permintaan Pekerjaan Cetak (Print Job Request)

```http
POST /api/v1/print
Content-Type: application/json
X-RosyidPOS-Key: kunci-api-anda
X-Idempotency-Key: order-12345-receipt-1

{
  "target": "cashier",
  "type": "escpos",
  "content": "data-terenkode-base64",
  "metadata": {
    "order_id": "ORD-12345",
    "category": "food"
  }
}
```

### Respons

```json
{
  "success": true,
  "job_id": "uuid",
  "status": "queued",
  "position": 1
}
```

## Dasbor (Dashboard)

Akses dasbor pemantauan di:

```
http://127.0.0.1:7331/dashboard
```

Fitur:
- Status printer real-time
- Manajemen antrean
- Peninjauan dan uji coba ulang DLQ
- Penampil log (log viewer)
- Penampil konfigurasi (config viewer)

## Integrasi

Lihat dokumentasi:
- [Panduan Integrasi Laravel](docs/laravel-integration.md)
- [Contoh Pembantu Vue](docs/vue-helper.md)

## Arsitektur

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

## Pemecahan Masalah (Troubleshooting)

### Layanan tidak dapat dijalankan (Service won't start)
1. Periksa Windows Event Viewer untuk melihat kesalahan
2. Coba jalankan secara manual: `node src/index.js`
3. Periksa log di `data/logs/`
4. Jika menemui error `LookupAccountName failed: 1332` atau `Failed to set logon as a service right`, pastikan opsi `allowServiceLogon` di file `scripts/install-service.js` dinonaktifkan atau dihapus agar service berjalan dengan akun default `LocalSystem` tanpa hambatan.

### Printer tidak ditemukan (Printer not found)
1. Buka dasbor, pilih tab Printer
2. Klik Refresh (Segarkan)
3. Pastikan nama printer sama persis dengan yang ada di Windows

### Pencetakan gagal (Prints failing)
1. Periksa DLQ di dasbor
2. Tinjau pesan kesalahan
3. Uji printer dengan tombol Test Print (Uji Cetak)

### Mode Aman (Safe Mode)
Jika agen memasuki mode aman setelah crash:
1. Periksa log untuk mencari penyebab crash
2. Perbaiki masalah tersebut
3. Mulai ulang layanan untuk keluar dari mode aman

## Lisensi (License)

Lisensi MIT - Lihat file LICENSE
