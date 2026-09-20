import express from "express";
import cors from "cors";
import { initSchema } from "./db";
import authRoutes from "./routes/auth";
import productRoutes from "./routes/products";
import sellerRoutes from "./routes/sellers";
import orderRoutes from "./routes/orders";
import disputeRoutes from "./routes/disputes";

export const app = express();
app.use(cors());
app.use(express.json());
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "next360-backend",
    message: "Next360 backend is running"
  });
});
app.get("/health", (_req, res) => res.json({ ok: true, service: "next360-backend" }));
app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/sellers", sellerRoutes);
app.use("/orders", orderRoutes);
app.use("/disputes", disputeRoutes);
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

export const ready = initSchema();