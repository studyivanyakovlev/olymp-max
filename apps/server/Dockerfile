# --- Этап 1: Сборка TypeScript ---
FROM node:22-alpine AS builder

WORKDIR /app

# Копируем манифесты монорепозитория
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/miniapp/package.json ./apps/miniapp/

RUN npm ci

# Копируем исходный код
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
COPY data ./data

# Собираем shared и server
RUN npm --workspace=packages/shared run build || true
RUN npm --workspace=apps/server run build

# --- Этап 2: Продакшн образ ---
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/miniapp/package.json ./apps/miniapp/

RUN npm ci --omit=dev

# Копируем собранный dist и данные
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/packages/shared ./packages/shared
COPY data ./data

EXPOSE 3000

CMD ["npm", "--workspace=apps/server", "run", "start"]
