const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const createApp = require("./app");

const PORT = Number(process.env.PORT || 5000);
const app = createApp({ enableRootHealthRoute: true });
const express = require("express");
const path = require("path");

// Serve React build files
app.use(express.static(path.resolve(__dirname, "../client/dist")));

// Handle SPA routing
app.get("*", (req, res) => {
  res.sendFile(path.resolve(__dirname, "../client/dist/index.html"));
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
