# syntax=docker/dockerfile:1.7
#
# apps/api — Fastify HTTP service.
#
# Surface: /health /healthz /readyz /metrics + business routes (auth, crm, ...).
# Listens on PORT (default 4000). See apps/api/src/env.ts.
#
# Build context MUST be the repo root, not apps/api:
#   docker build -f ops/docker/api.Dockerfile -t instigenie/api:<tag> .

ARG NODE_VERSION=20
ARG PNPM_VERSION=9.14.2

# ─── 1. base ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache libc6-compat tini
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /repo

# ─── 2. builder: install all workspace deps, build packages + this app ─────
FROM base AS builder
# Workspace metadata first — best layer caching when only source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/api apps/api
# Engine override: root package.json requires node >=22, image is node 20.
RUN pnpm install --frozen-lockfile --config.engine-strict=false
RUN pnpm --filter @instigenie/api... build
# Produce a self-contained, prod-only deployment dir for the api package.
# Requires apps/api/package.json to declare `"files": ["dist"]`.
RUN pnpm --filter @instigenie/api deploy --prod /deploy

# ─── 3. runner: minimal image, non-root user ───────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nodejs
COPY --from=builder --chown=nodejs:nodejs /deploy ./
USER nodejs

EXPOSE 4000

# /healthz is the liveness endpoint; /readyz checks pg + redis.
# Use Node's built-in fetch (Node ≥18) so we don't ship curl/wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
