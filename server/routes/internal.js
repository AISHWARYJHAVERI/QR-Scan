const express = require('express');
const Control = require('../models/Control');

const router = express.Router();
const SYNC_KEY = process.env.EVENT_SYNC_KEY || 'qrapp-event-sync-2026';
const TIMEZONE = 'Asia/Kolkata';

const pad = (n) => String(n).padStart(2, '0');

const todayParts = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = {};
  for (const part of formatter.formatToParts(new Date())) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts;
};

// Called by the QR App server after Event Dates are saved.
// Keeps the scanner window in sync with the days embedded in every QR.
router.post('/sync-window', async (req, res) => {
  if (req.get('x-sync-key') !== SYNC_KEY) {
    return res.status(401).json({ error: 'Invalid sync key' });
  }

  const days = Array.isArray(req.body && req.body.days)
    ? req.body.days.map(Number)
    : [];
  if (days.length !== 4 || days.some(n => Number.isNaN(n) || n < 1 || n > 31)) {
    return res.status(400).json({ error: 'Provide 4 day numbers between 1 and 31.' });
  }
  if (new Set(days).size !== 4) {
    return res.status(400).json({ error: 'The 4 event dates must be different.' });
  }

  try {
    const { year, month } = todayParts();
    const startDate = `${year}-${month}-${pad(Math.min(...days))}`;
    const endDate = `${year}-${month}-${pad(Math.max(...days))}`;
    const settings = await Control.updateSettings({ startDate, endDate });
    res.json({ ok: true, startDate, endDate, timezone: TIMEZONE, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
