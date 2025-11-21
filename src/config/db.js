const mongoose = require("mongoose");

async function connectDB(uri) {
  if (!uri) {
    throw new Error("Missing MongoDB connection string");
  }

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    autoIndex: true
  });

  return mongoose.connection;
}

module.exports = connectDB;
