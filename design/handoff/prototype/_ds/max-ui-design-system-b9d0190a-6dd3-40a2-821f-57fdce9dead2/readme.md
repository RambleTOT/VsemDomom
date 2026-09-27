# MAX UI Design System

Design system for **MAX** — the Russian messenger / digital platform by VK — as expressed by **MAX UI**, the official React component library for building **mini-apps inside MAX**, third-party super-apps and standalone apps. Components mimic native iOS and Android controls and support light and dark schemes; platform and scheme are auto-detected by the `<MaxUI>` provider and can be overridden.

## Sources
- GitHub: **https://github.com/max-messenger/max-ui** (branch `main`) — tokens (`src/styles/variables/*.scss`), components (`src/components/*`), internal primitives (`src/internal/*`), icons (`src/icons/*`), Storybook matrices (`src/stories/ComponentMatrices.stories.tsx`).
- npm: `@maxhub/max-ui` · Storybook: https://max-messenger.github.io/max-ui · Docs: https://dev.max.ru/ui
- Explore the repo further for exact behaviour (asChild polymorphism, innerClassNames) when building production mini-apps.

No Figma, logo or marketing material was provided.

## Index
- `styles.css` — entry; imports only.
- `tokens/colors.css` (light on `:root`, dark on `.max-dark`), `tokens/typography.css` (iOS default, `.max-android` override), `tokens/sizes.css`.
- `components/max-ui.css` — all component styles (`mx-` prefix), ported from the SCSS modules; `mx-t-*` typography utility classes.
- `components/<group>/` — JSX + `.d.ts` + `.prompt.md` + one `*.card.html`.
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand).
- `assets/icons/` — the 6 max-ui glyphs + 4 Storybook placeholder icons.
- `ui_kits/mini-app/` — click-through mini-app compositions (see its README).
- `SKILL.md`, `github.md`, `thumbnail.html`.

## Components
Mirrors the library's public exports exactly.
- **core/** — `MaxUI` (provider; also `usePlatform`, `useColorScheme`), `Icons`: `Icon16Chevron`, `Icon16CloseIos`, `Icon16SearchOutline`, `Icon20CloseAndroid`, `Icon20CloseFilled`, `Icon24CloseAndroid`
- **buttons/** — `Button`, `IconButton`
- **feedback/** — `Counter`, `Spinner`
- **avatar/** — `Avatar` (`Avatar.Container`, `.Image`, `.Text`, `.Icon`, `.Overlay`, `.CloseButton`; also exported flat as `AvatarContainer`, `AvatarImage`, `AvatarText`, `AvatarIcon`, `AvatarOverlay`, `AvatarCloseButton`)
- **typography/** — `Typography` (`.Display`, `.Headline`, `.Title`, `.Body`, `.Label`, `.Action`, `.Text`; flat `TypographyDisplay`, `TypographyHeadline`, `TypographyTitle`, `TypographyBody`, `TypographyLabel`, `TypographyAction`, `TypographyText`)
- **cells/** — `CellSimple`, `CellAction`, `CellHeader`, `CellInput`, `CellList`
- **forms/** — `Input`, `Textarea`, `Radio`, `Switch`
- **layout/** — `Panel`, `Container`, `Flex`, `Grid`, `EllipsisText`
- **utility/** — `Tappable`, `Ripple`, `SvgButton`, `ClearableInput`

Differences from source: no `asChild` (use `as` prop instead where relevant); `innerClassNames` dropped except on ClearableInput. Components are cosmetic ports, not production code.

### Intentional additions
- `Icons` namespace object — groups the six icon exports for convenience.
- Semantic alias tokens `--accent`, `--surface-page`, `--surface-card`, `--text-body`, `--text-muted` (not in source).

## CONTENT FUNDAMENTALS
- **Language:** Russian first. All source copy, aria-labels and story text are Russian ("Кнопка", "Пример текста", "Введите имя", aria-label "Очистить", "Закрыть", "Загрузка").
- **Tone:** plain, functional, native-app. Short noun or verb labels: "Настройки", "Удалить", "Продолжить", "Выйти". No marketing voice, no exclamation-heavy copy.
- **Casing:** sentence case everywhere ("Введите текст", not Title Case). Section headers (`CellHeader` caps style) are rendered UPPERCASE via CSS — author them in sentence case.
- **Address:** formal-neutral "вы" implicitly; imperative verbs in placeholders ("Введите имя", "Опишите проблему").
- **Placeholder names:** "Иван Иванов" is the canonical sample person; "MX" the sample initials.
- **Emoji:** not used in UI. Unicode as icons: none. Numbers use compact notation in counters (1200 → 1.2K).
- **Punctuation:** em dash (—) in docs; no trailing periods in labels/buttons.

## VISUAL FOUNDATIONS
- **Vibe:** native iOS/Android messenger chrome — quiet, flat, white cards on cool grey, one saturated blue. Content (avatars, photos) carries the colour.
- **Color:** single accent `rgb(0 122 255)` for primary buttons, active controls, themed text/icons, links. Ink is near-black `rgb(6 7 8)` at stepped opacities (100 / 68 / 52 %) rather than distinct greys. Negative red `rgb(255 48 60)`, positive green `rgb(26 190 67)` (online dot), promo violet `rgb(104 19 255)`. Dark scheme: graphite `rgb(15 15 18)` surface, `rgb(23 24 28)` primary, `rgb(37 38 45)` cards; red shifts to `rgb(206 66 87)`.
- **Gradients:** only the five avatar-initials gradients (~155°, two stops: red→pink/orange, orange, green-teal, blue-cyan, purple). No background gradients.
- **Type:** system fonts — SF (-apple-system) on iOS with tight negative tracking; Roboto on Android with slight positive tracking. Headers 600, body 400, strong/actions 500. Scale in rem: 28/24/20/17 headers, 16 body, 15 detail, 13 description, 12 label, 11 tag, 10 note. No webfonts shipped.
- **Spacing:** 2·4·6·8·10·12·16·20·24. 12px is *the* inset: cell padding, container padding, island list margin. Cells min-height 56 (normal) / 48 (compact), 40px before-slot.
- **Radii:** buttons scale with size 8/12/16/20; fields 12 (medium) / 16 (large); cards & islands 16; promo 20; IconButton 45% (soft squircle); avatars circle (people) or superellipse squircle mask (channels/bots/apps).
- **Cards/islands:** white `--background-card` on `--background-surface`, radius 16, **no border, no shadow**. Rows separated by 0.5px `--divider-primary` hairlines.
- **Shadows:** essentially none. The single shadow is the iOS switch thumb `0 3px 8px rgb(0 0 0/.15)`. Avatars get a 0.5px inner hairline.
- **Borders:** only hairlines (0.5px) and control outlines (2px radio ring, 2px Android switch track).
- **Backgrounds:** flat colour only. No imagery, textures, patterns or illustrations in the system.
- **Transparency:** translucent fills for secondary buttons (`32 54 110 / .1`), input fills (5% black), overlays (32% / 60% black). No backdrop blur in source.
- **Hover (pointer devices only):** buttons swap to a *lighter* state colour (primary → `rgb(71 159 255)`); rows get a 4% black tint; svg buttons darken.
- **Press:** iOS — "highlight": background swaps to a *darker* pressed colour (primary → `rgb(0 110 229)`), rows 8% tint. Android — material ripple (24px dot scaling ×8 over 300ms). No shrink/scale.
- **Disabled:** reduced-opacity versions of fills and grey `111 114 118 / .64` text — never simply `opacity`.
- **Animation:** minimal and fast — 100ms ease-out (radio), 0.1s (switch), 0.3s ripple, 0.8s iOS spinner fade, 1s linear Android spinner. Respects `prefers-reduced-motion`.
- **Layout:** mobile-first single column, 360–412px base widths. Panels fill height; content in island lists stacked with ~20px gaps. Nav bars are app-provided (not in the library).

## ICONOGRAPHY
- max-ui ships only **6 SVG glyphs** (`assets/icons/`): 16 chevron (12×16), 16 close-ios (filled circle ×), 16 search outline, 20 close-android, 20 close-filled, 24 close-android. All single-path, `fill="currentColor"`, rounded terminals, ~1.6px visual stroke weight built as filled outlines.
- Size is encoded in the name (16/20/24/28 grid). Storybook uses dashed rounded-square **placeholder icons** (`placeholder-16/20/24/28.svg`) wherever a real icon goes — consumers bring their own.
- Colours come from `--icon-primary` (84% ink), `--icon-tertiary` (48%), `--icon-mute` (28%, chevrons), `--icon-themed` (blue).
- No icon font, no PNGs, no emoji, no unicode-as-icon.
- **Substitution:** the UI kit uses **Lucide** (CDN, `lucide-static@0.469.0`, masked to currentColor) for settings/actions icons since MAX's full icon set isn't public in this repo. Replace with official MAX icons if available.

## Brand / logo
**No logo exists in the source.** Wherever a mark would go, render "MAX" in the system font. Do not draw or approximate the MAX logo.
