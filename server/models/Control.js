const bcrypt = require('bcryptjs');
const { getDb } = require('./db');

const USERNAME = 'aishwary';
// Pre-computed bcrypt hash of the chosen control-page password. Plain text is never stored.
const SEED_HASH = '$2a$10$ma6fAkmZ5s7D5051oJrAv.GvPx/9xuJ2okwBScsjRsRkeZ2qNycHO';
const TIMEZONE = 'Asia/Kolkata';

const DEFAULT_SLOTS = [
  { key: 'morning', label: 'Morning', start: '09:00', end: '12:00', enabled: true },
  { key: 'afternoon', label: 'Afternoon', start: '13:00', end: '16:00', enabled: true },
  { key: 'evening', label: 'Evening', start: '17:00', end: '20:00', enabled: true },
  { key: 'night', label: 'Night', start: '21:00', end: '23:00', enabled: true },
];

const DEFAULT_EVENT_DATES = ['2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20'];

const DEFAULT_SETTINGS = {
  enabled: true,
  eventMonth: 12,
  eventYear: 2026,
  eventDates: DEFAULT_EVENT_DATES,
  slots: DEFAULT_SLOTS,
  timezone: TIMEZONE,
  permissionMode: 'common-only',
  permissions: {},
  qrAppPermissions: {},
};

let seeded = false;

function cloneSlots(slots) {
  return slots.map(s => ({ ...s }));
}

async function ensureSeeded() {
  if (seeded) return;
  const db = getDb();
  const creds = db.collection('controlCredentials');
  if (!(await creds.findOne({ username: USERNAME }))) {
    await creds.insertOne({
      username: USERNAME,
      passwordHash: SEED_HASH,
      isAdmin: true,
      isSuperAdmin: true,
      settingsAccess: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  const settings = db.collection('scanSettings');
  if (!(await settings.findOne({ key: 'main' }))) {
    await settings.insertOne({
      key: 'main',
      ...DEFAULT_SETTINGS,
      eventDates: [...DEFAULT_EVENT_DATES],
      slots: cloneSlots(DEFAULT_SLOTS),
      updatedAt: new Date(),
    });
  }
  seeded = true;
}

const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const isMonth = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 12;
const isYear = value => Number.isInteger(Number(value)) && Number(value) >= 2000 && Number(value) <= 2100;

const toMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function buildDateRange(start, end) {
  const dates = [];
  const limit = end >= start ? 4 : 1;
  for (let i = 0; i < limit; i++) {
    const candidate = addDays(start, i);
    if (candidate > end) break;
    dates.push(candidate);
  }
  return dates;
}

function normalizeSettings(doc) {
  const base = { ...DEFAULT_SETTINGS, ...(doc || {}) };

  const incomingSlots = Array.isArray(base.slots) ? base.slots : [];
  base.slots = DEFAULT_SLOTS.map((def) => {
    const found = incomingSlots.find(s => s && s.key === def.key) || {};
    return {
      key: def.key,
      label: def.label,
      start: toMinutes(found.start) !== null ? found.start : def.start,
      end: toMinutes(found.end) !== null ? found.end : def.end,
      enabled: typeof found.enabled === 'boolean' ? found.enabled : def.enabled,
    };
  });

  let dates = Array.isArray(base.eventDates) ? base.eventDates.filter(isDate).slice(0, 4) : [];
  if (dates.length === 0) {
    const legacyStart = isDate(doc && doc.startDate) ? doc.startDate : (isDate(doc && doc.date) ? doc.date : '');
    const legacyEnd = isDate(doc && doc.endDate) ? doc.endDate : legacyStart;
    dates = legacyStart ? buildDateRange(legacyStart, legacyEnd) : [];
  }
  while (dates.length < 4) dates.push(dates[dates.length - 1] || DEFAULT_EVENT_DATES[dates.length]);
  base.eventDates = dates.slice(0, 4);

  if (!isMonth(base.eventMonth)) base.eventMonth = Number(base.eventDates[0].slice(5, 7));
  if (!isYear(base.eventYear)) base.eventYear = Number(base.eventDates[0].slice(0, 4));
  if (!base.qrAppPermissions || typeof base.qrAppPermissions !== 'object' || Array.isArray(base.qrAppPermissions)) {
    base.qrAppPermissions = {};
  }
  return base;
}

const formatDate = (value) => {
  if (!isDate(value)) return String(value || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] || match[2]} ${match[1]}`;
};

const formatTime = (value) => {
  const minutes = toMinutes(value);
  if (minutes === null) return String(value || '');
  const hours24 = Math.floor(minutes / 60);
  const mins = String(minutes % 60).padStart(2, '0');
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${mins} ${suffix}`;
};

const pad2 = n => String(n).padStart(2, '0');

// Accepts DD/MM/YYYY, DD-MM-YYYY, "DD MM YYYY" and already-normalized YYYY-MM-DD.
const toIsoDate = (value) => {
  const text = String(value || '').trim();
  if (isDate(text)) return text;
  const match = /^(\d{1,2})[\/\-\s](\d{1,2})[\/\-\s](\d{4})$/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
};

const formatDates = dates => (Array.isArray(dates) ? dates : []).map(formatDate).join(', ');

// Resolves the dates a QR allows. `dates` holds full dates (e.g. "17/12/2026").
// Legacy `days` holds day numbers (e.g. 17, 18) which map to the four control-page dates.
const resolveQrDates = (qr, settings) => {
  const result = [];
  const push = (value) => {
    const iso = toIsoDate(value);
    if (iso && !result.includes(iso)) result.push(iso);
  };
  if (!qr || typeof qr !== 'object') return result;
  if (Array.isArray(qr.dates)) qr.dates.forEach(push);

  if (Array.isArray(qr.days)) {
    const eventDates = Array.isArray(settings.eventDates) ? settings.eventDates : [];
    qr.days.forEach((day, index) => {
      const number = Number(day);
      if (!Number.isFinite(number)) return;
      // Prefer the picked date with the matching day-of-month; fall back to array order.
      const byDay = eventDates.find(date => Number(date.slice(8, 10)) === number);
      if (byDay) push(byDay);
      else if (eventDates[index]) push(eventDates[index]);
    });
  }
  return result;
};

// QR time ranges use "HH:mm-HH:mm" (24-hour, IST), e.g. "09:00-12:00".
const resolveQrTimes = (qr) => {
  const result = [];
  if (!qr || typeof qr !== 'object' || !Array.isArray(qr.times)) return result;
  for (const raw of qr.times) {
    const match = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(String(raw || '').trim());
    if (!match) continue;
    const start = toMinutes(match[1]);
    const end = toMinutes(match[2]);
    if (start === null || end === null || start === end) continue;
    if (!result.some(range => range.start === start && range.end === end)) {
      result.push({ start, end });
    }
  }
  return result;
};

const isWithinQrTimes = (qr, info = getTimeInfo()) => {
  const minutes = info.minutes;
  return resolveQrTimes(qr).some(({ start, end }) => (
    end > start ? minutes >= start && minutes <= end : minutes >= start || minutes <= end
  ));
};

const isEventDate = (settings, info = getTimeInfo()) => {
  if (!settings.enabled) return true;
  return Array.isArray(settings.eventDates)
    && settings.eventDates.includes(info.date);
};

const slotMessage = (settings) => {
  const slots = (settings.slots || [])
    .filter(s => s.enabled)
    .map(s => `${formatTime(s.start)}–${formatTime(s.end)}`)
    .join(', ');
  return `Scanning is only allowed during ${slots || 'the configured slots'} (${TIMEZONE}).`;
};

const getTimeInfo = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const part of formatter.formatToParts(new Date())) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
};

const inTimeRange = (minutes, slot) => {
  const start = toMinutes(slot.start);
  const end = toMinutes(slot.end);
  if (start === null || end === null) return false;
  if (end >= start) return minutes >= start && minutes <= end;
  return minutes >= start || minutes <= end;
};

const getSlotKey = (settings, info = getTimeInfo(), respectEnabled = true) => {
  if (respectEnabled && Array.isArray(settings.eventDates) && settings.eventDates.length
    && !settings.eventDates.includes(info.date)) return null;
  const slots = Array.isArray(settings.slots) ? settings.slots : [];
  const match = slots.find(s => (!respectEnabled || s.enabled) && inTimeRange(info.minutes, s));
  if (match) return match.key;
  if (respectEnabled) return null;
  // Fallback for bypasses outside every configured window.
  const minutes = info.minutes;
  if (minutes >= 9 * 60 && minutes < 13 * 60) return 'morning';
  if (minutes >= 13 * 60 && minutes < 17 * 60) return 'afternoon';
  if (minutes >= 17 * 60 && minutes < 21 * 60) return 'evening';
  return 'night';
};

const isWithinWindow = (settings, info = getTimeInfo()) => {
  if (!settings.enabled) return true;
  if (Array.isArray(settings.eventDates) && settings.eventDates.length
    && !settings.eventDates.includes(info.date)) return false;
  return !!getSlotKey(settings, info, true);
};

const allowedMessage = (settings) => {
  const dates = (settings.eventDates || []).map(formatDate).join(', ');
  const slots = (settings.slots || [])
    .filter(s => s.enabled)
    .map(s => `${formatTime(s.start)}–${formatTime(s.end)}`)
    .join(', ');
  return `Scanning is only allowed on ${dates}${slots ? `, ${slots}` : ''} (${TIMEZONE}).`;
};

const publicSettings = (doc) => {
  const settings = normalizeSettings(doc);
  return {
    enabled: !!settings.enabled,
    eventMonth: Number(settings.eventMonth),
    eventYear: Number(settings.eventYear),
    eventDates: [...settings.eventDates],
    slots: cloneSlots(settings.slots),
    timezone: TIMEZONE,
    permissionMode: settings.permissionMode === 'everyone' ? 'everyone' : 'common-only',
    permissions: settings.permissions || {},
    qrAppPermissions: settings.qrAppPermissions || {},
    updatedAt: doc && doc.updatedAt || null,
  };
};

const Control = {
  username: USERNAME,
  timezone: TIMEZONE,
  formatDate,
  formatDates,
  formatTime,
  toIsoDate,
  resolveQrDates,
  resolveQrTimes,
  isWithinQrTimes,
  isEventDate,
  getTimeInfo,
  getSlotKey,
  isWithinWindow,
  allowedMessage,
  slotMessage,

  async verifyCredentials(username, password) {
    await ensureSeeded();
    if (String(username || '').toLowerCase() !== USERNAME) return false;
    const db = getDb();
    const credential = await db.collection('controlCredentials').findOne({ username: USERNAME });
    if (!credential || !password) return false;
    return bcrypt.compare(String(password), credential.passwordHash);
  },

  async getControlUser() {
    await ensureSeeded();
    return {
      id: 'control',
      username: USERNAME,
      isAdmin: true,
      isSuperAdmin: true,
      settingsAccess: true,
    };
  },

  async setPassword(newPassword) {
    await ensureSeeded();
    const db = getDb();
    const hash = await bcrypt.hash(String(newPassword), 10);
    await db.collection('controlCredentials').updateOne(
      { username: USERNAME },
      { $set: { passwordHash: hash, updatedAt: new Date() } }
    );
  },

  async getSettings() {
    await ensureSeeded();
    const db = getDb();
    const doc = await db.collection('scanSettings').findOne({ key: 'main' });
    return normalizeSettings(doc);
  },

  async updateSettings(patch) {
    await ensureSeeded();
    const current = await this.getSettings();
    const next = {
      ...current,
      slots: cloneSlots(current.slots),
      eventDates: [...current.eventDates],
      qrAppPermissions: { ...(current.qrAppPermissions || {}) },
    };

    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (isMonth(patch.eventMonth)) next.eventMonth = Number(patch.eventMonth);
    if (isYear(patch.eventYear)) next.eventYear = Number(patch.eventYear);
    if (Array.isArray(patch.eventDates)) {
      const dates = patch.eventDates.filter(isDate).slice(0, 4);
      if (dates.length) {
        while (dates.length < 4) dates.push(dates[dates.length - 1]);
        next.eventDates = dates;
      }
    } else if (isDate(patch.startDate) || isDate(patch.endDate)) {
      const start = isDate(patch.startDate) ? patch.startDate : next.eventDates[0];
      const end = isDate(patch.endDate) ? patch.endDate : start;
      const generated = buildDateRange(start, end);
      if (generated.length) {
        while (generated.length < 4) generated.push(generated[generated.length - 1]);
        next.eventDates = generated;
      }
    }
    if (patch.permissionMode === 'common-only' || patch.permissionMode === 'everyone') {
      next.permissionMode = patch.permissionMode;
    }
    if (Array.isArray(patch.slots)) {
      for (const incoming of patch.slots) {
        if (!incoming || !incoming.key) continue;
        const slot = next.slots.find(s => s.key === incoming.key);
        if (!slot) continue;
        if (toMinutes(incoming.start) !== null) slot.start = incoming.start;
        if (toMinutes(incoming.end) !== null) slot.end = incoming.end;
        if (typeof incoming.enabled === 'boolean') slot.enabled = incoming.enabled;
      }
    }
    if (patch.permissions && typeof patch.permissions === 'object' && !Array.isArray(patch.permissions)) {
      next.permissions = patch.permissions;
    }
    if (patch.qrAppPermissions && typeof patch.qrAppPermissions === 'object' && !Array.isArray(patch.qrAppPermissions)) {
      next.qrAppPermissions = patch.qrAppPermissions;
    }

    const db = getDb();
    await db.collection('scanSettings').updateOne(
      { key: 'main' },
      { $set: { ...next, updatedAt: new Date() } },
      { upsert: true }
    );
    return publicSettings(next);
  },

  async getPermission(userId) {
    const settings = await this.getSettings();
    return (settings.permissions && settings.permissions[String(userId)]) || { scanOverride: false, pageAccess: false };
  },
};

module.exports = Control;
