import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import auth from "./routes/auth.js";
import projects from "./routes/projects.js";
import share from "./routes/share.js";
import github from "./routes/github.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);

app.route("/api/auth", auth);
app.route("/api/projects", projects);
app.route("/api", share);
app.route("/api/github", github);

app.get("/api/health", (c) => c.json({ ok: true }));

// Serve static frontend in production
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "../web/dist" }));
  // SPA fallback: serve index.html for non-API routes
  app.get("*", serveStatic({ root: "../web/dist", path: "index.html" }));
}

export default app;
