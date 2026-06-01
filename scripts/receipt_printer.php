<?php
/**
 * RosyidPOS Print Agent - PHP Integration Helper & Receipt Template
 * 
 * Script ini digunakan untuk mengonversi template nota HTML+CSS menjadi PDF
 * dan mengirimkannya secara otomatis ke RosyidPOS Print Agent.
 * 
 * Persyaratan:
 * 1. Dompdf Library (Sangat direkomendasikan untuk HTML-to-PDF di PHP)
 *    Instalasi via Composer: composer require dompdf/dompdf
 */

// Autoload Composer jika ada (sesuaikan path project Anda)
if (file_exists(__DIR__ . '/../vendor/autoload.php')) {
    require_once __DIR__ . '/../vendor/autoload.php';
}

use Dompdf\Dompdf;
use Dompdf\Options;

class ReceiptPrinter {
    private $agentUrl;
    private $apiKey;

    public function __construct($host = '127.0.0.1', $port = 7331, $apiKey = 'change-this-secret-key') {
        $this->agentUrl = "http://{$host}:{$port}/api/v1/print";
        $this->apiKey = $apiKey;
    }

    /**
     * Mengirimkan data PDF (base64) ke Print Agent
     */
    public function printPdf($printerTarget, $pdfBase64Data, $idempotencyKey = null) {
        $payload = [
            'target' => $printerTarget,
            'type' => 'pdf',
            'content' => $pdfBase64Data,
            'metadata' => [
                'printed_via' => 'php-sdk',
                'timestamp' => date('Y-m-d H:i:s')
            ]
        ];

        $headers = [
            'Content-Type: application/json',
            'X-RosyidPOS-Key: ' . $this->apiKey
        ];

        if ($idempotencyKey) {
            $headers[] = 'X-Idempotency-Key: ' . $idempotencyKey;
        }

        $ch = curl_init($this->agentUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        
        if (curl_errno($ch)) {
            $error_msg = curl_error($ch);
            curl_close($ch);
            throw new Exception("cURL Error: " . $error_msg);
        }
        
        curl_close($ch);

        $result = json_decode($response, true);
        
        if ($httpCode !== 200 && $httpCode !== 201) {
            $errorMsg = isset($result['message']) ? $result['message'] : (isset($result['error']) ? $result['error'] : 'Unknown error');
            throw new Exception("Print Agent Error (HTTP {$httpCode}): {$errorMsg}");
        }

        return $result;
    }

    /**
     * Menghasilkan HTML Nota yang rapi
     */
    public function getReceiptHtml($data) {
        // Format angka ke rupiah
        $formatRupiah = function($angka) {
            return number_format($angka, 0, ',', '.');
        };

        $html = '<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <style>
        @page {
            margin: 0;
            size: 80mm 200mm; /* Ukuran standard kertas struk 80mm */
        }
        body {
            font-family: "Courier New", Courier, monospace;
            font-size: 12px;
            color: #000;
            margin: 0;
            padding: 8px;
            width: 72mm; /* Area cetak aman */
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .bold { font-weight: bold; }
        .header {
            margin-bottom: 12px;
            line-height: 1.4;
        }
        .title {
            font-size: 16px;
            text-transform: uppercase;
            margin: 0 0 4px 0;
            letter-spacing: 0.5px;
        }
        .subtitle {
            font-size: 10px;
            margin: 0;
        }
        .divider {
            border-top: 1px dashed #000;
            margin: 8px 0;
        }
        .double-divider {
            border-top: 3px double #000;
            margin: 8px 0;
        }
        .meta-info {
            font-size: 10.5px;
            margin-bottom: 8px;
            line-height: 1.3;
        }
        .item-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10.5px;
        }
        .item-table th {
            text-align: left;
            padding-bottom: 4px;
        }
        .item-table td {
            padding: 3px 0;
            vertical-align: top;
        }
        .totals-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10.5px;
            margin-top: 4px;
        }
        .totals-table td {
            padding: 2.5px 0;
        }
        .footer {
            margin-top: 15px;
            font-size: 10px;
            line-height: 1.4;
        }
        .barcode {
            margin-top: 8px;
            font-size: 12px;
            letter-spacing: 3px;
        }
    </style>
</head>
<body>
    <div class="header text-center">
        <h1 class="title bold">' . htmlspecialchars($data['store_name']) . '</h1>
        <p class="subtitle">' . htmlspecialchars($data['store_address']) . '</p>
        <p class="subtitle">Telp: ' . htmlspecialchars($data['store_phone']) . '</p>
    </div>

    <div class="divider"></div>

    <div class="meta-info">
        <div>No. Nota : ' . htmlspecialchars($data['transaction_id']) . '</div>
        <div>Tanggal  : ' . htmlspecialchars($data['date']) . '</div>
        <div>Kasir    : ' . htmlspecialchars($data['cashier']) . '</div>
        <div>Tipe     : ' . htmlspecialchars($data['order_type']) . '</div>
    </div>

    <div class="divider"></div>

    <table class="item-table">
        <thead>
            <tr class="bold">
                <th style="width: 45%;">Menu</th>
                <th style="width: 15%; text-align: center;">Qty</th>
                <th style="width: 20%; text-align: right;">Harga</th>
                <th style="width: 20%; text-align: right;">Total</th>
            </tr>
        </thead>
        <tbody>';

        foreach ($data['items'] as $item) {
            $html .= '<tr>
                <td>' . htmlspecialchars($item['name']) . 
                    ($item['note'] ? '<br><small style="font-size: 8.5px; color: #333;">- ' . htmlspecialchars($item['note']) . '</small>' : '') . '</td>
                <td class="text-center">' . $item['qty'] . '</td>
                <td class="text-right">' . $formatRupiah($item['price']) . '</td>
                <td class="text-right">' . $formatRupiah($item['qty'] * $item['price']) . '</td>
            </tr>';
        }

        $html .= '</tbody>
    </table>

    <div class="divider"></div>

    <table class="totals-table">
        <tr>
            <td style="width: 60%;">Subtotal</td>
            <td style="width: 40%;" class="text-right">' . $formatRupiah($data['subtotal']) . '</td>
        </tr>';

        if ($data['discount'] > 0) {
            $html .= '<tr>
                <td>Diskon</td>
                <td class="text-right">-' . $formatRupiah($data['discount']) . '</td>
            </tr>';
        }

        if ($data['tax'] > 0) {
            $html .= '<tr>
                <td>Pajak (10%)</td>
                <td class="text-right">' . $formatRupiah($data['tax']) . '</td>
            </tr>';
        }

        $html .= '<tr class="bold">
            <td style="font-size: 12px;">GRAND TOTAL</td>
            <td style="font-size: 12px;" class="text-right">' . $formatRupiah($data['grand_total']) . '</td>
        </tr>
        <tr class="divider">
            <td colspan="2"></td>
        </tr>
        <tr>
            <td>Metode Pembayaran</td>
            <td class="text-right">' . htmlspecialchars($data['payment_method']) . '</td>
        </tr>
        <tr>
            <td>Bayar</td>
            <td class="text-right">' . $formatRupiah($data['payment_amount']) . '</td>
        </tr>
        <tr>
            <td>Kembalian</td>
            <td class="text-right">' . $formatRupiah($data['change_amount']) . '</td>
        </tr>
    </table>

    <div class="double-divider"></div>

    <div class="footer text-center">
        <p class="bold">TERIMA KASIH</p>
        <p>' . htmlspecialchars($data['footer_note']) . '</p>
        <div class="barcode bold">*' . htmlspecialchars(preg_replace('/[^A-Za-z0-9]/', '', $data['transaction_id'])) . '*</div>
    </div>
</body>
</html>';

        return $html;
    }

    /**
     * Membuat file PDF dari HTML, kemudian mengirimkannya ke Print Agent
     */
    public function generateAndPrint($printerTarget, $data, $idempotencyKey = null) {
        $html = $this->getReceiptHtml($data);

        // Inisialisasi Dompdf Options
        $options = new Options();
        $options->set('isHtml5ParserEnabled', true);
        $options->set('isRemoteEnabled', true);
        
        $dompdf = new Dompdf($options);
        $dompdf->loadHtml($html);
        
        // Render PDF
        $dompdf->render();
        
        // Dapatkan output biner PDF, konversi ke base64
        $pdfOutput = $dompdf->output();
        $pdfBase64 = base64_encode($pdfOutput);

        // Kirim ke Print Agent
        return $this->printPdf($printerTarget, $pdfBase64, $idempotencyKey);
    }
}

// ==========================================
// CONTOH PENGGUNAAN DIRECT (Dapat Dijalankan)
// ==========================================

/*
try {
    $printer = new ReceiptPrinter('127.0.0.1', 7331, 'change-this-secret-key');

    $receiptData = [
        'store_name' => 'Rosyid Coffee',
        'store_address' => 'Jl. Kebon Jeruk No. 45, Jakarta Barat',
        'store_phone' => '0812-3456-7890',
        'transaction_id' => 'TRX-20260601-0023',
        'date' => date('d M Y H:i:s'),
        'cashier' => 'Danifahmy',
        'order_type' => 'Dine-in (Meja 05)',
        'items' => [
            [
                'name' => 'Kopi Susu Gula Aren',
                'qty' => 2,
                'price' => 22000,
                'note' => 'Less Ice, More Espresso'
            ],
            [
                'name' => 'Croissant Butter',
                'qty' => 1,
                'price' => 18000,
                'note' => ''
            ],
            [
                'name' => 'Ice Lychee Tea',
                'qty' => 1,
                'price' => 15000,
                'note' => ''
            ]
        ],
        'subtotal' => 77000,
        'discount' => 7700,
        'tax' => 6930,
        'grand_total' => 76230,
        'payment_method' => 'QRIS (ShopeePay)',
        'payment_amount' => 76230,
        'change_amount' => 0,
        'footer_note' => 'Terima kasih atas kunjungan Anda!'
    ];

    // Ganti 'cashier' dengan nama printer logis Anda (misal: 'cashier')
    // atau gunakan display name fisik printer Windows Anda (misal: 'EPSON TM-T82 Receipt')
    $response = $printer->generateAndPrint('cashier', $receiptData, 'unique-idempotency-key-123');
    
    echo "Print berhasil dikirim! Job ID: " . $response['job_id'] . "\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
*/
