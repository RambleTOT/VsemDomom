import { describe, expect, it } from 'vitest';
import { flatLocation, isEntranceInRange, isFlatInRange } from '../src/index.ts';

const house1 = { entrances: 4, floors: 9, flatsPerFloor: 4, flatFrom: 1, flatTo: 144 };

describe('геометрия дома', () => {
  it('квартиры идут подряд по подъездам и этажам', () => {
    expect(flatLocation(house1, 1)).toEqual({ entrance: 1, floor: 1 });
    expect(flatLocation(house1, 4)).toEqual({ entrance: 1, floor: 1 });
    expect(flatLocation(house1, 5)).toEqual({ entrance: 1, floor: 2 });
    expect(flatLocation(house1, 36)).toEqual({ entrance: 1, floor: 9 });
    expect(flatLocation(house1, 37)).toEqual({ entrance: 2, floor: 1 });
    expect(flatLocation(house1, 144)).toEqual({ entrance: 4, floor: 9 });
  });

  it('вне диапазона — null', () => {
    expect(flatLocation(house1, 0)).toBeNull();
    expect(flatLocation(house1, 145)).toBeNull();
    expect(flatLocation(house1, 2.5)).toBeNull();
    expect(isFlatInRange(house1, 57)).toBe(true);
    expect(isEntranceInRange(house1, 5)).toBe(false);
  });

  it('учитывает начальный номер квартиры', () => {
    const h = { entrances: 2, floors: 5, flatsPerFloor: 4, flatFrom: 101, flatTo: 140 };
    expect(flatLocation(h, 101)).toEqual({ entrance: 1, floor: 1 });
    expect(flatLocation(h, 121)).toEqual({ entrance: 2, floor: 1 });
  });
});
