/**
 * Проживание (F10): одна учётная запись MAX — одна квартира в доме. Смена квартиры сбрасывает
 * уровень доверия до 0 и подтверждение; после сохранения — проверка членства в чате (уровень 1).
 * Общий код для регистрации в личке и PUT /api/v1/me/residency.
 */
import { isFlatInRange, type ResidencyRole, type ResidencySource } from '@vsemdomom/core';
import { eq } from 'drizzle-orm';
import { residencyIn, type HouseRow, type ResidencyRow } from '../db/queries.ts';
import { residency } from '../db/schema.ts';
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
  const membership = await refreshMembership(ctx, saved, { force: true });
  const fresh = (await residencyIn(ctx.db, userId, h.id)) ?? saved;
  return { ok: true, residency: fresh, trustReset: flatChanged && (existing?.trustLevel ?? 0) > 0, inChat: membership.inChat };
}
