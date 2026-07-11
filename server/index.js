require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const path = require('path');
const cors = require('cors');
const { connectDb, closeDb } = require('./models/db');
const authRoutes = require('./routes/auth');
const scanRoutes = require('./routes/scans');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check before DB (no DB required)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', env: { hasMongo: !!process.env.MONGODB_URI, hasJwt: !!process.env.JWT_SECRET } });
});

// Connect DB on first request (for serverless)
app.use(async (req, res, next) => {
  if (req.path === '/api/health') return next();
  try {
    await connectDb(process.env.MONGODB_URI);
    next();
  } catch (err) {
    console.error('DB connection error:', err.message);
    res.status(500).json({ error: 'Database connection failed', detail: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/admin', adminRoutes);

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

const cron = require('node-cron');
const { getDb } = require('./models/db');

// Schedule a daily task running at midnight (00:00) to clear scans older than 30 days
cron.schedule('0 0 * * *', async () => {
  console.log('⏰ Running daily cleanup job: Clearing scans older than 30 days...');
  try {
    const db = getDb();
    if (!db) {
      console.warn('⚠️ Cleanup skipped: Database not connected');
      return;
    }
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const result = await db.collection('scans').deleteMany({
      scannedAt: { $lt: thirtyDaysAgo }
    });
    console.log(`✅ Cleanup complete: Removed ${result.deletedCount} old scans.`);
  } catch (err) {
    console.error('❌ Daily cleanup cron job failed:', err.message);
  }
});

const start = async () => {
  try {
    await connectDb(process.env.MONGODB_URI);
    app.listen(PORT, () => {
      console.log('Server running on port ' + PORT);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

process.on('SIGINT', async () => {
  await closeDb();
  process.exit();
});

if (require.main === module) {
  start();
}

module.exports = app;
