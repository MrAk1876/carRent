const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const express = require("express");
const createApp = require("./app");

const PORT = Number(process.env.PORT || 5000);
const app = createApp({ enableRootHealthRoute: true });

// 🔥 Serve React build folder
app.use(express.static(path.join(__dirname, "../client/dist")));

// 🔥 SPA fallback (IMPORTANT)
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
