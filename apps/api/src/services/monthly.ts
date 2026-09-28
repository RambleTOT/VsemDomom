/**
 * F15. Итог месяца в чат дома (C08): 1-го числа не раньше PARAMS.monthlySummaryHour по времени дома —
 * одно сообщение за прошедший месяц. Задача идёт раз в час; дом получает итог один раз
 * (ключ идемпотентности — дом и месяц), не в тихие часы. Дома без чата и песочница — без итога.
 */
import { TZDate } from '@date-fns/tz';
import { isQuietTime, monthBounds, monthKey, monthOf, MS_PER_MINUTE, renderMonthlySummary } from '@vsemdomom/core';
import { eq } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import { house, houseChat } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import { monthlySummaryView } from './uk-view.ts';


export async function monthlySummaryJob(ctx: JobContext): Promise<number> {
  if (!ctx.config.features.monthlySummary) return 0;
  const now = ctx.clock.now();
  const rows = await ctx.db.select({ house, chatId: houseChat.chatId }).from(houseChat).innerJoin(house, eq(house.id, houseChat.houseId)).where(eq(house.isSandbox, false));
  let queued = 0;
  for (const { house: h, chatId } of rows) {
    const local = new TZDate(now.getTime(), h.timezone);
    if (local.getDate() !== PARAMS.monthlySummaryDay || local.getHours() < PARAMS.monthlySummaryHour) continue;
    if (isQuietTime(now, h.timezone, ctx.config.quietHours)) continue;
    // Прошедший месяц: момент за миллисекунду до начала текущего.
    const month = monthOf(new Date(monthBounds(monthOf(now, h.timezone), h.timezone).start.getTime() - 1), h.timezone);
    const summary = await monthlySummaryView(ctx.db, h, now, month);
    const message = renderMonthlySummary(
      {
        housePublicId: h.publicId,
        house: { label: h.label, isModel: h.isModel },
        month: month.month,
        incidents: summary.incidents,
        inNorm: summary.inNorm,
        avgAcceptMs: summary.avgAcceptMinutes === null ? null : summary.avgAcceptMinutes * MS_PER_MINUTE,
        overNorm: summary.services.flatMap((s) =>
          s.excessMinutes > 0 && s.limitMinutes !== null && s.norm
            ? [{ service: s.service, totalMs: s.totalMinutes * MS_PER_MINUTE, limitMs: s.limitMinutes * MS_PER_MINUTE, doc: s.norm.doc, point: s.norm.point }]
            : [],
        ),
        botUsername: ctx.config.max.botUsername,
      },
      ctx.i18n,
    );
    const id = await ctx.db.transaction(async (tx) =>
      enqueueOutbound(tx, ctx.queue, { kind: 'monthly_summary', idempotencyKey: `month:${h.id}:${monthKey(month)}`, target: { chatId }, message }),
    );
    if (id !== null) queued += 1;
  }
  return queued;
}
