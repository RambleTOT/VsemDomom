import { keywordMatcher } from '@vsemdomom/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KEYWORD_PHRASES } from '../src/config/params.ts';
import { incident, incidentParticipant } from '../src/db/schema.ts';
import { normalizeUpdate } from '../src/max/update.ts';
import { callbackPayload, createHarness, dm, fakeChat, lastDm, registerResident, STAFF_ID, updates, type Harness } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const MIN = 60_000;
const A = 8301;
const B = 8302;

describe.skipIf(!url)('F13: ответ на «нет воды» в чате дома (FEATURE_KEYWORD_REPLY)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness(url!, { chats: [fakeChat(CHAT)], env: { FEATURE_KEYWORD_REPLY: 'true' } });
    await h.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
    await registerResident(h, A, 57);
  });
  afterAll(async () => {
    await h?.close();
  });

  const replies = () => h.max.messagesIn({ chatId: CHAT }).filter((m) => m.message.text.startsWith('Похоже, в доме'));

  it('аварии нет: «Сообщить об аварии» ответом на сообщение жителя', async () => {
    const raw = updates.groupText(CHAT, B, 'Соседи, у кого-нибудь нет воды?');
    await h.deliver(raw);
    const [reply] = replies();
    expect(reply?.message.text).toBe('Похоже, в доме авария. Сообщите о ней одной кнопкой — соседи увидят карточку в чате\nМодельные данные');
    expect(reply?.message.keyboard.map((r) => r.map((b) => `${b.type}:${b.text}`))).toEqual([['open_app:Сообщить об аварии']]);
    expect(reply?.message.replyToMid).toBe(raw.message.body.mid);
  });

  it('не чаще раза в 10 минут на чат; сообщения без ключевых слов и сообщения ботов — без ответа', async () => {
    await h.deliver(updates.groupText(CHAT, B, 'опять нет воды'));
    await h.deliver(updates.groupText(CHAT, B, 'Добрый день'));
    const fromBot = updates.groupText(CHAT, 1, '🔴 Нет горячей воды · УК ещё не ответила');
    (fromBot.message.sender as { is_bot: boolean }).is_bot = true;
    await h.advance(11 * MIN);
    await h.deliver(fromBot);
    expect(replies()).toHaveLength(1);
  });

  it('есть открытая авария: вид услуги из неё и «Присоединиться к аварии» — житель отмечается', async () => {
    await h.deliver(updates.dmText(A, '/report'));
    await h.deliver(updates.callback(A, callbackPayload(lastDm(h, A), 'Горячая вода'), dm(A)));
    await h.deliver(updates.callback(A, callbackPayload(lastDm(h, A), 'Сейчас'), dm(A)));
    await h.deliver(updates.callback(A, callbackPayload(lastDm(h, A), 'Дом'), dm(A)));
    await h.advance(11 * MIN);
    await h.deliver(updates.groupText(CHAT, B, 'и у нас нет горячей'));
    const reply = replies().at(-1)!;
    expect(reply.message.text.split('\n')[0]).toBe('Похоже, в доме нет горячей воды. Отметьтесь одной кнопкой — соседи увидят в карточке');
    await h.deliver(updates.callback(B, callbackPayload(reply.message, 'Присоединиться к аварии'), { chatId: CHAT, chatType: 'chat' }, reply.mid));
    const [inc] = await h.handle.db.select().from(incident).where(eq(incident.createdBy, A));
    const people = await h.handle.db.select().from(incidentParticipant).where(eq(incidentParticipant.incidentId, inc!.id));
    expect(people.map((p) => p.userId).sort()).toEqual([A, B].sort());
  });

  it('текст группы в задачу очереди не попадает — только признак ключевого слова', () => {
    const u = normalizeUpdate(updates.groupText(CHAT, B, 'нет воды, звоните 89991234567'), { keywordMatcher: keywordMatcher(KEYWORD_PHRASES) });
    expect(u.keywordHit).toBe(true);
    expect(u.text).toBeUndefined();
    expect(JSON.stringify(u)).not.toContain('8999');
  });
});
