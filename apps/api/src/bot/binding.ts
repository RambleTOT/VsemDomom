/**
 * Привязка группового чата к дому (F11): бот добавлен → одноразовый токен и приглашение
 * с кнопкой open_app c_<токен> → сотрудник УК в мини-приложении выбирает дом → привязка,
 * панель дома публикуется и закрепляется. Запасной путь — /connect <код дома> в чате.
 */
import { renderBotAdded, renderText } from '@vsemdomom/core';
import { and, eq, or } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import { chatBindToken, houseChat } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import { QUEUES } from '../jobs/queue.ts';
import { MaxApiError } from '../max/types.ts';
import type { NormalizedUpdate } from '../max/update.ts';
import { sendDm } from './dm.ts';
import { houseByPublicId, houseOfChat, staffOf, userById, type HouseRow } from '../db/queries.ts';
import type { UpdateMeta } from './types.ts';
import { hashToken, newToken } from '../util/tokens.ts';

const MS_PER_HOUR = 3_600_000;

export { hashToken, newToken };

/** bot_added: приглашение привязать чат (в группе у всех одна клавиатура — список домов не показываем). */
export async function onBotAdded(u: NormalizedUpdate, ctx: JobContext, meta: UpdateMeta): Promise<void> {
  if (u.chatId === null || u.isChannel) return;
  const token = newToken();
  const chatId = u.chatId;
  await ctx.db.transaction(async (tx) => {
    await tx.insert(chatBindToken).values({
      tokenHash: hashToken(token),
      chatId,
      expiresAt: new Date(ctx.clock.now().getTime() + PARAMS.chatBindTokenTtlHours * MS_PER_HOUR),
    });
    await enqueueOutbound(tx, ctx.queue, {
      kind: 'bind_invite',
      idempotencyKey: `bind:invite:${meta.dedupeKey}`,
      target: { chatId },
      message: renderBotAdded({ token, botUsername: ctx.config.max.botUsername }, ctx.i18n),
    });
  });
}

export async function onBotRemoved(u: NormalizedUpdate, ctx: JobContext): Promise<void> {
  if (u.chatId === null) return;
  await ctx.db.delete(houseChat).where(eq(houseChat.chatId, u.chatId));
}

export async function onBotPermissionsChanged(u: NormalizedUpdate, ctx: JobContext): Promise<void> {
  if (u.chatId === null) return;
  const bound = await houseOfChat(ctx.db, u.chatId);
  if (!bound) return;
  await ctx.db
    .update(houseChat)
    .set({ botIsAdmin: u.isAdmin ?? false, botPermissions: u.permissions ?? [] })
    .where(eq(houseChat.chatId, u.chatId));
  if (u.isAdmin) await ctx.queue.send(QUEUES.panelRender, { houseId: bound.house.id, pin: true });
}

export async function onChatTitleChanged(u: NormalizedUpdate, ctx: JobContext): Promise<void> {
  if (u.chatId === null) return;
  await ctx.db.update(houseChat).set({ title: u.title ?? null }).where(eq(houseChat.chatId, u.chatId));
}

export type BindError = 'token_not_found' | 'token_used' | 'token_expired' | 'house_not_found' | 'forbidden';

export interface BindResult {
  house: HouseRow;
  botIsAdmin: boolean;
}

/** Сотрудник УК, которой принадлежит дом (песочница не привязывается к чатам). */
async function staffHouse(ctx: JobContext, staffUserId: number, housePublicId: string): Promise<HouseRow | BindError> {
  const h = await houseByPublicId(ctx.db, housePublicId);
  if (!h || h.isSandbox) return 'house_not_found';
  const roles = await staffOf(ctx.db, staffUserId);
  if (!roles.some((r) => r.uk.id === h.ukId)) return 'forbidden';
  return h;
}

/** Сведения о чате по токену (экран привязки U03). */
export async function bindingInfo(ctx: JobContext, token: string): Promise<{ chatId: number; status: 'active' | 'used' | 'expired'; expiresAt: Date } | null> {
  const [row] = await ctx.db.select().from(chatBindToken).where(eq(chatBindToken.tokenHash, hashToken(token)));
  if (!row) return null;
  const status = row.usedAt ? 'used' : row.expiresAt.getTime() < ctx.clock.now().getTime() ? 'expired' : 'active';
  return { chatId: row.chatId, status, expiresAt: row.expiresAt };
}

/** Привязать чат к дому: сведения о чате и правах бота из MAX, панель — в очередь. */
async function bind(ctx: JobContext, chatId: number, h: HouseRow, staffUserId: number, meta: { key: string; tokenHash?: string }): Promise<BindResult> {
  let title: string | null = null;
  let link: string | null = null;
  let participants: number | null = null;
  let botIsAdmin = false;
  let permissions: string[] = [];
  try {
    const chat = await ctx.max.getChat(chatId);
    title = chat.title ?? null;
    link = chat.link ?? null;
    participants = chat.participants_count;
  } catch (err) {
    ctx.log.warn({ err }, 'привязка: не удалось получить сведения о чате');
  }
  try {
    const me = await ctx.max.getMyMembership(chatId);
    botIsAdmin = me.is_admin;
    permissions = me.permissions ?? [];
  } catch (err) {
    if (!(err instanceof MaxApiError)) throw err;
  }
  await ctx.db.transaction(async (tx) => {
    // Чат привязан к одному дому, дом — к одному чату: прежние привязки заменяются.
    await tx.delete(houseChat).where(or(eq(houseChat.chatId, chatId), eq(houseChat.houseId, h.id)));
    await tx.insert(houseChat).values({
      houseId: h.id,
      chatId,
      title,
      inviteLink: link,
      botIsAdmin,
      botPermissions: permissions,
      participantsCount: participants,
      boundAt: ctx.clock.now(),
      boundBy: staffUserId,
    });
    if (meta.tokenHash) await tx.update(chatBindToken).set({ usedAt: ctx.clock.now() }).where(eq(chatBindToken.tokenHash, meta.tokenHash));
    await ctx.queue.send(QUEUES.panelRender, { houseId: h.id, pin: true }, { tx });
    const user = await userById(tx, staffUserId);
    if (!botIsAdmin && user?.dialogActive) {
      await sendDm(tx, ctx, staffUserId, renderText('bot.dm.bind.not_admin', ctx.i18n, { house: h.label }), meta.key);
    }
  });
  return { house: h, botIsAdmin };
}

/** POST /api/v1/uk/chat-bindings: привязка по одноразовому токену. */
export async function bindChatWithToken(
  ctx: JobContext,
  input: { token: string; housePublicId: string; staffUserId: number },
): Promise<BindResult | BindError> {
  const tokenHash = hashToken(input.token);
  const [row] = await ctx.db.select().from(chatBindToken).where(eq(chatBindToken.tokenHash, tokenHash));
  if (!row) return 'token_not_found';
  if (row.usedAt) return 'token_used';
  if (row.expiresAt.getTime() < ctx.clock.now().getTime()) return 'token_expired';
  const h = await staffHouse(ctx, input.staffUserId, input.housePublicId);
  if (typeof h === 'string') return h;
  return bind(ctx, row.chatId, h, input.staffUserId, { key: `bind:${tokenHash}`, tokenHash });
}

/** /connect <код дома> в групповом чате — только сотрудник УК этого дома. */
export async function onConnectCommand(u: NormalizedUpdate, ctx: JobContext, meta: UpdateMeta): Promise<void> {
  if (u.chatId === null || u.userId === null || !u.text) return;
  const code = u.text.trim().split(/\s+/)[1];
  if (!code) return;
  const h = await staffHouse(ctx, u.userId, code);
  if (typeof h === 'string') {
    ctx.log.info({ reason: h }, '/connect отклонён');
    return;
  }
  await bind(ctx, u.chatId, h, u.userId, { key: `connect:${meta.dedupeKey}` });
}

/** Чат, привязанный к дому (для U03). */
export async function unbindHouse(ctx: JobContext, houseId: number): Promise<void> {
  await ctx.db.delete(houseChat).where(and(eq(houseChat.houseId, houseId)));
}
