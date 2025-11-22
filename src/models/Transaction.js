const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    senderEmail: { type: String, required: true },
    recipientEmail: { type: String, required: true },
    senderAccount: { type: String, required: true },
    recipientAccount: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    transactionType: { type: String, enum: ["transfer", "withdrawal", "deposit"], default: "transfer" },
    status: { type: String, enum: ["success", "failed"], default: "success" },
    note: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);
