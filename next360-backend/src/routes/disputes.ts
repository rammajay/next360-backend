import { Router } from "express";
import { pool } from "../db";
import { genId } from "../utils";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";

const router = Router();

router.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const { orderId, reason } = req.body;
  if (!orderId || !reason) return res.status(400).json({ error: "orderId and reason are required" });
  const { rows: orderRows } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  if (!orderRows[0]) return res.status(404).json({ error: "Order not found" });
  const id = genId("disp");
  await pool.query(`INSERT INTO disputes (id, order_id, raised_by, reason) VALUES ($1, $2, $3, $4)`, [id, orderId, req.auth!.userId, reason]);
  const { rows } = await pool.query(`SELECT * FROM disputes WHERE id = $1`, [id]);
  res.status(201).json({ dispute: rows[0] });
});
router.get("/admin/all", requireAuth, requireRole("admin"), async (_req, res) => {
  const { rows } = await pool.query(`SELECT d.*, o.total_price, o.product_id FROM disputes d JOIN orders o ON o.id = d.order_id ORDER BY d.created_at DESC`);
  res.json({ disputes: rows });
});
router.post("/admin/:id/resolve", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
  const result = await pool.query(`UPDATE disputes SET status = 'resolved' WHERE id = $1`, [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Dispute not found" });
  res.json({ ok: true });
});

export default router;