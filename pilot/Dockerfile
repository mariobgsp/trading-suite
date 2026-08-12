# ── Pilot frontend build (TanStack Start + Hono) ─────────────────────────────
# Production image: builds the SSR bundle + client with Bun, then serves via
# the Hono gateway (server/index.ts) on Node 22 — matching the validated
# local setup (build output goes to dist/, start runs the Hono server).

# ── Stage 1: install + build ─────────────────────────────────────────────────
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV NODE_ENV=production
RUN bun run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    API_TARGET=http://backend:8000

RUN addgroup --system --gid 1001 pilot \
    && adduser --system --uid 1001 pilot

# Runtime needs: built output, the Hono server source, and the runtime
# deps for tsx (server/index.ts is TS, run through tsx).
COPY --from=builder --chown=pilot:pilot /app/dist ./dist
COPY --from=builder --chown=pilot:pilot /app/server ./server
COPY --from=builder --chown=pilot:pilot /app/package.json ./package.json
COPY --from=builder --chown=pilot:pilot /app/node_modules ./node_modules

USER pilot
EXPOSE 3001
CMD ["npx", "tsx", "server/index.ts"]
