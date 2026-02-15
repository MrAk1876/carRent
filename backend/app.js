const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const userRoutes = require('./routes/userRoutes');

let dbConnected = false;

const ensureDbConnection = () => {
  if (dbConnected) return;
  connectDB();
  dbConnected = true;
};

const createApp = (options = {}) => {
  const { enableRootHealthRoute = true } = options;
  const app = express();

  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,https://carrent-production-0235.up.railway.app')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  app.disable('x-powered-by');
  app.use(
    cors({
      origin(origin, callback) {
        // allow server-to-server and same-origin requests
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  ensureDbConnection();

  if (enableRootHealthRoute) {
    app.get('/', (req, res) => {
      res.send('Car Rental Backend Running');
    });
  }

  app.use('/api/cars', require('./routes/carRoutes'));
  app.use('/api/auth', require('./routes/authRoutes'));
  app.use('/api/bookings', require('./routes/bookingRoutes'));
  app.use('/api/requests', require('./routes/requestRoutes'));
  app.use('/api/offers', require('./routes/offerRoutes'));
  app.use('/api/reviews', require('./routes/reviewRoutes'));
  app.use('/api/contact', require('./routes/contactRoutes'));
  app.use('/api/admin', require('./routes/adminRoutes'));
  app.use('/api/user', userRoutes);

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    if (err && err.message) {
      return res.status(400).json({ message: err.message });
    }
    return res.status(500).json({ message: 'Internal server error' });
  });

  return app;
};

module.exports = createApp;
