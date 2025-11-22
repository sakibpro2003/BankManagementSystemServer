const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const authenticate = require("../middleware/auth");

const router = express.Router();

router.get("/me", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "name email role balance status closedAt accountNumber"
    );
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (user.status === "closed") {
      return res.status(403).json({ message: "This account has been closed." });
    }

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        accountNumber: user.accountNumber,
        role: user.role,
        balance: user.balance ?? 0,
        status: user.status,
        closedAt: user.closedAt
      }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch profile.", error: err.message });
  }
});

router.post("/transfer", authenticate, async (req, res) => {
  const { toEmail, toAccountNumber, to, amount } = req.body;
  const numericAmount = Number(amount);

  const recipientIdentifier = toEmail || toAccountNumber || to;

  if (!recipientIdentifier || Number.isNaN(numericAmount)) {
    return res
      .status(400)
      .json({ message: "Recipient email/account number and numeric amount are required." });
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

    if (sender.role === "admin") {
      await session.abortTransaction();
      return res.status(403).json({ message: "Admins cannot transfer funds from their own account." });
    }

    if (sender.status === "closed") {
      await session.abortTransaction();
      return res.status(403).json({ message: "Your account is closed." });
    }
    if (sender.status === "frozen") {
      await session.abortTransaction();
      return res.status(403).json({ message: "Your account is frozen." });
    }

    const recipient = await User.findOne({
      $or: [{ email: recipientIdentifier }, { accountNumber: recipientIdentifier }]
    }).session(session);
    if (!recipient) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Recipient account not found." });
    }

    if (recipient.status === "closed") {
      await session.abortTransaction();
      return res.status(400).json({ message: "Recipient account is closed." });
    }
    if (recipient.status === "frozen") {
      await session.abortTransaction();
      return res.status(400).json({ message: "Recipient account is frozen." });
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

    await Transaction.create(
      [
        {
          sender: sender.id,
          recipient: recipient.id,
          senderEmail: sender.email,
          recipientEmail: recipient.email,
          senderAccount: sender.accountNumber,
          recipientAccount: recipient.accountNumber,
          transactionType: "transfer",
          amount: numericAmount,
          status: "success"
        }
      ],
      { session }
    );

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

router.get("/transactions", authenticate, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  try {
    const currentUser = await User.findById(req.user.id).select("status");
    if (!currentUser) {
      return res.status(404).json({ message: "User not found." });
    }
    if (currentUser.status === "closed") {
      return res.status(403).json({ message: "This account has been closed." });
    }

    const userObjectId = new mongoose.Types.ObjectId(req.user.id);
    const [transactions, totals] = await Promise.all([
      Transaction.find({
        $or: [{ sender: req.user.id }, { recipient: req.user.id }]
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Transaction.aggregate([
        {
          $match: {
            $or: [
              { sender: userObjectId },
              { recipient: userObjectId }
            ]
          }
        },
        {
          $group: {
            _id: null,
            sent: {
              $sum: {
                $cond: [{ $eq: ["$sender", userObjectId] }, "$amount", 0]
              }
            },
            received: {
              $sum: {
                $cond: [
                  { $eq: ["$recipient", userObjectId] },
                  "$amount",
                  0
                ]
              }
            }
          }
        }
      ])
    ]);

    const report = totals?.[0] || { sent: 0, received: 0 };

    res.json({ transactions, report });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch transactions.", error: err.message });
  }
});

router.get("/users", authenticate, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Only admins can view accounts." });
  }

  try {
    const users = await User.find({})
      .select("name email accountNumber role balance status closedAt createdAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch users.", error: err.message });
  }
});

router.post("/close", authenticate, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Only admins can close accounts." });
  }

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email is required to close an account." });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (user.role === "admin") {
      return res.status(400).json({ message: "Admin accounts cannot be closed." });
    }

    if (user.status === "closed") {
      return res.status(400).json({ message: "Account is already closed." });
    }

    user.status = "closed";
    user.closedAt = new Date();
    user.balance = 0;
    await user.save();

    return res.json({
      message: "Account closed successfully.",
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        closedAt: user.closedAt
      }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to close account.", error: err.message });
  }
});

router.post("/withdraw", authenticate, async (req, res) => {
  const { amount } = req.body;
  const numericAmount = Number(amount);

  if (Number.isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ message: "Withdrawal amount must be greater than zero." });
  }

  const session = await User.startSession();

  try {
    session.startTransaction();

    const user = await User.findById(req.user.id).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ message: "User not found." });
    }

    if (user.role === "admin") {
      await session.abortTransaction();
      return res.status(403).json({ message: "Admins cannot withdraw funds from their own account." });
    }

    if (user.status === "closed") {
      await session.abortTransaction();
      return res.status(403).json({ message: "This account has been closed." });
    }
    if (user.status === "frozen") {
      await session.abortTransaction();
      return res.status(403).json({ message: "This account is frozen." });
    }
    if (user.status === "frozen") {
      await session.abortTransaction();
      return res.status(403).json({ message: "This account is frozen." });
    }

    user.balance = typeof user.balance === "number" ? user.balance : 0;
    if (user.balance < numericAmount) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Insufficient balance." });
    }

    user.balance -= numericAmount;
    await user.save({ session });

    await Transaction.create(
      [
        {
          sender: user.id,
          recipient: user.id,
          senderEmail: user.email,
          recipientEmail: user.email,
          senderAccount: user.accountNumber,
          recipientAccount: user.accountNumber,
          transactionType: "withdrawal",
          amount: numericAmount,
          status: "success",
          note: "Cash withdrawal"
        }
      ],
      { session }
    );

    await session.commitTransaction();
    return res.json({ message: "Withdrawal successful.", balance: user.balance });
  } catch (err) {
    await session.abortTransaction();
    return res.status(500).json({ message: "Withdrawal failed.", error: err.message });
  } finally {
    session.endSession();
  }
});

router.post("/deposit", authenticate, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Only admins can deposit funds." });
  }

  const { email, accountNumber, amount } = req.body;
  const numericAmount = Number(amount);

  if ((!email && !accountNumber) || Number.isNaN(numericAmount) || numericAmount <= 0) {
    return res
      .status(400)
      .json({ message: "A target account (email or account number) and positive amount are required." });
  }

  const session = await User.startSession();

  try {
    session.startTransaction();

    const admin = await User.findById(req.user.id).session(session);
    if (!admin) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Admin not found." });
    }
    if (admin.status === "closed") {
      await session.abortTransaction();
      return res.status(403).json({ message: "Your account has been closed." });
    }
    if (admin.status === "frozen") {
      await session.abortTransaction();
      return res.status(403).json({ message: "Your account is frozen." });
    }

    admin.balance = typeof admin.balance === "number" ? admin.balance : 0;
    if (admin.balance < numericAmount) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Insufficient admin balance." });
    }

    const recipient = await User.findOne({
      $or: [{ email }, { accountNumber }]
    }).session(session);

    if (!recipient) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Recipient account not found." });
    }
    if (recipient.status === "closed") {
      await session.abortTransaction();
      return res.status(400).json({ message: "Recipient account is closed." });
    }
    if (recipient.status === "frozen") {
      await session.abortTransaction();
      return res.status(400).json({ message: "Recipient account is frozen." });
    }

    recipient.balance = typeof recipient.balance === "number" ? recipient.balance : 0;
    admin.balance -= numericAmount;
    recipient.balance += numericAmount;

    await admin.save({ session });
    await recipient.save({ session });

    await Transaction.create(
      [
        {
          sender: admin.id,
          recipient: recipient.id,
          senderEmail: admin.email,
          recipientEmail: recipient.email,
          senderAccount: admin.accountNumber,
          recipientAccount: recipient.accountNumber,
          transactionType: "deposit",
          amount: numericAmount,
          status: "success",
          note: "Admin deposit"
        }
      ],
      { session }
    );

    await session.commitTransaction();
    return res.json({
      message: "Deposit successful.",
      balance: recipient.balance,
      adminBalance: admin.balance,
      recipient: {
        id: recipient.id,
        email: recipient.email,
        name: recipient.name,
        accountNumber: recipient.accountNumber,
        balance: recipient.balance
      }
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(500).json({ message: "Deposit failed.", error: err.message });
  } finally {
    session.endSession();
  }
});

router.post("/freeze", authenticate, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Only admins can freeze accounts." });
  }

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email is required to freeze an account." });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    if (user.role === "admin") {
      return res.status(400).json({ message: "Admin accounts cannot be frozen." });
    }
    if (user.status === "closed") {
      return res.status(400).json({ message: "Account is closed." });
    }
    if (user.status === "frozen") {
      return res.status(400).json({ message: "Account is already frozen." });
    }

    user.status = "frozen";
    await user.save();

    return res.json({
      message: "Account frozen.",
      user: { id: user.id, email: user.email, status: user.status }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to freeze account.", error: err.message });
  }
});

router.post("/unfreeze", authenticate, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Only admins can unfreeze accounts." });
  }

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email is required to unfreeze an account." });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    if (user.role === "admin") {
      return res.status(400).json({ message: "Admin accounts cannot be unfrozen this way." });
    }
    if (user.status === "active") {
      return res.status(400).json({ message: "Account is already active." });
    }
    if (user.status === "closed") {
      return res.status(400).json({ message: "Account is closed." });
    }

    user.status = "active";
    await user.save();

    return res.json({
      message: "Account unfrozen.",
      user: { id: user.id, email: user.email, status: user.status }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to unfreeze account.", error: err.message });
  }
});

module.exports = router;
