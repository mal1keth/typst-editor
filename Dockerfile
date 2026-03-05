# Build frontend
FROM node:22-slim AS web-builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile
COPY apps/web/ apps/web/
RUN pnpm --filter @typst-editor/web build

# Build server
FROM node:22-slim AS server-builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile
COPY apps/server/ apps/server/

# Production
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod

COPY --from=web-builder /app/apps/web/dist apps/web/dist
COPY apps/server/ apps/server/

# Serve static frontend from the server
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

VOLUME ["/app/apps/server/data"]

CMD ["pnpm", "--filter", "@typst-editor/server", "dev"]
