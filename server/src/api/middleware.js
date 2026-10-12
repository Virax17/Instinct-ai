import jwt from "jsonwebtoken";
import { config } from "../config.js";

export const COOKIE = "instinct_session";

export function setSession(res, userId) {
  const token = jwt.sign({ sub: String(userId) }, config.jwtSecret, {
    expiresIn: `${config.sessionDays}d`,
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
  });
}

export function requireAuth(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies[COOKIE], config.jwtSecret);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "not_authenticated" });
  }
}
