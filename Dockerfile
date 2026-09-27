# syntax=docker/dockerfile:1.7
# Один образ для api, worker и migrate (разные команды) + образ web (Caddy со статикой мини-приложения).
ARG NODE_IMAGE=node:24.21.0-slim
ARG CADDY_IMAGE=caddy:2.11.4-alpine

# 1. base: Node 24, corepack, сертификаты Минцифры в доверенных
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY infra/certs/*.crt /usr/local/share/ca-certificates/
RUN update-ca-certificates && corepack enable

# 2. deps: только манифесты и lock-файл → pnpm fetch (кэш слоя)
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile

# 3. build: установка из кэша, сборка всех пакетов, prod-выкладка api
FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm -r build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm deploy --filter @vsemdomom/api --prod --legacy /out/api
ARG GIT_COMMIT=dev
RUN printf '{"commit":"%s","builtAt":"%s"}\n' "$GIT_COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /out/api/build.json
# Статика мини-приложения (поток B); пока его нет — страница-заглушка
RUN mkdir -p /out/web \
    && if [ -f apps/miniapp/dist/index.html ]; then cp -r apps/miniapp/dist/. /out/web/; \
       else cp -r infra/web-placeholder/. /out/web/; fi

# 4. runtime-api: только прод-зависимости, пользователь node
FROM base AS runtime-api
WORKDIR /app
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/db/migrations \
    SEEDS_DIR=/app/seeds \
    BUILD_INFO_FILE=/app/build.json
COPY --from=build --chown=node:node /out/api /app
COPY --chown=node:node db/migrations /app/db/migrations
COPY --chown=node:node seeds /app/seeds
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

# 5. web: Caddy + статика мини-приложения
FROM ${CADDY_IMAGE} AS web
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY infra/Caddyfile.prod /etc/caddy/Caddyfile.prod
COPY --from=build /out/web /srv/app
EXPOSE 8080
