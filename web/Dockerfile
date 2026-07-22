# syntax=docker/dockerfile:1.7
FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS build
WORKDIR /app/web
ENV NEXT_TELEMETRY_DISABLED=1 CI=true
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build
# Image optimization is disabled; exclude Sharp/libvips from the runtime trace.
RUN find .next/standalone -type d \( -path '*/node_modules/sharp' -o -path '*/node_modules/@img' \) \
      -prune -exec rm -rf '{}' + \
    && test -z "$(find .next/standalone -path '*/node_modules/sharp/package.json' -print -quit)"

FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS runtime
ARG BUILD_VERSION=development
ARG BUILD_COMMIT=unknown
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 BUILD_VERSION=$BUILD_VERSION BUILD_COMMIT=$BUILD_COMMIT
LABEL org.opencontainers.image.title="PactAgent web" \
      org.opencontainers.image.version=$BUILD_VERSION \
      org.opencontainers.image.revision=$BUILD_COMMIT \
      org.opencontainers.image.source="https://github.com/pactagent/pactagent"
RUN groupadd --system --gid 1001 pactagent && useradd --system --uid 1001 --gid pactagent pactagent
# The standalone runtime only needs Node; remove npm and its bundled dependencies.
RUN corepack disable && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build --chown=pactagent:pactagent /app/web/public ./public
COPY --from=build --chown=pactagent:pactagent /app/web/.next/standalone ./
COPY --from=build --chown=pactagent:pactagent /app/web/.next/static ./.next/static
USER pactagent
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
