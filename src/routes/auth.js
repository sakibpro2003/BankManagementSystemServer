const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();

function signToken(userId, role, secret) {
  return jwt.sign({ sub: userId, role }, secret, { expiresIn: "7d" });
}

router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required." });
  }

  try {
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "Email already in use." });
    }

    const user = await User.create({ name, email, password });
    const token = signToken(user.id, user.role, process.env.JWT_SECRET);

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        accountNumber: user.accountNumber,
        role: user.role,
        balance: user.balance ?? 0,
        status: user.status,
        closedAt: user.closedAt
      },
      token
    });
  } catch (err) {
    res.status(500).json({ message: "Registration failed.", error: err.message });
  }
});

router.post("/login", async (req, res) => {
  const { email, accountNumber, identifier, password } = req.body;
  const loginIdentifier = (identifier || email || accountNumber || "").toString().trim();

  if (!loginIdentifier || !password) {
    return res.status(400).json({ message: "Email/account number and password are required." });
  }

  try {
    const user = await User.findOne({
      $or: [{ email: loginIdentifier }, { accountNumber: loginIdentifier }]
    });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    if (user.status === "closed") {
      return res.status(403).json({ message: "This account has been closed." });
    }

    const passwordMatches = await user.comparePassword(password);
    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const token = signToken(user.id, user.role, process.env.JWT_SECRET);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        accountNumber: user.accountNumber,
        role: user.role,
        balance: user.balance ?? 0,
        status: user.status,
        closedAt: user.closedAt
      },
      token
    });
  } catch (err) {
    res.status(500).json({ message: "Login failed.", error: err.message });
  }
});

module.exports = router;
