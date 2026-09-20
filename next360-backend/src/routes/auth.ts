import { Router } from "express";
import { db } from "../db";
import { genId, signToken } from "../utils";

const router = Router();

// Simulated OTP, as agreed: no real SMS provider.
// Any phone number gets a fixed test code so this is demoable without a
// telecom integration. In a real build this file is the only place that
// changes to plug in an actual SMS provider.
const TEST_OTP = "123456";

// POST /login  { phone }
// Generates (and in this simulated version, always returns) an OTP.
router.post("/login", (req, res) => {
  const { phone } = req.body;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "phone is required" });
  }

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at`
  ).run(phone, TEST_OTP, expiresAt);

  // Simulated: real integration would call an SMS provider here instead.
  return res.json({ message: "OTP sent (simulated)", devHint: `Use ${TEST_OTP} to verify` });
});

// POST /verify-otp  { phone, code, role, name }
// role/name are only used the first time this phone registers.
router.post("/verify-otp", (req, res) => {
  const { phone, code, role, name } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: "phone and code are required" });
  }

  const record = db.prepare(`SELECT * FROM otp_codes WHERE phone = ?`).get(phone) as
    | { phone: string; code: string; expires_at: string }
    | undefined;

  if (!record || record.code !== code) {
    return res.status(401).json({ error: "Invalid OTP" });
  }
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return res.status(401).json({ error: "OTP expired" });
  }

  let user = db.prepare(`SELECT * FROM users WHERE phone = ?`).get(phone) as
    | { id: string; phone: string; name: string | null; role: string }
    | undefined;

  if (!user) {
    const finalRole = role === "seller" || role === "admin" ? role : "buyer";
    const id = genId("usr");
    db.prepare(`INSERT INTO users (id, phone, name, role) VALUES (?, ?, ?, ?)`).run(
      id,
      phone,
      name || null,
      finalRole
    );
    if (finalRole === "seller") {
      db.prepare(`INSERT INTO sellers (user_id, status) VALUES (?, 'pending')`).run(id);
    }
    user = { id, phone, name: name || null, role: finalRole };
  }

  db.prepare(`DELETE FROM otp_codes WHERE phone = ?`).run(phone);

  const token = signToken({ userId: user.id, role: user.role as any, phone: user.phone });
  return res.json({ token, user });
});

export default router;
