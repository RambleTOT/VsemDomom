/** Геометрия модельного дома: квартиры пронумерованы подряд по подъездам, внутри подъезда — по этажам. */
export interface HouseGeometry {
  entrances: number;
  floors: number;
  flatsPerFloor: number;
  flatFrom: number;
  flatTo: number;
}

export interface FlatLocation {
  entrance: number;
  floor: number;
}

export function isFlatInRange(house: HouseGeometry, flatNo: number): boolean {
  return Number.isInteger(flatNo) && flatNo >= house.flatFrom && flatNo <= house.flatTo;
}

export function isEntranceInRange(house: Pick<HouseGeometry, 'entrances'>, entrance: number): boolean {
  return Number.isInteger(entrance) && entrance >= 1 && entrance <= house.entrances;
}

export function isFloorInRange(house: Pick<HouseGeometry, 'floors'>, floor: number): boolean {
  return Number.isInteger(floor) && floor >= 1 && floor <= house.floors;
}

/** Подъезд и этаж квартиры; null — квартира вне диапазона или за пределами сетки дома. */
export function flatLocation(house: HouseGeometry, flatNo: number): FlatLocation | null {
  if (!isFlatInRange(house, flatNo)) return null;
  const perEntrance = house.floors * house.flatsPerFloor;
  const index = flatNo - house.flatFrom;
  const entrance = Math.floor(index / perEntrance) + 1;
  const floor = Math.floor((index % perEntrance) / house.flatsPerFloor) + 1;
  if (entrance > house.entrances) return null;
  return { entrance, floor };
}

/**
 * Квартиры по всему дому: по одной в каждом подъезде по кругу, в подъездах — на разных этажах;
 * занятые и несуществующие пропускаются. Для демо-соседей: сетка «подъезд × этаж» заполнена вразброс.
 */
export function spreadFlats(house: HouseGeometry, count: number, taken: ReadonlySet<number> = new Set()): number[] {
  const perEntrance = house.floors * house.flatsPerFloor;
  const result: number[] = [];
  // За perEntrance кругов каждый подъезд проходит все пары «этаж, место на этаже» ровно один раз.
  for (let round = 0; round < perEntrance && result.length < count; round += 1) {
    for (let entrance = 1; entrance <= house.entrances && result.length < count; entrance += 1) {
      const floor = ((round + entrance - 1) % house.floors) + 1;
      const slot = Math.floor(round / house.floors) % house.flatsPerFloor;
      const flat = house.flatFrom + (entrance - 1) * perEntrance + (floor - 1) * house.flatsPerFloor + slot;
      if (isFlatInRange(house, flat) && !taken.has(flat) && !result.includes(flat)) result.push(flat);
    }
  }
  return result;
}
