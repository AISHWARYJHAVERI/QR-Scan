const dns = require('dns');
const { MongoClient } = require('mongodb');

dns.setServers(['8.8.8.8', '8.8.4.4']);

let client = null;
let db = null;
let connecting = null;

const connectDb = async (uri) => {
  if (db) return db;
  if (connecting) return connecting;
  connecting = (async () => {
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      retryWrites: true,
    });
    await client.connect();
    db = client.db('qr_scanner');
    await db.command({ ping: 1 });
    console.log('Connected to MongoDB');
    return db;
  })();
  return connecting;
};

const getDb = () => {
  if (!db) throw new Error('Database not connected');
  return db;
};

const closeDb = async () => {
  if (client) await client.close();
};

module.exports = { connectDb, getDb, closeDb };
