const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Control = require('../models/Control');

const userCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of userCache) {
    if (now - entry.ts > CACHE_TTL) userCache.delete(id);
  }
}, 60 * 1000).unref();

const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const requireControl = (req, res, next) => {
  if (!req.user || !req.user.settingsAccess) {
    return res.status(403).json({ error: 'Control page access required' });
  }
  next();
};

const invalidateUser = (id) => {
  if (id) userCache.delete(id);
};

const resolveUser = async (decoded) => {
  if (decoded.control) {
    return Control.getControlUser();
  }
  let cached = userCache.get(decoded.userId);
  if (!cached) {
    const user = await User.findById(decoded.userId);
    if (!user) return null;
    const settings = await Control.getSettings();
    const permission = (settings.permissions && settings.permissions[decoded.userId]) || {};
    cached = {
      id: user._id.toString(),
      username: user.username,
      email: user.email,
      isAdmin: !!user.isAdmin,
      settingsAccess: !!permission.pageAccess,
      scanOverride: !!permission.scanOverride,
      ts: Date.now(),
    };
    userCache.set(decoded.userId, cached);
  }
  return cached;
};

const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await resolveUser(decoded);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = auth;
module.exports.auth = auth;
module.exports.requireAdmin = requireAdmin;
module.exports.requireControl = requireControl;
module.exports.invalidateUser = invalidateUser;
module.exports.resolveUser = resolveUser;
