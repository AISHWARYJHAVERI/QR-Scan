const { getDb } = require('./db');

const createUserCollection = async () => {
  const db = getDb();
  const exists = await db.listCollections({ name: 'users' }).hasNext();
  if (!exists) {
    await db.createCollection('users');
  }
  const users = db.collection('users');
  await users.createIndex({ email: 1 }, { unique: true });
  await users.createIndex({ username: 1 }, { unique: true });
  return users;
};

const User = {
  async create({ username, email, password, isAdmin = true }) {
    const users = await createUserCollection();
    const doc = {
      username,
      email,
      password,
      isAdmin,
      createdAt: new Date(),
    };
    const result = await users.insertOne(doc);
    return { ...doc, _id: result.insertedId };
  },

  async findByEmail(email) {
    const users = await createUserCollection();
    return users.findOne({ email });
  },

  async findById(id) {
    const { ObjectId } = require('mongodb');
    const users = await createUserCollection();
    return users.findOne({ _id: new ObjectId(id) });
  },

  async findAll() {
    const users = await createUserCollection();
    return users.find().sort({ createdAt: -1 }).toArray();
  },

  async deleteById(id) {
    const { ObjectId } = require('mongodb');
    const users = await createUserCollection();
    return users.deleteOne({ _id: new ObjectId(id) });
  },
};

module.exports = User;
