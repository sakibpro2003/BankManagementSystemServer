const serverless = require("serverless-http");
const { app, ensureBootstrap } = require("../src/app");

const handler = serverless(app);

module.exports = async (req, res) => {
  await ensureBootstrap();
  return handler(req, res);
};
