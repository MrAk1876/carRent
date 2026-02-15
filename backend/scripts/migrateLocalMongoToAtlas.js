const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const DEFAULT_LOCAL_URI = "mongodb://localhost:27017/car_rental";
const sourceUri = String(process.env.LOCAL_MONGO_URI || DEFAULT_LOCAL_URI).trim();
const targetUri = String(process.env.MONGO_URI || "").trim();
const shouldClearDestination =
  String(process.env.CLEAR_ATLAS_BEFORE_MIGRATE || "").toLowerCase() === "true";

const ensureUris = () => {
  if (!sourceUri) {
    throw new Error("LOCAL_MONGO_URI is missing");
  }
  if (!targetUri) {
    throw new Error("MONGO_URI is missing");
  }
  if (sourceUri === targetUri) {
    throw new Error("Source and target Mongo URIs are identical. Aborting migration.");
  }
  if (
    targetUri.includes("<db_username>") ||
    targetUri.includes("<db_password>") ||
    targetUri.includes("<cluster-url>")
  ) {
    throw new Error("MONGO_URI still contains placeholders.");
  }
};

const migrateCollection = async (sourceDb, targetDb, collectionName) => {
  const sourceCollection = sourceDb.collection(collectionName);
  const targetCollection = targetDb.collection(collectionName);

  const docs = await sourceCollection.find({}).toArray();
  if (docs.length === 0) {
    return { collectionName, sourceCount: 0, migrated: 0 };
  }

  if (shouldClearDestination) {
    await targetCollection.deleteMany({});
  }

  const operations = docs.map((doc) => ({
    replaceOne: {
      filter: { _id: doc._id },
      replacement: doc,
      upsert: true,
    },
  }));

  await targetCollection.bulkWrite(operations, { ordered: false });
  return { collectionName, sourceCount: docs.length, migrated: docs.length };
};

const main = async () => {
  ensureUris();

  const sourceConnection = await mongoose.createConnection(sourceUri).asPromise();
  const targetConnection = await mongoose.createConnection(targetUri).asPromise();

  try {
    const sourceDb = sourceConnection.db;
    const targetDb = targetConnection.db;

    const collections = await sourceDb
      .listCollections({}, { nameOnly: true })
      .toArray();

    if (!collections.length) {
      console.log("No collections found in source database.");
      return;
    }

    const migrationSummary = [];
    for (const { name } of collections) {
      const result = await migrateCollection(sourceDb, targetDb, name);
      migrationSummary.push(result);
      console.log(
        `[${name}] source=${result.sourceCount} migrated=${result.migrated}`
      );
    }

    const totalMigrated = migrationSummary.reduce(
      (sum, item) => sum + item.migrated,
      0
    );
    console.log(`Migration completed. Total documents migrated: ${totalMigrated}`);
  } finally {
    await sourceConnection.close();
    await targetConnection.close();
  }
};

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});

