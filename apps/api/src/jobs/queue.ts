/**
 * Очередь задач в той же PostgreSQL (pg-boss): изменение данных и постановка задач —
 * в одной транзакции, задачи переживают рестарт, ретраи с экспоненциальной задержкой.
 */
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss, type QueueOptions, type SendOptions } from 'pg-boss';
import type { Logger } from 'pino';

export const QUEUES = {
  /** Событие MAX из webhook или long polling. */
  update: 'max-update',
  /** Новое сообщение бота из журнала outbound_message (идемпотентно). */
  outbound: 'outbound-send',
  /** Ответ нажавшему (POST /answers). */
  callbackAnswer: 'callback-answer',
  /** Правка карточки аварии: не чаще раза в окно на карточку. */
  cardRender: 'card-render',
  /** Правка панели дома в закрепе. */
  panelRender: 'panel-render',
  /** Предупреждение и истечение срока по нормативу. */
  deadline: 'deadline-tick',
  /** Окно проверки после «Устранено» и предельный срок расхождения. */
  check: 'check-tick',
  /** S09: срок проверки после повторного сообщения в АДС — предложение акта без исполнителя. */
  act: 'act-tick',
  /** Личные уведомления присоединившимся. */
  notify: 'notify-participants',
  /** Одно напоминание ввести номер заявки АДС. */
  adsReminder: 'ads-reminder',
  /** Демо-инструменты: ответы модельных соседей. */
  demo: 'demo-tick',
  /** Сторож подписки webhook (раз в 10 минут). */
  watchdog: 'watchdog',
  /** Чистка старых записей (раз в сутки). */
  cleanup: 'cleanup',
  /** Задачи, не выполненные после всех попыток: лог и алерт. */
  failed: 'job-failed',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Выполненные задачи хранятся сутки. */
const KEEP_COMPLETED_SECONDS = 86_400;

const COMMON: QueueOptions = {
  retryLimit: 5,
  retryDelay: 1,
  retryBackoff: true,
  retryDelayMax: 120,
  expireInSeconds: 120,
  deleteAfterSeconds: KEEP_COMPLETED_SECONDS,
};

const QUEUE_OPTIONS: Record<QueueName, QueueOptions & { deadLetter?: string }> = {
  [QUEUES.update]: { ...COMMON, deadLetter: QUEUES.failed },
  [QUEUES.outbound]: { ...COMMON, retryDelay: 2, deadLetter: QUEUES.failed },
  [QUEUES.callbackAnswer]: { ...COMMON, retryLimit: 3 },
  [QUEUES.cardRender]: { ...COMMON, deadLetter: QUEUES.failed },
  [QUEUES.panelRender]: { ...COMMON },
  [QUEUES.deadline]: { ...COMMON, deadLetter: QUEUES.failed },
  [QUEUES.check]: { ...COMMON, deadLetter: QUEUES.failed },
  [QUEUES.act]: { ...COMMON, deadLetter: QUEUES.failed },
  [QUEUES.notify]: { ...COMMON },
  [QUEUES.adsReminder]: { ...COMMON },
  [QUEUES.demo]: { ...COMMON },
  [QUEUES.watchdog]: { ...COMMON, retryLimit: 1 },
  [QUEUES.cleanup]: { ...COMMON, retryLimit: 1, expireInSeconds: 600 },
  [QUEUES.failed]: { ...COMMON, retryLimit: 0 },
};

/** Транзакция drizzle, в которой ставится задача. */
export interface TxLike {
  execute(query: unknown): Promise<unknown>;
}

export interface EnqueueOptions {
  priority?: number;
  startAfter?: Date;
  singletonKey?: string;
  /** Поставить задачу в той же транзакции, что и изменение данных. */
  tx?: TxLike;
}

/** То, что нужно сервисам: поставить задачу. Реализации — pg-boss и память (тесты). */
export interface JobQueue {
  send(queue: QueueName, data: object, options?: EnqueueOptions): Promise<string | null>;
  /** Не чаще одной задачи с ключом за окно: следующая — в следующем окне. */
  sendDebounced(queue: QueueName, data: object, seconds: number, key: string, options?: Pick<EnqueueOptions, 'tx'>): Promise<string | null>;
}

function toSendOptions(options: EnqueueOptions = {}): SendOptions {
  const out: SendOptions = {};
  if (options.priority !== undefined) out.priority = options.priority;
  if (options.startAfter) out.startAfter = options.startAfter;
  if (options.singletonKey) out.singletonKey = options.singletonKey;
  if (options.tx) out.db = fromDrizzle(options.tx as Parameters<typeof fromDrizzle>[0], sql);
  return out;
}

export class PgBossQueue implements JobQueue {
  readonly boss: PgBoss;

  constructor(boss: PgBoss) {
    this.boss = boss;
  }

  async send(queue: QueueName, data: object, options?: EnqueueOptions): Promise<string | null> {
    return this.boss.send(queue, data, toSendOptions(options));
  }

  async sendDebounced(queue: QueueName, data: object, seconds: number, key: string, options: Pick<EnqueueOptions, 'tx'> = {}): Promise<string | null> {
    return this.boss.sendDebounced(queue, data, toSendOptions(options), seconds, key);
  }
}

export interface BossOptions {
  databaseUrl: string;
  /** Только отправка задач (процесс api): без обслуживания очередей и расписаний. */
  sendOnly: boolean;
  log: Logger;
  applicationName: string;
}

export const BOSS_SCHEMA = 'pgboss';

export function createBoss(options: BossOptions): PgBoss {
  const boss = new PgBoss({
    connectionString: options.databaseUrl,
    schema: BOSS_SCHEMA,
    application_name: options.applicationName,
    max: options.sendOnly ? 3 : 6,
    supervise: !options.sendOnly,
    schedule: !options.sendOnly,
  });
  boss.on('error', (err) => options.log.error({ err }, 'очередь: ошибка pg-boss'));
  return boss;
}

/** Создать очереди (идемпотентно): новые — с опциями, существующие — обновить опции. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  // Очередь неудачных задач нужна раньше остальных: на неё ссылаются как на deadLetter.
  const names = [QUEUES.failed, ...Object.values(QUEUES).filter((q) => q !== QUEUES.failed)];
  for (const name of names) {
    const options = QUEUE_OPTIONS[name];
    const existing = await boss.getQueue(name);
    if (existing) await boss.updateQueue(name, options);
    else await boss.createQueue(name, { ...options, policy: 'standard' });
  }
}

/** Очередь в памяти для тестов сервисов. */
export class MemoryJobQueue implements JobQueue {
  readonly sent: { queue: QueueName; data: object; options: EnqueueOptions | undefined; debounce?: { seconds: number; key: string } }[] = [];

  async send(queue: QueueName, data: object, options?: EnqueueOptions): Promise<string | null> {
    this.sent.push({ queue, data, options });
    return String(this.sent.length);
  }

  async sendDebounced(queue: QueueName, data: object, seconds: number, key: string): Promise<string | null> {
    this.sent.push({ queue, data, options: undefined, debounce: { seconds, key } });
    return String(this.sent.length);
  }

  take(queue: QueueName): object[] {
    const taken = this.sent.filter((s) => s.queue === queue).map((s) => s.data);
    for (let i = this.sent.length - 1; i >= 0; i -= 1) if (this.sent[i]?.queue === queue) this.sent.splice(i, 1);
    return taken;
  }
}
