import type { Clock } from '@vsemdomom/core';

export const systemClock: Clock = {
  now: () => new Date(),
};
