# syntax=docker/dockerfile:1
#
# Build context is the repository root (see docker/docker-compose.yml).
#   docker build -f docker/Dockerfile -t whiskey-cellar ..

# ---------------------------------------------------------------------------
# Build: compile the React app + bundle the Node server
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Dependencies first, so layers cache unless a lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY docker/package.json docker/package-lock.json ./docker/
RUN cd docker && npm ci --no-audit --no-fund

# Source (only the exact files needed — never the local docker/node_modules,
# whose esbuild binary would be the wrong platform)
COPY index.html ./
COPY public ./public
COPY src ./src
COPY shared ./shared
COPY worker ./worker
COPY migrations ./migrations
COPY docker/server.ts docker/d1.ts docker/vite.config.docker.mts ./docker/

# React app (client-only Vite config — never touches Cloudflare) -> dist/client
RUN node_modules/.bin/vite build --config docker/vite.config.docker.mts

# Server: bundle docker/server.ts + worker/* + hono into one file.
# node:sqlite is a built-in, so nothing native to compile.
RUN docker/node_modules/.bin/esbuild docker/server.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --outfile=dist/server.mjs

# ---------------------------------------------------------------------------
# Runtime: tiny image, just Node + the three build outputs
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    DB_PATH=/data/whiskey.db \
    STATIC_DIR=/app/client \
    MIGRATIONS_DIR=/app/migrations \
    PORT=3000

RUN mkdir -p /data && chown node:node /data

COPY --from=build --chown=node:node /app/dist/server.mjs ./server.mjs
COPY --from=build --chown=node:node /app/dist/client ./client
COPY --from=build --chown=node:node /app/migrations ./migrations

USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=8s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
