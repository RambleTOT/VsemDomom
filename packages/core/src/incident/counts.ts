/**
 * Счётчики карточки (F02, F03): сколько жителей отметилось и в каких подъездах.
 * Считаются только отметившие «у меня тоже»; «не подтверждены» — уровень доверия 0,
 * в том числе незарегистрированные.
 */
import type { TrustLevel } from '../domain/enums.ts';
import { countsForThreshold } from './check.ts';

export interface CountParticipant {
  entrance: number | null;
  trustLevel: TrustLevel;
  /** false — ответил «Не у меня». */
  affected: boolean;
}

export interface EntranceCount {
  entrance: number;
  count: number;
}

export interface ParticipantCounts {
  residents: number;
  byEntrance: EntranceCount[];
  unconfirmed: number;
}

export function participantCounts(participants: readonly CountParticipant[]): ParticipantCounts {
  const affected = participants.filter((p) => p.affected);
  const byEntrance = new Map<number, number>();
  for (const p of affected) {
    if (p.entrance !== null) byEntrance.set(p.entrance, (byEntrance.get(p.entrance) ?? 0) + 1);
  }
  return {
    residents: affected.length,
    byEntrance: [...byEntrance.entries()].sort(([a], [b]) => a - b).map(([entrance, count]) => ({ entrance, count })),
    unconfirmed: affected.filter((p) => !countsForThreshold(p.trustLevel)).length,
  };
}
