const express = require('express');
const auth = require('../middleware/auth');
const { Scan, getTimeSlot } = require('../models/Scan');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { qrValue } = req.body;
    if (!qrValue) {
      return res.status(400).json({ error: 'qrValue required' });
    }
    
    let scannedBy = 'anonymous';
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      try {
        const token = header.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const User = require('../models/User');
        const user = await User.findById(decoded.userId);
        if (user) {
          scannedBy = user._id.toString();
        }
      } catch (err) {
        // Fallback to anonymous on invalid token
      }
    }

    const timeSlot = getTimeSlot();
    const existing = await Scan.findByQrAndSlot(qrValue, scannedBy, timeSlot);
    if (existing) {
      // If anonymous already scanned, return success directly to satisfy uniqueness index without throwing error
      if (scannedBy === 'anonymous') {
        return res.json({
          status: 'success',
          timeSlot,
          scan: {
            id: existing._id,
            qrValue: existing.qrValue,
            timeSlot: existing.timeSlot,
            scannedAt: existing.scannedAt,
          },
        });
      }
      return res.status(409).json({
        status: 'duplicate',
        timeSlot,
        message: `Already scanned in ${timeSlot} today`,
      });
    }
    const scan = await Scan.create({ qrValue, scannedBy });

    // Push scan to QR App API (async, non-blocking)
    const QR_APP_API = process.env.QR_APP_API_URL;
    if (QR_APP_API) {
      fetch(`${QR_APP_API}/api/scans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrValue, scannedBy, timeSlot, scannedAt: scan.scannedAt }),
      }).catch(err => console.error('QR App sync failed:', err.message));
    }

    res.status(201).json({
      status: 'success',
      timeSlot,
      scan: {
        id: scan._id,
        qrValue: scan.qrValue,
        timeSlot: scan.timeSlot,
        scannedAt: scan.scannedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /scans — all scans with pagination
router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const slot = req.query.slot || 'all';
    const q = req.query.q || '';
    const result = await Scan.findAll({ page, limit, slot, q });
    return res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /scans/analytics — global stats
router.get('/analytics', auth, async (req, res) => {
  try {
    const analytics = await Scan.getGlobalAnalytics();
    return res.json(analytics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /scans/:id — edit a scan
router.put('/:id', auth, async (req, res) => {
  try {
    const { qrValue, timeSlot, scannedAt } = req.body;
    const updated = await Scan.updateById(req.params.id, { qrValue, timeSlot, scannedAt });
    if (!updated) return res.status(404).json({ error: 'Scan not found' });
    res.json({ scan: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /scans/:id — delete a single scan
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await Scan.deleteById(req.params.id);
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Scan not found' });
    res.json({ message: 'Scan deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /scans/all — clear all scans
router.delete('/all/clear', auth, async (req, res) => {
  try {
    const count = await Scan.deleteAll();
    res.json({ message: `${count} scans cleared` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /scans/export — export scans as JSON or CSV
router.get('/export', auth, async (req, res) => {
  try {
    const format = req.query.format || 'json';
    const { scans } = await Scan.findAll({ page: 1, limit: 100000 });

    if (format === 'csv') {
      const header = 'QR Value,Time Slot,Scanned At\n';
      const rows = scans.map(s => `"${s.qrValue}","${s.timeSlot}","${new Date(s.scannedAt).toISOString()}"`).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=scans.csv');
      return res.send(header + rows);
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=scans.json');
    res.json(scans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
