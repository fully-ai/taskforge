import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { TaskForgeDB } from "./db.js";

export interface AuthedRequest extends Request {
  user?: { id: string; username: string; role: string };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${key}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function signToken(user: { id: string; username: string; role: string }, secret: string): string {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, secret, { expiresIn: "12h" });
}

export function requireAuth(db: TaskForgeDB, secret: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const hdr = req.headers.authorization;
    if (!hdr || !hdr.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }
    try {
      const payload = jwt.verify(hdr.slice(7), secret) as { sub: string };
      const u = db.getUserById(payload.sub);
      if (!u) {
        res.status(401).json({ error: "User not found" });
        return;
      }
      req.user = { id: String(u.id), username: String(u.username), role: String(u.role) };
      next();
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  };
}
