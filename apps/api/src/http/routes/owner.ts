/**
 * Приглашение собственника (F09, F10; флаг trustLevels): ссылка o_<токен> от жильца, экран S10
 * у собственника, подтверждение (уровень 2) или «Не знаю этого человека».
 */
import type { FastifyInstance } from 'fastify';
import { incidentByPublicId } from '../../services/incidents.ts';
import { loadIncidentBundle } from '../../services/incident-view.ts';
import { createOwnerInvite, decideOwnerInvite, inviteByToken, inviteStatus } from '../../services/owner.ts';
import { resultView } from '../../services/result.ts';
import { iso } from '../../services/views.ts';
import { assertResident, houseById, loadViewer, notFound } from '../access.ts';
import { registerApiRoute, type ApiDeps } from '../api-route.ts';
import { ApiError } from '../problem.ts';

const gone = (code: 'token_used' | 'token_expired') =>
  new ApiError(410, code, code === 'token_used' ? 'Ссылка уже использована' : 'Ссылка устарела');

export function registerOwnerRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { ctx } = deps;

  registerApiRoute(app, deps, 'createOwnerInvite', async ({ principal, body }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const inc = await incidentByPublicId(ctx.db, body.incidentId);
    if (!inc) throw notFound('Авария не найдена');
    const h = await houseById(ctx.db, inc.houseId);
    const residency = assertResident(viewer, h);
    if (inc.status === 'merged') throw notFound('Авария не найдена');
    const invite = await createOwnerInvite(ctx, { incident: inc, house: h, residency });
    return { status: 201, body: { link: invite.link, shareText: invite.shareText, expiresAt: iso(invite.expiresAt) } };
  });

  registerApiRoute(app, deps, 'getOwnerInvite', async ({ params }) => {
    const found = await inviteByToken(ctx.db, params.token);
    if (!found) throw notFound('Ссылка не найдена');
    const status = inviteStatus(found.invite);
    if (status === 'pending' && found.invite.expiresAt.getTime() < ctx.clock.now().getTime()) throw gone('token_expired');
    const bundle = found.incident.status === 'closed' ? await loadIncidentBundle(ctx.db, found.incident.id) : null;
    // Итог — по квартире жильца: собственник видит то же, что увидел жилец.
    const result = bundle
      ? await resultView(ctx.db, bundle, { userId: found.residency.userId, residency: found.residency, isStaff: false, user: null }, ctx.i18n, ctx.clock.now())
      : null;
    return {
      status: 200,
      body: {
        status,
        flatNo: found.residency.flatNo,
        tenantRole: found.residency.role,
        house: { id: found.house.publicId, label: found.house.label, address: found.house.address },
        result,
        incidentId: found.incident.publicId,
        expiresAt: iso(found.invite.expiresAt),
      },
    };
  });

  for (const [operationId, decision] of [
    ['confirmOwnerInvite', 'confirmed'],
    ['rejectOwnerInvite', 'rejected'],
  ] as const) {
    registerApiRoute(app, deps, operationId, async ({ principal, params }) => {
      const result = await decideOwnerInvite(ctx, { token: params.token, ownerUserId: principal.userId, decision });
      switch (result) {
        case 'not_found':
          throw notFound('Ссылка не найдена');
        case 'token_used':
        case 'token_expired':
          throw gone(result);
        case 'self':
          throw new ApiError(403, 'forbidden', 'Подтвердить проживание может только собственник');
        default:
          return { status: 200, body: { status: decision, tenantTrustLevel: result.trustLevel, incidentId: result.bundle.incident.publicId } };
      }
    });
  }

}
