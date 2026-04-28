# syntax=docker/dockerfile:1.7
#
# apps/listen-notify — bridges Postgres outbox.events → BullMQ.
#
# Talks to Postgres DIRECTLY (NOT through PgBouncer — the process exits
# fatally on boot if DATABASE_DIRECT_URL routes through a pooler; see
# packages/db/src/direct-url.ts → assertDirectPgUrl()).
#
# /healthz + /metrics on LISTEN_NOTIFY_PORT (default 4002). Set to 0 to
# disable the HTTP surface; you must then disable the HEALTHCHECK below.
#
# Build context MUST be the repo root:
#   docker build -f ops/docker/listen-notify.Dockerfile -t instigenie/listen-notify:<tag> .

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
COPY apps/listen-notify apps/listen-notify
RUN pnpm install --frozen-lockfile --config.engine-strict=false
RUN pnpm --filter @instigenie/listen-notify... build
# Requires apps/listen-notify/package.json to declare `"files": ["dist"]`.
RUN pnpm --filter @instigenie/listen-notify deploy --prod /deploy

# ─── 3. runner ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production
ENV LISTEN_NOTIFY_PORT=4002

RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nodejs
COPY --from=builder --chown=nodejs:nodejs /deploy ./
USER nodejs

EXPOSE 4002

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.LISTEN_NOTIFY_PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
