const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const userRoutes = require('./routes/userRoutes');

let dbConnected = false;

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://carrent-production-0235.up.railway.app',
];

const normalizeOrigin = (origin = '') => origin.trim().replace(/\/+$/, '').toLowerCase();

const buildAllowedOrigins = () => {
  const configuredOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);

  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    configuredOrigins.push(normalizeOrigin(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`));
  }

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins].map(normalizeOrigin).filter(Boolean));
};

const getRequestOrigin = (req) => {
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return '';

  const forwardedProto = req.get('x-forwarded-proto');
  const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol;
  return normalizeOrigin(`${protocol}://${host}`);
};

const ensureDbConnection = () => {
  if (dbConnected) return;
  connectDB();
  dbConnected = true;
};

const createApp = (options = {}) => {
  const { enableRootHealthRoute = true } = options;
  const app = express();
  const allowedOrigins = buildAllowedOrigins();

  app.disable('x-powered-by');
  app.use(
    cors((req, callback) => {
      const origin = normalizeOrigin(req.get('origin') || '');
      const sameOrigin = origin && origin === getRequestOrigin(req);
      const isAllowed = Boolean(origin) && (sameOrigin || allowedOrigins.has(origin));

      callback(null, {
        origin: isAllowed,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      });
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

  return app;
};

module.exports = createApp;
