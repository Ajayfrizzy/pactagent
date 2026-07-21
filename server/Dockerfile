# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build
WORKDIR /app/server
ENV CI=true
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/prisma ./prisma
COPY server/prisma.config.ts server/tsconfig.json ./
COPY server/src ./src
COPY shared ../shared
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate && npm run build

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS production-deps
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
COPY server/prisma ./prisma
COPY server/prisma.config.ts ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime
ARG BUILD_VERSION=development
ARG BUILD_COMMIT=unknown
WORKDIR /app/server
ENV NODE_ENV=production PORT=4000 BUILD_VERSION=$BUILD_VERSION BUILD_COMMIT=$BUILD_COMMIT
LABEL org.opencontainers.image.title="PactAgent server" \
      org.opencontainers.image.version=$BUILD_VERSION \
      org.opencontainers.image.revision=$BUILD_COMMIT \
      org.opencontainers.image.source="https://github.com/pactagent/pactagent"
RUN groupadd --system --gid 1001 pactagent && useradd --system --uid 1001 --gid pactagent pactagent
RUN corepack disable && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=production-deps --chown=pactagent:pactagent /app/server/node_modules ./node_modules
COPY --from=build --chown=pactagent:pactagent /app/server/node_modules/.prisma ./node_modules/.prisma
COPY --from=production-deps --chown=pactagent:pactagent /app/server/package.json ./package.json
COPY --from=production-deps --chown=pactagent:pactagent /app/server/prisma ./prisma
COPY --from=build --chown=pactagent:pactagent /app/server/dist ./dist
USER pactagent
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]

FROM build AS migrate
ARG BUILD_VERSION=development
ARG BUILD_COMMIT=unknown
ENV NODE_ENV=production
LABEL org.opencontainers.image.title="PactAgent migrations" \
      org.opencontainers.image.version=$BUILD_VERSION \
      org.opencontainers.image.revision=$BUILD_COMMIT
RUN groupadd --system --gid 1001 pactagent && useradd --system --uid 1001 --gid pactagent pactagent
RUN corepack disable \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && rm -rf node_modules/@cyclonedx node_modules/.bin/cyclonedx-npm package.json package-lock.json
USER pactagent
CMD ["sh", "-c", "node dist/scripts/auditTenantIntegrity.js && node node_modules/prisma/build/index.js migrate deploy"]
