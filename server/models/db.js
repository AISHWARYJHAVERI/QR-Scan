const dns = require('dns');
const { MongoClient, ServerApiVersion } = require('mongodb');

dns.setServers(['8.8.8.8', '8.8.4.4']);

let client = null;
let db = null;

const connectDb = async (uri) => {
  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  await client.connect();
  db = client.db('qr_scanner');
  await db.command({ ping: 1 });
  console.log('Connected to MongoDB');
  return db;
};

const getDb = () => {
  if (!db) throw new Error('Database not connected');
  return db;
};

const closeDb = async () => {
  if (client) await client.close();
};

module.exports = { connectDb, getDb, closeDb };
