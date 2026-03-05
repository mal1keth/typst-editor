import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { signToken } from "../lib/jwt.js";
import { requireAuth } from "../middleware/auth.js";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const BASE_URL = process.env.BASE_URL || "http://localhost:5173";

const auth = new Hono();

async function upsertUser(opts: {
  authProvider: string;
  authProviderId: string;
  email?: string | null;
  githubId?: number | null;
  githubLogin?: string | null;
  displayName: string;
  avatarUrl?: string | null;
  githubAccessToken?: string | null;
}): Promise<string> {
  const existing = await db.query.users.findFirst({
    where: and(
      eq(schema.users.authProvider, opts.authProvider),
      eq(schema.users.authProviderId, opts.authProviderId)
    ),
  });

  if (existing) {
    await db
      .update(schema.users)
      .set({
        displayName: opts.displayName,
        avatarUrl: opts.avatarUrl,
        email: opts.email,
        githubLogin: opts.githubLogin,
        githubAccessToken: opts.githubAccessToken,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.users.id, existing.id));
    return existing.id;
  }

  const userId = nanoid();
  await db.insert(schema.users).values({
    id: userId,
    authProvider: opts.authProvider,
    authProviderId: opts.authProviderId,
    email: opts.email,
    githubId: opts.githubId,
    githubLogin: opts.githubLogin,
    displayName: opts.displayName,
    avatarUrl: opts.avatarUrl,
    githubAccessToken: opts.githubAccessToken,
  });
  return userId;
}

function setAuthCookie(c: any, jwt: string) {
  setCookie(c, "token", jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });
}

// --- GitHub OAuth ---

auth.get("/github", (c) => {
  const state = nanoid();
  setCookie(c, "oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 600,
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${BASE_URL}/api/auth/github/callback`,
    scope: "repo user:email",
    state,
  });

  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

auth.get("/github/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token) {
    return c.json({ error: "Failed to get access token" }, 400);
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const githubUser = (await userRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
    email: string | null;
  };

  const userId = await upsertUser({
    authProvider: "github",
    authProviderId: String(githubUser.id),
    email: githubUser.email,
    githubId: githubUser.id,
    githubLogin: githubUser.login,
    displayName: githubUser.name || githubUser.login,
    avatarUrl: githubUser.avatar_url,
    githubAccessToken: tokenData.access_token,
  });

  const jwt = await signToken({ userId, githubLogin: githubUser.login });
  setAuthCookie(c, jwt);
  deleteCookie(c, "oauth_state");
  return c.redirect("/");
});

// --- Google OAuth ---

auth.get("/google", (c) => {
  const state = nanoid();
  setCookie(c, "oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 600,
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${BASE_URL}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return c.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
});

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: `${BASE_URL}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token) {
    return c.json({ error: "Failed to get access token" }, 400);
  }

  // Get user info
  const userRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    }
  );
  const googleUser = (await userRes.json()) as {
    id: string;
    email: string;
    name: string;
    picture: string;
  };

  const userId = await upsertUser({
    authProvider: "google",
    authProviderId: googleUser.id,
    email: googleUser.email,
    displayName: googleUser.name,
    avatarUrl: googleUser.picture,
  });

  const jwt = await signToken({ userId });
  setAuthCookie(c, jwt);
  deleteCookie(c, "oauth_state");
  return c.redirect("/");
});

// --- Common ---

auth.post("/logout", (c) => {
  deleteCookie(c, "token");
  return c.json({ ok: true });
});

// Dev-only: quick login without OAuth
auth.get("/dev-login", async (c) => {
  if (process.env.NODE_ENV === "production") {
    return c.json({ error: "Not available" }, 404);
  }

  const userId = await upsertUser({
    authProvider: "dev",
    authProviderId: "1",
    displayName: "Dev User",
    githubLogin: "dev-user",
    githubId: 1,
  });

  const jwt = await signToken({ userId, githubLogin: "dev-user" });
  setAuthCookie(c, jwt);
  return c.redirect("/");
});

auth.get("/me", requireAuth, async (c) => {
  const { userId } = c.get("user");
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: {
      id: true,
      authProvider: true,
      email: true,
      githubLogin: true,
      displayName: true,
      avatarUrl: true,
      createdAt: true,
    },
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json(user);
});

export default auth;
