/** Сетка «подъезд × этаж»: где отметились жители (U02) и ответы опроса о тепле (U05). Верхний этаж — сверху. */
import type { EntranceFloorGrid, HeatMap } from '@vsemdomom/shared';
import { plural, t } from '../i18n.ts';

const floorsDesc = (floors: number) => Array.from({ length: floors }, (_, i) => floors - i);
const entrancesAsc = (entrances: number) => Array.from({ length: entrances }, (_, i) => i + 1);

/** Порог «3+ квартиры» — подсветка плотности, а не норматив. */
const DENSE = 3;

/** Легенда плотности: 1–2 и 3+ квартиры — в строке заголовка карточки. */
export function GridLegend() {
  return (
    <div className="grid-legend" aria-hidden="true">
      <span className="legend-swatch lvl-1" />
      <span className="small muted">{t('screen.U02.grid.legend.low')}</span>
      <span className="legend-swatch lvl-3" />
      <span className="small muted">{t('screen.U02.grid.legend.high')}</span>
    </div>
  );
}

/** Пустая клетка — точка без фона (как в макете). */
const EMPTY = '·';

export function EntranceFloorGridView({ grid }: { grid: EntranceFloorGrid }) {
  const count = new Map(grid.cells.map((c) => [`${c.entrance}:${c.floor}`, c.count]));
  const unknown = new Map(grid.unknownFloor.map((c) => [c.entrance, c.count]));
  const entrances = entrancesAsc(grid.entrances);
  return (
    <div className="stack tight">
      <div className="grid-wrap">
        <table className="floor-grid">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">{t('screen.U02.grid')}</span>
              </th>
              {entrances.map((e) => (
                <th scope="col" key={e}>
                  {t('entrance.short', { entrance: e })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {floorsDesc(grid.floors).map((floor) => (
              <tr key={floor}>
                <th scope="row">{t('screen.U02.grid.floor', { n: floor })}</th>
                {entrances.map((e) => {
                  const n = count.get(`${e}:${floor}`) ?? 0;
                  return (
                    <td key={e} className={n >= DENSE ? 'lvl-3' : n > 0 ? 'lvl-1' : 'empty'} aria-label={t('screen.U02.grid.sr', { entrance: e, floor, count: n, flats: plural(n, 'flats') })}>
                      {n > 0 ? n : EMPTY}
                    </td>
                  );
                })}
              </tr>
            ))}
            {grid.unknownFloor.length > 0 ? (
              <tr>
                <th scope="row">{t('screen.U02.grid.floor_unknown')}</th>
                {entrances.map((e) => {
                  const n = unknown.get(e) ?? 0;
                  return (
                    <td key={e} className={n >= DENSE ? 'lvl-3' : n > 0 ? 'lvl-1' : 'empty'} aria-label={t('screen.U02.grid.sr', { entrance: e, floor: t('screen.U02.grid.floor_unknown'), count: n, flats: plural(n, 'flats') })}>
                      {n > 0 ? n : EMPTY}
                    </td>
                  );
                })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {grid.unknownEntrance > 0 ? <p className="muted small">{t('screen.U02.grid.unknown_entrance', { count: grid.unknownEntrance, flats: plural(grid.unknownEntrance, 'flats') })}</p> : null}
    </div>
  );
}

type HeatState = 'warm' | 'luke' | 'cold' | 'none';

/** Состояние ячейки — по большинству ответов; при равенстве — более холодное. */
export function heatState(cell: { warm: number; luke: number; cold: number } | undefined): HeatState {
  if (!cell || cell.warm + cell.luke + cell.cold === 0) return 'none';
  if (cell.cold >= cell.luke && cell.cold >= cell.warm) return 'cold';
  if (cell.luke >= cell.warm) return 'luke';
  return 'warm';
}

export function HeatGrid({ map }: { map: HeatMap }) {
  const cells = new Map(map.cells.map((c) => [`${c.entrance}:${c.floor}`, c]));
  const entrances = entrancesAsc(map.entrances);
  const totals = { warm: 0, luke: 0, cold: 0 };
  for (const c of map.cells) {
    totals.warm += c.warm;
    totals.luke += c.luke;
    totals.cold += c.cold;
  }
  return (
    <div className="stack tight">
      <div className="grid-wrap">
        <table className="floor-grid">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">{t('screen.U05.title')}</span>
              </th>
              {entrances.map((e) => (
                <th scope="col" key={e}>
                  {t('entrance.short', { entrance: e })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {floorsDesc(map.floors).map((floor) => (
              <tr key={floor}>
                <th scope="row">{t('screen.U02.grid.floor', { n: floor })}</th>
                {entrances.map((e) => {
                  const cell = cells.get(`${e}:${floor}`);
                  const state = heatState(cell);
                  const n = cell ? cell.warm + cell.luke + cell.cold : 0;
                  return (
                    <td key={e} className={state === 'none' ? 'empty' : `heat-${state}`} aria-label={t('heat.cell.sr', { entrance: e, floor, state: t(`heat.${state}`), count: n, answers: plural(n, 'answers') })}>
                      {state === 'none' ? t('heat.mark.none') : `${t(`heat.mark.${state}`)} ${n}`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="heat-legend">
        {(['warm', 'luke', 'cold'] as const).map((s) => (
          <li key={s} className="row">
            <span className={`legend-swatch heat-${s}`} aria-hidden="true">
              {t(`heat.mark.${s}`)}
            </span>
            <span className="small">{t(`heat.${s}`)}</span>
            <strong className="small">{totals[s]}</strong>
          </li>
        ))}
        <li className="row">
          <span className="legend-swatch" aria-hidden="true">
            {t('heat.mark.none')}
          </span>
          <span className="small">{t('heat.none')}</span>
          <strong className="small">{Math.max(0, map.totalFlats - map.answered)}</strong>
        </li>
      </ul>
    </div>
  );
}
