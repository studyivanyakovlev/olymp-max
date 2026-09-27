# Олимпиадный навигатор в MAX

Чат-бот в мессенджере MAX с подключённым mini app. Не даёт школьнику 8–11 класса пропустить регистрацию на олимпиаду из Перечня РСОШ: подбирает олимпиады по классу и предметам и присылает напоминания о регистрации и турах.

Проект для трека «Образовательные решения» хакатона MAX. Сдача онлайн-этапа — 30.09.2026, 23:59 МСК.

> Статус: в разработке. Полный README (запуск, переменные, порты, данные, ограничения) появится к сдаче.

## Архитектура

Модульный монолит на Node.js и TypeScript: один процесс с тремя входами (бот, REST API для mini app, планировщик напоминаний) над общими доменными сервисами. Данные в PostgreSQL. Caddy выдаёт HTTPS, раздаёт mini app и проксирует `/api` и `/webhook`.

```text
apps/
  server/        # bot + api + scheduler
  miniapp/       # React + Vite + MAX UI
packages/
  shared/        # общие типы и zod-схемы контракта API
data/            # olympiads.json, demo.json, schema.json
deploy/          # Caddyfile
```

## Стек

- Бот: [@maxhub/max-bot-api](https://github.com/max-messenger/max-bot-api-client-ts)
- API: Fastify, zod
- База: PostgreSQL 16, Drizzle ORM
- Mini app: React, Vite, [@maxhub/max-ui](https://github.com/max-community/MaxUI), MAX Bridge
- Инфраструктура: docker compose (app, db, caddy)

## Правила репозитория

- Токены, пароли и ключи не попадают в git. Настоящие значения — только в `.env`, в репозитории лежит `.env.example`.
- Изменения в `main` идут через pull request с ревью второго разработчика.
- Данные об олимпиадах подготовлены вручную по проекту Перечня олимпиад школьников на 2026/27 учебный год и официальным сайтам олимпиад. Демо-олимпиада в `data/demo.json` — тестовые данные для проверки жюри.
