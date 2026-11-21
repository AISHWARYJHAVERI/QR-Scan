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

  const body = req.body || {};
  const suppliedDates = Array.isArray(body.dates)
    ? body.dates.map(value => Control.toIsoDate(value)).filter(Boolean)
    : [];
  const days = Array.isArray(body.days) ? body.days.map(Number) : [];

  if (suppliedDates.length !== 4) {
    if (days.length !== 4 || days.some(n => Number.isNaN(n) || n < 1 || n > 31)) {
      return res.status(400).json({ error: 'Provide 4 dates (DD/MM/YYYY) or 4 day numbers (1–31).' });
    }
  }
  const values = suppliedDates.length === 4 ? suppliedDates : days;
  if (new Set(values).size !== 4) {
    return res.status(400).json({ error: 'The 4 event dates must be different.' });
  }

  const times = Array.isArray(body.times) ? body.times.map(String) : [];
  if (times.length && (times.length !== 4 || times.some(t => !/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(t)))) {
    return res.status(400).json({ error: 'Provide 4 time ranges in HH:mm-HH:mm format.' });
  }

  try {
    const today = todayParts();
    const year = String(body.year || today.year);
    const month = String(body.month || today.month);
    const eventDates = (suppliedDates.length === 4
      ? suppliedDates
      : days.map(d => `${year}-${month}-${pad(d)}`)).sort();
    const startDate = eventDates[0];
    const endDate = eventDates[eventDates.length - 1];

    const patch = {
      startDate,
      endDate,
      eventMonth: Number(month),
      eventYear: Number(year),
      eventDates,
    };
    if (times.length === 4) {
      const defs = [
        { key: 'morning', label: 'Morning' },
        { key: 'afternoon', label: 'Afternoon' },
        { key: 'evening', label: 'Evening' },
        { key: 'night', label: 'Night' },
      ];
      patch.slots = times.map((range, i) => {
        const [start, end] = range.split(/\s*-\s*/);
        return { ...defs[i], start, end, enabled: true };
      });
    }
    const settings = await Control.updateSettings(patch);
    res.json({ ok: true, startDate, endDate, eventDates, times, timezone: TIMEZONE, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
