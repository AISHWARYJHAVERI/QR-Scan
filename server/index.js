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

app.use('/api/auth', authRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
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
