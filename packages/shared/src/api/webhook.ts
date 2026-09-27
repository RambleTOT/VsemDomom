import { z } from 'zod';

/** Объект Update MAX: разбор терпимый — неизвестные поля не ломают приём. */
export const MaxUpdateSchema = z
  .object({
    update_type: z.string().meta({ example: 'message_callback' }),
    timestamp: z.int().meta({ description: 'Unix-время события в миллисекундах' }),
  })
  .catchall(z.unknown())
  .meta({ id: 'MaxUpdate', description: 'Событие MAX (см. объект Update в документации MAX)' });

export const WebhookAckSchema = z.object({ ok: z.literal(true) }).meta({ id: 'WebhookAck' });

export const WebhookHeaders = z.object({
  'x-max-bot-api-secret': z.string().meta({ description: 'Секрет подписки (MAX_WEBHOOK_SECRET)' }),
});
