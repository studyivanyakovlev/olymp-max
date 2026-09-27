FROM node:22-alpine AS build
WORKDIR /app
COPY apps/miniapp/package.json apps/miniapp/pnpm-lock.yaml apps/miniapp/pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY apps/miniapp/ ./
RUN pnpm build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv/miniapp
