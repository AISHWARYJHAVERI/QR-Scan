const { getDb } = require('./db');
const { ObjectId } = require('mongodb');

let _collection = null;
let _indexesEnsured = false;

async function getCollection() {
  if (_collection) return _collection;
  const db = getDb();
  _collection = db.collection('scans');
  if (!_indexesEnsured) {
    await _collection.createIndex({ qrValue: 1, scannedBy: 1, timeSlot: 1 }, { unique: true });
    await _collection.createIndex({ scannedBy: 1 });
    await _collection.createIndex({ scannedAt: -1 });
    await _collection.createIndex({ qrValue: 1 });
    _indexesEnsured = true;
  }
  return _collection;
}

const getTimeSlot = () => {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
};

const Scan = {
  async create({ qrValue, scannedBy }) {
    const scans = await getCollection();
    const timeSlot = getTimeSlot();
    const doc = { qrValue, scannedBy, timeSlot, scannedAt: new Date() };
    const result = await scans.insertOne(doc);
    return { ...doc, _id: result.insertedId };
  },

  async findByQrAndSlot(qrValue, scannedBy, timeSlot) {
    const scans = await getCollection();
    return scans.findOne({ qrValue, scannedBy, timeSlot });
  },

  async findByUser(scannedBy) {
    const scans = await getCollection();
    return scans.find({ scannedBy }).sort({ scannedAt: -1 }).toArray();
  },

  async findAll({ page = 1, limit = 10, slot, q, sortBy = 'scannedAt', sortOrder = 'desc' } = {}) {
    const scans = await getCollection();
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
    const scans = await getCollection();
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
    const scans = await getCollection();
    return scans.deleteOne({ _id: new ObjectId(id) });
  },

  async deleteAll() {
    const scans = await getCollection();
    const result = await scans.deleteMany({});
    return result.deletedCount;
  },

  async getAnalytics(scannedBy) {
    const scans = await getCollection();
    const [stats] = await scans.aggregate([
      { $match: { scannedBy } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          morning: { $sum: { $cond: [{ $eq: ['$timeSlot', 'morning'] }, 1, 0] } },
          afternoon: { $sum: { $cond: [{ $eq: ['$timeSlot', 'afternoon'] }, 1, 0] } },
          evening: { $sum: { $cond: [{ $eq: ['$timeSlot', 'evening'] }, 1, 0] } },
          night: { $sum: { $cond: [{ $eq: ['$timeSlot', 'night'] }, 1, 0] } },
          uniqueQRs: { $addToSet: '$qrValue' },
        },
      },
    ]).toArray();
    if (!stats) return { total: 0, bySlot: { morning: 0, afternoon: 0, evening: 0, night: 0 }, uniqueQRs: 0 };
    return {
      total: stats.total,
      bySlot: { morning: stats.morning, afternoon: stats.afternoon, evening: stats.evening, night: stats.night },
      uniqueQRs: stats.uniqueQRs.length,
    };
  },

  async getGlobalAnalytics() {
    const scans = await getCollection();
    const [stats] = await scans.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          morning: { $sum: { $cond: [{ $eq: ['$timeSlot', 'morning'] }, 1, 0] } },
          afternoon: { $sum: { $cond: [{ $eq: ['$timeSlot', 'afternoon'] }, 1, 0] } },
          evening: { $sum: { $cond: [{ $eq: ['$timeSlot', 'evening'] }, 1, 0] } },
          night: { $sum: { $cond: [{ $eq: ['$timeSlot', 'night'] }, 1, 0] } },
          uniqueQRs: { $addToSet: '$qrValue' },
          uniqueScannedBy: { $addToSet: '$scannedBy' },
        },
      },
    ]).toArray();
    if (!stats) return { total: 0, bySlot: { morning: 0, afternoon: 0, evening: 0, night: 0 }, uniqueQRs: 0, totalUsers: 0 };
    return {
      total: stats.total,
      bySlot: { morning: stats.morning, afternoon: stats.afternoon, evening: stats.evening, night: stats.night },
      uniqueQRs: stats.uniqueQRs.length,
      totalUsers: stats.uniqueScannedBy.length,
    };
  },
};

module.exports = { Scan, getTimeSlot };
