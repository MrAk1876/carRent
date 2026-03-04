const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const mongoose = require('mongoose');
const createApp = require('./app');
const { stopReminderScheduler } = require('./services/reminderSchedulerService');
const { initializeSocketServer, closeSocketServer } = require('./socket');

const PORT = Number(process.env.PORT || 5000);
const isProduction = process.env.NODE_ENV === 'production';
const distPath = path.join(__dirname, '../client/dist');

const app = express();
const apiApp = createApp({ enableRootHealthRoute: false });
const serveClientBuild = express.static(distPath);

app.disable('x-powered-by');
app.set('trust proxy', 1);

// 1) CORS + body parsing + API routes are registered inside createApp().
app.use(apiApp);

if (isProduction) {
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
}

// 4) Final error handler.
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (String(err?.name || '') === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'Image size must be 5MB or less' });
    }
    return res.status(422).json({ message: err?.message || 'Invalid image upload request' });
  }

  const statusCode =
    Number.isInteger(err?.status) ? err.status : Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  const message = statusCode >= 500 ? 'Internal server error' : err?.message || 'Request failed';

  return res.status(statusCode).json({ message });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
initializeSocketServer(server);

let shuttingDown = false;

const gracefulShutdown = async (signal, onComplete = null) => {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    console.log(`[shutdown] ${signal} received, closing services...`);
    stopReminderScheduler();
  } catch (error) {
    console.error('[shutdown] reminder scheduler stop failed:', error?.message || error);
  }

  try {
    await closeSocketServer();
  } catch (error) {
    console.error('[shutdown] socket close failed:', error?.message || error);
  }

  try {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  } catch (error) {
    console.error('[shutdown] server close failed:', error?.message || error);
  }

  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
    }
  } catch (error) {
    console.error('[shutdown] mongoose close failed:', error?.message || error);
  }

  if (typeof onComplete === 'function') {
    onComplete();
  }
};

process.once('SIGINT', () => {
  gracefulShutdown('SIGINT')
    .finally(() => process.exit(0));
});

process.once('SIGTERM', () => {
  gracefulShutdown('SIGTERM')
    .finally(() => process.exit(0));
});

process.once('SIGUSR2', () => {
  gracefulShutdown('SIGUSR2', () => {
    process.kill(process.pid, 'SIGUSR2');
  }).catch((error) => {
    console.error('[shutdown] SIGUSR2 graceful shutdown failed:', error?.message || error);
    process.kill(process.pid, 'SIGUSR2');
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
