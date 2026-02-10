/**
 * Status API Routes
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/v1/status
 * Get printer status summary
 */
router.get('/status', (req, res) => {
  try {
    const services = req.app.get('services');
    const printerService = services?.printer;

    if (!printerService) {
      return res.status(503).json({ 
        error: 'Service Unavailable', 
        message: 'Printer service not initialized' 
      });
    }

    const summary = printerService.getStatusSummary();

    res.json({
      timestamp: new Date().toISOString(),
      printers: summary
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

/**
 * GET /api/v1/status/:target
 * Get status for specific printer target
 */
router.get('/status/:target', (req, res) => {
  try {
    const services = req.app.get('services');
    const printerService = services?.printer;
    const target = req.params.target;

    // Resolve logical name to physical
    const physicalName = printerService?.resolveLogicalName(target);
    const status = printerService?.getStatus(physicalName);

    if (!status || status.status === 'unknown') {
      // Try direct physical name
      const directStatus = printerService?.getStatus(target);
      if (directStatus && directStatus.status !== 'unknown') {
        return res.json({
          target: target,
          physical: target,
          ...directStatus
        });
      }
    }

    res.json({
      target: target,
      physical: physicalName,
      ...status
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

module.exports = router;
