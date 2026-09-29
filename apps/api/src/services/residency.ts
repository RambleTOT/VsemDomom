/**
 * Проживание (F10): одна учётная запись MAX — одна квартира в доме. Смена квартиры сбрасывает
 * уровень доверия до 0 и подтверждение; после сохранения — проверка членства в чате (уровень 1).
 * Общий код для регистрации в личке и PUT /api/v1/me/residency.
 */
import { isFlatInRange, OPEN_STATUSES, type ResidencyRole, type ResidencySource } from '@vsemdomom/core';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { cardLater } from '../chat/card.ts';
import { residencyIn, type HouseRow, type ResidencyRow } from '../db/queries.ts';
import { incident, incidentParticipant, residency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { refreshMembership } from './membership.ts';

export interface SaveResidencyInput {
  userId: number;
  house: HouseRow;
  flatNo: number;
  role: ResidencyRole;
  source: ResidencySource;
}

export type SaveResidencyResult =
  | { ok: true; residency: ResidencyRow; trustReset: boolean; inChat: boolean | null }
  | { ok: false; error: 'flat_out_of_range' };

export async function saveResidency(ctx: JobContext, input: SaveResidencyInput): Promise<SaveResidencyResult> {
  const { house: h, userId, flatNo, role } = input;
  if (!isFlatInRange(h, flatNo)) return { ok: false, error: 'flat_out_of_range' };
  const now = ctx.clock.now();
  const existing = await residencyIn(ctx.db, userId, h.id);
  const flatChanged = existing !== null && existing.flatNo !== flatNo;
  if (existing) {
    await ctx.db
      .update(residency)
      .set({
        flatNo,
        role,
        updatedAt: now,
        ...(flatChanged ? { trustLevel: 0 as const, reviewStatus: 'pending' as const, confirmedAt: null, confirmedBy: null, membershipCheckedAt: null } : {}),
      })
      .where(eq(residency.id, existing.id));
  } else {
    await ctx.db.insert(residency).values({ userId, houseId: h.id, flatNo, role, trustLevel: 0, source: input.source });
  }
  const saved = await residencyIn(ctx.db, userId, h.id);
  if (!saved) throw new Error('проживание не сохранено');
  await linkEarlierPresses(ctx, saved);
  const membership = await refreshMembership(ctx, saved, { force: true });
  const fresh = (await residencyIn(ctx.db, userId, h.id)) ?? saved;
  return { ok: true, residency: fresh, trustReset: flatChanged && (existing?.trustLevel ?? 0) > 0, inChat: membership.inChat };
}

/**
 * Нажатия в карточке до регистрации (без квартиры) привязываются к новому проживанию: отметка
 * сохраняется, житель перестаёт считаться «не подтверждённым», карточка правится.
 */
async function linkEarlierPresses(ctx: JobContext, saved: ResidencyRow): Promise<void> {
  const open = ctx.db
    .select({ id: incident.id })
    .from(incident)
    .where(and(eq(incident.houseId, saved.houseId), inArray(incident.status, [...OPEN_STATUSES])));
  const linked = await ctx.db
    .update(incidentParticipant)
    .set({ residencyId: saved.id })
    .where(and(eq(incidentParticipant.userId, saved.userId), isNull(incidentParticipant.residencyId), inArray(incidentParticipant.incidentId, open)))
    .returning({ incidentId: incidentParticipant.incidentId });
  for (const row of linked) await cardLater(ctx.queue, row.incidentId);
}
