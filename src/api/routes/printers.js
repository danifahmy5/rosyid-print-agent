/**
 * Printers API Routes
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/v1/printers
 * List available printers
 */
router.get('/printers', async (req, res) => {
  try {
    const services = req.app.get('services');
    const printerService = services?.printer;

    if (!printerService) {
      return res.status(503).json({ 
        error: 'Service Unavailable', 
        message: 'Printer service not initialized' 
      });
    }

    const printers = printerService.getPrinters();

    res.json({
      count: printers.length,
      printers: printers
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

/**
 * POST /api/v1/printers/refresh
 * Force refresh printer list
 */
router.post('/printers/refresh', async (req, res) => {
  try {
    const services = req.app.get('services');
    const printerService = services?.printer;

    await printerService?.detectPrinters();
    const printers = printerService?.getPrinters() || [];

    res.json({
      success: true,
      count: printers.length,
      printers: printers
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

/**
 * POST /api/v1/printers/:name/test
 * Send test print to a printer
 */
router.post('/printers/:name/test', async (req, res) => {
  try {
    const services = req.app.get('services');
    const printerService = services?.printer;
    const printerName = decodeURIComponent(req.params.name);

    // Check if it's a logical name
    const physicalName = printerService.resolveLogicalName(printerName);

    if (!printerService.printerExists(physicalName)) {
      return res.status(404).json({ 
        error: 'Not Found', 
        message: `Printer not found: ${printerName}` 
      });
    }

    await printerService.testPrint(physicalName);

    res.json({
      success: true,
      message: `Test print sent to ${physicalName}`
    });

  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Print Failed', 
      message: error.message 
    });
  }
});

module.exports = router;
