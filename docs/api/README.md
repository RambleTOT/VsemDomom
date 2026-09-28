# Контракт API «Всем домом»

- `openapi.yaml` — OpenAPI 3.1, **генерируется** из zod-схем `packages/shared/src/api` (`pnpm openapi:gen`); CI проверяет, что закоммиченный файл совпадает со сгенерированным (`pnpm openapi:check`). Руками не править.
- Swagger UI с этим же контрактом — `/api/docs` на стенде (https://app.vsemdomom.ru/api/docs) и локально (http://localhost:8080/api/docs); «Authorize» — Bearer-токен сессии или тестовый токен роли.
- Типы и схемы для мини-приложения: `import { IncidentDetailSchema, type IncidentDetail } from '@vsemdomom/shared'`.
- Примеры ответов для моков msw: `packages/shared/examples/*.json` (`@vsemdomom/shared/examples/incident-open.json`), проверяются тестом на соответствие схемам.
- Словарь текстов: `packages/shared/i18n/ru.json` (ключи из пакета дизайна, не переименовываются).
- Статус: **версия 1.1.0** — полный контракт к сдаче: все эндпоинты описаны, реализованные перечислены ниже. Каждое изменение — отдельным коммитом с обновлением `openapi.yaml` (`info.version`: новые поля и эндпоинты — минорная версия, несовместимые изменения — мажорная) и записью в `CHANGELOG.md`.

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
| 403 | `forbidden`, `not_resident`, `not_staff`, `not_participant`, `consent_required`, `demo_code_invalid` | Нет прав (`not_resident` — нет проживания в доме; `not_participant` — сначала «У меня тоже»; `consent_required` — сначала `POST /me/consent`; `forbidden` — в том числе тестовым токенам на смену и удаление профиля) |
| 404 | `not_found`, `feature_disabled` | Нет объекта или функция выключена флагом |
| 409 | `duplicate_incident` (+`duplicateOf`), `version_conflict` (+`currentVersion`), `invalid_transition`, `incident_not_open` (+`mergedInto`), `incident_not_closed`, `dialog_not_started` (+`botLink`), `already_bound` | Конфликт состояния |
| 410 | `token_expired`, `token_used` | Ссылка собственнику или токен привязки чата больше не действуют |
| 422 | `started_at_in_future`, `started_at_too_old` (старше 31 дня), `confirm_old_required`, `entrance_required`, `entrance_out_of_range`, `floor_out_of_range`, `flat_out_of_range` (+`flatFrom`, `flatTo`), `registered_at_in_future`, `registered_at_before_start` (раньше начала аварии или отметки «Устранено»), `ads_number_invalid` (похоже на телефон), `consent_version_mismatch`, `eta_required`, `eta_in_past`, `monthly_charge_invalid`, `text_too_long` | Бизнес-валидация |
| 429 | `rate_limited` | Лимит запросов |
| 502 | `max_unavailable` | MAX не ответил (например, при отправке заявления в личку) |

## Статус реализации

Реализованы все операции контракта: вход (`auth/max`, `auth/dev`), профиль (`me`, согласие, проживание, удаление, настройки), дома (поиск, краткие сведения, главная, месяц), нормы, аварии жителя (создание, просмотр, «У меня тоже», «Не у меня», АДС, «Уведомлять меня») — A6; экраны УК (аварии, статусы с `If-Match`, объединение, дома, привязка чата) — A7; ответы о восстановлении и отметки о бригаде (`observations`), повторное сообщение в АДС после «Устранено», итог (`result`) — A8; перерасчёт (`recalculation`), заявление в личку (`send-to-dm`), приглашение собственника (`owner-invites`) — A9; демо-инструменты (`me/demo-uk-role`, `…/demo/neighbours`, `…/demo/time-shift`, `…/demo/reset`) — A10; очередь подтверждения жильцов (`uk/residents`, `…/confirm`, `…/reject`) — A11; сброс песочницы (`sandbox/reset`) — A12; акт без исполнителя (`act/ready`, блок `act` в карточке аварии), тепловая карта (`…/heatmap`) и запуск «Тепло ли у вас?» (`…/polls/heating`, 202; повтор в сезоне и дом без чата — 409 `invalid_transition`) — A13. Операции функций волн 2–3 при выключенном флаге отвечают 404 `feature_disabled`. Список нереализованных операций ведёт `apps/api/src/http/routes/index.ts` (`PENDING_OPERATIONS`, сейчас пуст), тест сверяет его с контрактом.

Вне production каждый ответ API проверяется zod-схемой контракта: расхождение — ошибка 500 в тестах.

## DATA-API: проверки на доме-песочнице

- `DATA-API.yaml` (формат DATA-API 1.0 организаторов) — цепочка по плану разработки: сброс песочницы → `health` → нормы ГВС → создание без входа (401) → житель сообщает → второй житель «У меня тоже» → житель пытается сменить статус УК (403) → УК «Принято» → УК «Устранено» → авария глазами жителя → расчёт перерасчёта; `cleanup` — снова сброс.
- Роли → тестовые токены (заголовок `Authorization: Bearer <токен>`): `resident` — `CHECKER_TOKEN_RESIDENT` (кв. 1), `resident2` — `CHECKER_TOKEN_RESIDENT_2` (кв. 5), `uk` — `CHECKER_TOKEN_UK`; `public` — без токена. Токены работают только при `CHECKER_API_ENABLED=true` и только с домом-песочницей `dom5sandbx`: в ней «Устранено» сразу закрывает аварию, чата и сообщений нет, поэтому цепочку можно повторять сколько угодно раз.
- `POST /api/v1/sandbox/reset` — только токен `uk` (другим — 403, при выключенном `CHECKER_API_ENABLED` — 404); удаляет аварии песочницы, проживания проверяющих остаются.
- Тела запросов и параметры песочницы — `test-data/*.json` (совпадение с сидами и с `DATA-API.yaml` сверяет тест).
- Проверки файла: валидатор организаторов (`tools/data-api/`, шаг CI «DATA-API»). Проверки поведения: тест `apps/api/test/data-api.test.ts` прогоняет цепочку против API дважды подряд; против стенда — `pnpm data-api:run --base https://app.<домен>` с токенами в окружении (`CHECKER_TOKEN_*`).
- `api.baseUrl` — стенд `https://app.vsemdomom.ru`.

## Подсказки для экранов

| Экран | Что брать из API |
|---|---|
| «Вступить в чат дома» (F12) | Показывать, только если `features.joinChat`, у проживания `inHouseChat !== true` и есть `chat.inviteLink` |
| Переключатель «Как житель / Как УК» | Только при роли `uk` в `GET /me` → `roles`; экран жителя — `GET /incidents/{id}` (у сотрудника без проживания `me: null`), экран УК — `GET /uk/incidents/{id}` |
| U04 | `GET /uk/residents?houseId=` — заявки уровня 0–1, старые сверху; `…/confirm` → уровень 2, `…/reject` → уровень прежний; счётчик на U03 — `UkHouse.pendingResidents`; при `features.trustLevels = false` экрана нет |

## Демо-инструменты

Работают только при `DEMO_MODE=true`; выключено — 403 `forbidden`, мини-приложение по `demoMode: false` в `GET /me` блок не показывает.

| Эндпоинт | Поведение |
|---|---|
| `POST /me/demo-uk-role` | Код `DEMO_UK_CODE` → роль сотрудника «УК Модельная», `staff.isDemo: true`; неверный — 403 `demo_code_invalid`; 10 попыток в минуту на пользователя (дальше 429); тестовым токенам — 403 `forbidden` |
| `POST /uk/houses/{id}/demo/neighbours` | Пять модельных соседей уровня 1 в текущую аварию дома (`UkHouseDetail.demo.activeIncidentId`), разные подъезды; повтор — `added: 0`; нет открытой аварии — 409 `incident_not_open`. Через `DEMO_NEIGHBOUR_ANSWER_DELAY_SEC` после вопроса о восстановлении (или после добавления, если вопрос уже задан) соседи отвечают «Да» |
| `POST /uk/incidents/{id}/demo/time-shift` | Начало аварии на 6 ч назад, `version` +1, событие `demo_time_shift` (`payload`: `hours`, `from`, `to`); пересчитываются сроки от начала аварии (устранение, допустимый перерыв), срок ответа УК и локализации — нет; ответ — `UkIncidentDetail`; закрытая или объединённая авария — 409 `incident_not_open` |
| `POST /uk/houses/{id}/demo/reset` | Удаляет аварии, созданные при проверке, и пересоздаёт историю дома; проживания и роли остаются; `removedIncidents` — сколько аварий удалено |

Инструменты дома — только демо-роли своей УК и только в модельных домах (иначе 403 `forbidden`, чужая УК — 403 `not_staff`, песочница — 404). Модельные записи помечены `isModel` / `payload.model: true`.

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
