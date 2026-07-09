const app = require('../server/index');
const { connectDb } = require('../server/models/db');

let cachedDb = null;

module.exports = async (req, res) => {
  if (!cachedDb) {
    try {
      cachedDb = await connectDb(process.env.MONGODB_URI);
    } catch (err) {
      console.error('DB connect error:', err);
    }
  }
  return app(req, res);
};
