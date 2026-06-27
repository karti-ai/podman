# PodMan backend agent — built from the monorepo root.
# Build:  docker build -f infra/Dockerfile -t podman-backend .
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
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
COPY --from=build /app /app
EXPOSE 8787
CMD ["node", "backend/dist/index.js"]
