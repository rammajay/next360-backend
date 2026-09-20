import { Router } from "express";
import multer from "multer";
import { put } from "@vercel/blob";
import { pool } from "../db";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/register-seller", requireAuth, requireRole("seller"), upload.single("kycDoc"), async (req: AuthedRequest, res) => {
  const { businessName, docType, docNumber } = req.body;
  if (!businessName || !docType || !docNumber) {
    return res.status(400).json({ error: "businessName, docType, docNumber are required" });
  }
  let docFileUrl: string | null = null;
  if (req.file) {
    const blob = await put(`kyc/${req.auth!.userId}-${Date.now()}-${req.file.originalname}`, req.file.buffer, { access: "public" });
    docFileUrl = blob.url;
  }
  const kycDetails = JSON.stringify({ docType, docNumber, docFileUrl });
  await pool.query(`UPDATE sellers SET business_name = $1, kyc_details = $2, status = 'pending' WHERE user_id = $3`, [businessName, kycDetails, req.auth!.userId]);
  const { rows } = await pool.query(`SELECT * FROM sellers WHERE user_id = $1`, [req.auth!.userId]);
  res.json({ seller: rows[0] });
});

router.get("/me", requireAuth, requireRole("seller"), async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(`SELECT * FROM sellers WHERE user_id = $1`, [req.auth!.userId]);
  res.json({ seller: rows[0] });
});

router.get("/earnings", requireAuth, requireRole("seller"), async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(`SELECT o.* FROM orders o JOIN products p ON p.id = o.product_id WHERE p.seller_id = $1 AND o.status != 'cancelled'`, [req.auth!.userId]);
  const totalSales = rows.reduce((sum: number, o: any) => sum + Number(o.total_price), 0);
  const totalCommission = rows.reduce((sum: number, o: any) => sum + Number(o.commission_amount), 0);
  const netPayout = rows.reduce((sum: number, o: any) => sum + Number(o.seller_payout), 0);
  res.json({ totalSales: round2(totalSales), totalCommission: round2(totalCommission), netPayout: round2(netPayout), orderCount: rows.length });
});
function round2(n: number) { return Math.round(n * 100) / 100; }

router.get("/admin/pending", requireAuth, requireRole("admin"), async (_req, res) => {
  const { rows } = await pool.query(`SELECT s.*, u.phone, u.name FROM sellers s JOIN users u ON u.id = s.user_id WHERE s.status = 'pending' ORDER BY s.created_at ASC`);
  res.json({ sellers: rows });
});
router.get("/admin/all", requireAuth, requireRole("admin"), async (_req, res) => {
  const { rows } = await pool.query(`SELECT s.*, u.phone, u.name FROM sellers s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC`);
  res.json({ sellers: rows });
});
router.post("/admin/:id/approve", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
  const result = await pool.query(`UPDATE sellers SET status = 'approved' WHERE user_id = $1`, [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Seller not found" });
  res.json({ ok: true });
});
router.post("/admin/:id/reject", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
  const result = await pool.query(`UPDATE sellers SET status = 'rejected' WHERE user_id = $1`, [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Seller not found" });
  res.json({ ok: true });
});
router.post("/admin/:id/block", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
  const result = await pool.query(`UPDATE sellers SET status = 'blocked' WHERE user_id = $1`, [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Seller not found" });
  res.json({ ok: true });
});

export default router;