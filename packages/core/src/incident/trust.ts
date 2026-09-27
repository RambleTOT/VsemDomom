/**
 * Уровни доверия (F10): 0 — заявлено; 1 — состоит в чате дома; 2 — подтверждён
 * собственником или УК. Пороги «не меньше двух квартир» считаются только по уровням 1–2.
 */
import type { TrustLevel } from '../domain/enums.ts';

export interface TrustInput {
  /** Житель зарегистрирован (есть проживание). */
  registered: boolean;
  /** Проверенное членство в чате дома; null — не проверено. */
  inHouseChat: boolean | null;
  /** Подтверждение собственником или УК. */
  confirmed: boolean;
}

const DECLARED: TrustLevel = 0;
const IN_HOUSE_CHAT: TrustLevel = 1;
const CONFIRMED: TrustLevel = 2;

export function trustLevel(input: TrustInput): TrustLevel {
  if (!input.registered) return DECLARED;
  if (input.confirmed) return CONFIRMED;
  if (input.inHouseChat === true) return IN_HOUSE_CHAT;
  return DECLARED;
}
