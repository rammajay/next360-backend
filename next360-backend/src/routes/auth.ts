import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db";
import { genId, signToken } from "../utils";

const router = Router();
const TEST_OTP = "123456";

router.post("/login", async (req, res) => {
  const { phone } = req.body;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "phone is required" });
  }

  // The buyer app uses phone + password. Keep the OTP-only behavior for
  // seller/admin clients that call this route without a password.
  if (typeof req.body.password === "string") {
    const { rows } = await pool.query(`SELECT * FROM users WHERE phone = $1`, [phone.trim()]);
    const user = rows[0];
    if (!user?.password_hash || !(await bcrypt.compare(req.body.password, user.password_hash))) {
      return res.status(401).json({ error: "Mobile number or password is incorrect." });
    }
    const token = signToken({ userId: user.id, role: user.role, phone: user.phone });
    return res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
  }

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await pool.query(
    `INSERT INTO otp_codes (phone, code, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
    [phone, TEST_OTP, expiresAt]
  );
  return res.json({ message: "OTP sent (simulated)", devHint: `Use ${TEST_OTP} to verify` });
});

router.post("/register", async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const phone = typeof req.body.phone === "string" ? req.body.phone.replace(/\D/g, "") : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!name || !/^\S+@\S+\.\S+$/.test(email) || !/^\d{10}$/.test(phone) || password.length < 6) {
    return res.status(400).json({ error: "Enter a name, valid email, 10-digit mobile number, and password of at least 6 characters." });
  }

  const { rows: existing } = await pool.query(
    `SELECT id FROM users WHERE phone = $1 OR email = $2 LIMIT 1`,
    [phone, email]
  );
  if (existing[0]) {
    return res.status(409).json({ error: "An account with this mobile number or email already exists." });
  }

  const id = genId("usr");
  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (id, phone, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5, 'buyer')`,
    [id, phone, email, passwordHash, name]
  );
  const user = { id, phone, email, name, role: "buyer" as const };
  const token = signToken({ userId: id, role: user.role, phone });
  return res.status(201).json({ user, token });
});

router.post("/verify-otp", async (req, res) => {
  const { phone, code, role, name } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: "phone and code are required" });
  }
  const { rows: otpRows } = await pool.query(`SELECT * FROM otp_codes WHERE phone = $1`, [phone]);
  const record = otpRows[0];
  if (!record || record.code !== code) {
    return res.status(401).json({ error: "Invalid OTP" });
  }
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return res.status(401).json({ error: "OTP expired" });
  }
  const { rows: userRows } = await pool.query(`SELECT * FROM users WHERE phone = $1`, [phone]);
  let user = userRows[0];
  if (!user) {
    const finalRole = role === "seller" || role === "admin" ? role : "buyer";
    const id = genId("usr");
    await pool.query(`INSERT INTO users (id, phone, name, role) VALUES ($1, $2, $3, $4)`, [id, phone, name || null, finalRole]);
    if (finalRole === "seller") {
      await pool.query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'pending')`, [id]);
    }
    user = { id, phone, name: name || null, role: finalRole };
  }
  await pool.query(`DELETE FROM otp_codes WHERE phone = $1`, [phone]);
  const token = signToken({ userId: user.id, role: user.role, phone: user.phone });
  return res.json({ token, user });
});

export default router;
