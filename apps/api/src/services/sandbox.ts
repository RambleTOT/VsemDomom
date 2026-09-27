/**
 * Дом-песочница для проверок DATA-API: checker-токены работают только с ней, «Устранено» сразу
 * закрывает аварию, чата и сообщений нет. Сброс удаляет её аварии — цепочка проверок повторяется
 * сколько угодно раз; проживания проверяющих (из сидов) остаются.
 */
import { eq, inArray } from 'drizzle-orm';
import { house, incident } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { audit, staffActor } from './audit.ts';
import { removeIncidents } from './incident-removal.ts';

export async function resetSandbox(ctx: JobContext, input: { staffUserId: number }): Promise<number> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const houses = await tx.select({ id: house.id, publicId: house.publicId }).from(house).where(eq(house.isSandbox, true));
    if (houses.length === 0) return 0;
    const rows = await tx.select({ id: incident.id }).from(incident).where(inArray(incident.houseId, houses.map((h) => h.id)));
    await removeIncidents(tx, rows.map((r) => r.id));
    for (const h of houses) await audit(tx, { actor: staffActor(input.staffUserId), action: 'sandbox_reset', entity: 'house', entityId: h.publicId, at: now });
    return rows.length;
  });
}
