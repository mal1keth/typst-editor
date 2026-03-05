import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { signToken } from "../lib/jwt.js";
import { requireAuth } from "../middleware/auth.js";
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from "../lib/password.js";

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

// --- Email/Password Auth ---

auth.post("/register", async (c) => {
  const body = await c.req.json<{
    email: string;
    password: string;
    displayName: string;
  }>();

  if (!body.email?.trim() || !body.password || !body.displayName?.trim()) {
    return c.json(
      { error: "Email, password, and display name are required" },
      400
    );
  }

  const email = body.email.trim().toLowerCase();
  const displayName = body.displayName.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Invalid email format" }, 400);
  }

  const pwError = validatePasswordStrength(body.password);
  if (pwError) {
    return c.json({ error: pwError }, 400);
  }

  // Check if email already exists for email auth
  const existing = await db.query.users.findFirst({
    where: and(
      eq(schema.users.authProvider, "email"),
      eq(schema.users.email, email)
    ),
  });

  if (existing) {
    return c.json(
      { error: "An account with this email already exists" },
      409
    );
  }

  const hashedPw = await hashPassword(body.password);
  const userId = nanoid();

  await db.insert(schema.users).values({
    id: userId,
    authProvider: "email",
    authProviderId: email,
    email,
    displayName,
    passwordHash: hashedPw,
  });

  const jwt = await signToken({ userId });
  setAuthCookie(c, jwt);
  return c.json({ ok: true, userId }, 201);
});

auth.post("/login", async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();

  if (!body.email?.trim() || !body.password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  const email = body.email.trim().toLowerCase();

  // Look up by email across all providers (so GitHub users with passwords can also login)
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  if (!user || !user.passwordHash) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const jwt = await signToken({
    userId: user.id,
    githubLogin: user.githubLogin || undefined,
  });
  setAuthCookie(c, jwt);
  return c.json({ ok: true });
});

auth.post("/set-password", requireAuth, async (c) => {
  const { userId } = c.get("user");
  const body = await c.req.json<{
    password: string;
    currentPassword?: string;
  }>();

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });

  if (!user) return c.json({ error: "User not found" }, 404);

  // If user already has a password, require current password
  if (user.passwordHash) {
    if (!body.currentPassword) {
      return c.json({ error: "Current password required" }, 400);
    }
    const valid = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!valid) {
      return c.json({ error: "Current password is incorrect" }, 401);
    }
  }

  const pwError = validatePasswordStrength(body.password);
  if (pwError) return c.json({ error: pwError }, 400);

  const hashedPw = await hashPassword(body.password);

  await db
    .update(schema.users)
    .set({
      passwordHash: hashedPw,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.users.id, userId));

  return c.json({ ok: true });
});

// --- GitHub OAuth ---

auth.get("/github", (c) => {
  // Clear stale connect cookie to prevent accidental linking
  deleteCookie(c, "connect_github_user_id");

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

// Connect GitHub to existing account (authenticated user)
auth.get("/connect-github", requireAuth, (c) => {
  const { userId } = c.get("user");

  setCookie(c, "connect_github_user_id", userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 600,
    path: "/",
  });

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

  const tokenRes = await fetch(
    "https://github.com/login/oauth/access_token",
    {
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
    }
  );

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

  // Check if this is a "connect GitHub to existing account" flow
  const connectUserId = getCookie(c, "connect_github_user_id");

  if (connectUserId) {
    deleteCookie(c, "connect_github_user_id");
    deleteCookie(c, "oauth_state");

    // Check if this GitHub account is already linked to a different user
    const existingGithubUser = await db.query.users.findFirst({
      where: and(
        eq(schema.users.authProvider, "github"),
        eq(schema.users.authProviderId, String(githubUser.id))
      ),
    });

    if (existingGithubUser && existingGithubUser.id !== connectUserId) {
      return c.redirect("/?error=github_already_linked");
    }

    // Update existing user with GitHub credentials
    await db
      .update(schema.users)
      .set({
        githubId: githubUser.id,
        githubLogin: githubUser.login,
        githubAccessToken: tokenData.access_token,
        avatarUrl: githubUser.avatar_url,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.users.id, connectUserId));

    const jwt = await signToken({
      userId: connectUserId,
      githubLogin: githubUser.login,
    });
    setAuthCookie(c, jwt);
    return c.redirect("/?github_connected=true");
  }

  // Normal OAuth login flow
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

/* Google OAuth - temporarily disabled
auth.get("/google", (c) => { ... });
auth.get("/google/callback", async (c) => { ... });
*/

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
      githubId: true,
      displayName: true,
      avatarUrl: true,
      passwordHash: true,
      createdAt: true,
    },
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const { passwordHash, ...rest } = user;
  return c.json({
    ...rest,
    hasPassword: !!passwordHash,
    hasGithub: !!user.githubLogin,
  });
});

export default auth;
