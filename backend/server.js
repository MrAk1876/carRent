const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const createApp = require('./app');
const express = require('express');

const PORT = Number(process.env.PORT || 5000);
const app = createApp({ enableRootHealthRoute: false });

const distPath = path.resolve(__dirname, '../client/dist');

// Serve static files first
app.use(express.static(distPath));

// SPA fallback (Express 5 safe — no wildcard)
app.use((req, res, next) => {
  // If request starts with /api → let API handle it
  if (req.path.startsWith('/api')) {
    return next();
  }

  // If it looks like a file request (.js, .css, .png, etc.) → skip
  if (req.path.includes('.')) {
    return next();
  }

  // Otherwise serve React index.html
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
