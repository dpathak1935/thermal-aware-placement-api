const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Thermal-Aware Node Placement Optimization API',
      version: '1.0.0',
      description:
        'Given a rack layout and a new node\'s thermal profile, returns the optimal slot(s) ' +
        'to place it in, ranked by thermal risk score. Every recommendation is explainable ' +
        '(cost + breakdown) and persisted to placement history.',
    },
    servers: [{ url: '/', description: 'Current server' }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    tags: [
      { name: 'Auth', description: 'API key issuance' },
      { name: 'Racks', description: 'Rack layout registration and lookup' },
      { name: 'Optimize', description: 'Thermal-aware placement recommendation' },
      { name: 'Placements', description: 'Placement decision history' },
    ],
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);
