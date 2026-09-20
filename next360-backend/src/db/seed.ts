

import { pool, initSchema } from "./index";
import { genId } from "../utils";

async function upsertUser(phone: string, name: string, role: "buyer" | "seller" | "admin") {
  const { rows } = await pool.query(`SELECT id FROM users WHERE phone = $1`, [phone]);
  if (rows[0]) return rows[0].id as string;
  const id = genId("usr");
  await pool.query(`INSERT INTO users (id, phone, name, role) VALUES ($1, $2, $3, $4)`, [id, phone, name, role]);
  return id;
}

async function upsertProduct(id: string, seller: string, name: string, type: string, status: string, price: number) {
  const { rows } = await pool.query(`SELECT id FROM products WHERE id = $1`, [id]);
  if (rows[0]) return;
  await pool.query(`INSERT INTO products (id, seller_id, name, category, type, certificate_url, status, price, stock, description, location, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [id, seller, name, "Demo", type, type === "organic" ? "https://example.com/demo-cert.pdf" : null, status, price, 50, `Seed demo product: ${name}`, "Hyderabad", `https://placehold.co/400x300?text=${encodeURIComponent(name)}`]);
}

async function main() {
  await initSchema();
  const seller1 = await upsertUser("9000000001", "Ravi Kumar", "seller");
  const seller2 = await upsertUser("9000000002", "Meera Textiles", "seller");
  await upsertUser("9999999999", "Platform Admin", "admin");
  await upsertUser("9111111111", "Test Buyer", "buyer");
  for (const [id, business] of [[seller1, "GreenLeaf Farms"], [seller2, "EarthKind Co"]] as const) {
    const { rows } = await pool.query(`SELECT user_id FROM sellers WHERE user_id = $1`, [id]);
    if (!rows[0]) {
      await pool.query(`INSERT INTO sellers (user_id, status, business_name, kyc_details) VALUES ($1, 'approved', $2, $3)`, [id, business, JSON.stringify({ docType: "GSTIN", docNumber: "DEMO12345", docFileUrl: null })]);
    } else {
      await pool.query(`UPDATE sellers SET status = 'approved', business_name = $1 WHERE user_id = $2`, [business, id]);
    }
  }
  await upsertProduct("prod_seed1", seller1, "Organic Turmeric Powder", "organic", "approved", 180);
  await upsertProduct("prod_seed2", seller1, "Cold-Pressed Coconut Oil", "organic", "pending", 320);
  await upsertProduct("prod_seed3", seller2, "Natural Jaggery Blocks", "natural", "live", 90);
  await upsertProduct("prod_seed4", seller2, "Bamboo Toothbrush Set", "eco", "live", 150);
  console.log("Seed complete.");
  console.log("Admin phone: 9999999999");
  console.log("Seller phones: 9000000001, 9000000002 (both pre-approved)");
  console.log("Buyer phone: 9111111111");
  console.log("OTP for all logins: 123456");
  await pool.end();
}
main().catch((err) => { console.error(err); process.exit(1); });