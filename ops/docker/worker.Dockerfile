# syntax=docker/dockerfile:1.7
#
# apps/worker — BullMQ worker (critical / high / default / pdf / scheduler).
#
# The worker exposes /healthz + /metrics on WORKER_PORT (default 4001).
# Set WORKER_PORT=0 to disable the metrics server entirely.
#
# Build context MUST be the repo root:
#   docker build -f ops/docker/worker.Dockerfile -t instigenie/worker:<tag> .

ARG NODE_VERSION=20
ARG PNPM_VERSION=9.14.2

# ─── 1. base ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache libc6-compat tini
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# ─── 2. builder ────────────────────────────────────────────────────────────
FROM base AS builder
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/worker apps/worker
RUN pnpm install --frozen-lockfile --config.engine-strict=false
RUN pnpm --filter @instigenie/worker... build
# Self-contained prod-only deployment dir.
# Requires apps/worker/package.json to declare `"files": ["dist"]`.
RUN pnpm --filter @instigenie/worker deploy --prod /deploy

# ─── 3. runner ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production
ENV WORKER_PORT=4001

RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nodejs
COPY --from=builder --chown=nodejs:nodejs /deploy ./
USER nodejs

EXPOSE 4001

# /healthz on the metrics port. If WORKER_PORT=0, drop the HEALTHCHECK at
# orchestrator level (compose: healthcheck.disable: true) — the process
# is a daemon with no HTTP surface.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.WORKER_PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
