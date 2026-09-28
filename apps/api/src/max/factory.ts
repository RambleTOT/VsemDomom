import type { Clock } from '@vsemdomom/core';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.ts';
import type { Db } from '../db/client.ts';
import { FakeMaxApi, type FakeCallStore, type FakeChat } from './fake.ts';
import { DbFakeCallStore } from './fake-store.ts';
import { HttpMaxApi } from './http.ts';
import { RateLimiter } from './rate-limiter.ts';
import type { MaxApi } from './types.ts';

/** Чаты симулятора: демо-чаты домов 1 и 4. Бот — администратор, участником считается любой. */
export const SIMULATOR_CHATS: readonly { chatId: number; title: string; housePublicId: string }[] = [
  { chatId: -1001, title: 'Дом 1 (демо, симулятор)', housePublicId: 'dom1model1' },
  { chatId: -1004, title: 'Дом 4 (демо, симулятор)', housePublicId: 'dom4model4' },
];

const SIMULATOR_PARTICIPANTS = 312;

export function simulatorChats(publicBaseUrl: string): FakeChat[] {
  return SIMULATOR_CHATS.map((c) => ({
    chatId: c.chatId,
    title: c.title,
    link: `${publicBaseUrl}/dev/chat?chat=${c.chatId}`,
    participantsCount: SIMULATOR_PARTICIPANTS,
    members: null,
    botIsAdmin: true,
    botPermissions: ['read_all_messages', 'pin_message', 'write', 'edit_link'],
  }));
}

export interface MaxFactoryDeps {
  db: Db;
  log: Logger;
  clock: Clock;
  /** Журнал симулятора; по умолчанию — таблица fake_max_call. */
  fakeStore?: FakeCallStore;
}

export function createMaxApi(config: AppConfig, deps: MaxFactoryDeps): MaxApi {
  if (config.max.mode === 'simulator') {
    return new FakeMaxApi({
      clock: deps.clock,
      store: deps.fakeStore ?? new DbFakeCallStore(deps.db),
      botUsername: config.max.botUsername,
      chats: simulatorChats(config.publicBaseUrl),
    });
  }
  const token = config.max.botToken;
  if (!token) throw new Error('MAX_BOT_TOKEN не задан');
  return new HttpMaxApi({
    baseUrl: config.max.apiBase,
    token,
    log: deps.log.child({ component: 'max' }),
    limiter: new RateLimiter({ globalRps: config.max.rate.globalRps }),
    rate: { perChat: config.max.rate.perChat, answersPerChat: config.max.rate.answersPerChat },
  });
}
