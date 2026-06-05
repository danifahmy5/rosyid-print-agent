/**
 * Printer Service
 * 
 * Handles printer detection, raw printing, and status monitoring.
 * Uses heuristic status based on actual print results.
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class PrinterService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.printers = new Map();
    this.printerStatus = new Map();
  }

  /**
   * Initialize printer service
   */
  async initialize() {
    await this.detectPrinters();
    this.logger.info(`Detected ${this.printers.size} printers`);
  }

  /**
   * Detect available printers on Windows
   */
  async detectPrinters() {
    try {
      // Use Windows PowerShell to get printers
      let stdout;
      let usingFallback = false;
      try {
        const result = await execPromise(
          'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus | ConvertTo-Json"',
          { timeout: 10000 }
        );
        stdout = result.stdout;
      } catch (psError) {
        this.logger.warn('PowerShell Get-Printer failed, trying InstalledPrinters fallback...', { error: psError.message });
        try {
          const result = await execPromise(
            'powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Drawing; [System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ConvertTo-Json"',
            { timeout: 10000 }
          );
          stdout = result.stdout;
          usingFallback = true;
        } catch (fallbackError) {
          this.logger.error('Fallback printer detection also failed', { error: fallbackError.message });
          throw psError; // Throw original error to trigger main catch block
        }
      }

      let printerList = [];
      try {
        const parsed = JSON.parse(stdout);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        if (usingFallback) {
          printerList = list.map(name => ({
            Name: name,
            DriverName: 'Unknown',
            PortName: 'Unknown',
            PrinterStatus: 0
          }));
        } else {
          printerList = list;
        }
      } catch (e) {
        this.logger.warn('Could not parse printer list, using empty list');
        printerList = [];
      }

      // Clear and rebuild printer map
      this.printers.clear();
      
      for (const printer of printerList) {
        if (printer && printer.Name) {
          this.printers.set(printer.Name, {
            name: printer.Name,
            driver: printer.DriverName || 'Unknown',
            port: printer.PortName || 'Unknown',
            windowsStatus: printer.PrinterStatus || 'Unknown'
          });

          // Initialize heuristic status
          if (!this.printerStatus.has(printer.Name)) {
            this.printerStatus.set(printer.Name, {
              status: 'unknown',
              confidence: 'low',
              lastSuccess: null,
              lastError: null,
              consecutiveFailures: 0
            });
          }
        }
      }

    } catch (error) {
      this.logger.error('Failed to detect printers', { error: error.message });
    }
  }

  /**
   * Get list of all printers with status
   */
  getPrinters() {
    const result = [];
    const mappings = this.config.get('printers.mappings', {});
    
    // Create reverse mapping (physical -> logical)
    const reverseMap = {};
    for (const [logical, physical] of Object.entries(mappings)) {
      if (physical) {
        reverseMap[physical] = logical;
      }
    }

    for (const [name, printer] of this.printers) {
      const status = this.printerStatus.get(name) || {};
      result.push({
        name: name,
        logical: reverseMap[name] || null,
        driver: printer.driver,
        port: printer.port,
        status: status.status || 'unknown',
        confidence: status.confidence || 'low',
        lastSuccess: status.lastSuccess,
        lastError: status.lastError,
        paperStatus: 'unknown' // Windows doesn't reliably report this
      });
    }

    return result;
  }

  /**
   * Get physical printer name from logical name
   * @param {string} logicalName - Logical printer name
   */
  resolveLogicalName(logicalName) {
    const mappings = this.config.get('printers.mappings', {});
    return mappings[logicalName] || logicalName;
  }

  /**
   * Check if printer exists
   * @param {string} printerName - Physical printer name
   */
  printerExists(printerName) {
    return this.printers.has(printerName);
  }

  /**
   * Print raw data to printer
   * @param {string} printerName - Physical printer name
   * @param {Buffer|string} data - Data to print
   * @param {object} options - Print options
   */
  async printRaw(printerName, data, options = {}) {
    const startTime = Date.now();
    
    try {
      if (!this.printerExists(printerName)) {
        throw new Error(`Printer not found: ${printerName}`);
      }

      // Convert data to buffer if needed
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

      // Write to temp file then use Windows print command
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const tempFile = path.join(os.tmpdir(), `print_${Date.now()}.raw`);
      
      fs.writeFileSync(tempFile, buffer);

      try {
        // Try the default copy command for RAW printing (requires sharing)
        try {
          await execPromise(
            `copy /b "${tempFile}" "\\\\%COMPUTERNAME%\\${printerName}"`,
            { timeout: 30000, shell: 'cmd.exe' }
          );
        } catch (copyError) {
          this.logger.warn('Copy command print failed, trying PowerShell Spooler fallback...', { error: copyError.message });
          
          // PowerShell fallback using Win32 Spooler API (does not require sharing)
          const psScript = `
$code = @"
using System;
using System.Runtime.InteropServices;
using System.IO;

public class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern uint StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendFileToPrinter(string szPrinterName, string szFileName) {
        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOA di = new DOCINFOA();
        bool bSuccess = false;
        di.pDocName = "RosyidPOS Print Job";
        di.pDataType = "RAW";
        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            if (StartDocPrinter(hPrinter, 1, di) != 0) {
                if (StartPagePrinter(hPrinter)) {
                    byte[] bytes = File.ReadAllBytes(szFileName);
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int dwWritten = 0;
                    bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                    EndPagePrinter(hPrinter);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        return bSuccess;
    }
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
$res = [RawPrinter]::SendFileToPrinter("${printerName.replace(/"/g, '""')}", "${tempFile.replace(/"/g, '""')}")
if (-not $res) {
    exit 1
}
exit 0
`;
          const psFile = path.join(os.tmpdir(), `print_${Date.now()}.ps1`);
          fs.writeFileSync(psFile, psScript, 'utf8');
          try {
            await execPromise(
              `powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`,
              { timeout: 30000 }
            );
          } catch (psError) {
            throw new Error(`Both copy command and PowerShell Spooler fallback failed. Copy error: ${copyError.message.trim()}. PowerShell error: ${psError.message.trim()}`);
          } finally {
            try {
              fs.unlinkSync(psFile);
            } catch (e) {
              // Ignore cleanup errors
            }
          }
        }
      } finally {
        // Clean up temp file
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      // Record success
      this.recordPrintResult(printerName, true);
      
      this.logger.info('Print job completed', {
        printer: printerName,
        size: buffer.length,
        duration: Date.now() - startTime
      });

      return { success: true, printer: printerName };

    } catch (error) {
      // Record failure
      this.recordPrintResult(printerName, false, error.message);
      
      this.logger.error('Print failed', {
        printer: printerName,
        error: error.message,
        duration: Date.now() - startTime
      });

      throw error;
    }
  }

  /**
   * Print using PDF to Printer (for PDF documents)
   * @param {string} printerName - Printer name
   * @param {string} pdfPath - Path to PDF file
   */
  async printPdf(printerName, pdfPath) {
    const pdfToPrinter = require('pdf-to-printer');
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);

    const timeoutMs = this.config.get('monitoring.printer_timeout_ms', 30000);

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(async () => {
        this.logger.warn(`PDF printing timed out after ${timeoutMs}ms. Attempting to kill SumatraPDF process...`);
        try {
          // Kill the SumatraPDF process running under our service account
          await execPromise('taskkill /F /IM SumatraPDF*');
          this.logger.info('Killed hanging SumatraPDF process');
        } catch (killError) {
          this.logger.error('Failed to kill SumatraPDF process', { error: killError.message });
        }
        reject(new Error(`PDF printing timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    
    try {
      if (!this.printerExists(printerName)) {
        throw new Error(`Printer not found: ${printerName}`);
      }

      await Promise.race([
        pdfToPrinter.print(pdfPath, { printer: printerName }),
        timeoutPromise
      ]);

      clearTimeout(timeoutId);
      this.recordPrintResult(printerName, true);
      return { success: true, printer: printerName };
    } catch (error) {
      clearTimeout(timeoutId);
      this.recordPrintResult(printerName, false, error.message);
      throw error;
    }
  }

  /**
   * Record print result for heuristic status
   * @param {string} printerName - Printer name
   * @param {boolean} success - Whether print succeeded
   * @param {string} error - Error message if failed
   */
  recordPrintResult(printerName, success, error = null) {
    const status = this.printerStatus.get(printerName) || {
      status: 'unknown',
      confidence: 'low',
      lastSuccess: null,
      lastError: null,
      consecutiveFailures: 0
    };

    if (success) {
      status.status = 'online';
      status.confidence = 'high';
      status.lastSuccess = new Date().toISOString();
      status.consecutiveFailures = 0;
    } else {
      status.lastError = new Date().toISOString();
      status.errorMessage = error;
      status.consecutiveFailures++;

      // Update status based on consecutive failures
      if (status.consecutiveFailures >= 3) {
        status.status = 'offline';
        status.confidence = 'high';
      } else if (status.consecutiveFailures >= 1) {
        status.status = 'degraded';
        status.confidence = 'medium';
      }
    }

    this.printerStatus.set(printerName, status);
  }

  /**
   * Get status of a specific printer
   * @param {string} printerName - Printer name
   */
  getStatus(printerName) {
    return this.printerStatus.get(printerName) || {
      status: 'unknown',
      confidence: 'low'
    };
  }

  /**
   * Get status summary of all mapped printers
   */
  getStatusSummary() {
    const mappings = this.config.get('printers.mappings', {});
    const summary = {};

    for (const [logical, physical] of Object.entries(mappings)) {
      if (physical) {
        const status = this.printerStatus.get(physical) || { status: 'unknown' };
        summary[logical] = {
          physical: physical,
          status: status.status,
          confidence: status.confidence,
          lastSuccess: status.lastSuccess
        };
      } else {
        summary[logical] = {
          physical: null,
          status: 'not_configured',
          confidence: 'high'
        };
      }
    }

    return summary;
  }

  /**
   * Test print to verify printer is working
   * @param {string} printerName - Printer name
   */
  async testPrint(printerName) {
    const testData = Buffer.from([
      0x1B, 0x40,       // Initialize printer
      0x1B, 0x61, 0x01, // Center align
      ...Buffer.from('=== TEST PRINT ===\n'),
      ...Buffer.from('RosyidPOS Print Agent\n'),
      ...Buffer.from(`Time: ${new Date().toLocaleString()}\n`),
      ...Buffer.from('==================\n\n\n'),
      0x1D, 0x56, 0x00  // Cut paper
    ]);

    return this.printRaw(printerName, testData);
  }
}

module.exports = { PrinterService };
