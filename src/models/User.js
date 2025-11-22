const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

async function generateAccountNumber(UserModel, attempts = 0) {
  if (attempts > 5) {
    throw new Error("Failed to generate account number.");
  }

  const candidate = String(Math.floor(1000000000 + Math.random() * 9000000000)); // 10-digit
  const exists = await UserModel.findOne({ accountNumber: candidate });
  if (!exists) return candidate;
  return generateAccountNumber(UserModel, attempts + 1);
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    role: { type: String, enum: ["admin", "user"], default: "user" },
    balance: { type: Number, default: 1000, min: 0 },
    status: { type: String, enum: ["active", "closed", "frozen"], default: "active" },
    closedAt: { type: Date },
    accountNumber: { type: String, unique: true }
  },
  { timestamps: true }
);

userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) return next();

  try {
    const alreadyHashed = /^\$2[aby]\$/.test(this.password);
    if (alreadyHashed) return next();

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.pre("save", async function generateAccount(next) {
  if (this.accountNumber) return next();

  try {
    this.accountNumber = await generateAccountNumber(this.constructor);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password);
};

const User = mongoose.model("User", userSchema);

module.exports = User;
