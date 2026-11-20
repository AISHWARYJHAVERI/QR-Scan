const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Control = require('../models/Control');
const auth = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password required' });
    }
    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, password: hashed });
    const token = jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user._id, username: user.username, email: user.email, isAdmin: !!user.isAdmin } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const identifier = String(req.body.email || req.body.username || '').trim();
    const password = req.body.password;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Username/email and password required' });
    }

    // Control-page credentials are checked first. A wrong password falls through
    // to the normal user database (so another account can share the same username).
    if (identifier.toLowerCase() === Control.username.toLowerCase()
      && await Control.verifyCredentials(identifier, password)) {
      const token = jwt.sign({ userId: 'control', control: true }, process.env.JWT_SECRET, { expiresIn: '7d' });
      return res.json({
        token,
        user: { id: 'control', username: Control.username, isAdmin: true, settingsAccess: true },
        redirect: '/control.html',
      });
    }

    const user = await User.findByEmail(identifier) || await User.findByUsername(identifier);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const settings = await Control.getSettings();
    const permission = (settings.permissions && settings.permissions[user._id.toString()]) || {};
    const token = jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: !!user.isAdmin,
        settingsAccess: !!permission.pageAccess,
      },
      redirect: null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', auth, async (req, res) => {
  res.json({ user: req.user });
});

router.put('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const user = await User.findById(req.user.id);
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    const { getDb } = require('../models/db');
    const { ObjectId } = require('mongodb');
    const db = getDb();
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: { password: hashed } }
    );
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
