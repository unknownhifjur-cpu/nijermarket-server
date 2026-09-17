require("dotenv").config();

const app = require("./app");
const { initStore } = require("./services/store");
const { validateProductionEnvironment } = require("./config/environment");

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    validateProductionEnvironment();
    await initStore();
    app.listen(PORT, () => console.log(`NIJER MARKET API listening on port ${PORT}`));
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
