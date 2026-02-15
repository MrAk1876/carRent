const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const createApp = require('./app');
const express = require('express');

const PORT = Number(process.env.PORT || 5000);
const app = createApp({ enableRootHealthRoute: true });

// Serve React build
app.use(express.static(path.resolve(__dirname, '../client/dist')));

// SPA fallback (Express 5 safe)
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api')) {
    return next();
  }

  res.sendFile(path.resolve(__dirname, '../client/dist/index.html'));
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
