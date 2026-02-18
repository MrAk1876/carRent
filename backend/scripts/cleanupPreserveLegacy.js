const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SEEDED_EMAIL_REGEX = /(@staff\.carrent\.com|@users\.carrent\.com)$/i;
const COLLECTIONS_TO_CLEAR = [
  'bookings',
  'requests',
  'offers',
  'reviews',
  'drivers',
  'maintenances',
  'subscriptionplans',
  'usersubscriptions',
  'auditlogs',
  'contactmessages',
];
const STAFF_ROLES = new Set(['BranchAdmin', 'FleetManager', 'FinanceManager', 'SupportStaff']);

const getCount = async (db, collectionName) => {
  const exists = await db.listCollections({ name: collectionName }).toArray();
  if (!exists.length) return 0;
  return db.collection(collectionName).countDocuments();
};

const getMainBranch = async (db) => {
  const branchByCode = await db.collection('branches').findOne({ branchCode: 'MAIN' });
  if (branchByCode) return branchByCode;

  const [largestBranch] = await db
    .collection('cars')
    .aggregate([
      { $group: { _id: '$branchId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
      {
        $lookup: {
          from: 'branches',
          localField: '_id',
          foreignField: '_id',
          as: 'branch',
        },
      },
      { $unwind: '$branch' },
      { $replaceRoot: { newRoot: '$branch' } },
    ])
    .toArray();

  return largestBranch || null;
};

const summarizeCounts = async (db) => {
  const names = ['tenants', 'branches', 'cars', 'users', ...COLLECTIONS_TO_CLEAR];
  const summary = {};
  for (const name of names) {
    summary[name] = await getCount(db, name);
  }
  return summary;
};

const printSummary = (title, summary) => {
  console.log(`\n${title}`);
  Object.entries(summary).forEach(([name, count]) => {
    console.log(`- ${name}: ${count}`);
  });
};

const main = async () => {
  const shouldApply = process.argv.includes('--apply');

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing in backend/.env');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  try {
    const before = await summarizeCounts(db);
    printSummary('Current Atlas Counts', before);

    const mainBranch = await getMainBranch(db);
    if (!mainBranch?._id) {
      throw new Error('Unable to find a branch to preserve.');
    }

    const carsInMainBranch = await db
      .collection('cars')
      .find({ branchId: mainBranch._id }, { projection: { _id: 1 } })
      .toArray();
    const preserveCarIds = carsInMainBranch.map((item) => item._id);

    const allUsers = await db
      .collection('users')
      .find({}, { projection: { _id: 1, email: 1, role: 1 } })
      .toArray();
    const preserveUsers = allUsers.filter((user) => !SEEDED_EMAIL_REGEX.test(String(user.email || '').trim()));
    const preserveUserIds = preserveUsers.map((user) => user._id);

    console.log('\nPreservation Plan');
    console.log(`- Main Branch: ${mainBranch.branchName} (${String(mainBranch._id)})`);
    console.log(`- Cars to keep: ${preserveCarIds.length}`);
    console.log(`- Users to keep: ${preserveUserIds.length}`);
    console.log(`- Users kept: ${preserveUsers.map((u) => u.email).join(', ')}`);

    if (!shouldApply) {
      console.log('\nDry run complete. Re-run with --apply to execute cleanup.');
      return;
    }

    const deletionReport = {};

    for (const collectionName of COLLECTIONS_TO_CLEAR) {
      const exists = await db.listCollections({ name: collectionName }).toArray();
      if (!exists.length) {
        deletionReport[collectionName] = 0;
        continue;
      }
      const result = await db.collection(collectionName).deleteMany({});
      deletionReport[collectionName] = result.deletedCount || 0;
    }

    const branchDeleteResult = await db.collection('branches').deleteMany({ _id: { $ne: mainBranch._id } });
    deletionReport.branches = branchDeleteResult.deletedCount || 0;

    const carsDeleteResult = await db.collection('cars').deleteMany({ _id: { $nin: preserveCarIds } });
    deletionReport.cars = carsDeleteResult.deletedCount || 0;

    const usersDeleteResult = await db.collection('users').deleteMany({ _id: { $nin: preserveUserIds } });
    deletionReport.users = usersDeleteResult.deletedCount || 0;

    await db.collection('branches').updateOne(
      { _id: mainBranch._id },
      {
        $set: {
          isActive: true,
          branchCode: 'MAIN',
          branchName: mainBranch.branchName || 'Main Branch',
        },
      },
    );

    await db.collection('users').updateMany(
      {
        _id: { $in: preserveUserIds },
        role: { $in: Array.from(STAFF_ROLES) },
      },
      { $set: { assignedBranches: [mainBranch._id] } },
    );

    const after = await summarizeCounts(db);

    printSummary('Deletion Report', deletionReport);
    printSummary('Final Atlas Counts', after);
    console.log('\nCleanup finished successfully.');
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error('cleanupPreserveLegacy failed:', error.message);
  process.exitCode = 1;
});
