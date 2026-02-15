const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const createApp = require('./app');
const express = require('express');

const PORT = Number(process.env.PORT || 5000);
const app = createApp({ enableRootHealthRoute: false });

const distPath = path.resolve(__dirname, '../client/dist');

// Serve static files
app.use(express.static(distPath));

// SPA fallback (only if file not found)
app.get('/*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
