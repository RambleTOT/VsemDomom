/** Профиль: GET /me, согласие, проживание, удаление данных, настройки уведомлений. */
import type { FastifyInstance } from 'fastify';
import type { Principal } from '../../auth/principal.ts';
import { deleteUserData } from '../../services/user-data.ts';
import { giveConsent, hasConsent, loadMe, setNotifyDefault } from '../../services/me.ts';
import { saveResidency } from '../../services/residency.ts';
import { chatOfHouse } from '../../db/queries.ts';
import { residencyView } from '../../services/views.ts';
import { loadViewer, visibleHouse } from '../access.ts';
import { registerApiRoute, type ApiDeps } from '../api-route.ts';
import { ApiError } from '../problem.ts';

/** Профиль проверяющих задан сидами песочницы: тестовые токены его не меняют и не удаляют. */
function assertNotChecker(principal: Principal): void {
  if (principal.kind === 'checker') throw new ApiError(403, 'forbidden', 'Недоступно тестовым токенам', 'Профиль проверяющих задан сидами песочницы');
}

export function registerMeRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { ctx } = deps;

  registerApiRoute(app, deps, 'getMe', async ({ principal }) => ({ status: 200, body: await loadMe(ctx, principal.userId) }));

  registerApiRoute(app, deps, 'giveConsent', async ({ principal, body }) => {
    const result = await giveConsent(ctx, principal.userId, body.version);
    if (result === 'version_mismatch') {
      throw new ApiError(422, 'consent_version_mismatch', 'Текст согласия обновился', 'Обновите экран и дайте согласие заново');
    }
    return { status: 204 };
  });

  registerApiRoute(app, deps, 'putResidency', async ({ principal, body }) => {
    assertNotChecker(principal);
    const viewer = await loadViewer(ctx.db, principal);
    if (!hasConsent(viewer.user)) throw new ApiError(403, 'consent_required', 'Нужно согласие на обработку данных');
    const h = await visibleHouse(ctx.db, viewer, body.houseId);
    const saved = await saveResidency(ctx, { userId: principal.userId, house: h, flatNo: body.flatNo, role: body.role, source: 'miniapp' });
    if (!saved.ok) {
      throw new ApiError(422, 'flat_out_of_range', 'Такой квартиры в доме нет', `Квартиры в этом доме: ${h.flatFrom}–${h.flatTo}`, {
        flatFrom: h.flatFrom,
        flatTo: h.flatTo,
      });
    }
    return {
      status: 200,
      body: { residency: residencyView(saved.residency, h, await chatOfHouse(ctx.db, h.id)), trustReset: saved.trustReset },
    };
  });

  registerApiRoute(app, deps, 'deleteMe', async ({ principal }) => {
    assertNotChecker(principal);
    await deleteUserData(ctx.db, principal.userId, ctx.clock.now());
    return { status: 204 };
  });

  registerApiRoute(app, deps, 'patchSettings', async ({ principal, body }) => ({
    status: 200,
    body: { notifyDefault: await setNotifyDefault(ctx, principal.userId, body.notifyDefault) },
  }));
}
