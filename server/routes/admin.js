const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const { Scan } = require('../models/Scan');

const router = express.Router();

// GET /admin/users — list all users
router.get('/users', auth, async (req, res) => {
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

// DELETE /admin/users/:id — delete a user + their scans
router.delete('/users/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Delete all scans by this user
    const { getDb } = require('../models/db');
    const db = getDb();
    await db.collection('scans').deleteMany({ scannedBy: req.params.id });

    await User.deleteById(req.params.id);
    res.json({ message: 'User and their scans deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/stats — system-wide stats
router.get('/stats', auth, async (req, res) => {
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
