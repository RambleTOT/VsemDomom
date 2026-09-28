// Для мини-приложения: форматирование времени и разбор payload из ядра —
// мини-приложение импортирует только packages/shared (правило границ слоёв).
export { formatChatTime, formatDate, formatDuration, formatPercent, formatRubles, formatTime, monthName } from '@vsemdomom/core/format';
export { botLink, decodeStartApp, encodeStartApp, startAppLink, START_APP_KINDS, type StartAppKind, type StartAppPayload } from '@vsemdomom/core/payloads';
