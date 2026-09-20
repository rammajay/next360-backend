import express from "express";
import cors from "cors";
import path from "path";
import "./db"; // initializes schema on import

import authRoutes from "./routes/auth";
import productRoutes from "./routes/products";
import sellerRoutes from "./routes/sellers";
import orderRoutes from "./routes/orders";
import disputeRoutes from "./routes/disputes";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Serve uploaded certificates/KYC docs statically so the frontend can view them
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/health", (_req, res) => res.json({ ok: true, service: "next360-backend" }));

app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/sellers", sellerRoutes);
app.use("/orders", orderRoutes);
app.use("/disputes", disputeRoutes);

// Central error handler (Express 5 forwards async errors here automatically)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Next360 backend running on http://localhost:${PORT}`);
});
