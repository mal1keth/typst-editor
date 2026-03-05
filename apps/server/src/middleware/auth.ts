import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verifyToken, type JWTPayload } from "../lib/jwt.js";

declare module "hono" {
  interface ContextVariableMap {
    user: JWTPayload;
  }
}

export const requireAuth = createMiddleware(async (c, next) => {
  const token =
    getCookie(c, "token") ||
    c.req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return c.json({ error: "Invalid token" }, 401);
  }

  c.set("user", payload);
  await next();
});
