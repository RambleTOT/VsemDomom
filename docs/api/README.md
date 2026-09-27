# Контракт API «Всем домом»

- `openapi.yaml` — OpenAPI 3.1, **генерируется** из zod-схем `packages/shared/src/api` (`pnpm openapi:gen`); CI проверяет, что закоммиченный файл совпадает со сгенерированным (`pnpm openapi:check`). Руками не править.
- Типы и схемы для мини-приложения: `import { IncidentDetailSchema, type IncidentDetail } from '@vsemdomom/shared'`.
- Примеры ответов для моков msw: `packages/shared/examples/*.json` (`@vsemdomom/shared/examples/incident-open.json`), проверяются тестом на соответствие схемам.
- Словарь текстов: `packages/shared/i18n/ru.json` (ключи из пакета дизайна, не переименовываются).
- Статус: **черновик волны 1** — формы ответов могут уточняться при реализации; каждое изменение — отдельным коммитом с обновлением `openapi.yaml` и записью в `CHANGELOG.md`.

## Соглашения

| Тема | Правило |
|---|---|
| Префикс и формат | `/api/v1`, JSON; даты — ISO 8601, ответы в UTC (`Z`); показывать в часовом поясе дома (`house.timezone`) |
| Идентификаторы | Публичные ID — 10 символов `A-Za-z0-9`; внутренние числовые ID наружу не отдаются |
| Авторизация | `Authorization: Bearer <token>`: сессия из `POST /api/v1/auth/max` (12 ч) или тестовый токен роли `CHECKER_TOKEN_*` |
| Dev-вход | `POST /api/v1/auth/dev {userId, role}` — только при `DEV_AUTH=true` (локально), иначе 404 |
| Ошибки | `application/problem+json`: `type`, `title`, `status`, `detail`, `code`, `traceId`; дополнительные поля по коду (`duplicateOf`, `currentVersion`, `botLink`, `mergedInto`) |
| Идемпотентность | `Idempotency-Key` на `POST /incidents` и `POST …/recalculation` — повтор возвращает первый ответ |
| Оптимистичная блокировка | `If-Match: <version>` на `POST /uk/incidents/{id}/status` и `…/merge`; устаревшая версия → 409 `version_conflict` |
| Трассировка | Каждый ответ содержит `X-Request-Id` (он же `traceId` в ошибках) |
| Флаги функций | При выключенном флаге эндпоинт отвечает 404 `feature_disabled`; значения флагов — `GET /api/v1/version` и `GET /api/v1/me` → `features` |
| Модельные данные | Поле `isModel` у домов, УК и аварий — показывать плашку «Модельные данные» |

## Коды ошибок (`code`)

| HTTP | code | Когда |
|---|---|---|
| 400 | `validation_error` (+`errors[]`: `path`, `message`) | Неверный формат запроса |
| 401 | `unauthorized`, `session_expired`, `invalid_init_data` | Нет сессии, сессия истекла, подпись initData не сошлась или она старше часа |
| 403 | `forbidden`, `not_resident`, `not_staff`, `consent_required`, `demo_code_invalid` | Нет прав (`not_resident` — нет проживания в доме; `consent_required` — сначала `POST /me/consent`) |
| 404 | `not_found`, `feature_disabled` | Нет объекта или функция выключена флагом |
| 409 | `duplicate_incident` (+`duplicateOf`), `version_conflict` (+`currentVersion`), `invalid_transition`, `incident_not_open` (+`mergedInto`), `incident_not_closed`, `dialog_not_started` (+`botLink`), `already_bound` | Конфликт состояния |
| 410 | `token_expired`, `token_used` | Ссылка собственнику или токен привязки чата больше не действуют |
| 422 | `started_at_in_future`, `confirm_old_required`, `entrance_required`, `entrance_out_of_range`, `floor_out_of_range`, `flat_out_of_range` (+`flatFrom`, `flatTo`), `registered_at_in_future`, `consent_version_mismatch`, `eta_required`, `eta_in_past`, `monthly_charge_invalid`, `text_too_long` | Бизнес-валидация |
| 429 | `rate_limited` | Лимит запросов |
| 502 | `max_unavailable` | MAX не ответил (например, при отправке заявления в личку) |

## Статус реализации

Реализованы: вход (`auth/max`, `auth/dev`), профиль (`me`, согласие, проживание, удаление, настройки), дома (поиск, краткие сведения, главная, месяц), нормы, аварии жителя (создание, просмотр, «У меня тоже», «Не у меня», АДС, «Уведомлять меня») — A6; экраны УК (аварии, статусы с `If-Match`, объединение, дома, привязка чата) — A7; ответы о восстановлении и отметки о бригаде (`observations`), повторное сообщение в АДС после «Устранено», итог (`result`) — A8. Остальные операции появятся в задачах потока A (A9 — перерасчёт и заявление, A10 — демо-инструменты, A11 — уровень 2 и собственник, A12 — песочница, A13 — опросы и акт); до этого на них отвечает 404 `not_found`. Список ведёт `apps/api/src/http/routes/index.ts` (`PENDING_OPERATIONS`), тест сверяет его с контрактом.

Вне production каждый ответ API проверяется zod-схемой контракта: расхождение — ошибка 500 в тестах.

## Payload запуска → экран

Payload приходит в `startParam` ответа `POST /api/v1/auth/max` (из `open_app` или `?startapp=`). Разрешены только `A-Za-z0-9_-`, до 512 символов.

| Payload | Житель | Сотрудник УК | Данные |
|---|---|---|---|
| `n_<houseId>` | S04, дом выбран | S04 | `GET /houses/{houseId}/summary` |
| `i_<incidentId>` | S05 | U02 + «Как житель / Как УК» | `GET /incidents/{id}`, `GET /uk/incidents/{id}` |
| `h_<houseId>` | S03 | U03 | `GET /houses/{houseId}`, `GET /uk/houses/{id}` |
| `r_<incidentId>` | S07 → S08 | U02 | `GET /incidents/{id}/result` |
| `a_<incidentId>` | S09 | U02 | `GET /incidents/{id}` → `act` |
| `o_<token>` | S10 | S10 | `GET /owner-invites/{token}` |
| `c_<token>` | «Привязать чат может только сотрудник УК» | U03, привязка чата | `GET /uk/chat-bindings/{token}` → `POST /uk/chat-bindings` |

Нет регистрации → сначала согласие и проживание (`POST /me/consent`, `PUT /me/residency`), затем экран из payload. Неизвестный payload → «Ссылка устарела».

## Отличия от таблицы эндпоинтов в плане разработки

Добавлены эндпоинты, без которых экраны не собрать:

- `POST /api/v1/auth/dev` — dev-вход вне MAX (`DEV_AUTH=true`).
- `GET /api/v1/houses/{houseId}/summary` — адрес и диапазон квартир до регистрации (S02).
- `GET /api/v1/owner-invites/{token}` — данные для S10.
- `GET /api/v1/uk/chat-bindings/{token}` — название чата на экране привязки (U03).
