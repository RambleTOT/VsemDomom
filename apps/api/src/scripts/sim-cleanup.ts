/**
 * Переход стенда с симулятора на живой MAX: убрать следы режима simulator, чтобы демо-чаты
 * привязывались к модельным домам с чистого листа.
 *   node dist/scripts/sim-cleanup.js           — показать, что будет удалено
 *   node dist/scripts/sim-cleanup.js --apply   — удалить
 * Удаляются: привязки симуляторных чатов к домам, аварии модельных домов 1–4, созданные при
 * проверках (история из сидов остаётся), опросы этих домов, синтетические жители и диспетчер
 * страницы /dev/chat, журнал симулятора fake_max_call. Дом-песочница и проживания людей не трогаются.
 */
import { and, count, eq, inArray } from 'drizzle-orm';
import { ConfigError, loadConfig } from '../config/env.ts';
import { createDb } from '../db/client.ts';
import { fakeMaxCall, house, houseChat, incident, maxUser, poll } from '../db/schema.ts';
import { SIM_RESIDENT_IDS, SIM_UK_USER_ID } from '../dev/sim-chat.ts';
import { SIMULATOR_CHATS } from '../max/factory.ts';
import { removeIncidents } from '../services/incident-removal.ts';
import { deleteUserData } from '../services/user-data.ts';

const SIM_USERS = [...SIM_RESIDENT_IDS, SIM_UK_USER_ID];

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const config = loadConfig();
  const handle = createDb(config.databaseUrl, { max: 2, applicationName: 'vsemdomom-sim-cleanup' });
  try {
    const summary = await handle.db.transaction(async (tx) => {
      const chats = SIMULATOR_CHATS.map((c) => c.chatId);
      const bound = await tx.select({ houseId: houseChat.houseId, chatId: houseChat.chatId }).from(houseChat).where(inArray(houseChat.chatId, chats));
      const modelHouses = await tx
        .select({ id: house.id })
        .from(house)
        .where(and(eq(house.isModel, true), eq(house.isSandbox, false)));
      const houseIds = modelHouses.map((h) => h.id);
      const incidents = houseIds.length
        ? await tx.select({ id: incident.id }).from(incident).where(and(inArray(incident.houseId, houseIds), eq(incident.isModel, false)))
        : [];
      const polls = houseIds.length ? await tx.select({ n: count() }).from(poll).where(inArray(poll.houseId, houseIds)) : [{ n: 0 }];
      const journal = await tx.select({ n: count() }).from(fakeMaxCall);
      const users = await tx.select({ id: maxUser.id }).from(maxUser).where(inArray(maxUser.id, SIM_USERS));
      const result = {
        simulatorChatBindings: bound.length,
        testIncidentsInModelHouses: incidents.length,
        polls: polls[0]?.n ?? 0,
        simulatorUsers: users.length,
        simulatorJournalRows: journal[0]?.n ?? 0,
      };
      if (!apply) return result;
      await tx.delete(houseChat).where(inArray(houseChat.chatId, chats));
      await removeIncidents(tx, incidents.map((r) => r.id));
      if (houseIds.length) await tx.delete(poll).where(inArray(poll.houseId, houseIds));
      await tx.delete(fakeMaxCall);
      return result;
    });
    if (apply) {
      // Синтетические жители и диспетчер /dev/chat: как /delete, затем сами записи (каскадом — проживания и роли).
      for (const userId of SIM_USERS) await deleteUserData(handle.db, userId, new Date());
      await handle.db.delete(maxUser).where(inArray(maxUser.id, SIM_USERS));
    }
    process.stdout.write(`${JSON.stringify({ mode: apply ? 'удалено' : 'будет удалено (запустите с --apply)', ...summary }, null, 2)}\n`);
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof ConfigError ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
