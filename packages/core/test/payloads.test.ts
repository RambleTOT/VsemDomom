import { describe, expect, it } from 'vitest';
import {
  botStartLink,
  decodeBotStart,
  decodeCallback,
  decodeStartApp,
  encodeCallback,
  encodeStartApp,
  startAppLink,
} from '../src/index.ts';

describe('payload кнопок и диплинков', () => {
  it('callback: v1:<action>:<id>[:<arg>] — туда и обратно', () => {
    const p = encodeCallback('join', 'K3f9QpZ2aB', 2);
    expect(p).toBe('v1:join:K3f9QpZ2aB:2');
    expect(decodeCallback(p)).toEqual({ action: 'join', id: 'K3f9QpZ2aB', arg: '2' });
    expect(decodeCallback(encodeCallback('pdn', null))).toEqual({ action: 'pdn', id: null, arg: null });
    expect(decodeCallback(encodeCallback('role', null, 'social_tenant'))).toEqual({ action: 'role', id: null, arg: 'social_tenant' });
  });

  it('мусор и неизвестные действия → null (ответ «Ссылка устарела»)', () => {
    for (const bad of ['', 'join:K3f9QpZ2aB', 'v2:join:K3f9QpZ2aB', 'v1:hack:K3f9QpZ2aB', 'v1:join:short', 'v1:join:K3f9QpZ2aB:2:extra', 'v1:join:K3f9QpZ2aB:<script>', 'x'.repeat(2000)]) {
      expect(decodeCallback(bad), bad).toBeNull();
    }
    expect(decodeCallback(null)).toBeNull();
  });

  it('payload мини-приложения: n_, i_, h_, r_, a_ — публичный ID; o_, c_ — токен', () => {
    expect(decodeStartApp(encodeStartApp('n', 'dom1model1'))).toEqual({ kind: 'new_incident', value: 'dom1model1' });
    expect(decodeStartApp('i_K3f9QpZ2aB')).toEqual({ kind: 'incident', value: 'K3f9QpZ2aB' });
    expect(decodeStartApp('c_abcdefghijklmnop_-XYZ')).toEqual({ kind: 'chat_binding', value: 'abcdefghijklmnop_-XYZ' });
    expect(decodeStartApp('o_short')).toBeNull();
    expect(decodeStartApp('x_K3f9QpZ2aB')).toBeNull();
    expect(decodeStartApp('i-K3f9QpZ2aB')).toBeNull();
    expect(decodeStartApp('i_K3f9QpZ2a!')).toBeNull();
    expect(decodeStartApp(`c_${'a'.repeat(600)}`)).toBeNull();
  });

  it('диплинк бота ?start=h_<houseId> и ссылки', () => {
    expect(decodeBotStart('h_dom1model1')).toEqual({ houseId: 'dom1model1' });
    expect(decodeBotStart('h_bad')).toBeNull();
    expect(decodeBotStart(null)).toBeNull();
    expect(botStartLink('vsemdomom_bot', 'dom1model1')).toBe('https://max.ru/vsemdomom_bot?start=h_dom1model1');
    expect(startAppLink('vsemdomom_bot', 'r_K3f9QpZ2aB')).toBe('https://max.ru/vsemdomom_bot?startapp=r_K3f9QpZ2aB');
  });
});
