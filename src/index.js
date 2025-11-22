const port = process.env.PORT || 5000;
const { app, ensureBootstrap } = require("./app");

async function bootstrap() {
  try {
    await ensureBootstrap();

    app.listen(port, () => {
      console.log(`API running on http://localhost:${port}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  }
}

bootstrap();
