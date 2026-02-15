const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');
const Car = require('../models/Car');
const { uploadImageFromBuffer, deleteImageByPublicId } = require('../utils/cloudinaryImage');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const uploadsDir = path.resolve(__dirname, '..', '..', 'client', 'public', 'uploads');

const mimeByExtension = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const isLegacyUploadPath = (value) =>
  typeof value === 'string' && value.trim().toLowerCase().startsWith('/uploads/');

const resolveLegacyFilePath = (legacyImagePath) => {
  const filename = path.basename(String(legacyImagePath || ''));
  if (!filename) return null;
  return path.join(uploadsDir, filename);
};

const createUploadFileFromLegacyPath = async (legacyImagePath) => {
  const absolutePath = resolveLegacyFilePath(legacyImagePath);
  if (!absolutePath) return null;
  if (!fs.existsSync(absolutePath)) return null;

  const extension = path.extname(absolutePath).toLowerCase();
  const mimetype = mimeByExtension[extension];
  if (!mimetype) return null;

  const buffer = await fs.promises.readFile(absolutePath);
  return {
    originalname: path.basename(absolutePath),
    mimetype,
    buffer,
  };
};

const migrateUsers = async () => {
  const users = await User.find({
    image: { $regex: '^/uploads/', $options: 'i' },
  });

  let migrated = 0;
  let resetDefault = 0;
  let skipped = 0;

  for (const user of users) {
    const legacyImage = String(user.image || '');
    if (!isLegacyUploadPath(legacyImage)) {
      skipped += 1;
      continue;
    }

    if (legacyImage.endsWith('/user.png')) {
      user.image = '';
      user.imagePublicId = '';
      await user.save({ validateModifiedOnly: true });
      resetDefault += 1;
      continue;
    }

    const uploadFile = await createUploadFileFromLegacyPath(legacyImage);
    if (!uploadFile) {
      skipped += 1;
      continue;
    }

    const uploaded = await uploadImageFromBuffer(uploadFile, { folder: 'car-rental/users' });
    const oldPublicId = user.imagePublicId || '';

    user.image = uploaded.url;
    user.imagePublicId = uploaded.publicId;
    await user.save({ validateModifiedOnly: true });

    if (oldPublicId && oldPublicId !== uploaded.publicId) {
      try {
        await deleteImageByPublicId(oldPublicId);
      } catch (error) {
        console.error('Could not cleanup previous user cloud image:', oldPublicId, error.message);
      }
    }

    migrated += 1;
  }

  return { total: users.length, migrated, resetDefault, skipped };
};

const migrateCars = async () => {
  const cars = await Car.find({
    image: { $regex: '^/uploads/', $options: 'i' },
  });

  let migrated = 0;
  let skipped = 0;

  for (const car of cars) {
    const legacyImage = String(car.image || '');
    if (!isLegacyUploadPath(legacyImage)) {
      skipped += 1;
      continue;
    }

    const uploadFile = await createUploadFileFromLegacyPath(legacyImage);
    if (!uploadFile) {
      skipped += 1;
      continue;
    }

    const uploaded = await uploadImageFromBuffer(uploadFile, { folder: 'car-rental/cars' });
    const oldPublicId = car.imagePublicId || '';

    car.image = uploaded.url;
    car.imagePublicId = uploaded.publicId;
    await car.save();

    if (oldPublicId && oldPublicId !== uploaded.publicId) {
      try {
        await deleteImageByPublicId(oldPublicId);
      } catch (error) {
        console.error('Could not cleanup previous car cloud image:', oldPublicId, error.message);
      }
    }

    migrated += 1;
  }

  return { total: cars.length, migrated, skipped };
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required in environment');
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const userStats = await migrateUsers();
  const carStats = await migrateCars();

  console.log('User migration:', userStats);
  console.log('Car migration:', carStats);
};

main()
  .catch((error) => {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // ignore disconnect errors
    }
  });
