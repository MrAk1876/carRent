const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const Branch = require('../models/Branch');
const { ensureDefaultTenant } = require('../services/tenantService');
const { ensureMainBranch } = require('../services/branchService');

const BRANCH_STATES = [
  {
    state: 'Maharashtra',
    cities: ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Aurangabad'],
    address: 'Andheri East, Mumbai',
    contactNumber: '+91-22-4000-2001',
  },
  {
    state: 'Karnataka',
    cities: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Belagavi'],
    address: 'Indiranagar, Bengaluru',
    contactNumber: '+91-80-4000-3001',
  },
  {
    state: 'Rajasthan',
    cities: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer'],
    address: 'C-Scheme, Jaipur',
    contactNumber: '+91-141-4000-4001',
  },
  {
    state: 'Uttar Pradesh',
    cities: ['Lucknow', 'Kanpur', 'Noida', 'Varanasi', 'Agra'],
    address: 'Hazratganj, Lucknow',
    contactNumber: '+91-522-4000-5001',
  },
];

const toBranchCode = (value = '') =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_-]/g, '');

const normalizeCityList = (cities = []) =>
  [...new Set((Array.isArray(cities) ? cities : []).map((city) => String(city || '').trim()).filter(Boolean))];

const GUJARAT_CITIES = ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Gandhinagar'];

const moveBranchReferences = async (db, fromBranchId, toBranchId) => {
  const collectionsWithBranchId = [
    'cars',
    'drivers',
    'bookings',
    'requests',
    'subscriptionplans',
    'usersubscriptions',
  ];

  for (const name of collectionsWithBranchId) {
    const exists = await db.listCollections({ name }).toArray();
    if (!exists.length) continue;
    await db.collection(name).updateMany({ branchId: fromBranchId }, { $set: { branchId: toBranchId } });
  }

  const usersExists = await db.listCollections({ name: 'users' }).toArray();
  if (usersExists.length) {
    const fromId = String(fromBranchId);
    const toId = String(toBranchId);
    const cursor = db.collection('users').find({ assignedBranches: fromId }, { projection: { _id: 1, assignedBranches: 1 } });
    for await (const user of cursor) {
      const nextBranches = [...new Set((user.assignedBranches || []).map(String).map((id) => (id === fromId ? toId : id)))];
      await db.collection('users').updateOne({ _id: user._id }, { $set: { assignedBranches: nextBranches } });
    }
  }
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing in backend/.env');
  }

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const tenant = await ensureDefaultTenant();
    const tenantId = tenant?._id || null;
    if (!tenantId) {
      throw new Error('Default tenant not found');
    }

    const mainBranch = await ensureMainBranch();
    if (!mainBranch?._id) {
      throw new Error('Main branch not found');
    }

    mainBranch.state = 'Gujarat';
    mainBranch.city = GUJARAT_CITIES[0];
    mainBranch.serviceCities = [...GUJARAT_CITIES];
    mainBranch.isActive = true;
    await mainBranch.save({ validateModifiedOnly: true });

    const duplicateGujaratBranches = await Branch.find({
      tenantId,
      _id: { $ne: mainBranch._id },
      $or: [{ branchCode: 'GUJARAT' }, { branchName: 'Gujarat' }, { state: 'Gujarat' }],
    })
      .setOptions({ skipTenantFilter: true })
      .lean();

    for (const duplicate of duplicateGujaratBranches) {
      await moveBranchReferences(mongoose.connection.db, duplicate._id, mainBranch._id);
      await Branch.deleteOne({ _id: duplicate._id }).setOptions({ skipTenantFilter: true });
    }

    let created = 0;
    let updated = 0;

    for (const entry of BRANCH_STATES) {
      const branchName = entry.state;
      const branchCode = toBranchCode(entry.state);
      const serviceCities = normalizeCityList(entry.cities).slice(0, 5);
      const city = serviceCities[0] || '';

      let branch = await Branch.findOne({ tenantId, branchCode }).setOptions({ skipTenantFilter: true });
      if (!branch) {
        branch = await Branch.findOne({ tenantId, branchName }).setOptions({ skipTenantFilter: true });
      }

      if (!branch) {
        await Branch.create({
          tenantId,
          branchName,
          branchCode,
          state: entry.state,
          city,
          serviceCities,
          address: entry.address,
          contactNumber: entry.contactNumber,
          isActive: true,
        });
        created += 1;
      } else {
        branch.branchName = branchName;
        branch.branchCode = branchCode;
        branch.state = entry.state;
        branch.city = city;
        branch.serviceCities = serviceCities;
        branch.address = entry.address;
        branch.contactNumber = entry.contactNumber;
        branch.isActive = true;
        await branch.save({ validateModifiedOnly: true });
        updated += 1;
      }
    }

    const stateBranches = await Branch.find({
      tenantId,
      state: { $in: ['Gujarat', ...BRANCH_STATES.map((entry) => entry.state)] },
    })
      .setOptions({ skipTenantFilter: true })
      .sort({ state: 1 })
      .lean();

    console.log('State branch setup completed (Gujarat on Main Branch).');
    console.log(`Created: ${created}, Updated: ${updated}`);
    stateBranches.forEach((branch) => {
      const cities = normalizeCityList(branch.serviceCities).join(', ');
      console.log(`- ${branch.branchName} [${branch.branchCode}] -> ${cities}`);
    });
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error('ensureFiveStateBranches failed:', error.message);
  process.exit(1);
});
