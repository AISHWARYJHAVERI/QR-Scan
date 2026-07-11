const { getDb } = require('./db');

const getTimeSlot = () => {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
};

const createScanCollection = async () => {
  const db = getDb();
  const exists = await db.listCollections({ name: 'scans' }).hasNext();
  if (!exists) {
    await db.createCollection('scans');
  }
  const scans = db.collection('scans');
  await scans.createIndex({ qrValue: 1, scannedBy: 1, timeSlot: 1 }, { unique: true });
  await scans.createIndex({ scannedBy: 1 });
  await scans.createIndex({ scannedAt: -1 });
  await scans.createIndex({ qrValue: 1 });
  return scans;
};

const { ObjectId } = require('mongodb');

const Scan = {
  async create({ qrValue, scannedBy }) {
    const scans = await createScanCollection();
    const timeSlot = getTimeSlot();
    const doc = {
      qrValue,
      scannedBy,
      timeSlot,
      scannedAt: new Date(),
    };
    const result = await scans.insertOne(doc);
    return { ...doc, _id: result.insertedId };
  },

  async findByQrAndSlot(qrValue, scannedBy, timeSlot) {
    const scans = await createScanCollection();
    return scans.findOne({ qrValue, scannedBy, timeSlot });
  },

  async findByUser(scannedBy) {
    const scans = await createScanCollection();
    return scans.find({ scannedBy }).sort({ scannedAt: -1 }).toArray();
  },

  async findAll({ page = 1, limit = 10, slot, q, sortBy = 'scannedAt', sortOrder = 'desc' } = {}) {
    const scans = await createScanCollection();
    const filter = {};
    if (slot && slot !== 'all') filter.timeSlot = slot;
    if (q) filter.qrValue = { $regex: q, $options: 'i' };

    const total = await scans.countDocuments(filter);
    const skip = (page - 1) * limit;
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const items = await scans.find(filter).sort(sort).skip(skip).limit(limit).toArray();
    return { scans: items, total, page, totalPages: Math.ceil(total / limit), limit };
  },

  async updateById(id, updates) {
    const scans = await createScanCollection();
    const setFields = {};
    if (updates.qrValue !== undefined) setFields.qrValue = updates.qrValue;
    if (updates.timeSlot !== undefined) setFields.timeSlot = updates.timeSlot;
    if (updates.scannedAt !== undefined) setFields.scannedAt = new Date(updates.scannedAt);
    return scans.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: setFields },
      { returnDocument: 'after' }
    );
  },

  async deleteById(id) {
    const scans = await createScanCollection();
    return scans.deleteOne({ _id: new ObjectId(id) });
  },

  async deleteAll() {
    const scans = await createScanCollection();
    const result = await scans.deleteMany({});
    return result.deletedCount;
  },

  async getAnalytics(scannedBy) {
    const scans = await createScanCollection();
    const all = await scans.find({ scannedBy }).toArray();
    const total = all.length;
    const bySlot = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    for (const s of all) {
      bySlot[s.timeSlot] = (bySlot[s.timeSlot] || 0) + 1;
    }
    const uniqueQRs = new Set(all.map(s => s.qrValue)).size;
    return { total, bySlot, uniqueQRs, scans: all };
  },

  async getGlobalAnalytics() {
    const scans = await createScanCollection();
    const all = await scans.find({}).toArray();
    const total = all.length;
    const bySlot = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    const scannedBySet = new Set();
    for (const s of all) {
      bySlot[s.timeSlot] = (bySlot[s.timeSlot] || 0) + 1;
      scannedBySet.add(s.scannedBy);
    }
    const uniqueQRs = new Set(all.map(s => s.qrValue)).size;
    return { total, bySlot, uniqueQRs, totalUsers: scannedBySet.size, scans: all };
  },
};

module.exports = { Scan, getTimeSlot };
