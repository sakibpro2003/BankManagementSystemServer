require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const seedAdmin = require("./utils/seedAdmin");
const User = require("./models/User");
const authRoutes = require("./routes/auth");
const accountRoutes = require("./routes/account");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "bank-management-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);

let bootstrapped = false;

async function ensureBootstrap() {
  if (bootstrapped) return;

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required. Add it to your environment variables.");
  }

  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required. Add it to your environment variables.");
  }

  await connectDB(process.env.MONGO_URI);
  await seedAdmin(User, {
    email: process.env.ADMIN_EMAIL || "admin@gmail.com",
    password: process.env.ADMIN_PASSWORD || "1111",
    name: process.env.ADMIN_NAME || "Default Admin"
  });

  bootstrapped = true;
}

module.exports = { app, ensureBootstrap };
