# Analytics Speed Fix Plan

## Problem
Analytics dashboard takes 10+ seconds to load because:
1. `createScanCollection()` runs on every API call — checks collection existence + creates 4 MongoDB indexes
2. `getGlobalAnalytics()` loads ALL scan documents into JavaScript memory via `find({}).toArray()`

## Solution
One file change: `server/models/Scan.js`

### Changes to make:

#### 1. Replace `createScanCollection()` with cached `getCollection()`

**Remove** (lines 11-23):
```js
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
```

**Replace with** (place after `const { ObjectId } = require('mongodb');`):
```js
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
```

#### 2. Replace all `createScanCollection()` calls with `getCollection()`

Every instance of `const scans = await createScanCollection();` → `const scans = await getCollection();`

#### 3. Add `const { ObjectId } = require('mongodb');` at top (move from inside methods)

Move the `ObjectId` require to the top of the file, near the other imports.

#### 4. Rewrite `getAnalytics(scannedBy)` — use aggregation

**Replace** (lines 90-100):
```js
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

    if (!stats) {
      return { total: 0, bySlot: { morning: 0, afternoon: 0, evening: 0, night: 0 }, uniqueQRs: 0 };
    }

    return {
      total: stats.total,
      bySlot: { morning: stats.morning, afternoon: stats.afternoon, evening: stats.evening, night: stats.night },
      uniqueQRs: stats.uniqueQRs.length,
    };
  },
```

#### 5. Rewrite `getGlobalAnalytics()` — use aggregation

**Replace** (lines 102-114):
```js
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

    if (!stats) {
      return {
        total: 0,
        bySlot: { morning: 0, afternoon: 0, evening: 0, night: 0 },
        uniqueQRs: 0,
        totalUsers: 0,
      };
    }

    return {
      total: stats.total,
      bySlot: { morning: stats.morning, afternoon: stats.afternoon, evening: stats.evening, night: stats.night },
      uniqueQRs: stats.uniqueQRs.length,
      totalUsers: stats.uniqueScannedBy.length,
    };
  },
```

## What NOT to change
- `main/index.html` — frontend code stays exactly the same
- `server/routes/scans.js` — routes stay the same, API contract unchanged
- `server/index.js` — server setup unchanged
- Any other file

## After applying the change
1. Run `node server/index.js` to test locally
2. Or push to Vercel (git add → commit → push)
3. Analytics should load in <500ms instead of 10+ seconds
