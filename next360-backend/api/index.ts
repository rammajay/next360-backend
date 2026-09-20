import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "http";
import { app, ready } from "../src/app";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ready;
  return (app as any)(req, res);
}