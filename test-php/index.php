<?php
/**
 * Interactive Testing UI for RosyidPOS Print Agent
 * 
 * Mengintegrasikan pembuatan struk belanja HTML/CSS, konversi PDF via Dompdf,
 * antarmuka pengujian interaktif, dan editor pemetaan printer DINAMIS langsung ke agent.
 */

$autoloadPath = __DIR__ . '/vendor/autoload.php';
$hasComposer = file_exists($autoloadPath);

if ($hasComposer) {
    require_once $autoloadPath;
}

use Dompdf\Dompdf;
use Dompdf\Options;

// File log lokal untuk menyimpan riwayat test print
define('LOG_FILE', __DIR__ . '/test_logs.json');

// --- HANDLER AJAX / ROUTING API ---
if (isset($_GET['action'])) {
    header('Content-Type: application/json');
    $action = $_GET['action'];

    if ($action === 'get_printers') {
        // Ambil daftar printer aktif dari Print Agent
        try {
            $ch = curl_init('http://127.0.0.1:7331/api/v1/printers');
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 3);
            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode === 200) {
                echo $response;
            } else {
                echo json_encode(['success' => false, 'printers' => [], 'message' => 'Agent returned HTTP ' . $httpCode]);
            }
        } catch (Exception $e) {
            echo json_encode(['success' => false, 'printers' => [], 'message' => $e->getMessage()]);
        }
        exit;
    }

    if ($action === 'get_config') {
        // Ambil konfigurasi pemetaan printer saat ini dari Print Agent
        try {
            $ch = curl_init('http://127.0.0.1:7331/api/v1/config');
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 3);
            $response = curl_exec($ch);
            curl_close($ch);
            echo $response;
        } catch (Exception $e) {
            echo json_encode(['success' => false, 'message' => $e->getMessage()]);
        }
        exit;
    }

    if ($action === 'save_mappings' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        // Simpan pemetaan printer baru ke Print Agent
        try {
            $input = json_decode(file_get_contents('php://input'), true);
            
            $ch = curl_init('http://127.0.0.1:7331/api/v1/config/printers');
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PUT');
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['mappings' => $input['mappings']]));
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json',
                'X-RosyidPOS-Key: change-this-secret-key'
            ]);
            curl_setopt($ch, CURLOPT_TIMEOUT, 5);
            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            
            if ($httpCode === 200) {
                echo $response;
            } else {
                echo json_encode(['success' => false, 'message' => 'Failed to save configuration. Agent returned HTTP ' . $httpCode]);
            }
        } catch (Exception $e) {
            echo json_encode(['success' => false, 'message' => $e->getMessage()]);
        }
        exit;
    }

    if ($action === 'get_logs') {
        // Ambil log test local
        if (file_exists(LOG_FILE)) {
            echo file_get_contents(LOG_FILE);
        } else {
            echo json_encode([]);
        }
        exit;
    }

    if ($action === 'print' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        if (!$hasComposer) {
            echo json_encode(['success' => false, 'message' => 'Composer dependencies not installed. Please run "composer install" first.']);
            exit;
        }

        try {
            $input = json_decode(file_get_contents('php://input'), true);
            if (!$input) {
                throw new Exception('Invalid JSON input');
            }

            $printerTarget = isset($input['printer_target']) ? $input['printer_target'] : 'cashier';
            $receiptData = $input['receipt_data'];

            // Generate HTML Nota
            $html = getReceiptTemplateHtml($receiptData);

            // Inisialisasi Dompdf
            $options = new Options();
            $options->set('isHtml5ParserEnabled', true);
            $options->set('isRemoteEnabled', true);
            
            $dompdf = new Dompdf($options);
            $dompdf->loadHtml($html);
            $dompdf->render();
            
            $pdfOutput = $dompdf->output();
            $pdfBase64 = base64_encode($pdfOutput);

            // Kirim ke Print Agent
            $agentUrl = 'http://127.0.0.1:7331/api/v1/print';
            $payload = [
                'target' => $printerTarget,
                'type' => 'pdf',
                'content' => $pdfBase64,
                'metadata' => [
                    'printed_via' => 'interactive-test-ui',
                    'timestamp' => date('Y-m-d H:i:s')
                ]
            ];

            $ch = curl_init($agentUrl);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json',
                'X-RosyidPOS-Key: change-this-secret-key'
            ]);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);
            
            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            $result = json_decode($response, true);

            // Simpan ke log lokal
            $logEntry = [
                'timestamp' => date('Y-m-d H:i:s'),
                'transaction_id' => $receiptData['transaction_id'],
                'target' => $printerTarget,
                'items_count' => count($receiptData['items']),
                'grand_total' => $receiptData['grand_total'],
                'success' => ($httpCode === 200 || $httpCode === 201),
                'job_id' => isset($result['job_id']) ? $result['job_id'] : null,
                'message' => isset($result['message']) ? $result['message'] : (isset($result['error']) ? $result['error'] : 'Success')
            ];

            $logs = [];
            if (file_exists(LOG_FILE)) {
                $logs = json_decode(file_get_contents(LOG_FILE), true) ?: [];
            }
            array_unshift($logs, $logEntry);
            file_put_contents(LOG_FILE, json_encode(array_slice($logs, 0, 50), JSON_PRETTY_PRINT)); // Simpan 50 log terakhir

            if ($httpCode !== 200 && $httpCode !== 201) {
                throw new Exception($logEntry['message']);
            }

            echo json_encode(['success' => true, 'job_id' => $result['job_id'], 'status' => $result['status']]);
        } catch (Exception $e) {
            echo json_encode(['success' => false, 'message' => $e->getMessage()]);
        }
        exit;
    }

    if ($action === 'preview') {
        // Kembalikan HTML nota untuk Iframe preview
        $input = json_decode(file_get_contents('php://input'), true) ?: getSampleData();
        echo getReceiptTemplateHtml($input);
        exit;
    }
}

// --- CORE UTILITY FUNCTIONS ---
function getSampleData() {
    return [
        'store_name' => 'Rosyid Coffee & Roastery',
        'store_address' => 'Jl. Kebon Jeruk No. 45, Jakarta Barat',
        'store_phone' => '0812-3456-7890',
        'transaction_id' => 'TRX-' . date('Ymd') . '-0042',
        'date' => date('d M Y H:i:s'),
        'cashier' => 'Danifahmy',
        'order_type' => 'Dine-in (Meja 05)',
        'items' => [
            ['name' => 'Kopi Susu Gula Aren', 'qty' => 2, 'price' => 22000, 'note' => 'Less Ice, More Espresso'],
            ['name' => 'Croissant Butter Extra', 'qty' => 1, 'price' => 18000, 'note' => 'Hangatkan'],
            ['name' => 'Ice Lychee Tea Sweet', 'qty' => 1, 'price' => 15000, 'note' => '']
        ],
        'subtotal' => 77000,
        'discount' => 7700,
        'tax' => 6930,
        'grand_total' => 76230,
        'payment_method' => 'QRIS (ShopeePay)',
        'payment_amount' => 76230,
        'change_amount' => 0,
        'footer_note' => 'Terima kasih, silakan berkunjung kembali!'
    ];
}

function getReceiptTemplateHtml($data) {
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
            size: 80mm auto; /* Tinggi auto */
        }
        body {
            font-family: "Courier New", Courier, monospace;
            font-size: 11px;
            color: #000;
            margin: 0;
            padding: 8px;
            width: 68mm; /* Area cetak standard kertas struk thermal */
            background-color: #fff;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .bold { font-weight: bold; }
        .header {
            margin-bottom: 12px;
            line-height: 1.4;
        }
        .title {
            font-size: 15px;
            text-transform: uppercase;
            margin: 0 0 3px 0;
            letter-spacing: 0.5px;
        }
        .subtitle {
            font-size: 9px;
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
            font-size: 10px;
            margin-bottom: 8px;
            line-height: 1.3;
        }
        .item-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
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
            font-size: 10px;
            margin-top: 4px;
        }
        .totals-table td {
            padding: 2px 0;
        }
        .footer {
            margin-top: 15px;
            font-size: 9px;
            line-height: 1.4;
        }
        .barcode {
            margin-top: 8px;
            font-size: 11px;
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
                    ($item['note'] ? '<br><small style="font-size: 8.5px; color: #555;">- ' . htmlspecialchars($item['note']) . '</small>' : '') . '</td>
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
            <td style="font-size: 11px;">GRAND TOTAL</td>
            <td style="font-size: 11px;" class="text-right">' . $formatRupiah($data['grand_total']) . '</td>
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

$sample = getSampleData();
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RosyidPOS Print Agent - Interactive Tester</title>
    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    
    <style>
        :root {
            --bg-color: #0b0f19;
            --card-bg: #141c2f;
            --primary-color: #6366f1;
            --primary-hover: #4f46e5;
            --success-color: #10b981;
            --danger-color: #ef4444;
            --border-color: #1e293b;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            padding: 20px;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--border-color);
        }

        .header-title h1 {
            font-size: 24px;
            font-weight: 700;
            background: linear-gradient(to right, #818cf8, #6366f1);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .header-title p {
            font-size: 13px;
            color: var(--text-muted);
            margin-top: 2px;
        }

        .agent-status-badge {
            display: flex;
            align-items: center;
            background-color: rgba(16, 185, 129, 0.1);
            color: var(--success-color);
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 500;
            border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .agent-status-badge.offline {
            background-color: rgba(239, 68, 68, 0.1);
            color: var(--danger-color);
            border-color: rgba(239, 68, 68, 0.2);
        }

        .status-dot {
            width: 8px;
            height: 8px;
            background-color: currentColor;
            border-radius: 50%;
            margin-right: 8px;
            box-shadow: 0 0 10px currentColor;
        }

        .grid-container {
            display: grid;
            grid-template-columns: 1.2fr 1fr 1fr;
            gap: 20px;
            flex: 1;
        }

        @media (max-width: 1200px) {
            .grid-container {
                grid-template-columns: 1fr 1fr;
            }
            .grid-container > :last-child {
                grid-column: span 2;
            }
        }

        @media (max-width: 768px) {
            .grid-container {
                grid-template-columns: 1fr;
            }
            .grid-container > :last-child {
                grid-column: span 1;
            }
        }

        .card {
            background-color: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 20px;
            display: flex;
            flex-direction: column;
            box-shadow: var(--shadow);
            overflow: hidden;
        }

        .card-header {
            margin-bottom: 18px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .card-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--text-main);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .card-subtitle {
            font-size: 12px;
            color: var(--text-muted);
        }

        /* --- PREVIEW STYLES (CENTER COLUMN) --- */
        .preview-container {
            flex: 1;
            display: flex;
            align-items: flex-start;
            justify-content: center;
            background-color: rgba(0, 0, 0, 0.2);
            border-radius: 8px;
            padding: 20px;
            overflow-y: auto;
            border: 1px inset var(--border-color);
            min-height: 450px;
        }

        /* Mockup Paper Roll Receipt */
        .receipt-paper {
            width: 76mm; /* Standard width */
            background-color: #ffffff;
            color: #000000;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            border-radius: 2px;
            position: relative;
            transform-origin: top center;
        }

        /* Jagged bottom edge for mockup paper */
        .receipt-paper::after {
            content: "";
            position: absolute;
            bottom: -6px;
            left: 0;
            width: 100%;
            height: 6px;
            background: linear-gradient(-135deg, var(--card-bg) 3px, transparent 0), 
                        linear-gradient(135deg, var(--card-bg) 3px, transparent 0);
            background-size: 6px 12px;
            background-repeat: repeat-x;
        }

        .receipt-iframe {
            width: 100%;
            height: 520px;
            border: none;
            overflow: hidden;
        }

        /* --- FORM INPUT STYLES (LEFT COLUMN) --- */
        .form-scroll {
            overflow-y: auto;
            flex: 1;
            padding-right: 5px;
            max-height: 65vh;
        }

        .form-group {
            margin-bottom: 14px;
        }

        .form-row-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }

        label {
            display: block;
            font-size: 12.5px;
            font-weight: 500;
            color: var(--text-muted);
            margin-bottom: 6px;
        }

        input, select, textarea {
            width: 100%;
            background-color: rgba(15, 23, 42, 0.6);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 8px 12px;
            color: var(--text-main);
            font-family: inherit;
            font-size: 13px;
            transition: all 0.2s;
        }

        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
        }

        .items-heading {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-muted);
            margin: 18px 0 10px 0;
            padding-bottom: 6px;
            border-bottom: 1px dashed var(--border-color);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .item-row {
            display: grid;
            grid-template-columns: 2fr 0.7fr 1.2fr 0.4fr;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
        }

        .item-note {
            grid-column: span 4;
            margin-top: -4px;
            margin-bottom: 8px;
        }

        .btn-add-item {
            background-color: transparent;
            border: 1px dashed var(--primary-color);
            color: var(--primary-color);
            padding: 6px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            transition: all 0.2s;
        }

        .btn-add-item:hover {
            background-color: rgba(99, 102, 241, 0.1);
        }

        .btn-delete {
            background-color: transparent;
            border: none;
            color: var(--danger-color);
            font-size: 18px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 32px;
        }

        .btn-delete:hover {
            opacity: 0.8;
        }

        .btn-primary {
            background-color: var(--primary-color);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 12px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 10px;
            margin-top: 15px;
        }

        .btn-primary:hover {
            background-color: var(--primary-hover);
        }

        .btn-primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        /* --- LOGS AND SETTINGS STYLES (RIGHT COLUMN) --- */
        .logs-container {
            flex: 1;
            overflow-y: auto;
            max-height: 40vh;
            padding-right: 5px;
        }

        .log-item {
            background-color: rgba(15, 23, 42, 0.4);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 10px;
            font-size: 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .log-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .log-time {
            color: var(--text-muted);
            font-size: 11px;
            font-family: 'JetBrains Mono', monospace;
        }

        .log-badge {
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .log-badge.success {
            background-color: rgba(16, 185, 129, 0.15);
            color: var(--success-color);
        }

        .log-badge.failed {
            background-color: rgba(239, 68, 68, 0.15);
            color: var(--danger-color);
        }

        .log-details {
            font-family: 'JetBrains Mono', monospace;
            background-color: rgba(0, 0, 0, 0.2);
            padding: 6px;
            border-radius: 4px;
            font-size: 11px;
            color: var(--text-main);
            overflow-x: auto;
        }

        /* Spinner animation */
        .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid transparent;
            border-top-color: white;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            display: none;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Composer warning banner */
        .composer-warning {
            background-color: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.2);
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 20px;
            color: #fca5a5;
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-size: 13.5px;
        }

        .composer-warning code {
            background-color: rgba(0, 0, 0, 0.3);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'JetBrains Mono', monospace;
            color: #f87171;
            font-size: 12.5px;
        }
    </style>
</head>
<body>

    <header>
        <div class="header-title">
            <h1>RosyidPOS Print Agent Tester</h1>
            <p>Antarmuka Pengujian Cetak Nota HTML & PDF Interaktif</p>
        </div>
        <div id="agent-status" class="agent-status-badge offline">
            <span class="status-dot"></span>
            <span class="status-text">Memeriksa Agent...</span>
        </div>
    </header>

    <?php if (!$hasComposer): ?>
        <div class="composer-warning">
            <span class="bold">⚠️ Dependensi PHP Belum Lengkap!</span>
            <p>Folder <code>vendor</code> tidak terdeteksi. Untuk melakukan pengetesan cetak PDF, Anda harus menginstal dependensi <b>Dompdf</b> terlebih dahulu.</p>
            <p>Buka terminal di direktori <code>test-php</code> lalu jalankan:</p>
            <p><code>composer install</code></p>
        </div>
    <?php endif; ?>

    <div class="grid-container">
        
        <!-- COLUMN 1: FORM INPUT -->
        <div class="card">
            <div class="card-header">
                <div>
                    <h2 class="card-title">📝 Data Nota</h2>
                    <p class="card-subtitle">Sesuaikan isi struk di bawah ini</p>
                </div>
            </div>

            <form id="receipt-form" class="form-scroll" onsubmit="event.preventDefault();">
                <div class="form-group">
                    <label for="store_name">Nama Toko</label>
                    <input type="text" id="store_name" value="<?= htmlspecialchars($sample['store_name']) ?>" required>
                </div>

                <div class="form-group">
                    <label for="store_address">Alamat Toko</label>
                    <input type="text" id="store_address" value="<?= htmlspecialchars($sample['store_address']) ?>" required>
                </div>

                <div class="form-row-2">
                    <div class="form-group">
                        <label for="store_phone">Telepon</label>
                        <input type="text" id="store_phone" value="<?= htmlspecialchars($sample['store_phone']) ?>">
                    </div>
                    <div class="form-group">
                        <label for="cashier">Kasir</label>
                        <input type="text" id="cashier" value="<?= htmlspecialchars($sample['cashier']) ?>">
                    </div>
                </div>

                <div class="form-row-2">
                    <div class="form-group">
                        <label for="transaction_id">ID Transaksi</label>
                        <input type="text" id="transaction_id" value="<?= htmlspecialchars($sample['transaction_id']) ?>">
                    </div>
                    <div class="form-group">
                        <label for="order_type">Tipe Order</label>
                        <input type="text" id="order_type" value="<?= htmlspecialchars($sample['order_type']) ?>">
                    </div>
                </div>

                <!-- DYNAMIC ITEMS TABLE -->
                <div class="items-heading">
                    <span>Menu / Item Belanja</span>
                    <button type="button" class="btn-add-item" onclick="addItemRow()" style="width: auto; padding: 4px 8px;">+ Tambah Menu</button>
                </div>
                <div id="items-list-container">
                    <?php foreach ($sample['items'] as $index => $item): ?>
                        <div class="item-wrapper" data-index="<?= $index ?>">
                            <div class="item-row">
                                <input type="text" class="item-name" placeholder="Nama Menu" value="<?= htmlspecialchars($item['name']) ?>" required>
                                <input type="number" class="item-qty" placeholder="Qty" value="<?= $item['qty'] ?>" min="1" required style="text-align: center;">
                                <input type="number" class="item-price" placeholder="Harga" value="<?= $item['price'] ?>" required style="text-align: right;">
                                <button type="button" class="btn-delete" onclick="removeItemRow(this)">×</button>
                            </div>
                            <input type="text" class="item-note" placeholder="Catatan Tambahan (opsional)" value="<?= htmlspecialchars($item['note']) ?>">
                        </div>
                    <?php endforeach; ?>
                </div>

                <div class="form-group" style="margin-top: 15px;">
                    <label for="footer_note">Catatan Kaki (Footer)</label>
                    <input type="text" id="footer_note" value="<?= htmlspecialchars($sample['footer_note']) ?>">
                </div>

                <div class="divider" style="margin: 15px 0; border-color: var(--border-color);"></div>

                <div class="form-group">
                    <label for="payment_method">Metode Pembayaran</label>
                    <select id="payment_method">
                        <option value="QRIS (ShopeePay)" selected>QRIS (ShopeePay)</option>
                        <option value="Tunai">Tunai</option>
                        <option value="Debit Card">Debit Card</option>
                        <option value="Gopay/OVO">Gopay / OVO</option>
                    </select>
                </div>

                <div class="form-row-2">
                    <div class="form-group">
                        <label for="discount_percent">Diskon (%)</label>
                        <input type="number" id="discount_percent" value="10" min="0" max="100">
                    </div>
                    <div class="form-group">
                        <label for="tax_percent">Pajak / Service (%)</label>
                        <input type="number" id="tax_percent" value="10" min="0" max="100">
                    </div>
                </div>

                <div class="form-group">
                    <label for="printer_target">Target Printer (Print Agent)</label>
                    <select id="printer_target">
                        <option value="cashier">Logical: cashier (default)</option>
                        <option value="kitchen">Logical: kitchen</option>
                        <option value="bar">Logical: bar</option>
                        <option value="invoice">Logical: invoice</option>
                    </select>
                </div>

                <button type="button" id="btn-submit-print" class="btn-primary" onclick="submitPrintJob()" <?= !$hasComposer ? 'disabled' : '' ?>>
                    <span class="spinner" id="print-spinner"></span>
                    <span id="print-btn-text">🖨️ Kirim ke Printer</span>
                </button>
            </form>
        </div>

        <!-- COLUMN 2: LIVE NOTA PREVIEW -->
        <div class="card">
            <div class="card-header">
                <div>
                    <h2 class="card-title">👁️ Live Preview</h2>
                    <p class="card-subtitle">Tampilan struk 80mm asli saat dicetak</p>
                </div>
            </div>
            
            <div class="preview-container">
                <div class="receipt-paper">
                    <iframe id="preview-iframe" class="receipt-iframe"></iframe>
                </div>
            </div>
        </div>

        <!-- COLUMN 3: SETTINGS & LOGS -->
        <div style="display: flex; flex-direction: column; gap: 20px;">
            <!-- CARD 1: PRINTER CONFIG MAPPINGS -->
            <div class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">⚙️ Pemetaan Printer</h2>
                        <p class="card-subtitle">Petakan printer logis POS ke printer fisik Windows</p>
                    </div>
                </div>
                
                <form id="mappings-form" onsubmit="event.preventDefault(); savePrinterMappings();">
                    <div id="mappings-list-container">
                        <!-- Baris pemetaan dinamis akan dimasukkan di sini oleh JS -->
                    </div>
                    <button type="button" class="btn-add-item" onclick="addMappingRow()" style="margin-top: 5px; margin-bottom: 10px;">
                        ➕ Tambah Pemetaan Baru
                    </button>
                    <button type="submit" class="btn-primary" style="padding: 10px;">
                        💾 Simpan Pemetaan
                    </button>
                </form>
            </div>

            <!-- CARD 2: PRINT LOGS -->
            <div class="card" style="flex: 1;">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">📜 Log Test Print</h2>
                        <p class="card-subtitle">Riwayat cetak struk dari halaman ini</p>
                    </div>
                </div>
                <div class="logs-container" id="logs-list">
                    <div class="text-center text-muted" style="padding: 20px;">Memuat log riwayat...</div>
                </div>
            </div>
        </div>

    </div>

    <!-- JavaScript Interaktif -->
    <script>
        let physicalPrinters = [];
        let configuredMappings = {};

        document.addEventListener('DOMContentLoaded', () => {
            // Monitor perubahan pada form untuk update live preview struk
            const inputs = document.querySelectorAll('#receipt-form input, #receipt-form select');
            inputs.forEach(input => {
                input.addEventListener('input', debounce(updatePreview, 400));
            });

            // Jalankan update preview pertama kali
            updatePreview();

            // Cek status print agent, konfigurasi pemetaan, & printer dropdown
            checkAgentStatus();
            initSettingsForm().then(() => {
                loadPrinters();
            });
            loadLogs();

            // Periodik reload logs & status
            setInterval(checkAgentStatus, 8000);
            setInterval(loadLogs, 6000);
        });

        // Debounce utility to optimize live updating
        function debounce(func, wait) {
            let timeout;
            return function(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        }

        // Kumpulkan data form nota menjadi objek JSON
        function getReceiptData() {
            const items = [];
            document.querySelectorAll('#items-list-container .item-wrapper').forEach(wrapper => {
                const name = wrapper.querySelector('.item-name').value;
                const qty = parseInt(wrapper.querySelector('.item-qty').value) || 0;
                const price = parseFloat(wrapper.querySelector('.item-price').value) || 0;
                const note = wrapper.querySelector('.item-note').value;

                if (name) {
                    items.push({ name, qty, price, note });
                }
            });

            // Hitung kalkulasi
            let subtotal = 0;
            items.forEach(item => { subtotal += (item.qty * item.price); });

            const discountPercent = parseFloat(document.getElementById('discount_percent').value) || 0;
            const discount = subtotal * (discountPercent / 100);

            const afterDiscount = subtotal - discount;
            const taxPercent = parseFloat(document.getElementById('tax_percent').value) || 0;
            const tax = afterDiscount * (taxPercent / 100);

            const grandTotal = Math.round(afterDiscount + tax);
            
            return {
                store_name: document.getElementById('store_name').value,
                store_address: document.getElementById('store_address').value,
                store_phone: document.getElementById('store_phone').value,
                transaction_id: document.getElementById('transaction_id').value,
                date: new Date().toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':'),
                cashier: document.getElementById('cashier').value,
                order_type: document.getElementById('order_type').value,
                items: items,
                subtotal: subtotal,
                discount: discount,
                tax: tax,
                grand_total: grandTotal,
                payment_method: document.getElementById('payment_method').value,
                payment_amount: grandTotal, // asumsikan uang pas
                change_amount: 0,
                footer_note: document.getElementById('footer_note').value
            };
        }

        // Update tampilan Iframe Preview secara real-time
        async function updatePreview() {
            const data = getReceiptData();
            const iframe = document.getElementById('preview-iframe');

            try {
                const res = await fetch('index.php?action=preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const html = await res.text();
                
                // Write html content directly into iframe
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                doc.open();
                doc.write(html);
                doc.close();
            } catch (e) {
                console.error("Preview render failed:", e);
            }
        }

        // Tambah baris item belanja
        function addItemRow() {
            const container = document.getElementById('items-list-container');
            const newIndex = container.children.length;
            const wrapper = document.createElement('div');
            wrapper.className = 'item-wrapper';
            wrapper.dataset.index = newIndex;

            wrapper.innerHTML = `
                <div class="item-row">
                    <input type="text" class="item-name" placeholder="Nama Menu" required>
                    <input type="number" class="item-qty" placeholder="Qty" value="1" min="1" required style="text-align: center;">
                    <input type="number" class="item-price" placeholder="Harga" value="15000" required style="text-align: right;">
                    <button type="button" class="btn-delete" onclick="removeItemRow(this)">×</button>
                </div>
                <input type="text" class="item-note" placeholder="Catatan Tambahan (opsional)" value="">
            `;
            container.appendChild(wrapper);

            // Bind update events to new inputs
            wrapper.querySelectorAll('input').forEach(input => {
                input.addEventListener('input', debounce(updatePreview, 400));
            });

            updatePreview();
        }

        // Hapus baris item belanja
        function removeItemRow(btn) {
            const wrapper = btn.closest('.item-wrapper');
            wrapper.remove();
            updatePreview();
        }

        // Kirim perintah print melalui AJAX ke Backend PHP
        async function submitPrintJob() {
            const btn = document.getElementById('btn-submit-print');
            const text = document.getElementById('print-btn-text');
            const spinner = document.getElementById('print-spinner');
            const printerTarget = document.getElementById('printer_target').value;
            
            // Nonaktifkan tombol
            btn.disabled = true;
            spinner.style.display = 'inline-block';
            text.textContent = 'Mengirim Cetak...';

            const payload = {
                printer_target: printerTarget,
                receipt_data: getReceiptData()
            };

            try {
                const res = await fetch('index.php?action=print', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();

                if (result.success) {
                    alert(`✅ Sukses! Nota dikirim ke printer target: "${printerTarget}"\nJob ID: ${result.job_id}`);
                } else {
                    alert(`❌ Gagal: ${result.message}`);
                }
            } catch (e) {
                alert(`❌ Koneksi gagal: ${e.message}`);
            } finally {
                btn.disabled = false;
                spinner.style.display = 'none';
                text.textContent = '🖨️ Kirim ke Printer';
                loadLogs();
            }
        }

        // Cek status konektivitas print agent lokal
        async function checkAgentStatus() {
            const badge = document.getElementById('agent-status');
            const dot = badge.querySelector('.status-dot');
            const text = badge.querySelector('.status-text');

            try {
                const res = await fetch('http://127.0.0.1:7331/health', { method: 'GET' });
                if (res.ok) {
                    badge.className = 'agent-status-badge';
                    text.textContent = 'Agent Online';
                } else {
                    throw new Error();
                }
            } catch (e) {
                badge.className = 'agent-status-badge offline';
                text.textContent = 'Agent Offline (7331)';
            }
        }

        // Inisialisasi daftar printer fisik & data konfigurasi pemetaan saat ini
        async function initSettingsForm() {
            try {
                // 1. Ambil printer fisik terdeteksi
                const printersRes = await fetch('index.php?action=get_printers');
                const printersData = await printersRes.json();
                physicalPrinters = printersData.printers || [];

                // 2. Ambil pemetaan terkonfigurasi saat ini dari agent
                const configRes = await fetch('index.php?action=get_config');
                const configData = await configRes.json();
                
                const container = document.getElementById('mappings-list-container');
                container.innerHTML = '';

                if (configData.printers && configData.printers.mappings) {
                    configuredMappings = configData.printers.mappings;
                    
                    const keys = Object.keys(configuredMappings);
                    if (keys.length === 0) {
                        // Jika kosong, masukkan default 4 printer
                        const defaults = { cashier: '', kitchen: '', bar: '', invoice: '' };
                        Object.entries(defaults).forEach(([logical, physical]) => {
                            createMappingRowElement(logical, physical);
                        });
                    } else {
                        Object.entries(configuredMappings).forEach(([logical, physical]) => {
                            createMappingRowElement(logical, physical);
                        });
                    }
                } else {
                    // Fallback default jika data tidak didapat
                    const defaults = { cashier: '', kitchen: '', bar: '', invoice: '' };
                    Object.entries(defaults).forEach(([logical, physical]) => {
                        createMappingRowElement(logical, physical);
                    });
                }
            } catch (e) {
                console.error("Gagal menginisialisasi form pemetaan:", e);
            }
        }

        // Membuat element baris pemetaan baru
        function createMappingRowElement(logical = '', physical = '') {
            const container = document.getElementById('mappings-list-container');
            const row = document.createElement('div');
            row.className = 'mapping-row-item';
            row.style.display = 'grid';
            row.style.gridTemplateColumns = '1fr 1.3fr 0.3fr';
            row.style.gap = '8px';
            row.style.marginBottom = '10px';
            row.style.alignItems = 'center';

            // Options untuk dropdown printer fisik
            let optionsHtml = '<option value="">-- Pilih Printer Fisik --</option>';
            physicalPrinters.forEach(p => {
                const selected = p.name === physical ? 'selected' : '';
                optionsHtml += `<option value="${p.name}" ${selected}>${p.name} (${p.status})</option>`;
            });

            row.innerHTML = `
                <input type="text" class="mapping-logical-name" placeholder="Nama Logis (e.g. bakery)" value="${logical}" required style="padding: 6px 8px;">
                <select class="mapping-physical-select" style="padding: 6px 8px;">
                    ${optionsHtml}
                </select>
                <button type="button" class="btn-delete" onclick="this.parentElement.remove()" style="height: 30px; margin-top:0;">×</button>
            `;
            container.appendChild(row);
        }

        // Tambah baris pemetaan kosong baru
        function addMappingRow() {
            createMappingRowElement('', '');
        }

        // Simpan pemetaan printer yang baru ke Print Agent
        async function savePrinterMappings() {
            const btn = document.querySelector('#mappings-form button[type="submit"]');
            const originalText = btn.textContent;
            
            btn.disabled = true;
            btn.textContent = 'Menyimpan...';

            // Kompilasi objek mappings dari input form dinamis
            const mappings = {};
            document.querySelectorAll('#mappings-list-container .mapping-row-item').forEach(row => {
                const logical = row.querySelector('.mapping-logical-name').value.trim();
                const physical = row.querySelector('.mapping-physical-select').value;
                if (logical) {
                    mappings[logical] = physical;
                }
            });

            const payload = { mappings };

            try {
                const res = await fetch('index.php?action=save_mappings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();

                if (result.success) {
                    alert('✅ Sukses! Pemetaan printer berhasil disimpan langsung ke database Print Agent.');
                    configuredMappings = mappings;
                    // Reload dropdown target printer di form cetak
                    loadPrinters();
                } else {
                    alert('❌ Gagal menyimpan pemetaan: ' + (result.message || 'Unknown error'));
                }
            } catch (e) {
                alert('❌ Koneksi ke Agent gagal: ' + e.message);
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }

        // Ambil data printer yang tersedia di print agent (untuk dropdown target cetak)
        async function loadPrinters() {
            const select = document.getElementById('printer_target');
            
            try {
                const currentVal = select.value;
                select.innerHTML = '';
                
                const logicalGroup = document.createElement('optgroup');
                logicalGroup.label = 'Pemetaan Logis (Config)';
                
                const physicalGroup = document.createElement('optgroup');
                physicalGroup.label = 'Printer Fisik (Windows Direct)';

                // Masukkan pemetaan logis terkonfigurasi secara dinamis
                const keys = Object.keys(configuredMappings);
                if (keys.length > 0) {
                    keys.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m;
                        opt.textContent = `Logical: ${m}`;
                        logicalGroup.appendChild(opt);
                    });
                } else {
                    // Fallback jika kosong
                    ['cashier', 'kitchen', 'bar', 'invoice'].forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m;
                        opt.textContent = `Logical: ${m}`;
                        logicalGroup.appendChild(opt);
                    });
                }

                // Masukkan printer fisik
                physicalPrinters.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.name;
                    opt.textContent = `${p.name} (${p.status})`;
                    physicalGroup.appendChild(opt);
                });

                select.appendChild(logicalGroup);
                select.appendChild(physicalGroup);

                // Kembalikan pilihan sebelumnya jika ada
                if (select.querySelector(`option[value="${currentVal}"]`)) {
                    select.value = currentVal;
                }
            } catch (e) {
                console.error("Gagal memuat daftar printer dari agent:", e);
            }
        }

        // Memuat log pengujian lokal
        async function loadLogs() {
            const container = document.getElementById('logs-list');

            try {
                const res = await fetch('index.php?action=get_logs');
                const logs = await res.json();

                if (!logs || logs.length === 0) {
                    container.innerHTML = `
                        <div class="text-center text-muted" style="padding: 30px 10px;">
                            Belum ada riwayat pencetakan.<br>Silakan lakukan test print terlebih dahulu.
                        </div>
                    `;
                    return;
                }

                container.innerHTML = logs.map(l => `
                    <div class="log-item">
                        <div class="log-meta">
                            <span class="log-time">${l.timestamp}</span>
                            <span class="log-badge ${l.success ? 'success' : 'failed'}">${l.success ? 'SUKSES' : 'GAGAL'}</span>
                        </div>
                        <div style="font-weight: 600;">ID Nota: ${l.transaction_id}</div>
                        <div style="color: var(--text-muted);">Printer Target: <b>${l.target}</b> | Items: ${l.items_count} | Rp ${parseInt(l.grand_total).toLocaleString('id-ID')}</div>
                        ${l.job_id ? `<div class="log-details">Job ID: ${l.job_id}</div>` : ''}
                        ${!l.success ? `<div class="log-details" style="color: var(--danger-color); border-color: rgba(239, 68, 68, 0.2);">${l.message}</div>` : ''}
                    </div>
                `).join('');

            } catch (e) {
                container.innerHTML = `<div class="text-center text-muted" style="color: var(--danger-color);">Gagal memuat log: ${e.message}</div>`;
            }
        }
    </script>
</body>
</html>
