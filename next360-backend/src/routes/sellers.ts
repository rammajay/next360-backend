import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../db";
import { genId, calcCommission } from "../utils";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";

const router = Router();

const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads", "kyc");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${genId("kyc")}${path.extname(file.originalname)}`),
  }),
});

// ---------- POST /register-seller ----------
// PRD 4.2 onboarding: register (already done via /login+/verify-otp with role=seller)
// -> upload KYC -> submit for approval. This endpoint handles the KYC + submit step.
router.post(
  "/register-seller",
  requireAuth,
  requireRole("seller"),
  upload.single("kycDoc"),
  (req: AuthedRequest, res) => {
    const { businessName, docType, docNumber } = req.body;
    if (!businessName || !docType || !docNumber) {
      return res.status(400).json({ error: "businessName, docType, docNumber are required" });
    }

    const kycDetails = JSON.stringify({
      docType,
      docNumber,
      docFileUrl: req.file ? `/uploads/kyc/${req.file.filename}` : null,
    });

    db.prepare(
      `UPDATE sellers SET business_name = ?, kyc_details = ?, status = 'pending' WHERE user_id = ?`
    ).run(businessName, kycDetails, req.auth!.userId);

    const seller = db.prepare(`SELECT * FROM sellers WHERE user_id = ?`).get(req.auth!.userId);
    res.json({ seller });
  }
);

// ---------- GET /sellers/me ----------
router.get("/me", requireAuth, requireRole("seller"), (req: AuthedRequest, res) => {
  const seller = db.prepare(`SELECT * FROM sellers WHERE user_id = ?`).get(req.auth!.userId);
  res.json({ seller });
});

// ---------- GET /sellers/earnings (Earnings Dashboard: total sales, commission, net payout) ----------
router.get("/earnings", requireAuth, requireRole("seller"), (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT o.* FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE p.seller_id = ? AND o.status != 'cancelled'`
    )
    .all(req.auth!.userId) as any[];

  const totalSales = rows.reduce((sum, o) => sum + o.total_price, 0);
  const totalCommission = rows.reduce((sum, o) => sum + o.commission_amount, 0);
  const netPayout = rows.reduce((sum, o) => sum + o.seller_payout, 0);

  res.json({
    totalSales: round2(totalSales),
    totalCommission: round2(totalCommission),
    netPayout: round2(netPayout),
    orderCount: rows.length,
  });
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------- Admin: seller verification ----------

// GET /admin/sellers/pending
router.get("/admin/pending", requireAuth, requireRole("admin"), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*, u.phone, u.name FROM sellers s JOIN users u ON u.id = s.user_id
       WHERE s.status = 'pending' ORDER BY s.created_at ASC`
    )
    .all();
  res.json({ sellers: rows });
});

// GET /admin/sellers (all, for moderation view)
router.get("/admin/all", requireAuth, requireRole("admin"), (_req, res) => {
  const rows = db
    .prepare(`SELECT s.*, u.phone, u.name FROM sellers s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC`)
    .all();
  res.json({ sellers: rows });
});

// POST /admin/sellers/:id/approve
router.post("/admin/:id/approve", requireAuth, requireRole("admin"), (req: AuthedRequest, res) => {
  const result = db.prepare(`UPDATE sellers SET status = 'approved' WHERE user_id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Seller not found" });
  res.json({ ok: true });
});

// POST /admin/sellers/:id/reject
router.post("/admin/:id/reject", requireAuth, requireRole("admin"), (req: AuthedRequest, res) => {
  const result = db.prepare(`UPDATE sellers SET status = 'rejected' WHERE user_id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Seller not found" });
  res.json({ ok: true });
});

// POST /admin/sellers/:id/block  (manual override, PRD 4.3)
router.post("/admin/:id/block", requireAuth, requireRole("admin"), (req: AuthedRequest, res) => {
  const result = db.prepare(`UPDATE sellers SET status = 'blocked' WHERE user_id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Seller not found" });
  res.json({ ok: true });
});

export default router;
