# Thaw

Подготовка документов для человека, у которого биржа заморозила вывод после AML-проверки. Это не юридическая помощь и не обещание разморозки. Санкционные случаи не берём. Приватные ключи и сид-фразы не собираем.

Проверка шанса платная. Человек переводит USDC напрямую на наш кошелёк в Base (Arbitrum по настройке). Сумма заказа не меньше 1.00 USD и задаётся конфигом. Эта оплата зачитывается в цену дела по тому же заказу. Отдельный путь для агентов через x402 выключен, пока его явно не включат.

## Запуск и тесты

```bash
npm install
npm test
npm run typecheck
npm run build
```

Тестам не нужны ключи и сеть. `npm run dev` поднимает форму. Заказ на оплату в этом режиме отвечает, только если в окружении задан `THAW_USDC_ADDRESS`. Полный локальный режим с D1: `npx wrangler dev` после шагов ниже.

## Деплой на Workers Free

Своего домена нет: адрес будет вида `thaw.<account>.workers.dev`. Ресурсы этим репозиторием не создаются.

1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create thaw`
4. Впишите выданный `database_id` в `wrangler.toml` вместо `replace-with-d1-database-id`.
5. `npx wrangler d1 migrations apply thaw --remote`
6. Секреты, без записи в репозиторий: `npx wrangler secret put THAW_USDC_ADDRESS`, и при необходимости `ALCHEMY_API_KEY`, `SERV_API_KEY`, `TRONGRID_API_KEY`, `ETHERSCAN_API_KEY`, `THAW_RECEIPT_SECRET`, `THAW_TURNSTILE_SECRET`.
7. `npm run build`
8. `npx wrangler deploy`

## Переменные окружения

Имена, без значений:

- `THAW_USDC_ADDRESS`
- `THAW_CHECK_PRICE_USD`
- `THAW_PAYMENT_CHAIN`
- `THAW_PAYMENT_CONFIRMATIONS`
- `THAW_CASE_LIGHT_USD`
- `THAW_CASE_FULL_USD`
- `ALCHEMY_API_KEY`
- `THAW_RPC_URL_ETHEREUM`
- `THAW_RPC_URL_BASE`
- `THAW_RPC_URL_ARBITRUM`
- `SERV_API_KEY`
- `SERV_MODEL`
- `SERV_GUARD_MODEL`
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

`THAW_CHECK_PRICE_USD` не может быть ниже 1.00. Если не задан, используется 1.00. `THAW_PAYMENT_CONFIRMATIONS` — сколько подтверждений ждать; если не задан, достаточно одного блока с успешной транзакцией. `ETHERSCAN_API_KEY` не нужен для основного пути: EVM читается через RPC. `THAW_PAID_PATH_ENABLED` оставляет выключенным отдельный путь для агентов.
