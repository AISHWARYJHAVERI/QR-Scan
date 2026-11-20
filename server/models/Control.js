const bcrypt = require('bcryptjs');
const { getDb } = require('./db');

const USERNAME = 'aishwary';
// Pre-computed bcrypt hash of the chosen control-page password. Plain text is never stored.
const SEED_HASH = '$2a$10$ma6fAkmZ5s7D5051oJrAv.GvPx/9xuJ2okwBScsjRsRkeZ2qNycHO';
const TIMEZONE = 'Asia/Kolkata';

const DEFAULT_SETTINGS = {
  enabled: true,
  date: '2026-11-21',
  startTime: '00:00',
  endTime: '23:59',
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
    await settings.insertOne({ key: 'main', ...DEFAULT_SETTINGS, updatedAt: new Date() });
  }
  seeded = true;
}

const toMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const formatDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return String(value || '');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] || match[2]} ${match[1]}`;
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

const isWithinWindow = (settings, info = getTimeInfo()) => {
  if (!settings.enabled) return true;
  if (settings.date && info.date !== settings.date) return false;
  const start = toMinutes(settings.startTime);
  const end = toMinutes(settings.endTime);
  if (start === null || end === null) return true;
  if (end >= start) return info.minutes >= start && info.minutes <= end;
  return info.minutes >= start || info.minutes <= end;
};

const publicSettings = (doc) => ({
  enabled: !!doc.enabled,
  date: doc.date || '',
  startTime: doc.startTime || '00:00',
  endTime: doc.endTime || '23:59',
  timezone: TIMEZONE,
  permissionMode: doc.permissionMode === 'everyone' ? 'everyone' : 'common-only',
  permissions: doc.permissions || {},
  updatedAt: doc.updatedAt || null,
});

const Control = {
  username: USERNAME,
  timezone: TIMEZONE,
  formatDate,
  getTimeInfo,
  isWithinWindow,

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
    return { ...DEFAULT_SETTINGS, ...(doc || {}) };
  },

  async updateSettings(patch) {
    await ensureSeeded();
    const current = await this.getSettings();
    const next = { ...current };

    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (typeof patch.date === 'string') {
      next.date = /^\d{4}-\d{2}-\d{2}$/.test(patch.date) ? patch.date : '';
    }
    if (typeof patch.startTime === 'string' && toMinutes(patch.startTime) !== null) next.startTime = patch.startTime;
    if (typeof patch.endTime === 'string' && toMinutes(patch.endTime) !== null) next.endTime = patch.endTime;
    if (patch.permissionMode === 'common-only' || patch.permissionMode === 'everyone') {
      next.permissionMode = patch.permissionMode;
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
