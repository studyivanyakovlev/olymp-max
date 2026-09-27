# Олимпиадный навигатор в MAX

Чат-бот в мессенджере MAX с подключённым mini app. Помогает школьнику 8–11 класса
не пропустить регистрацию на олимпиаду из Перечня РСОШ: подбирает олимпиады по классу
и предметам и присылает напоминания о регистрации и турах.

Проект для трека «Образовательные решения» хакатона MAX. Сдача онлайн-этапа - 30.09.2026, 23:59 МСК.

> Статус: в разработке. Полный README (запуск, переменные, порты, данные, ограничения) появится к сдаче.

## Архитектура

Планируемая архитектура: модульный монолит на Node.js и TypeScript с тремя входами
(бот, REST API для mini app, планировщик напоминаний) и общими доменными сервисами.
Данные хранятся в PostgreSQL. Caddy выдаёт HTTPS, раздаёт mini app и проксирует
`/api` и `/webhook`.

```text
apps/
  server/        # бот, API и планировщик
  miniapp/       # приложение на React, Vite и MAX UI
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

## Mini app

Фронтенд находится в `apps/miniapp`. Запуск, демонстрационные данные, контракт API и
настройка MAX Bridge описаны в [README mini app](apps/miniapp/README.md).

## Правила репозитория

- Токены, пароли и ключи не попадают в git. Настоящие значения хранятся в `.env`,
  в репозитории лежит `.env.example`.
- Изменения в `main` идут через pull request с ревью второго разработчика.
- Проверенный датасет олимпиад ещё не подключён. Данные mini app сейчас вымышлены
  и используются только для демонстрации интерфейса.
