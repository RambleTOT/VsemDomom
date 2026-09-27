# components.md — составные компоненты «Всем домом»

Версия пакета: 1.0.0-wave1 · 27.09.2026 · основа — `@maxhub/max-ui@0.5.0`.
Правило имени: компонент называется по смыслу; основа MAX UI указана в колонке «Основа». Референс-реализация — одноимённые `*.dc.html` в корне проекта (не копировать в код как есть).

Общие состояния интерактивных элементов: **default · hover (L)** `--states-background-hovered-transparent` · **pressed** штатный `Tappable`/`Ripple` (`--states-background-pressed-transparent`) · **focus** обводка 2 px `--controls-active`, смещение 2 px · **disabled** штатная прозрачность MAX UI + строка причины текстом · **loading** `Spinner` в кнопке или `Skeleton` · **error** иконка + текст `--app-text-negative`.

Отклонения от MAX UI, принятые ради контраста (ТЗ 11.2): подсказки полей рисуем своей строкой `--text-secondary` 13 px вместо `Input hint` (там `--text-tertiary`); заголовки секций — свой `h2` 13/16 strong `--text-secondary` вместо `CellHeader` (`--text-tertiary`).

| Компонент | Основа | Пропсы | Состояния | Роль и диктор |
|---|---|---|---|---|
| `IncidentHeadline` | `Typography.Headline`(regular, 20/24) или `Title`(compact, 17/24) + `StatusBadge` + `DeadlineChip` | `displayStatus` (9 статусов), `ukEta`, `nextDeadline {state,due,left,at,prefix}`, `density` regular/compact, `restoreQuestion`, `count`, `duration`, `onAction` | 9 статусов + загрузка (скелетон 24 px). Расхождение — баннер `--app-negative-bg`, текст `--text-primary`, иконка `--icon-negative`, кнопка «Что делать». Объединена — кнопка «Открыть актуальную» | `role="heading" aria-level=2`; обёртка `aria-live="polite"`, объявляется только смена статуса |
| `StatusBadge` | чип 24 px, иконка 16 + `Label` 13 | `status` | 9 вариантов: иконка и фон по ТЗ 4.3 | не кликабелен; префикс «Статус: » визуально скрыт; иконка `aria-hidden` |
| `DeadlineChip` | чип 28 px, иконка 16 + `Text detail` 15 | `state` normal/soon/expired/done/no_norm, `due`, `left`, `at`, `prefix` | normal `--background-tertiary`; soon (≤ 30 мин) `--app-warning-bg` + `--app-warning-icon`; expired `--app-negative-bg` + `--icon-negative`, текст «истёк в 18:10»; done `--app-icon-positive`; no_norm `--text-secondary` | `role="img"` + `aria-label` («Срок подходит: до 18:30, осталось 12 минут»). `aria-live` на чипе нет; отсчёт раз в минуту |
| `NormBasisLink` | `Tappable`/button + `Label` 13 `--app-text-link`, подчёркивание | `doc`, `point`, `normId`, `onOpen` | default, hover, focus | цель касания 44 px (отступы −12 px), `aria-haspopup="dialog"` |
| `NormSheet` | шторка (S, M) / боковая панель 400 px (L); `Button secondary` «Открыть первоисточник» (`openLink`), `Button ghost` «Закрыть» | `norm {head,text,docFull,edition,checked,url}`, `side`, `onClose` | открыта; короткий экран — на всю высоту со скроллом | `role="dialog" aria-modal`, фокус на заголовок, Esc и «Назад» закрывают, фокус возвращается на ссылку |
| `ModelDataBadge` | чип 28 px, иконка info 16 + `Label` 13 `--text-secondary` на `--app-model-data-bg` | `compact` | обычный; сжатый (иконка + tooltip) | в сжатом текст визуально скрыт, читается диктором |
| `Timeline` | `ol`; точка 32 px + время (15 strong) + текст (15) + источник (13 secondary) | `items[{time,text,src,who}]` | src: uk (building, `--icon-themed`), res (users), sys (circle-dot, `--icon-tertiary`), disc (triangle, `--icon-negative` на `--app-negative-bg`) | нумерованный список «19:10, УК отметила устранение» |
| `StatusStepper` | `ol`; вертикальный (S, M), горизонтальный (L) | шаги + текущий | пройден (галочка на tertiary), текущий (`--controls-active`), пропущен (пунктир + «шаг пропущен»), будущий (контур) | `aria-current="step"` у текущего |
| `EntranceCounter` | `ul` чипов 32 px | `counts[]`, `unknown`, `selected`, `scroll` | 0 — `--text-secondary`, >0 — 500; «не указан»; > 6 подъездов — горизонтальная прокрутка на S; 99+ | «Подъезд 2: 6 квартир» |
| `EntranceFloorGrid` | CSS grid 52 px + N×1fr | матрица этаж × подъезд, «этаж не указан» | 0 «·»; 1–2 `--background-tertiary`; 3+ `--app-negative-bg`; число всегда в ячейке + легенда | `role=table`, ячейка «Подъезд 2, этаж 5: 3 квартиры» |
| `ServiceTypePicker` | `Grid` плиток 88 px (72 на коротком), иконка 28 + подпись 15 | `value`, `onChange` | обычная, выбрана (обводка 2 px `--controls-active`, иконка `--icon-themed`), hover, focus | `radiogroup` / `radio aria-checked`; колонки XS 2, S 3, M 4, L 3 (в двухколоночной форме) |
| `TimeSince` | чипы-радио 44 px + `Input` | `value`, `custom` | выбран; время в будущем → ошибка поля; старше суток → подтверждение | `radiogroup` |
| `ScopePicker` | `CellSimple as=label` + `Radio` | `value` | + кнопки подъездов 48 px и `Input` этажа | `radiogroup` |
| `DuplicateSuggest` | карточка + `ActionBar stack` | авария | «Присоединиться» (primary), «Это другая авария» (secondary) | — |
| `ActionBar` | 1–2 `Button size=large stretched` | `primary`, `secondary`, `variant`, `loading`, `disabled`, `reason`, `pinned`, `stack` | pinned на S и M; в конце контента при высоте ≤ 480 и на L; фон `--background-primary`, разделитель `--divider-secondary`, отступ `env(safe-area-inset-bottom)` | контент получает нижний отступ = высоте панели (WCAG 2.4.11); disabled всегда с причиной над кнопкой |
| `ConfirmDialog` | шторка (S, M) / диалог 440 px (L); `Button` primary или destructive + secondary | `title`, `text`, `ok`, `cancel`, `variant` | loading на подтверждении | `role="alertdialog"`, фокус внутри, Esc — отмена |
| `Toast` | плашка радиус 14 (`--size-border-radius-semantic-border-radius-floating`), `--background-primary` + волосяная граница | `kind` success/error/info, `text`, `action` | 4 с, над `ActionBar`, не перекрывает кнопки | `role="status"` |
| `InlineError` | карточка (inline) или центр экрана (full, S12) + `Button` | `kind` network/server/forbidden/merged/notfound/session/outside/expired/feature_off/slow | всегда с действием; server — код для поддержки | `role="alert"` |
| `Skeleton` | блоки `--background-tertiary`, пульс 1,2 с | `kind` line/card/list/timeline, `count` | при `prefers-reduced-motion` без пульса | `aria-busy` |
| `EmptyState` | иконка 48 + `Title` + текст + `Button` | `icon`, `title`, `text`, `action` | — | — |
| `TrustLevelBadge` | чип 28 px, иконка shield | `level` 0/1/2 | — | текст уровня |
| `MoneyBreakdown` | строки ключ–значение + итог `Display` 28 | `excess`, `rate`, `fee`, `total` | с превышением; без превышения («перерасчёт не положен») | — |
| `DocumentPreview` | карточка `Text detail` 15; подставленные поля на `--background-tertiary` | `template`, поля | черновик, заполнено, скопировано; запасной путь «Выделить всё» | — |
| `ReadyToSignCounter` | волна 3 (S09) — не входит в этот пакет | | | |

Иконки — Lucide 0.469.0 (ISC), обводка 1,75 px, `currentColor`; список — `icons/ICONS_LICENSE.md`.
