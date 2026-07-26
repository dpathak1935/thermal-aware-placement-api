const app = require('./src/app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Thermal-placement API listening on port ${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/docs`);
});
