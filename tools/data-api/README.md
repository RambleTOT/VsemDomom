# Валидатор DATA-API 1.0

Эталонный валидатор организаторов для `docs/api/DATA-API.yaml`: JSON Schema, семантика (зависимости, переменные, path-параметры) и сверка путей с `docs/api/openapi.yaml`.

- Источник: https://gitverse.ru/stasnorman/example-data-api, коммит `8504a6d9b39e6f652bce689d96e88538d7541c6b` (18.09.2026).
- Автор — Станислав Макиевский, условия использования — `licence.md` (файлы `validate_data_api.py`, `DATA-API.schema.json`, `requirements.txt`, `licence.md` скопированы без изменений).
- `requirements.lock.txt` — наши точные версии зависимостей в пределах `requirements.txt` (обе — MIT).

Запуск локально (Python ≥ 3.10):

```bash
python3 -m venv .venv-data-api
.venv-data-api/bin/pip install -r tools/data-api/requirements.lock.txt
.venv-data-api/bin/python tools/data-api/validate_data_api.py docs/api/DATA-API.yaml
```

В CI то же самое выполняет шаг «DATA-API (валидатор организаторов)». Сама цепочка проверок прогоняется против API тестом `apps/api/test/data-api.test.ts`, против стенда — `pnpm data-api:run`.
