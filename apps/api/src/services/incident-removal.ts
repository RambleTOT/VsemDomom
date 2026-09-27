/**
 * Удаление аварий при сбросе демо-данных и песочницы: вместе с отметками, хронологией, сроками
 * и карточками (каскад в БД); неотправленные сообщения по ним отменяются, отправленные остаются в чатах.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../db/client.ts';
import { incident, outboundMessage } from '../db/schema.ts';

export async function removeIncidents(tx: Pick<Executor, 'update' | 'delete'>, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(outboundMessage)
    .set({ status: 'skipped', payload: null })
    .where(and(inArray(outboundMessage.incidentId, [...ids]), eq(outboundMessage.status, 'pending')));
  // Одним запросом: объединённые аварии ссылаются друг на друга.
  await tx.delete(incident).where(inArray(incident.id, [...ids]));
}
