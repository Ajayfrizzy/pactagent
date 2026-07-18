# syntax=docker/dockerfile:1.7
FROM node:20.19.5-bookworm-slim@sha256:9e70124bd00f47dd023e349cd587132ae61892acc0e47ed641416c3e18f401c3 AS build
WORKDIR /app/server
ENV CI=true
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/prisma ./prisma
COPY server/prisma.config.ts server/tsconfig.json ./
COPY server/src ./src
COPY shared ../shared
RUN npx prisma generate && npm run build

FROM node:20.19.5-bookworm-slim@sha256:9e70124bd00f47dd023e349cd587132ae61892acc0e47ed641416c3e18f401c3 AS production-deps
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
COPY server/prisma ./prisma
COPY server/prisma.config.ts ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20.19.5-bookworm-slim@sha256:9e70124bd00f47dd023e349cd587132ae61892acc0e47ed641416c3e18f401c3 AS runtime
WORKDIR /app/server
ENV NODE_ENV=production PORT=4000
RUN groupadd --system --gid 1001 pactagent && useradd --system --uid 1001 --gid pactagent pactagent
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
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 pactagent && useradd --system --uid 1001 --gid pactagent pactagent
USER pactagent
CMD ["npx", "prisma", "migrate", "deploy"]
