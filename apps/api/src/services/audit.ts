/**
 * Журнал действий УК и демо-инструментов (audit_log): кто, что и над чем — только идентификаторы,
 * без ПДн. Пишется в той же транзакции, что и само действие.
 */
import type { Executor } from '../db/client.ts';
import { auditLog } from '../db/schema.ts';

export type AuditAction =
  /** uk_status:<статус> — accepted, brigade_on_site, localized, resolved. */
  | `uk_status:${string}`
  | 'uk_merge'
  | 'bind_chat'
  | 'demo_uk_role'
  | 'demo_neighbours'
  | 'demo_time_shift'
  | 'demo_reset';

export interface AuditEntry {
  /** staff:<userId> — сотрудник УК (в том числе демо-роль и checker-УК); user:<userId> — пользователь. */
  actor: string;
  action: AuditAction;
  entity: 'incident' | 'house' | 'user';
  /** Публичный ID аварии или дома; для пользователя — его MAX ID. */
  entityId: string;
  at: Date;
}

export const staffActor = (userId: number): string => `staff:${userId}`;
export const userActor = (userId: number): string => `user:${userId}`;

export async function audit(db: Pick<Executor, 'insert'>, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values(entry);
}
