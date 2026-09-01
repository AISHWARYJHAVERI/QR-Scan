const express = require('express');
const middleware = require('../middleware/auth');
const User = require('../models/User');
const { Scan } = require('../models/Scan');

const router = express.Router();
const auth = middleware.auth;
const requireAdmin = middleware.requireAdmin;
const invalidateUser = middleware.invalidateUser;

// GET /admin/users — list all users (admin only)
router.get('/users', auth, requireAdmin, async (req, res) => {
  try {
    const users = await User.findAll();
    const usersWithCounts = await Promise.all(users.map(async (u) => {
      const analytics = await Scan.getAnalytics(u._id.toString());
      return {
        id: u._id,
        username: u.username,
        email: u.email,
        isAdmin: u.isAdmin || false,
        createdAt: u.createdAt,
        scanCount: analytics.total,
      };
    }));
    res.json({ users: usersWithCounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/users/:id — delete a user + their scans (admin only)
router.delete('/users/:id', auth, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Delete all scans by this user
    const { getDb } = require('../models/db');
    const db = getDb();
    await db.collection('scans').deleteMany({ scannedBy: req.params.id });

    await User.deleteById(req.params.id);
    invalidateUser(req.params.id);
    res.json({ message: 'User and their scans deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/users/:id — grant or revoke admin access (admin only)
router.put('/users/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { isAdmin } = req.body;
    if (typeof isAdmin !== 'boolean') {
      return res.status(400).json({ error: 'isAdmin boolean required' });
    }
    if (req.params.id === req.user.id && !isAdmin) {
      return res.status(400).json({ error: 'You cannot remove your own admin access' });
    }
    const { getDb } = require('../models/db');
    const { ObjectId } = require('mongodb');
    const db = getDb();
    const result = await db.collection('users').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { isAdmin } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'User not found' });
    invalidateUser(req.params.id);
    res.json({ message: `Admin access ${isAdmin ? 'granted' : 'revoked'}`, id: req.params.id, isAdmin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/stats — system-wide stats (admin only)
router.get('/stats', auth, requireAdmin, async (req, res) => {
  try {
    const users = await User.findAll();
    const analytics = await Scan.getGlobalAnalytics();
    res.json({
      totalUsers: users.length,
      totalScans: analytics.total,
      uniqueQRs: analytics.uniqueQRs,
      bySlot: analytics.bySlot,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
