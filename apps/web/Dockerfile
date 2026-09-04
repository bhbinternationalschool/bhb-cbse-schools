# syntax=docker/dockerfile:1
# BHB CBSE Schools — Cloud Run (npm workspaces)
# Use Debian (glibc), not Alpine — Tailwind v4 / lightningcss needs linux-x64-gnu.
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web ./apps/web
COPY packages/time ./packages/time

RUN npm ci \
  && npm install --no-save --workspace=web \
       lightningcss-linux-x64-gnu@1.32.0 \
       @tailwindcss/oxide-linux-x64-gnu@4.3.2

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL=https://bhbinternational.school
ARG NEXT_PUBLIC_DEMO_AUTH=true
ARG NEXT_PUBLIC_SCHOOL_NAME="BHB International School"
ARG NEXT_PUBLIC_TENANT_SLUG=bhb-international
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_PAYMENT_GATEWAY

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_DEMO_AUTH=$NEXT_PUBLIC_DEMO_AUTH
ENV NEXT_PUBLIC_SCHOOL_NAME=$NEXT_PUBLIC_SCHOOL_NAME
ENV NEXT_PUBLIC_TENANT_SLUG=$NEXT_PUBLIC_TENANT_SLUG
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_PAYMENT_GATEWAY=$NEXT_PUBLIC_PAYMENT_GATEWAY
ENV NODE_OPTIONS=--max-old-space-size=4096

# Track C desk cutover — NEXT_PUBLIC_*_READ_FROM_DB baked into client bundle
# Committed source of truth (deploy/desk-cutover-build.env), so a Cloud Build
# trigger with no .env.local can build. Matches the live service exactly.
COPY deploy/desk-cutover-build.env ./desk-cutover-build.env

RUN set -a \
  && . ./desk-cutover-build.env \
  && set +a \
  && test -x apps/web/node_modules/.bin/next \
  && npm run build -w web

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL=https://bhbinternational.school
ARG NEXT_PUBLIC_DEMO_AUTH=true
ARG NEXT_PUBLIC_SCHOOL_NAME="BHB International School"
ARG NEXT_PUBLIC_TENANT_SLUG=bhb-international
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_PAYMENT_GATEWAY

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_DEMO_AUTH=$NEXT_PUBLIC_DEMO_AUTH
ENV NEXT_PUBLIC_SCHOOL_NAME=$NEXT_PUBLIC_SCHOOL_NAME
ENV NEXT_PUBLIC_TENANT_SLUG=$NEXT_PUBLIC_TENANT_SLUG
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_PAYMENT_GATEWAY=$NEXT_PUBLIC_PAYMENT_GATEWAY

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
