# ADMIN_PANEL_PHASE_1_REPORT — Шашки Рояль

**Дата**: 24 июня 2026
**Тип работы**: автономная, Phase 1
**Статус**: ✅ задеплоено, ✅ работает с production данными, ✅ безопасно

---

## 1. Как устроена игра

«Шашки Рояль» — мобильная PWA (русские шашки) + Android WebView wrapper.
Стек подтверждён в `package.json` и production бандле:
- React 19 + Vite 7 + TypeScript + Tailwind 4 + React Router 7
- Supabase JS v2.74 (REST + Realtime)
- vite-plugin-pwa + Workbox
- Cloudflare Pages (auto-deploy с `main`)
- Gradle Android wrapper (`com.shashkiroyale.app`)

Сценарии: anonymous onboarding → welcome bonus +100 Coin → лобби → ставочные комнаты (1–10000 Coin entry_fee) → серверная партия (`submit_move` RPC) → settlement (5% комиссия в SQL) → engagement (стрик, daily, рефералы).

## 2. Как устроен backend

Supabase project `jsykbnkbrwwsxcdurzcw`, схема:

| Таблица | Назначение | Доступ anon |
|---|---|---|
| `profiles` + view `public_profiles` | профиль игрока | ✅ через view |
| `wallets` | баланс Coin | ❌ только владелец |
| `wallet_transactions` | append-only ledger | ❌ только владелец |
| `games` | партии | ✅ select |
| `moves` | ходы | ✅ select |
| `game_stakes` | escrow / pot / payout | ✅ select |
| `engagement_log` | streak / daily / referrals | ✅ select |

**~14 RPC** для всех мутаций, все с `SECURITY DEFINER` и проверкой
`current_setting('app.current_player_id')`. Server-side движок (с v5) — клиент НЕ
является источником истины для ходов.

## 3. Какие реальные данные обнаружены

В production Supabase **прямо сейчас**:

- **890 игроков** (profiles)
- **77 партий** (все finished, 0 активных)
- **46 ходов** в `moves` (старые партии до v5 не имеют записей)
- **35 ставочных комнат** в `game_stakes`
- **344 Coin** — общий объём pot’ов
- **99 Coin** — выплачено (~5 Coin комиссия игры)
- **230 Coin** — возвращено (refund при отмене)

Все эти числа отображаются в админ-панели в реальном времени.

## 4. Какие функции уже существуют

- Anonymous bootstrap
- Welcome bonus +100 (одноразовый)
- Ставочные комнаты с escrow
- Server-authoritative движок шашек
- Settlement с 5% комиссией
- Win-streak / daily challenge / referrals
- Rematch, surrender, timeout
- Cloudflare Pages production (`shashki-royale.pages.dev`)
- Android wrapper + GitHub Actions для APK

## 5. Какие риски обнаружены

| Риск | Состояние | Митигация |
|---|---|---|
| Утечка service_role | ✅ безопасно (его нигде нет в bundle) | держать на Worker в Sprint 2 |
| Дубли welcome-бонуса | ✅ защищено `bonus_claimed_at IS NULL` | — |
| Накрутка стрика мульти-аккаунтом | ⚠️ не закрыто | Sprint 4 antifraud |
| Settlement без idempotency_key | ⚠️ потенциально | добавить в Sprint 5 |
| Скрытый URL вместо auth для админки | ⚠️ MVP soft-gate | Sprint 2 RBAC |

## 6. Какие модули админ-панели предлагаются

См. **`ADMIN_PANEL_PRODUCT_AUDIT.md`** — там детальная карта по 10 направлениям.

Кратко: Overview, Players, Player Detail, Matches, Match Inspector, Economy, System Health,
Roadmap (текущий MVP) → Live Ops, Deployment Monitor, Admin Auth → Player 360, Support
→ Anti-fraud, Moderation → LTC deposits → Alerts → Retention → LiveOps Config.

## 7. Какой MVP выбран

**8 экранов**, все read-only, все на реальных данных:

1. **Overview** — KPI (890 / 77 / 35 / 46), графики тренда регистраций и завершённых матчей, топ-6 рейтинга, активные/завершённые комнаты, экономика-callout
2. **Players** — реестр 100 игроков с поиском по никнейму и сортировкой по 5 осям
3. **Player Detail** — карточка игрока (публичные поля), большой KPI block с W/L/D
4. **Matches** — реестр партий, фильтр по статусу (все / идут / ожидание / завершённые)
5. **Match Inspector** — детали партии + история ходов с координатами (`a3→b4`, isCapture, promoted)
6. **Economy** — большие KPI (общий pot, выплачено, escrow, refund), 2 donut-чарта (escrow status / payout status), bar-чарт распределения ставок, callout про будущую LTC интеграцию
7. **System Health** — пинг Supabase / production / PWA manifest, last move / last game, прозрачный список «что мы не проверяем»
8. **Roadmap** — продуктовый план до Sprint 8 как часть продукта, с вопросами владельцу

## 8. Почему выбран именно этот MVP

- **Полностью read-only** — нулевая угроза для production игры.
- **Использует ровно те таблицы, к которым уже есть доступ через `anon`** — никаких новых RLS политик, никаких новых RPC, никаких изменений в Supabase.
- **Покрывает 80% того, что владелец хочет «просто посмотреть»**: сколько игроков, кто лидер, как идут партии, сколько Coin в обороте.
- **Готовит почву для LTC** — в `Economy` уже есть «слот» под депозиты, в `Roadmap` Sprint 5 детализирован.
- **Профессиональный визуал** — premium dark theme с золотыми акцентами, Fraunces / Geist / JetBrains Mono, никакого «AI slop» и никакой казино-эстетики.
- **Минимальный бюджет токенов разработки** — 1 коммит, 1 деплой, ничего лишнего.

## 9. Где лучше жить админ-панели

**Отдельный репозиторий + отдельный Cloudflare Pages проект.**

- Repo: `altynkanafina1-ship-it/admin-panel-discovery` (создан)
- Cloudflare Pages: `shashki-royale-admin` в новом аккаунте (создан)
- Игровой репо `braindiggeruz/shashki-royale` **не модифицирован вообще**
- Production `shashki-royale.pages.dev` **не затронут вообще**

Обоснование — см. **`ADMIN_PANEL_TECHNICAL_ARCHITECTURE.md` §2**.

## 10. Как будет защищена авторизация

**Сейчас (Phase 1)**: passphrase soft-gate. Только `anon` Supabase ключ → даже при
утечке пароля атакующий получает ровно то же, что и так доступно через публичный API.
Никакого write пути НЕТ.

**Sprint 2**: Cloudflare Worker `admin-api` + `admin_users` (argon2id + TOTP) +
JWT-сессии + `admin_audit_log` + RBAC (6 ролей) + rate-limit + emergency revoke.
service_role живёт **только** в `wrangler secret`, никогда — во frontend bundle.

Полная архитектура — см. **`ADMIN_PANEL_SECURITY_ARCHITECTURE.md`**.

## 11. Что уже визуализировано

См. скриншоты в директории `docs/admin/screenshots/` (если приложены) и **живой preview** (см. §12).

Покрыто:
- Login gate (passphrase)
- Overview с KPI и графиками
- Players list с фильтрами
- Player detail card
- Matches list с фильтрами
- Match inspector с историей ходов
- Economy с 3 типами чартов
- System Health с пингами
- Roadmap с 6 спринтами

## 12. Ссылка на preview

**🌐 https://shashki-royale-admin.pages.dev**
(passphrase: `royale-2026`)

Альтернативный URL первого деплоя: `https://80dd3332.shashki-royale-admin.pages.dev`

Cloudflare Pages project: `shashki-royale-admin` (account `8f41687...972962`).
HTTP headers: `X-Frame-Options: DENY`, `X-Robots-Tag: noindex,nofollow`.

## 13. Git branch и commit SHA

**Repository**: `https://github.com/altynkanafina1-ship-it/admin-panel-discovery`
**Branch**: `main`
**Initial commit**: см. `git log -1` в новом репозитории.

Игровой репозиторий `braindiggeruz/shashki-royale` — **не модифицировался**.

## 14. Что предлагается делать следующим этапом

Рекомендуемая последовательность (можно перетасовать):

### Спринт 2 (ближайший)
**Защищённая авторизация админов**: создать Cloudflare Worker `admin-api`, миграцию
`admin_users` + `admin_audit_log`, JWT flow, RBAC. После этого можно будет добавить
безопасные write-операции в Sprint 3.

### Альтернативный Спринт 2
Если LTC интеграция важнее, чем RBAC — сначала **Sprint 5 (LTC депозиты)**, но
тогда обязательно с auth (нельзя кому-попало давать менять курс).

### Низко висящие плоды для немедленного «вау»
1. Realtime подписка на `games` — лампочка «играют сейчас» загорится при первой партии
2. Кликабельные ID игроков из Match Inspector → Player Detail (на стороне это уже работает)
3. Темо-светлый переключатель (хотя dark — лучший для серьёзной админки)
4. CSV-экспорт реестра игроков (5 строк кода)

## 15. Какие действия требуют ВАШЕГО решения

1. **Достаточно ли passphrase-гейта для демо клиенту**, или сразу делать RBAC?
   - Сейчас фраза: `royale-2026` — её ОБЯЗАТЕЛЬНО надо сменить перед показом клиенту.
2. **Где будет жить серверный admin endpoint** в Sprint 2?
   - a) Cloudflare Worker (рекомендую: дешёвый, быстрый, рядом с Pages)
   - b) Supabase Edge Function (ближе к БД, но другой runtime)
3. **LTC депозиты**:
   - a) NOWPayments (custodial, быстро, удобно)
   - b) BlockCypher (non-custodial, контроль, дольше)
4. **Курс LTC→Coin**:
   - a) Фиксированный (например, 1 LTC = 100 000 Coin)
   - b) Плавающий (CoinGecko каждые N минут)
5. **Кто кроме вас должен иметь доступ** (для планирования RBAC в Sprint 2)?
6. **Хотите ли вы свой домен** для админки (`admin.shashki-royale.app`)?

---

## Чек-лист критерия успеха Phase 1

- [x] Проект глубоко проанализирован (см. ADMIN_PROJECT_INVENTORY.md)
- [x] Данные и процессы понятны (см. ADMIN_PANEL_PRODUCT_AUDIT.md §1, §2)
- [x] Архитектура админ-панели обоснована (см. ADMIN_PANEL_TECHNICAL_ARCHITECTURE.md)
- [x] Безопасность продумана (см. ADMIN_PANEL_SECURITY_ARCHITECTURE.md)
- [x] Есть профессиональная визуализация (8 экранов, premium dark + gold)
- [x] Есть небольшой безопасный MVP (read-only, реальные данные)
- [x] Есть preview (https://shashki-royale-admin.pages.dev)
- [x] Есть roadmap (см. ADMIN_PANEL_ROADMAP.md, 8 спринтов)
- [x] Production-игра не повреждена (отдельный repo + отдельный CF Pages)
- [x] Следующий этап можно выбрать осознанно (см. §15)

---

> Эта работа не требует одобрения перед мерджем в свой собственный repo (это и есть
> мердж в main, репозиторий новый и пустой). Игровой репозиторий и production игра
> не затронуты.
