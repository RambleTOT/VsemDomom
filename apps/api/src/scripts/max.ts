/**
 * Служебные команды Bot API для стенда (раздел «подключение токена»):
 *   node dist/scripts/max.js me | subscriptions | subscribe | unsubscribe | commands
 * Локально: pnpm max:me и т.д. В режиме simulator работают на FakeMaxApi.
 * Токен берётся из окружения и никуда не печатается.
 */
import { ruTranslator } from '@vsemdomom/shared';
import { pino } from 'pino';
import { ConfigError, loadConfig } from '../config/env.ts';
import { webhookUrl } from '../jobs/maintenance.ts';
import { FakeMaxApi, MemoryFakeCallStore } from '../max/fake.ts';
import { simulatorChats } from '../max/factory.ts';
import { HttpMaxApi } from '../max/http.ts';
import { RateLimiter } from '../max/rate-limiter.ts';
import type { MaxApi, MaxBotCommand } from '../max/types.ts';
import { SUBSCRIBED_UPDATE_TYPES } from '../max/update.ts';
import { systemClock } from '../util/clock.ts';

export const BOT_COMMANDS: readonly { name: string; key: string }[] = [
  { name: 'start', key: 'bot.cmd.start' },
  { name: 'menu', key: 'bot.cmd.menu' },
  { name: 'report', key: 'bot.cmd.report' },
  { name: 'help', key: 'bot.cmd.help' },
  { name: 'delete', key: 'bot.cmd.delete' },
];

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function run(command: string | undefined): Promise<void> {
  const config = loadConfig();
  const log = pino({ level: 'warn' });
  const max: MaxApi =
    config.max.mode === 'simulator'
      ? new FakeMaxApi({ clock: systemClock, store: new MemoryFakeCallStore(), botUsername: config.max.botUsername, chats: simulatorChats(config.publicBaseUrl) })
      : new HttpMaxApi({
          baseUrl: config.max.apiBase,
          token: config.max.botToken ?? '',
          log,
          limiter: new RateLimiter({ globalRps: config.max.rate.globalRps }),
          rate: { perChat: config.max.rate.perChat, answersPerChat: config.max.rate.answersPerChat },
        });
  const url = webhookUrl(config.publicBaseUrl);

  switch (command ?? '') {
    case 'me': {
      const me = await max.getMe();
      print({ user_id: me.user_id, username: me.username, name: me.first_name, is_bot: me.is_bot, mode: max.kind });
      if (config.max.mode !== 'simulator' && me.username !== config.max.botUsername) {
        process.stderr.write(`Внимание: username бота ${me.username ?? '—'} не совпадает с MAX_BOT_USERNAME\n`);
        process.exitCode = 1;
      }
      return;
    }
    case 'subscriptions':
      print(await max.listSubscriptions());
      return;
    case 'subscribe': {
      if (!config.max.webhookSecret) throw new Error('MAX_WEBHOOK_SECRET не задан');
      if (!url.startsWith('https://')) throw new Error(`webhook должен быть https: ${url}`);
      await max.subscribe({ url, updateTypes: [...SUBSCRIBED_UPDATE_TYPES], secret: config.max.webhookSecret });
      print({ subscribed: url, updateTypes: SUBSCRIBED_UPDATE_TYPES });
      return;
    }
    case 'unsubscribe':
      await max.unsubscribe(url);
      print({ unsubscribed: url });
      return;
    case 'commands': {
      const commands: MaxBotCommand[] = BOT_COMMANDS.map((c) => ({ name: c.name, description: ruTranslator.t(c.key) }));
      await max.setCommands(commands);
      print(commands);
      return;
    }
    default:
      process.stderr.write('Команды: me | subscriptions | subscribe | unsubscribe | commands\n');
      process.exitCode = 2;
  }
}

run(process.argv[2]).catch((err: unknown) => {
  process.stderr.write(`${err instanceof ConfigError ? err.message : err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
