# Развёртывание на сервере

Стенд — один VPS с Docker. Всё живёт на одном адресе `https://app.<домен>`: мини-приложение в корне, API — `/api/*`, webhook MAX — `/webhook/max`, проверки — `/health` и `/ready`, политика данных — `/privacy`. Сертификат Let's Encrypt выпускает Caddy сам.

Ниже `app.<домен>` — ваш адрес стенда, `<IP>` — адрес сервера. Команды на сервере выполняются от `root` (или через `sudo`).

## 0. Что понадобится

- VPS: Ubuntu 24.04, не меньше 2 vCPU, 2 ГБ RAM и 20 ГБ диска, публичный IPv4. Оплатить минимум до 30.10.
- Домен, в котором можно добавить DNS-запись.
- Токен бота MAX и имя бота (от организаторов). Можно подключить позже — до этого стенд работает в режиме симулятора.
- Файл `.env.stand` с секретами стенда — лежит в корне проекта на вашем компьютере, в Git не попадает. В нём уже сгенерированы пароль базы, секрет сессий, секрет webhook, тестовые токены проверяющих и демо-код УК.

## 1. DNS

Добавьте A-запись: `app` → `<IP>`. Проверка с вашего компьютера (может занять до часа):

```bash
dig +short app.<домен>
```

Должен вернуться `<IP>`.

## 2. Сервер: обновления, swap, брандмауэр

```bash
ssh root@<IP>
apt update && apt -y upgrade
```

Swap на 2 ГБ — без него сборка образов на 2 ГБ памяти может упасть:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Брандмауэр: SSH, 80 (выпуск сертификата) и 443 (мини-приложение, API и webhook — MAX доставляет события только на порт 443):

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
```

## 3. Docker

Установка из официального репозитория Docker:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt update && apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker compose version
```

Нужна Docker Compose 2.24 или новее.

## 4. Код

```bash
git clone https://github.com/RambleTOT/VsemDomom.git /opt/app
cd /opt/app
```

Короткая команда для compose (пригодится дальше):

```bash
echo "alias dc='docker compose -f /opt/app/compose.yaml -f /opt/app/infra/compose.prod.yaml'" >> ~/.bashrc
source ~/.bashrc
```

## 5. Секреты

С вашего компьютера, из корня проекта:

```bash
scp .env.stand root@<IP>:/opt/app/.env
```

На сервере:

```bash
chmod 600 /opt/app/.env
nano /opt/app/.env
```

Заполните строки с пометкой «ЗАПОЛНИТЬ»:

| Переменная | Значение |
|---|---|
| `DOMAIN` | `app.<домен>` — без `https://` |
| `REDIRECT_DOMAINS` | Необязательно: адреса через пробел, которые перенаправляются на `DOMAIN`, например `<домен> www.<домен>` (для них тоже нужны A-записи) |
| `PUBLIC_BASE_URL` | `https://app.<домен>` |
| `MAX_BOT_TOKEN` | Токен бота. Если токена ещё нет — оставьте пустым и поставьте `MAX_MODE=simulator` |
| `MAX_BOT_USERNAME` | Имя бота без `@`, как в ссылке `https://max.ru/<имя>` |
| `SEED_UK_STAFF_MAX_IDS`, `ALERT_USER_ID` | Пока пусто — заполняются в шаге 10 |

Сохраните копию `.env` в менеджер паролей команды. В Git он не попадает: `git status` на сервере должен быть чистым.

На стенде приложение всегда работает с `NODE_ENV=production` и `DEV_AUTH=false` (их задаёт `infra/compose.prod.yaml`), а без своих `SESSION_SECRET`, `MAX_WEBHOOK_SECRET` (не короче 32 символов) и `POSTGRES_PASSWORD` compose не стартует — в `.env.stand` они уже есть.

## 6. Первый запуск

```bash
cd /opt/app
export GIT_COMMIT=$(git rev-parse --short HEAD)
dc up -d --build
dc ps
```

Первая сборка — 5–10 минут. Ожидается: `db`, `api`, `worker`, `web` — `running` (у `api` и `worker` — `healthy`), `migrate` — `exited (0)`: он применил миграции и сиды и завершился.

Если `api` или `migrate` не стартуют — `dc logs migrate api`: при ошибке настроек там список «Неверная конфигурация: …». Значения из `.env.example` в production не принимаются — это нормально, нужны свои.

## 7. Проверка HTTPS

С вашего компьютера (из внешней сети):

```bash
curl -fsS https://app.<домен>/health
```

```bash
curl -fsS https://app.<домен>/ready
```

```bash
curl -fsS https://app.<домен>/api/v1/version
```

Ожидается: `{"status":"ok"}`; `/ready` — `"status":"ok"`; в `version` — `commit`, равный `GIT_COMMIT`. Сертификат и полная цепочка (нужны MAX для webhook):

```bash
openssl s_client -connect app.<домен>:443 -servername app.<домен> -showcerts </dev/null 2>/dev/null | grep -E '^ *[0-9] s:| i:'
```

Должны быть видны сертификат `app.<домен>` и промежуточный Let's Encrypt. Страница https://app.<домен>/privacy открывается.

## 8. URL мини-приложения

Адрес для настроек бота — `https://app.<домен>`: только `https://`, без пути и без `/` в конце (MAX разрешает в URL латиницу, цифры, точку и дефис).

- Через форму организаторов https://sbor-ssylok-dlya-mini-prilojeniy.testograf.ru/ — в настройках бота его прописывают они. Сделайте это сразу после шага 7: сколько занимает применение, неизвестно.
- Если у вас есть доступ к платформе MAX для партнёров: «Чат-боты» → бот → ⋮ → «Настройки» → поле ссылки → вид кнопки «Открыть» → «Сохранить».

Мини-приложение (поток B) собирается в образ `web` автоматически, как только `apps/miniapp` появится в репозитории. До этого по адресу открывается страница-заглушка.

## 9. Подключение бота MAX

Когда в `.env` есть `MAX_BOT_TOKEN` и `MAX_BOT_USERNAME`, поставьте `MAX_MODE=webhook` и выполните:

```bash
dc up -d
```

`dc up -d` пересоздаёт контейнеры с новым `.env` — `dc restart` его не перечитывает. Затем по порядку:

```bash
dc exec api node dist/scripts/max.js me
```

Ожидается JSON бота, `username` совпадает с `MAX_BOT_USERNAME`. Ошибка TLS — проблема сертификатов (в образе есть сертификаты Минцифры); 401 — неверный токен.

```bash
dc exec api node dist/scripts/max.js subscribe
```

```bash
dc exec api node dist/scripts/max.js subscriptions
```

В списке подписок — `https://app.<домен>/webhook/max`.

```bash
dc exec api node dist/scripts/max.js commands
```

Проверка: напишите боту `/start` с телефона — придёт приветствие. Логи: `dc logs --tail=100 api worker`.

Не запускайте локально боевой токен в режиме `webhook` или `polling`: это перепишет подписку стенда. Если подписка всё же пропала, worker раз в 10 минут восстанавливает её сам и пишет алерт (шаг 10).

## 10. Роль сотрудника УК для команды и алерты

Каждый участник команды пишет боту `/start`. Затем на сервере:

```bash
dc exec db psql -U app -d app -c "select id, created_at from max_user order by created_at desc limit 5;"
```

Впишите ID в `.env`: `SEED_UK_STAFF_MAX_IDS=111,222` (роль сотрудника «УК Модельная») и `ALERT_USER_ID=111` (кому бот пишет о проблемах: пропала подписка, задачи падают, `/ready` не проходит). Примените:

```bash
dc up -d
```

Перед перезапуском `api` и `worker` compose снова выполнит `migrate` — сиды идемпотентны, роли появятся (`dc logs migrate`). Заодно история модельных домов пересчитывается на текущий месяц; после смены месяца это можно сделать отдельно: `dc run --rm migrate`. Проверяющие получают роль УК демо-кодом `DEMO_UK_CODE` в профиле мини-приложения.

## 11. Демо-чаты

1. В MAX создайте групповой чат «Дом 1 (демо)», добавьте бота и сделайте его администратором (нужно для закрепа панели и проверки участников).
2. С аккаунта сотрудника (шаг 10) напишите в чат `/connect dom1model1` или нажмите «Привязать к дому» в сообщении бота.
3. Ожидается: панель дома 1 опубликована и закреплена.
4. Второй чат «Дом 4 (демо)» — так же, командой `/connect dom4model4`.
5. Ссылки-приглашения в оба чата — на служебный слайд.

## 12. Проверки стенда

Цепочка DATA-API — с вашего компьютера, из корня проекта (тестовые токены берутся из `.env.stand`):

```bash
export $(grep -E '^CHECKER_TOKEN_' .env.stand | xargs)
```

```bash
pnpm data-api:run --base https://app.<домен>
```

Ожидается «Все проверки прошли». После этого впишите `https://app.<домен>` в `api.baseUrl` файла `docs/api/DATA-API.yaml` и закоммитьте.

Дальше — проверки на живом MAX из `docs/MAX_CHECKS.md` (результаты записываются туда же) и сквозной сценарий в веб-версии MAX и на телефоне.

Для служебного слайда из `.env` на сервере нужны `DEMO_UK_CODE` и `CHECKER_TOKEN_*`. Передавайте их только через слайд.

## 13. Резервные копии

Копия базы раз в сутки, хранятся 7 дней, каталог `/var/backups/vsemdomom`. Проверка вручную:

```bash
/opt/app/infra/backup.sh
```

Расписание — `crontab -e`, строка:

```
17 3 * * * /opt/app/infra/backup.sh >> /var/log/vsemdomom-backup.log 2>&1
```

Восстановление из копии:

```bash
dc stop api worker
dc exec -T db pg_restore -U app -d app --clean --if-exists < /var/backups/vsemdomom/app-<дата>.dump
dc up -d
```

В копиях есть MAX ID жителей и номера квартир: не выкладывайте их в общие хранилища.

## 14. Мониторинг

- Внешняя проверка `https://app.<домен>/health` раз в 5 минут с оповещением команды — хватит бесплатного тарифа любого сервиса мониторинга (UptimeRobot, Healthchecks и т. п.).
- Алерты бота в личку `ALERT_USER_ID` (шаг 10).
- Состояние и логи: `dc ps`, `dc logs -f --tail=100 api worker`.

## 15. Обновление и откат

```bash
cd /opt/app && git pull
export GIT_COMMIT=$(git rev-parse --short HEAD)
dc up -d --build
curl -fsS https://app.<домен>/api/v1/version
```

В `version` — новый `commit`. Для сдачи разворачивается тег: `git fetch --tags && git checkout v1.0.0`, затем те же команды.

Откат — `git checkout <прежний коммит>` и те же команды. Если в новой версии была миграция базы, перед откатом восстановите копию (шаг 13).

## 16. Остановка

`dc down` — остановить, данные остаются в томе `pgdata`. `dc down -v` удаляет базу — на стенде не выполнять.

## 17. Если что-то не так

| Симптом | Что проверить |
|---|---|
| Нет HTTPS, Caddy не выпускает сертификат | A-запись указывает на `<IP>` (`dig`), открыты 80 и 443 (`ufw status`), `dc logs web` |
| `api` не стартует | `dc logs api`: «Неверная конфигурация» — исправить `.env` по списку и `dc up -d` |
| Образы с Docker Hub не скачиваются | Зеркало реестра: `{"registry-mirrors": ["https://mirror.gcr.io"]}` в `/etc/docker/daemon.json`, `systemctl restart docker` |
| Сборка падает по памяти | Swap из шага 2 (`swapon --show`) |
| Бот молчит на `/start` | `max.js subscriptions` показывает наш URL; `MAX_WEBHOOK_SECRET` не менялся после подписки (иначе снова `subscribe`); сертификат из шага 7; `dc logs api` |
| Мини-приложение не открывается из MAX | URL из шага 8 ещё не применён или указан с путём |
| `/ready` не проходит в режиме `webhook` | Токен: `max.js me` |

Если токен утёк: запросить новый у организаторов → заменить в `.env` → `dc up -d` → `max.js subscribe` → проверить `/start`.
