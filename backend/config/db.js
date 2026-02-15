const mongoose = require("mongoose");

const getMongoUri = () => {
  const uri = String(process.env.MONGO_URI || "").trim();
  if (!uri) {
    throw new Error("MONGO_URI is not configured");
  }

  const looksLikePlaceholder =
    uri.includes("<db_username>") ||
    uri.includes("<db_password>") ||
    uri.includes("<cluster-url>");

  if (looksLikePlaceholder) {
    throw new Error("MONGO_URI still contains Atlas placeholders. Replace them with real values.");
  }

  return uri;
};

const connectDB = async () => {
  try {
    const mongoUri = getMongoUri();
    const serverSelectionTimeoutMS = Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000);
    const socketTimeoutMS = Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000);

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS,
      socketTimeoutMS,
    });

    console.log("MongoDB Connected Successfully");
  } catch (error) {
    const isAtlasUri = String(process.env.MONGO_URI || "").startsWith("mongodb+srv://");
    if (isAtlasUri) {
      console.error(
        "MongoDB Connection Failed:",
        `${error.message}. Verify Atlas username/password, database user permissions, and Network Access IP allowlist.`
      );
    } else {
      console.error("MongoDB Connection Failed:", error.message);
    }
    process.exit(1);
  }
};

module.exports = connectDB;
