import { keywordMatcher } from '@vsemdomom/core';
import { describe, expect, it } from 'vitest';
import { dedupeKey, normalizeUpdate, updatePriority, updateSchema } from '../src/max/update.ts';

// Фикстуры — по объекту Update из schema.yaml MAX; имена вымышленные.
const callback = {
  update_type: 'message_callback',
  timestamp: 1790000000000,
  callback: { timestamp: 1790000000000, callback_id: 'cb.123', payload: 'v1:join:K3f9QpZ2aB:2', user: { user_id: 1001, first_name: 'Анна', is_bot: false } },
  message: { recipient: { chat_id: -1001, chat_type: 'chat' }, timestamp: 1789999990000, body: { mid: 'mid.card', seq: 5, text: 'карточка' } },
  user_locale: 'ru',
};
const dmMessage = {
  update_type: 'message_created',
  timestamp: 1790000000001,
  message: { sender: { user_id: 1001, first_name: 'Анна', is_bot: false }, recipient: { chat_id: 555, chat_type: 'dialog' }, timestamp: 1, body: { mid: 'mid.dm', seq: 1, text: '57' } },
};
const groupMessage = {
  update_type: 'message_created',
  timestamp: 1790000000002,
  message: { sender: { user_id: 1002, first_name: 'Борис', is_bot: false }, recipient: { chat_id: -1001, chat_type: 'chat' }, timestamp: 1, body: { mid: 'mid.g', seq: 2, text: 'У кого тоже нет воды?' } },
};
const botStarted = { update_type: 'bot_started', timestamp: 1790000000003, chat_id: 555, user: { user_id: 1001, first_name: 'Анна', is_bot: false }, payload: 'h_dom1model1', user_locale: 'ru' };

const parse = (u: unknown) => updateSchema.parse(u);
const off = { keywordMatcher: null };

describe('события MAX', () => {
  it('ключи дедупликации', () => {
    expect(dedupeKey(parse(callback))).toBe('cb:cb.123');
    expect(dedupeKey(parse(dmMessage))).toBe('msg:mid.dm');
    expect(dedupeKey(parse(botStarted))).toBe('bot_started:555:1001:1790000000003');
  });

  it('нажатие: чат карточки, нажавший, payload; имя не попадает в задачу', () => {
    const n = normalizeUpdate(parse(callback), off);
    expect(n).toMatchObject({ type: 'message_callback', chatId: -1001, chatType: 'chat', userId: 1001, callbackId: 'cb.123', payload: 'v1:join:K3f9QpZ2aB:2', mid: 'mid.card' });
    expect(JSON.stringify(n)).not.toContain('Анна');
    expect(updatePriority('message_callback')).toBeGreaterThan(updatePriority('message_created'));
  });

  it('личка: текст передаётся (шаги диалога); группа: только признак ключевых слов', () => {
    expect(normalizeUpdate(parse(dmMessage), off)).toMatchObject({ chatType: 'dialog', userId: 1001, text: '57' });
    const g = normalizeUpdate(parse(groupMessage), { keywordMatcher: keywordMatcher(['у кого тоже', 'нет воды']) });
    expect(g).toMatchObject({ chatType: 'chat', chatId: -1001, keywordHit: true });
    expect(g.text).toBeUndefined();
    expect(JSON.stringify(g)).not.toContain('воды?');
    expect(normalizeUpdate(parse(groupMessage), off).keywordHit).toBeUndefined();
  });

  it('bot_started с payload диплинка; остальные типы — без имён', () => {
    expect(normalizeUpdate(parse(botStarted), off)).toMatchObject({ type: 'bot_started', chatId: 555, userId: 1001, payload: 'h_dom1model1', locale: 'ru' });
    const added = normalizeUpdate(parse({ update_type: 'user_added', timestamp: 1, chat_id: -1001, user: { user_id: 7, first_name: 'Вера' }, inviter_id: null, is_channel: false }), off);
    expect(added).toMatchObject({ type: 'user_added', chatId: -1001, userId: 7, inviterId: null });
    const perms = normalizeUpdate(parse({ update_type: 'bot_admin_permissions_changed', timestamp: 1, chat_id: -1001, user_id: 9, bot_id: 1, is_channel: false, is_admin: true, permissions: ['pin_message', 'post_edit_delete_message'] }), off);
    expect(perms).toMatchObject({ isAdmin: true, permissions: ['pin_message', 'post_edit_delete_message'] });
  });

  it('неизвестные поля и типы не ломают разбор', () => {
    const u = parse({ update_type: 'comment_created', timestamp: 1, something_new: { a: 1 } });
    expect(normalizeUpdate(u, off)).toMatchObject({ type: 'comment_created' });
    expect(updateSchema.safeParse({ timestamp: 1 }).success).toBe(false);
  });
});

describe('ключевые слова F13', () => {
  it('без учёта регистра, ё и лишних пробелов', () => {
    const m = keywordMatcher(['нет воды', 'отключили свет']);
    expect(m('У нас   НЕТ   воды')).toBe(true);
    expect(m('Отключили воду')).toBe(false);
    expect(m('отключили  свет')).toBe(true);
  });
});
