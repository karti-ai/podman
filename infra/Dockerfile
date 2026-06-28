# PodMan backend runtime — built from the monorepo root.
# Build:  docker build -f infra/Dockerfile -t podman-backend .
# Run API:    docker run --env-file backend/.env -e PODMAN_PROCESS=server -p 8787:8787 podman-backend
# Run agent:  docker run --env-file backend/.env -e PODMAN_PROCESS=agent podman-backend
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Install workspace deps (cached on lockfile)
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile

# Build shared + backend
FROM deps AS build
COPY . .
RUN pnpm --filter @podman/shared build && pnpm --filter @podman/backend build

# Runtime
FROM base AS runtime
ENV NODE_ENV=production
ENV PODMAN_PROCESS=server
COPY --from=build /app /app
EXPOSE 8787
CMD ["sh", "-c", "if [ \"$PODMAN_PROCESS\" = \"agent\" ]; then exec node backend/dist/agent.js; else exec node backend/dist/server.js; fi"]
