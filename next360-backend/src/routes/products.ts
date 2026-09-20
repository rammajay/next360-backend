import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../db";
import { genId } from "../utils";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";

const router = Router();

const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads", "certificates");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${genId("cert")}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ---------- GET /products (Buyer App discovery) ----------
// PRD 6: unapproved organic products must never be shown to buyers,
// regardless of any filter. Natural/Eco-friendly are visible immediately
// once created (their status is set to 'live' at creation time).
router.get("/", (req, res) => {
  const { category, type, location, minPrice, maxPrice, verifiedOnly } = req.query;

  let sql = `SELECT p.*, s.business_name as seller_name FROM products p
             JOIN sellers s ON s.user_id = p.seller_id
             WHERE (
               (p.type = 'organic' AND p.status = 'approved')
               OR (p.type != 'organic' AND p.status = 'live')
             )`;
  const params: any[] = [];

  if (verifiedOnly === "true") {
    sql += ` AND p.type = 'organic'`;
  } else if (type && type !== "all") {
    sql += ` AND p.type = ?`;
    params.push(type);
  }
  if (category) {
    sql += ` AND p.category = ?`;
    params.push(category);
  }
  if (location) {
    sql += ` AND p.location = ?`;
    params.push(location);
  }
  if (minPrice) {
    sql += ` AND p.price >= ?`;
    params.push(Number(minPrice));
  }
  if (maxPrice) {
    sql += ` AND p.price <= ?`;
    params.push(Number(maxPrice));
  }
  sql += ` ORDER BY p.created_at DESC`;

  const rows = db.prepare(sql).all(...params);
  res.json({ products: rows });
});

// ---------- GET /products/:id (Product Detail Page) ----------
router.get("/:id", (req, res) => {
  const product = db
    .prepare(
      `SELECT p.*, s.business_name as seller_name FROM products p
       JOIN sellers s ON s.user_id = p.seller_id WHERE p.id = ?`
    )
    .get(req.params.id);

  if (!product) return res.status(404).json({ error: "Product not found" });

  const p = product as any;
  // Certification viewer only applies to organic (PRD 5: "Certification visible only for organic")
  if (p.type !== "organic") delete p.certificate_url;

  res.json({ product: p });
});

// ---------- POST /products (Seller: add-product) ----------
// This is the classification logic from PRD 4.2:
//   organic  -> certificate mandatory, status = pending, needs admin approval
//   natural  -> no certificate, status = live immediately, marked unverified
//   eco      -> no certificate, status = live immediately, marked unverified
router.post(
  "/",
  requireAuth,
  requireRole("seller"),
  upload.single("certificate"),
  (req: AuthedRequest, res) => {
    const sellerId = req.auth!.userId;

    const seller = db.prepare(`SELECT * FROM sellers WHERE user_id = ?`).get(sellerId) as
      | { status: string }
      | undefined;
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

    const id = genId("prod");
    const certificateUrl = req.file ? `/uploads/certificates/${req.file.filename}` : null;
    const status = isOrganic ? "pending" : "live";

    db.prepare(
      `INSERT INTO products (id, seller_id, name, category, type, certificate_url, status, price, stock, description, location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      sellerId,
      name,
      category,
      type,
      certificateUrl,
      status,
      Number(price),
      Number(stock),
      description || null,
      location || null
    );

    const created = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
    res.status(201).json({ product: created });
  }
);

// ---------- GET /products/seller/mine (Seller: view own listings) ----------
router.get("/seller/mine", requireAuth, requireRole("seller"), (req: AuthedRequest, res) => {
  const rows = db
    .prepare(`SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC`)
    .all(req.auth!.userId);
  res.json({ products: rows });
});

// ---------- GET /admin/products/pending (Admin: organic queue) ----------
router.get("/admin/pending", requireAuth, requireRole("admin"), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, s.business_name as seller_name, u.phone as seller_phone
       FROM products p
       JOIN sellers s ON s.user_id = p.seller_id
       JOIN users u ON u.id = p.seller_id
       WHERE p.type = 'organic' AND p.status = 'pending'
       ORDER BY p.created_at ASC`
    )
    .all();
  res.json({ products: rows });
});

// ---------- POST /admin/products/:id/approve ----------
router.post("/admin/:id/approve", requireAuth, requireRole("admin"), (req: AuthedRequest, res) => {
  const result = db
    .prepare(`UPDATE products SET status = 'approved' WHERE id = ? AND type = 'organic'`)
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Pending organic product not found" });
  res.json({ ok: true });
});

// ---------- POST /admin/products/:id/reject ----------
router.post("/admin/:id/reject", requireAuth, requireRole("admin"), (req: AuthedRequest, res) => {
  const result = db.prepare(`UPDATE products SET status = 'rejected' WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Product not found" });
  res.json({ ok: true });
});

// ---------- GET /admin/products (Admin: moderation - view all listings) ----------
router.get("/admin/all", requireAuth, requireRole("admin"), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, s.business_name as seller_name FROM products p
       JOIN sellers s ON s.user_id = p.seller_id ORDER BY p.created_at DESC`
    )
    .all();
  res.json({ products: rows });
});

// ---------- DELETE /admin/products/:id (Admin: remove misleading product) ----------
router.delete("/admin/:id", requireAuth, requireRole("admin"), (req: AuthedRequest, res) => {
  const result = db.prepare(`DELETE FROM products WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Product not found" });
  res.json({ ok: true });
});

// ---------- PATCH /admin/products/:id/reclassify (Admin: change classification) ----------
router.patch(
  "/admin/:id/reclassify",
  requireAuth,
  requireRole("admin"),
  (req: AuthedRequest, res) => {
    const { type } = req.body;
    if (!["organic", "natural", "eco"].includes(type)) {
      return res.status(400).json({ error: "type must be organic, natural, or eco" });
    }
    // Reclassifying to organic resets it to pending (needs a certificate + approval);
    // reclassifying to natural/eco makes it live immediately, matching creation-time rules.
    const status = type === "organic" ? "pending" : "live";
    const result = db
      .prepare(`UPDATE products SET type = ?, status = ? WHERE id = ?`)
      .run(type, status, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Product not found" });
    res.json({ ok: true });
  }
);

export default router;
