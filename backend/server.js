const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const createApp = require('./app');

const PORT = Number(process.env.PORT || 5000);

const app = express();

// 1️⃣ Mount API app under /api
app.use('/api', createApp({ enableRootHealthRoute: false }));

// 2️⃣ Serve React build
const distPath = path.resolve(__dirname, '../client/dist');
app.use(express.static(distPath));

// 3️⃣ SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
