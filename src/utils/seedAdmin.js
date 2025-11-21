const bcrypt = require("bcryptjs");

async function seedAdmin(UserModel, adminConfig) {
  const adminEmail = adminConfig?.email;
  const adminPassword = adminConfig?.password;
  const adminName = adminConfig?.name || "Admin";

  if (!adminEmail || !adminPassword) {
    throw new Error("Admin seed requires email and password");
  }

  const existing = await UserModel.findOne({ email: adminEmail });
  if (existing) return existing;

  const hashed = await bcrypt.hash(adminPassword, 10);
  const adminUser = await UserModel.create({
    name: adminName,
    email: adminEmail,
    password: hashed,
    role: "admin",
    balance: 10000
  });

  return adminUser;
}

module.exports = seedAdmin;
