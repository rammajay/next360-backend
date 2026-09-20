import crypto from "crypto";
import jwt from "jsonwebtoken";

export const JWT_SECRET = process.env.JWT_SECRET || "next360-dev-secret-change-in-prod";

export function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export interface AuthPayload {
  userId: string;
  role: "buyer" | "seller" | "admin";
  phone: string;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

// PRD section 6: Commission = 10-20%, seller payout = order value - commission.
// Fixed at 15% (mid-range) since the PRD gives a range, not a fixed number,
// and doesn't specify what decides the exact rate within it.
export const COMMISSION_RATE = 0.15;

export function calcCommission(orderValue: number) {
  const commission = Math.round(orderValue * COMMISSION_RATE * 100) / 100;
  const payout = Math.round((orderValue - commission) * 100) / 100;
  return { commission, payout };
}
