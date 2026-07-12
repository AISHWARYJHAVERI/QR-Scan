const jwt = require('jsonwebtoken');
const User = require('../models/User');

const userCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of userCache) {
    if (now - entry.ts > CACHE_TTL) userCache.delete(id);
  }
}, 60 * 1000).unref();

const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    let cached = userCache.get(decoded.userId);
    if (!cached) {
      const user = await User.findById(decoded.userId);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      cached = { id: user._id.toString(), username: user.username, email: user.email, isAdmin: user.isAdmin || false };
      userCache.set(decoded.userId, { ...cached, ts: Date.now() });
    }
    req.user = cached;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = auth;
