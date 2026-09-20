import { Router } from "express";
import { pool } from "../db";
import { genId, calcCommission } from "../utils";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";

const router = Router();

router.post("/", requireAuth, requireRole("buyer"), async (req: AuthedRequest, res) => {
  const { productId, quantity, address } = req.body;
  if (!productId || !quantity) {
    return res.status(400).json({ error: "productId and quantity are required" });
  }
  const { rows: productRows } = await pool.query(`SELECT * FROM products WHERE id = $1`, [productId]);
  const product = productRows[0];
  if (!product) return res.status(404).json({ error: "Product not found" });
  const buyerVisible = (product.type === "organic" && product.status === "approved") || (product.type !== "organic" && product.status === "live");
  if (!buyerVisible) return res.status(403).json({ error: "This product is not available for purchase" });
  const qty = Number(quantity);
  if (product.stock < qty) return res.status(400).json({ error: "Insufficient stock" });
  const totalPrice = Math.round(product.price * qty * 100) / 100;
  const { commission, payout } = calcCommission(totalPrice);
  const orderId = genId("ord");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE products SET stock = stock - $1 WHERE id = $2`, [qty, productId]);
    await client.query(`INSERT INTO orders (id, user_id, product_id, quantity, status, total_price, commission_amount, seller_payout, address) VALUES ($1, $2, $3, $4, 'placed', $5, $6, $7, $8)`, [orderId, req.auth!.userId, productId, qty, totalPrice, commission, payout, address || null]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  const { rows } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  res.status(201).json({ order: rows[0] });
});

router.get("/", requireAuth, requireRole("buyer"), async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(`SELECT o.*, p.name as product_name, p.image_url FROM orders o JOIN products p ON p.id = o.product_id WHERE o.user_id = $1 ORDER BY o.created_at DESC`, [req.auth!.userId]);
  res.json({ orders: rows });
});
router.get("/seller/mine", requireAuth, requireRole("seller"), async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(`SELECT o.*, p.name as product_name FROM orders o JOIN products p ON p.id = o.product_id WHERE p.seller_id = $1 ORDER BY o.created_at DESC`, [req.auth!.userId]);
  res.json({ orders: rows });
});
router.patch("/:id/status", requireAuth, requireRole("seller"), async (req: AuthedRequest, res) => {
  const { status } = req.body;
  if (!["shipped", "delivered", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "status must be shipped, delivered, or cancelled" });
  }
  const { rows: ownedRows } = await pool.query(`SELECT o.id FROM orders o JOIN products p ON p.id = o.product_id WHERE o.id = $1 AND p.seller_id = $2`, [req.params.id, req.auth!.userId]);
  if (ownedRows.length === 0) return res.status(404).json({ error: "Order not found for this seller" });
  await pool.query(`UPDATE orders SET status = $1 WHERE id = $2`, [status, req.params.id]);
  res.json({ ok: true });
});
router.get("/admin/all", requireAuth, requireRole("admin"), async (_req, res) => {
  const { rows } = await pool.query(`SELECT o.*, p.name as product_name, u.phone as buyer_phone FROM orders o JOIN products p ON p.id = o.product_id JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC`);
  res.json({ orders: rows });
});
router.post("/admin/:id/cancel", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
  const result = await pool.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Order not found" });
  res.json({ ok: true });
});

export default router;