/** Куда вести после входа: payload кнопки open_app или диплинка startapp → экран по роли (таблица payload → экран). */
import { decodeStartApp } from '@vsemdomom/shared/browser';
import type { Me } from '@vsemdomom/shared';

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

/** Жителю без согласия или без квартиры — сначала S01–S02, затем экран из payload. */
export function onboardingFor(me: Pick<Me, 'staff' | 'consentRequired' | 'residencies'>, target: string): string | null {
  if (isStaff(me)) return null;
  if (target.startsWith('/owner/') || target.startsWith('/error/')) return null;
  // Сам экран регистрации — без «следующего экрана», иначе после неё вернёмся на неё же.
  const next = isOnboarding(target) ? '' : `?next=${encodeURIComponent(target)}`;
  if (me.consentRequired) return `/onboarding${next}`;
  if (me.residencies.length === 0) return target.startsWith('/onboarding/residence') ? null : `/onboarding/residence${next}`;
  return null;
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
