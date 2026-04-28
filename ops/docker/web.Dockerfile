# syntax=docker/dockerfile:1.7
#
# apps/web — Next.js 16 frontend (webpack build).
#
# Requires `output: "standalone"` in apps/web/next.config.ts so the
# runner stage can ship just .next/standalone + .next/static + public.
#
# Build context MUST be the repo root:
#   docker build -f ops/docker/web.Dockerfile -t instigenie/web:<tag> .

ARG NODE_VERSION=20
ARG PNPM_VERSION=9.14.2

# ─── 1. base ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache libc6-compat tini
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# ─── 2. builder: install workspace deps, build contracts, then build web ───
FROM base AS builder
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/web apps/web
RUN pnpm install --frozen-lockfile --config.engine-strict=false
# `^build` (turbo) ensures all workspace deps (e.g. @instigenie/contracts)
# compile to dist/ before next build runs.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @instigenie/web... build

# ─── 3. runner: standalone Next server ─────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nodejs

# Standalone output bundles only the deps Next actually traced — minimal.
COPY --from=builder --chown=nodejs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nodejs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nodejs:nodejs /repo/apps/web/public ./apps/web/public

USER nodejs
EXPOSE 3000

# Next.js doesn't ship a dedicated health route by default. We probe `/`
# which always returns 200 (or a redirect, which fetch follows). If you
# add a /api/health route, swap the URL below.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
