# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:22-alpine AS build-base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_MAXSOCKETS=6

FROM build-base AS deps
RUN apk add --no-cache libc6-compat python3 make g++
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps --no-audit --no-fund; else npm install --legacy-peer-deps --no-audit --no-fund; fi

FROM build-base AS builder
ARG APP_VERSION=0.1.0
ENV APP_VERSION=${APP_VERSION}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM --platform=$BUILDPLATFORM node:22-alpine AS prod-deps
ARG TARGETARCH
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_MAXSOCKETS=6
COPY package.json package-lock.json* ./
RUN NPM_CPU=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "x64") && \
    if [ -f package-lock.json ]; then \
      npm ci --omit=dev --os=linux --cpu="$NPM_CPU" --libc=musl --ignore-scripts --legacy-peer-deps --no-audit --no-fund; \
    else \
      npm install --omit=dev --os=linux --cpu="$NPM_CPU" --libc=musl --ignore-scripts --legacy-peer-deps --no-audit --no-fund; \
    fi

FROM node:22-alpine AS runner
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG APP_VERSION=0.1.0
LABEL org.opencontainers.image.title="SupportDesk Enterprise AI Support & File Hub" \
      org.opencontainers.image.version="${APP_VERSION}"

RUN apk add --no-cache tini postgresql16-client curl wget tzdata \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV APP_VERSION=${APP_VERSION}
ENV STORAGE_ROOT=/var/lib/supportdesk/storage

RUN mkdir -p /var/lib/supportdesk/storage /app/logs \
  && chown -R nextjs:nodejs /var/lib/supportdesk /app

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
RUN rm -rf ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/ready >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
