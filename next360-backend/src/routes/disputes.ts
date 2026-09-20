import { Router } from "express";
import { db } from "../db";
import { genId } from "../utils";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";

const router = Router();

// POST /disputes (buyer or seller raises a complaint about an order)
router.post("/", requireAuth, (req: AuthedRequest, res) => {
  const { orderId, reason } = req.body;
  if (!orderId || !reason) return res.status(400).json({ error: "orderId and reason are required" });

  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  if (!order) return res.status(404).json({ error: "Order not found" });

  const id = genId("disp");
  db.prepare(`INSERT INTO disputes (id, order_id, raised_by, reason) VALUES (?, ?, ?, ?)`).run(
    id,
    orderId,
    req.auth!.userId,
    reason
  );
  res.status(201).json({ dispute: db.prepare(`SELECT * FROM disputes WHERE id = ?`).get(id) });
});

// GET /disputes/admin/all
router.get("/admin/all", requireAuth, requireRole("admin"), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT d.*, o.total_price, o.product_id FROM disputes d
       JOIN orders o ON o.id = d.order_id ORDER BY d.created_at DESC`
    )
    .all();
  res.json({ disputes: rows });
});

// POST /disputes/admin/:id/resolve
router.post("/admin/:id/resolve", requireAuth, requireRole("admin"), (req: AuthedRequest, res) => {
  const result = db.prepare(`UPDATE disputes SET status = 'resolved' WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Dispute not found" });
  res.json({ ok: true });
});

export default router;
