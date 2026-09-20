import { Router } from "express";
import { db } from "../db";
import { genId, calcCommission } from "../utils";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";

const router = Router();

// ---------- POST /orders (create-order) ----------
// PRD order flow: user places order -> inventory reduced -> seller notified (status field) -> seller updates status.
// Payment is mocked: this endpoint just records the order as placed, no real gateway call.
router.post("/", requireAuth, requireRole("buyer"), (req: AuthedRequest, res) => {
  const { productId, quantity, address } = req.body;
  if (!productId || !quantity) {
    return res.status(400).json({ error: "productId and quantity are required" });
  }

  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId) as any;
  if (!product) return res.status(404).json({ error: "Product not found" });

  const buyerVisible =
    (product.type === "organic" && product.status === "approved") ||
    (product.type !== "organic" && product.status === "live");
  if (!buyerVisible) {
    return res.status(403).json({ error: "This product is not available for purchase" });
  }

  const qty = Number(quantity);
  if (product.stock < qty) {
    return res.status(400).json({ error: "Insufficient stock" }); // prevent overselling, PRD 4.2
  }

  const totalPrice = Math.round(product.price * qty * 100) / 100;
  const { commission, payout } = calcCommission(totalPrice);
  const orderId = genId("ord");

  const tx = db.transaction(() => {
    db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ?`).run(qty, productId); // auto-reduce stock
    db.prepare(
      `INSERT INTO orders (id, user_id, product_id, quantity, status, total_price, commission_amount, seller_payout, address)
       VALUES (?, ?, ?, ?, 'placed', ?, ?, ?, ?)`
    ).run(orderId, req.auth!.userId, productId, qty, totalPrice, commission, payout, address || null);
  });
  tx();

  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  res.status(201).json({ order });
});

// ---------- GET /orders (buyer: own order history) ----------
router.get("/", requireAuth, requireRole("buyer"), (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, p.name as product_name, p.image_url FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE o.user_id = ? ORDER BY o.created_at DESC`
    )
    .all(req.auth!.userId);
  res.json({ orders: rows });
});

// ---------- GET /orders/seller (seller: orders for their products) ----------
router.get("/seller/mine", requireAuth, requireRole("seller"), (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, p.name as product_name FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE p.seller_id = ? ORDER BY o.created_at DESC`
    )
    .all(req.auth!.userId);
  res.json({ orders: rows });
});

// ---------- PATCH /orders/:id/status (seller updates status) ----------
router.patch("/:id/status", requireAuth, requireRole("seller"), (req: AuthedRequest, res) => {
  const { status } = req.body;
  if (!["shipped", "delivered", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "status must be shipped, delivered, or cancelled" });
  }
  // Ensure this order belongs to one of this seller's products before updating.
  const owned = db
    .prepare(
      `SELECT o.id FROM orders o JOIN products p ON p.id = o.product_id
       WHERE o.id = ? AND p.seller_id = ?`
    )
    .get(req.params.id, req.auth!.userId);
  if (!owned) return res.status(404).json({ error: "Order not found for this seller" });

  db.prepare(`UPDATE orders SET status = ? WHERE id = ?`).run(status, req.params.id);
  res.json({ ok: true });
});

// ---------- Admin: order monitoring ----------
router.get("/admin/all", requireAuth, requireRole("admin"), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, p.name as product_name, u.phone as buyer_phone FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC`
    )
    .all();
  res.json({ orders: rows });
});

// ---------- Admin: manual override - cancel order ----------
router.post("/admin/:id/cancel", requireAuth, requireRole("admin"), (req: AuthedRequest, res) => {
  const result = db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Order not found" });
  res.json({ ok: true });
});

export default router;
