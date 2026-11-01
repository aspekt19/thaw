# Thaw

Подготовка документов для человека, у которого биржа заморозила вывод после AML-проверки. Это не юридическая помощь и не обещание разморозки. Санкционные случаи не берём. Приватные ключи и сид-фразы не собираем.

Сейчас в репозитории каркас и бесплатная проверка шанса: форма и `POST /api/check-chance` (тот же обработчик на `/v1/check-chance`).

## Запуск

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

Форма открывается на локальном адресе Vite. Ключи для тестов не нужны.

## Переменные окружения

Имена, без значений:

- `SERV_API_KEY`
- `SERV_MODEL`
- `SERV_REASONING_EFFORT`
- `SERV_LOG`
- `ETHERSCAN_API_KEY`
- `TRONGRID_API_KEY`
- `THAW_BANLIST_ENABLED`
- `THAW_TURNSTILE_SECRET`
- `THAW_DAILY_CHECK_LIMIT`
- `THAW_DAILY_SPEND_CAP_USD`
- `THAW_PAID_PATH_ENABLED`
- `THAW_BURST_PER_MINUTE`
- `THAW_CORS_ORIGINS`
- `THAW_RECEIPT_SECRET`

Пустые значения значат: модель не вызывается, платная проверка адресов выключена, капча не требуется, платная проверка сверх лимита выключена. `THAW_TURNSTILE_SECRET` включает проверку токена на сервере. Виджет на странице не подключён.
