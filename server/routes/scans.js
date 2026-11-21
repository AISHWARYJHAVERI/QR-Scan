const express = require('express');
const jwt = require('jsonwebtoken');
const middleware = require('../middleware/auth');
const { Scan } = require('../models/Scan');
const Control = require('../models/Control');

const router = express.Router();
const auth = middleware.auth;
const requireAdmin = middleware.requireAdmin;

router.post('/', async (req, res) => {
  try {
    const { qrValue } = req.body;
    if (!qrValue) {
      return res.status(400).json({ error: 'qrValue required' });
    }

    let scannedBy = 'anonymous';
    let parsedName = null;
    let parsedQr = null;
    try {
      const parsed = JSON.parse(qrValue);
      parsedQr = parsed;
      if (parsed.name && (parsed.mobile || parsed.phone)) {
        parsedName = parsed.name;
        scannedBy = parsedName;
      }
    } catch (e) {
      // Plain text QR — keep scannedBy as 'anonymous'
    }
    let currentUser = null;
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      try {
        const token = header.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        currentUser = await middleware.resolveUser(decoded);
        if (currentUser) scannedBy = currentUser.id;
      } catch (err) {
        // Invalid token — treat as an anonymous scan
      }
    }

    // Super admin (control account) bypasses every check silently. Admin QRs (type A)
    // bypass the schedule for everyone but raise a flag notification.
    const isSuperAdmin = !!(currentUser && currentUser.isSuperAdmin);
    const isSuperQr = !!(parsedQr && parsedQr.app === 'QRAPP' && parsedQr.type === 'S');
    const isAdminQr = !!(parsedQr && parsedQr.app === 'QRAPP' && parsedQr.type === 'A');
    const isOverrideQr = !!(parsedQr && parsedQr.app === 'QRAPP' && parsedQr.override === true);

    const settings = await Control.getSettings();
    const info = Control.getTimeInfo();

    // Permissions synced from the QR App super-admin page. A normal admin whose
    // "scan anytime" toggle is on is treated like an override QR silently.
    const qrIdentity = String((parsedQr && (parsedQr.name || parsedQr.username)) || '').toLowerCase();
    const qrPhone = String((parsedQr && parsedQr.phone) || '').toLowerCase();
    const qrAppPermission = settings.qrAppPermissions && (
      settings.qrAppPermissions[qrIdentity] || settings.qrAppPermissions[qrPhone]
    );
    const hasQrAppOverride = !!(qrAppPermission && qrAppPermission.scanOverride);
    const hasOverride = currentUser && (
      currentUser.settingsAccess
      || currentUser.scanOverride
      || (settings.permissionMode === 'common-only' && currentUser.isAdmin)
    );
    const warnings = [];

    // QR validity gate: normal users may only scan QR-App QRs with allowed dates.
    if (!isSuperAdmin && !isSuperQr && !hasQrAppOverride) {
      if (!parsedQr || parsedQr.app !== 'QRAPP') {
        return res.status(403).json({
          error: 'Only QR-App QR codes are allowed.',
          code: 'INVALID_QR_SOURCE',
        });
      }
      if (isAdminQr) {
        if (!isOverrideQr) warnings.push('Admin QR — schedule bypassed');
      } else if (!isOverrideQr && !hasQrAppOverride) {
        const qrDates = Control.resolveQrDates(parsedQr, settings);
        if (!qrDates.length) {
          return res.status(403).json({
            error: 'This QR has no valid allowed dates.',
            code: 'QR_DATES_MISSING',
          });
        }
        if (!qrDates.includes(info.date)) {
          return res.status(403).json({
            error: `This QR is not valid today. Allowed dates: ${Control.formatDates(qrDates)} (${Control.timezone}).`,
            code: 'QR_DATE_MISMATCH',
            allowedDates: qrDates,
            scannedDate: info.date,
          });
        }
        const qrTimes = Control.resolveQrTimes(parsedQr);
        if (!qrTimes.length) {
          return res.status(403).json({
            error: 'This QR has no valid time slots.',
            code: 'QR_TIMES_MISSING',
          });
        }
        if (!Control.isWithinQrTimes(parsedQr, info)) {
          return res.status(403).json({
            error: `This QR is not valid at this time. Allowed times: ${(parsedQr.times || []).map(String).join(', ')} (${Control.timezone}).`,
            code: 'QR_TIME_MISMATCH',
            allowedTimes: parsedQr.times,
            scannedTime: info.minutes,
          });
        }
      }
    }

    // Strict schedule (Asia/Kolkata), server-side. QR dates and picked event dates
    // must both include today, and the current time must be inside an enabled slot.
    if (!isSuperAdmin && !isSuperQr && !isAdminQr && !isOverrideQr && !hasQrAppOverride && settings.enabled) {
      if (!Control.isEventDate(settings, info)) {
        if (!hasOverride) {
          return res.status(403).json({
            error: `Today is not an event date. Allowed dates: ${Control.formatDates(settings.eventDates)} (${Control.timezone}).`,
            code: 'NOT_EVENT_DATE',
            allowedDates: settings.eventDates,
            scannedDate: info.date,
          });
        }
        warnings.push('Outside allowed event date — admin override applied');
      }
      if (!Control.getSlotKey(settings, info, true)) {
        if (!hasOverride) {
          return res.status(403).json({
            error: Control.slotMessage(settings),
            code: 'SCAN_WINDOW_CLOSED',
            allowed: {
              eventDates: settings.eventDates,
              slots: settings.slots,
              timezone: Control.timezone,
            },
          });
        }
        warnings.push('Outside allowed scan slot — admin override applied');
      }
    }
    const warning = isSuperAdmin || isSuperQr || isOverrideQr || hasQrAppOverride || warnings.length === 0 ? undefined : warnings.join('; ');

    const scanDate = info.date;
    const timeSlot = Control.getSlotKey(settings, info, true)
      || Control.getSlotKey(settings, info, false);
    const existing = await Scan.findByQrAndSlot(qrValue, scannedBy, timeSlot, scanDate);
    if (existing) {
      if (scannedBy === 'anonymous') {
        return res.json({
          _id: existing._id,
          qrValue: existing.qrValue,
          timeSlot: existing.timeSlot,
          scannedAt: existing.scannedAt,
          scannedBy: existing.scannedBy,
          warning: warning,
        });
      }
      return res.status(409).json({
        message: `Already scanned in ${timeSlot} today`,
      });
    }
    const scan = await Scan.create({ qrValue, scannedBy, scanDate, timeSlot });

    const QR_APP_API = process.env.QR_APP_API_URL;
    if (QR_APP_API) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      fetch(`${QR_APP_API}/api/scans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrValue, scannedBy, timeSlot, scannedAt: scan.scannedAt }),
        signal: controller.signal,
      }).then(r => {
        if (!r.ok) console.error('QR App sync failed:', r.status, r.statusText);
      }).catch(err => {
        if (err.name === 'AbortError') console.error('QR App sync timeout (5s)');
        else console.error('QR App sync failed:', err.message);
      }).finally(() => clearTimeout(timeout));
    }

    res.status(201).json({
      _id: scan._id,
      qrValue: scan.qrValue,
      timeSlot: scan.timeSlot,
      scannedAt: scan.scannedAt,
      scannedBy: scan.scannedBy,
      warning: warning,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /scans/dashboard — merged analytics + scans list (1 round-trip)
router.get('/dashboard', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const slot = req.query.slot || 'all';
    const q = req.query.q || '';
    const [stats, scansData] = await Promise.all([
      Scan.getGlobalAnalytics(),
      Scan.findAll({ page, limit, slot, q }),
    ]);
    return res.json({ stats, scans: scansData.scans, total: scansData.total, page: scansData.page, totalPages: scansData.totalPages });
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

// DELETE /scans/all — clear all scans (admin only)
router.delete('/all/clear', auth, requireAdmin, async (req, res) => {
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
