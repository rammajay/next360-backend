import { Router } from "express";
import { pool } from "../db";
import { genId, signToken } from "../utils";

const router = Router();
const TEST_OTP = "123456";

router.post("/login", async (req, res) => {
  const { phone } = req.body;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "phone is required" });
  }
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await pool.query(
    `INSERT INTO otp_codes (phone, code, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
    [phone, TEST_OTP, expiresAt]
  );
  return res.json({ message: "OTP sent (simulated)", devHint: `Use ${TEST_OTP} to verify` });
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