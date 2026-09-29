/** Куда вести после входа: payload кнопки open_app или диплинка startapp → экран по роли (таблица payload → экран). */
import { decodeStartApp, RESIDENCY_ROLES } from '@vsemdomom/shared/browser';
import type { Me, ResidencyRole } from '@vsemdomom/shared';

export const isStaff = (me: Pick<Me, 'staff'>): boolean => me.staff !== null;

/** Корень роли: УК — «Аварии», житель — «Мой дом» (или регистрация). */
export function homePath(me: Pick<Me, 'staff' | 'residencies'>): string {
  if (isStaff(me)) return '/uk';
  const house = me.residencies[0]?.house.id;
  return house ? `/house/${house}` : '/onboarding/residence';
}

/** Экран по payload; неизвестный payload — «Ссылка устарела». */
export function routeForStart(startParam: string | null, me: Pick<Me, 'staff' | 'residencies'>): string {
  if (!startParam) return homePath(me);
  const payload = decodeStartApp(startParam);
  if (!payload) return '/error/expired';
  const staff = isStaff(me);
  // Итог и акт адресованы жителю: сотрудник, который сам живёт в доме (демо-роль проверяющего), идёт как житель.
  const staffOnly = staff && me.residencies.length === 0;
  const id = payload.value;
  switch (payload.kind) {
    case 'new_incident':
      return `/report?house=${id}`;
    case 'incident':
      return staff ? `/uk/incident/${id}` : `/incident/${id}`;
    case 'house':
      return staff && !me.residencies.some((r) => r.house.id === id) ? `/uk/houses/${id}` : `/house/${id}`;
    case 'result':
      return staffOnly ? `/uk/incident/${id}` : `/incident/${id}/result`;
    case 'act':
      return staffOnly ? `/uk/incident/${id}` : `/incident/${id}/act`;
    case 'owner_invite':
      return `/owner/${id}`;
    case 'chat_binding':
      return staff ? `/uk/bind/${id}` : '/error/forbidden';
  }
}

/** Что уже известно для регистрации (например, из приглашения собственника): дом, квартира, роль. */
export interface ResidencePrefill {
  house: string;
  flat: number;
  role: ResidencyRole;
}

/** Жителю без согласия или без квартиры — сначала S01–S02, затем экран из payload. */
export function onboardingFor(me: Pick<Me, 'staff' | 'consentRequired' | 'residencies'>, target: string, prefill?: ResidencePrefill): string | null {
  if (isStaff(me)) return null;
  if (target.startsWith('/owner/') || target.startsWith('/error/')) return null;
  const q = new URLSearchParams(prefill ? { house: prefill.house, flat: String(prefill.flat), role: prefill.role } : {});
  // Сам экран регистрации — без «следующего экрана», иначе после неё вернёмся на неё же.
  if (!isOnboarding(target)) q.set('next', target);
  const query = q.size > 0 ? `?${q.toString()}` : '';
  if (me.consentRequired) return `/onboarding${query}`;
  if (me.residencies.length === 0) return target.startsWith('/onboarding/residence') ? null : `/onboarding/residence${query}`;
  return null;
}

/** Подстановка для S02 из адреса (после S01 передаётся дальше): только корректные дом, квартира и роль. */
export function residencePrefill(params: URLSearchParams): string {
  const q = new URLSearchParams();
  const house = params.get('house');
  const flat = params.get('flat');
  const role = params.get('role');
  if (house && /^[A-Za-z0-9]{10}$/.test(house)) q.set('house', house);
  if (flat && /^\d{1,5}$/.test(flat)) q.set('flat', flat);
  if (role && (RESIDENCY_ROLES as readonly string[]).includes(role)) q.set('role', role);
  return q.toString();
}

const isOnboarding = (path: string): boolean => path === '/onboarding' || path.startsWith('/onboarding/') || path.startsWith('/onboarding?');

/** Дом из payload или адреса следующего экрана — для S02 «Дом выбран по ссылке». */
export function houseFromTarget(target: string | null): string | null {
  if (!target) return null;
  const report = /[?&]house=([A-Za-z0-9]{10})/.exec(target);
  if (report) return report[1] ?? null;
  const house = /^\/house\/([A-Za-z0-9]{10})/.exec(target);
  return house?.[1] ?? null;
}

/** Только внутренние пути приложения (?next=): защита от внешних адресов. */
export function safeNext(next: string | null, fallback: string): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !isOnboarding(next) ? next : fallback;
}
