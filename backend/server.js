const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const createApp = require('./app');

const PORT = Number(process.env.PORT || 5000);
const isProduction = process.env.NODE_ENV === 'production';
const distPath = path.join(__dirname, '../client/dist');

const app = express();
const apiApp = createApp({ enableRootHealthRoute: !isProduction });
const serveClientBuild = express.static(distPath);

app.disable('x-powered-by');
app.set('trust proxy', 1);

// 1) CORS + body parsing + API routes are registered inside createApp().
app.use(apiApp);

// 2) Serve built frontend assets and do not let static handling override /api routes.
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  return serveClientBuild(req, res, next);
});

// 3) Express 5-safe SPA fallback using middleware instead of wildcard route strings.
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }
  return res.sendFile(path.join(distPath, 'index.html'));
});

// 4) Final error handler.
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode =
    Number.isInteger(err?.status) ? err.status : Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  const message = statusCode >= 500 ? 'Internal server error' : err?.message || 'Request failed';

  return res.status(statusCode).json({ message });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
