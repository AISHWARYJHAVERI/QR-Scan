const express = require('express');
const User = require('../models/User');
const Control = require('../models/Control');
const { auth, requireControl, invalidateUser } = require('../middleware/auth');

const router = express.Router();

router.use(auth);

// GET /control/settings — settings, account info and admin permission list
router.get('/settings', requireControl, async (req, res) => {
  try {
    const settings = await Control.getSettings();
    const users = await User.findAll();
    const permissions = settings.permissions || {};
    const admins = users.filter(u => u.isAdmin).map(u => ({
      id: u._id.toString(),
      username: u.username,
      email: u.email,
      scanOverride: !!(permissions[u._id.toString()] || {}).scanOverride,
      pageAccess: !!(permissions[u._id.toString()] || {}).pageAccess,
    }));
    res.json({
      settings: {
        enabled: !!settings.enabled,
        startDate: settings.startDate,
        endDate: settings.endDate,
        slots: settings.slots,
        timezone: Control.timezone,
        permissionMode: settings.permissionMode || 'common-only',
      },
      account: { username: Control.username, passwordMasked: '••••••••' },
      admins,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /control/settings — update the scan window and per-admin permissions
router.put('/settings', requireControl, async (req, res) => {
  try {
    const { settings: incoming, permissions } = req.body || {};
    const patch = incoming || {};
    if (permissions && typeof permissions === 'object') {
      const normalized = {};
      for (const [id, value] of Object.entries(permissions)) {
        normalized[id] = {
          scanOverride: !!(value && value.scanOverride),
          pageAccess: !!(value && value.pageAccess),
        };
        invalidateUser(id);
      }
      patch.permissions = normalized;
    }
    const updated = await Control.updateSettings(patch);
    res.json({ settings: updated, message: 'Settings saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /control/password — set a new control-page password (no current password required)
router.put('/password', requireControl, async (req, res) => {
  try {
    const newPassword = req.body && req.body.newPassword;
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    if (req.body.confirmPassword && req.body.confirmPassword !== newPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    await Control.setPassword(newPassword);
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
