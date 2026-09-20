import { db } from "./index";
import { genId } from "../utils";

function upsertUser(phone: string, name: string, role: "buyer" | "seller" | "admin") {
  const existing = db.prepare(`SELECT id FROM users WHERE phone = ?`).get(phone) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = genId("usr");
  db.prepare(`INSERT INTO users (id, phone, name, role) VALUES (?, ?, ?, ?)`).run(id, phone, name, role);
  return id;
}

// Admin
const adminId = upsertUser("9999999999", "Platform Admin", "admin");

// Sellers (pre-approved so they can list products immediately in the demo)
const seller1 = upsertUser("9000000001", "Ravi Kumar", "seller");
const seller2 = upsertUser("9000000002", "Meera Textiles", "seller");

for (const [id, business] of [
  [seller1, "GreenLeaf Farms"],
  [seller2, "EarthKind Co"],
] as const) {
  const existing = db.prepare(`SELECT user_id FROM sellers WHERE user_id = ?`).get(id);
  if (!existing) {
    db.prepare(
      `INSERT INTO sellers (user_id, status, business_name, kyc_details) VALUES (?, 'approved', ?, ?)`
    ).run(id, business, JSON.stringify({ docType: "GSTIN", docNumber: "DEMO12345", docFileUrl: null }));
  } else {
    db.prepare(`UPDATE sellers SET status = 'approved', business_name = ? WHERE user_id = ?`).run(business, id);
  }
}

// A buyer for testing checkout
const buyerId = upsertUser("9111111111", "Test Buyer", "buyer");

// Sample products: one approved organic, one pending organic, one natural, one eco
function upsertProduct(id: string, seller: string, name: string, type: string, status: string, price: number) {
  const existing = db.prepare(`SELECT id FROM products WHERE id = ?`).get(id);
  if (existing) return;
  db.prepare(
    `INSERT INTO products (id, seller_id, name, category, type, certificate_url, status, price, stock, description, location, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    seller,
    name,
    "Demo",
    type,
    type === "organic" ? "/uploads/certificates/demo-cert.pdf" : null,
    status,
    price,
    50,
    `Seed demo product: ${name}`,
    "Hyderabad",
    `https://placehold.co/400x300?text=${encodeURIComponent(name)}`
  );
}

upsertProduct("prod_seed1", seller1, "Organic Turmeric Powder", "organic", "approved", 180);
upsertProduct("prod_seed2", seller1, "Cold-Pressed Coconut Oil", "organic", "pending", 320);
upsertProduct("prod_seed3", seller2, "Natural Jaggery Blocks", "natural", "live", 90);
upsertProduct("prod_seed4", seller2, "Bamboo Toothbrush Set", "eco", "live", 150);

console.log("Seed complete.");
console.log("Admin phone: 9999999999");
console.log("Seller phones: 9000000001, 9000000002 (both pre-approved)");
console.log("Buyer phone: 9111111111");
console.log("OTP for all logins: 123456");
