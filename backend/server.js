const express = require('express');
const path = require('path');
require('dotenv').config();
const createApp = require('./app');

const app = createApp({ enableRootHealthRoute: false });
const PORT = process.env.PORT || 8080;

/* 1️⃣ Serve static files FIRST */
app.use(express.static(path.join(__dirname, '../client/dist')));

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();

  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
