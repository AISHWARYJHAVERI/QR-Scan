const app = require('../server/index');

module.exports = async (req, res) => {
  try {
    await app(req, res);
  } catch (err) {
    console.error('Serverless handler error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
  }
};
