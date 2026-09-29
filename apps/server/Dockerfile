# --- Этап 1: Сборка shared, сервера и Mini App ---
FROM node:22-alpine AS builder

WORKDIR /app

# Копируем манифесты монорепозитория
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/miniapp/package.json ./apps/miniapp/

# postinstall мини-приложения (msw init) выполним после копирования исходников
RUN npm ci --ignore-scripts

# Копируем исходный код
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
COPY apps/miniapp ./apps/miniapp
COPY data ./data

# Ник бота для ссылок «Поделиться» в Mini App (https://max.ru/<ник>?startapp=...)
ARG VITE_BOT_NAME=
ENV VITE_BOT_NAME=$VITE_BOT_NAME

RUN npm --workspace=packages/shared run build
RUN npm --workspace=apps/server run build
RUN npm --workspace=apps/miniapp run build

# --- Этап 2: Продакшн образ ---
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/miniapp/package.json ./apps/miniapp/

RUN npm ci --omit=dev --ignore-scripts

# Собранный код, данные, сертификат Минцифры для MAX Bot API и HTML-страницы сервера
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/miniapp/dist ./apps/miniapp/dist
COPY apps/server/certs ./apps/server/certs
COPY apps/server/src/api/app.html apps/server/src/api/playground.html ./apps/server/src/api/
COPY data ./data

EXPOSE 3000

# Сервер запускается из apps/server: оттуда он находит ../miniapp/dist и ../../data
CMD ["npm", "--workspace=apps/server", "run", "start"]
