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

const DEFAULT_SETTINGS = {
  enabled: true,
  startDate: '2026-11-21',
  endDate: '2026-11-21',
  slots: DEFAULT_SLOTS,
  timezone: TIMEZONE,
  permissionMode: 'common-only',
  permissions: {},
};

let seeded = false;

async function ensureSeeded() {
  if (seeded) return;
  const db = getDb();
  const creds = db.collection('controlCredentials');
  if (!(await creds.findOne({ username: USERNAME }))) {
    await creds.insertOne({
      username: USERNAME,
      passwordHash: SEED_HASH,
      isAdmin: true,
      settingsAccess: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  const settings = db.collection('scanSettings');
  if (!(await settings.findOne({ key: 'main' }))) {
    await settings.insertOne({ key: 'main', ...DEFAULT_SETTINGS, slots: cloneSlots(DEFAULT_SLOTS), updatedAt: new Date() });
  }
  seeded = true;
}

function cloneSlots(slots) {
  return slots.map(s => ({ ...s }));
}

function normalizeSettings(doc) {
  const base = { ...DEFAULT_SETTINGS, ...(doc || {}) };
  const legacyDate = /^\d{4}-\d{2}-\d{2}$/.test(String(doc && doc.date || '')) ? doc.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(base.startDate || ''))) base.startDate = legacyDate || DEFAULT_SETTINGS.startDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(base.endDate || ''))) base.endDate = legacyDate || DEFAULT_SETTINGS.endDate;

  const incoming = Array.isArray(base.slots) ? base.slots : [];
  base.slots = DEFAULT_SLOTS.map((def) => {
    const found = incoming.find(s => s && s.key === def.key) || {};
    return {
      key: def.key,
      label: def.label,
      start: toMinutes(found.start) !== null ? found.start : def.start,
      end: toMinutes(found.end) !== null ? found.end : def.end,
      enabled: typeof found.enabled === 'boolean' ? found.enabled : def.enabled,
    };
  });
  return base;
}

const toMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

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
  if (respectEnabled && isDate(settings.startDate) && isDate(settings.endDate)) {
    if (info.date < settings.startDate || info.date > settings.endDate) return null;
  }
  const slots = Array.isArray(settings.slots) ? settings.slots : [];
  const match = slots.find(s => (!respectEnabled || s.enabled) && inTimeRange(info.minutes, s));
  if (match) return match.key;
  if (respectEnabled) return null;
  // Fallback for admin overrides outside every configured window.
  const minutes = info.minutes;
  if (minutes >= 9 * 60 && minutes < 13 * 60) return 'morning';
  if (minutes >= 13 * 60 && minutes < 17 * 60) return 'afternoon';
  if (minutes >= 17 * 60 && minutes < 21 * 60) return 'evening';
  return 'night';
};

const isWithinWindow = (settings, info = getTimeInfo()) => {
  if (!settings.enabled) return true;
  if (isDate(settings.startDate) && isDate(settings.endDate)) {
    if (info.date < settings.startDate || info.date > settings.endDate) return false;
  }
  return !!getSlotKey(settings, info, true);
};

const allowedMessage = (settings) => {
  const dates = settings.startDate === settings.endDate
    ? `on ${formatDate(settings.startDate)}`
    : `from ${formatDate(settings.startDate)} to ${formatDate(settings.endDate)}`;
  const slots = (settings.slots || [])
    .filter(s => s.enabled)
    .map(s => `${formatTime(s.start)}–${formatTime(s.end)}`)
    .join(', ');
  return `Scanning is only allowed ${dates}${slots ? `, ${slots}` : ''} (${TIMEZONE}).`;
};

const publicSettings = (doc) => {
  const settings = normalizeSettings(doc);
  return {
    enabled: !!settings.enabled,
    startDate: settings.startDate,
    endDate: settings.endDate,
    slots: cloneSlots(settings.slots),
    timezone: TIMEZONE,
    permissionMode: settings.permissionMode === 'everyone' ? 'everyone' : 'common-only',
    permissions: settings.permissions || {},
    updatedAt: doc && doc.updatedAt || null,
  };
};

const Control = {
  username: USERNAME,
  timezone: TIMEZONE,
  formatDate,
  formatTime,
  getTimeInfo,
  getSlotKey,
  isWithinWindow,
  allowedMessage,

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
    return { id: 'control', username: USERNAME, isAdmin: true, settingsAccess: true };
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
    const next = { ...current, slots: cloneSlots(current.slots) };

    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (typeof patch.startDate === 'string' && isDate(patch.startDate)) next.startDate = patch.startDate;
    if (typeof patch.endDate === 'string' && isDate(patch.endDate)) next.endDate = patch.endDate;
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
