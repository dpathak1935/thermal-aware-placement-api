const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');

const racksRouter = require('./routes/racks');
const optimizeRouter = require('./routes/optimize');
const placementsRouter = require('./routes/placements');
const authKeysRouter = require('./routes/authKeys');

const app = express();
app.use(express.json());

// Allow the browser-based frontend (hosted on a different origin) to call this API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check — no auth required
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'thermal-placement-api' }));

// Swagger UI — reviewable without reading code
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/openapi.json', (req, res) => res.json(swaggerSpec));

// API routes
app.use('/api/racks', racksRouter);
app.use('/api/optimize', optimizeRouter);
app.use('/api/placements', placementsRouter);
app.use('/api/auth/keys', authKeysRouter);

// 404 + error handling
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
