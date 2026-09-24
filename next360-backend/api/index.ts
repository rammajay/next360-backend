import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "http";
import { app, ready } from "../src/app";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await ready;
  } catch (error) {
    console.error("[db] API unavailable", error);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "The service is temporarily unavailable. Please try again shortly." }));
    return;
  }
  return (app as any)(req, res);
}
