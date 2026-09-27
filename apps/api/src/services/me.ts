/** Профиль пользователя: учётная запись MAX (только ID), согласие, проживание, роль сотрудника, настройки. */
import type { Me } from '@vsemdomom/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import { residenciesOf, staffOf, userById } from '../db/queries.ts';
import { houseChat, maxUser } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { meView } from './views.ts';

/** Пользователь вошёл в мини-приложение: запись с одним идентификатором MAX (и языком). */
export async function ensureUser(ctx: JobContext, userId: number, locale: string | null): Promise<void> {
  await ctx.db
    .insert(maxUser)
    .values({ id: userId, locale })
    .onConflictDoUpdate({ target: maxUser.id, set: { locale: sql`coalesce(${locale}, ${maxUser.locale})` } });
}

export async function loadMe(ctx: JobContext, userId: number): Promise<Me> {
  const user = await userById(ctx.db, userId);
  const list = await residenciesOf(ctx.db, userId);
  const chats = list.length > 0 ? await ctx.db.select().from(houseChat).where(inArray(houseChat.houseId, list.map((r) => r.house.id))) : [];
  const [staff] = await staffOf(ctx.db, userId);
  return meView(
    {
      userId,
      user,
      residencies: list.map((r) => ({ ...r, chat: chats.find((c) => c.houseId === r.house.id) ?? null })),
      staff: staff
        ? {
            role: staff.staff.role,
            isDemo: staff.staff.isDemo,
            isChecker: staff.staff.isChecker,
            uk: { publicId: staff.uk.publicId, name: staff.uk.name, isModel: staff.uk.isModel },
          }
        : null,
    },
    ctx.config,
  );
}

export type ConsentResult = 'saved' | 'version_mismatch';

export async function giveConsent(ctx: JobContext, userId: number, version: string): Promise<ConsentResult> {
  if (version !== PARAMS.consentVersion) return 'version_mismatch';
  await ctx.db
    .update(maxUser)
    .set({ consentVersion: PARAMS.consentVersion, consentAt: ctx.clock.now(), deletedAt: null })
    .where(eq(maxUser.id, userId));
  return 'saved';
}

export async function setNotifyDefault(ctx: JobContext, userId: number, notifyDefault: boolean): Promise<boolean> {
  await ctx.db.update(maxUser).set({ notifyDefault }).where(eq(maxUser.id, userId));
  return notifyDefault;
}

export function hasConsent(user: { consentVersion: string | null } | null): boolean {
  return user?.consentVersion === PARAMS.consentVersion;
}
