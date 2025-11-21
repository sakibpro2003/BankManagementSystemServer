const express = require("express");
const User = require("../models/User");
const authenticate = require("../middleware/auth");

const router = express.Router();

router.get("/me", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("name email role balance");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch profile.", error: err.message });
  }
});

router.post("/transfer", authenticate, async (req, res) => {
  const { toEmail, amount } = req.body;
  const numericAmount = Number(amount);

  if (!toEmail || Number.isNaN(numericAmount)) {
    return res.status(400).json({ message: "Recipient email and numeric amount are required." });
  }

  if (numericAmount <= 0) {
    return res.status(400).json({ message: "Transfer amount must be greater than zero." });
  }

  const session = await User.startSession();

  try {
    session.startTransaction();

    const sender = await User.findById(req.user.id).session(session);
    if (!sender) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Sender not found." });
    }

    const recipient = await User.findOne({ email: toEmail }).session(session);
    if (!recipient) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Recipient account not found." });
    }

    if (String(recipient.id) === String(sender.id)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "You cannot transfer funds to your own account." });
    }

    sender.balance = typeof sender.balance === "number" ? sender.balance : 0;
    recipient.balance = typeof recipient.balance === "number" ? recipient.balance : 0;

    if (sender.balance < numericAmount) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Insufficient balance." });
    }

    sender.balance -= numericAmount;
    recipient.balance += numericAmount;

    await sender.save({ session });
    await recipient.save({ session });

    await session.commitTransaction();
    return res.json({
      message: "Transfer successful.",
      balance: sender.balance,
      recipient: {
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        balance: recipient.balance
      }
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(500).json({ message: "Transfer failed.", error: err.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;
