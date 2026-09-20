import { Router } from "express";
import multer from "multer";
import { put } from "@vercel/blob";
import { pool } from "../db";
import { genId } from "../utils";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get("/", async (req, res) => {
  const { category, type, location, minPrice, maxPrice, verifiedOnly } = req.query;
  let sql = `SELECT p.*, s.business_name as seller_name FROM products p JOIN sellers s ON s.user_id = p.seller_id WHERE ((p.type = 'organic' AND p.status = 'approved') OR (p.type != 'organic' AND p.status = 'live'))`;
  const params: any[] = [];
  let i = 1;
  if (verifiedOnly === "true") { sql += ` AND p.type = 'organic'`; }
  else if (type && type !== "all") { sql += ` AND p.type = $${i++}`; params.push(type); }
  if (category) { sql += ` AND p.category = $${i++}`; params.push(category); }
  if (location) { sql += ` AND p.location = $${i++}`; params.push(location); }
  if (minPrice) { sql += ` AND p.price >= $${i++}`; params.push(Number(minPrice)); }
  if (maxPrice) { sql += ` AND p.price <= $${i++}`; params.push(Number(maxPrice)); }
  sql += ` ORDER BY p.created_at DESC`;
  const { rows } = await pool.query(sql, params);
  res.json({ products: rows });
});

router.get("/:id", async (req, res) => {
  const { rows } = await pool.query(`SELECT p.*, s.business_name as seller_name FROM products p JOIN sellers s ON s.user_id = p.seller_id WHERE p.id = $1`, [req.params.id]);
  const p = rows[0];
  if (!p) return res.status(404).json({ error: "Product not found" });
  if (p.type !== "organic") delete p.certificate_url;
  res.json({ product: p });
});

router.post("/", requireAuth, requireRole("seller"), upload.single("certificate"), async (req: AuthedRequest, res) => {
  const sellerId = req.auth!.userId;
  const { rows: sellerRows } = await pool.query(`SELECT * FROM sellers WHERE user_id = $1`, [sellerId]);
  const seller = sellerRows[0];
  if (!seller || seller.status !== "approved") {
    return res.status(403).json({ error: "Seller not yet approved — cannot list products" });
  }
  const { name, category, type, price, stock, description, location } = req.body;
  if (!name || !category || !type || !price || !stock) {
    return res.status(400).json({ error: "name, category, type, price, stock are required" });
  }
  if (!["organic", "natural", "eco"].includes(type)) {
    return res.status(400).json({ error: "type must be organic, natural, or eco" });
  }
  const isOrganic = type === "organic";
  if (isOrganic && !req.file) {
    return res.status(400).json({ error: "Organic products require a certificate upload" });
  }
  let certificateUrl: string | null = null;
  if (req.file) {
    const blob = await put(`certificates/${sellerId}-${Date.now()}-${req.file.originalname}`, req.file.buffer, { access: "public" });
    certificateUrl = blob.url;
  }
  const id = genId("prod");
  const status = isOrganic ? "pending" : "live";
  await pool.query(`INSERT INTO products (id, seller_id, name, category, type, certificate_url, status, price, stock, description, location) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [id, sellerId, name, category, type, certificateUrl, status, Number(price), Number(stock), description || null, location || null]);
  const { rows } = await pool.query(`SELECT * FROM products WHERE id = $1`, [id]);
  res.status(201).json({ product: rows[0] });
});

router.get("/seller/mine", requireAuth, requireRole("seller"), async (req: AuthedRequest, res) => {
  const { rows } = await pool.query(`SELECT * FROM products WHERE seller_id = $1 ORDER BY created_at DESC`, [req.auth!.userId]);
  res.json({ products: rows });
});

router.get("/admin/pending", requireAuth, requireRole("admin"), async (_req, res) => {
  const { rows } = await pool.query(`SELECT p.*, s.business_name as seller_name, u.phone as seller_phone FROM products p JOIN sellers s ON s.user_id = p.seller_id JOIN users u ON u.id = p.seller_id WHERE p.type = 'organic' AND p.status = 'pending' ORDER BY p.created_at ASC`);
  res.json({ products: rows });
});
router.post("/admin/:id/approve", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
  const result = await pool.query(`UPDATE products SET status = 'approved' WHERE id = $1 AND type = 'organic'`, [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Pending organic product not found" });
  res.json({ ok: true });
});
router.post("/admin/:id/reject", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
  const result = await pool.query(`UPDATE products SET status = 'rejected' WHERE id = $1`, [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Product not found" });
  res.json({ ok: true });
});
router.get("/admin/all", requireAuth, requireRole("admin"), async (_req, res) => {
  const { rows } = await pool.query(`SELECT p.*, s.business_name as seller_name FROM products p JOIN sellers s ON s.user_id = p.seller_id ORDER BY p.created_at DESC`);
  res.json({ products: rows });
});
router.delete("/admin/:id", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
  const result = await pool.query(`DELETE FROM products WHERE id = $1`, [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Product not found" });
  res.json({ ok: true });
});
router.patch("/admin/:id/reclassify", requireAuth, requireRole("admin"), async (req: AuthedRequest, res) => {
  const { type } = req.body;
  if (!["organic", "natural", "eco"].includes(type)) {
    return res.status(400).json({ error: "type must be organic, natural, or eco" });
  }
  const status = type === "organic" ? "pending" : "live";
  const result = await pool.query(`UPDATE products SET type = $1, status = $2 WHERE id = $3`, [type, status, req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Product not found" });
  res.json({ ok: true });
});

export default router;