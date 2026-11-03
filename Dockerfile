# syntax=docker/dockerfile:1.7
# Two images from one build:
#   web     the Next.js server (standalone output), for the ECS service
#   worker  the whole workspace with tsx, for one-off and scheduled tasks:
#           `pnpm db:migrate`, `pnpm ingest:fec 2028`, `pnpm check:ingest`, ...
# Build: docker build --target web -t civicscope-web .
#        docker build --target worker -t civicscope-worker .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
# RDS presents certificates from Amazon's own authorities, which Node doesn't trust by
# default. The app connects with TLS verification on (DB_TLS=true).
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /opt/rds/global-bundle.pem
RUN chmod 755 /opt/rds && chmod 644 /opt/rds/global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/opt/rds/global-bundle.pem
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @civicscope/web build

FROM base AS worker
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo /repo
USER node
ENTRYPOINT ["pnpm"]
CMD ["check:ingest"]

FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# ECS sets HOSTNAME to the task's own address, which would make Next.js listen only
# there, and the health check above (127.0.0.1) would never reach it. Listen everywhere.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node apps/web/server.js"]
