import type { Me } from '@vsemdomom/shared';
import { describe, expect, it } from 'vitest';
import { homePath, houseFromTarget, onboardingFor, routeForStart, safeNext } from '../src/app/start.ts';

type Who = Pick<Me, 'staff' | 'residencies' | 'consentRequired'>;

const house = { id: 'dom1model1' } as Me['residencies'][number]['house'];
const resident: Who = { staff: null, consentRequired: false, residencies: [{ house } as Me['residencies'][number]] };
const newcomer: Who = { staff: null, consentRequired: true, residencies: [] };
const staff: Who = { staff: { uk: { id: 'ukmodel001', name: 'УК', isModel: true }, role: 'dispatcher', isDemo: true, isChecker: false }, consentRequired: true, residencies: [] };

const ID = 'KBdF9MZV2Y';
const TOKEN = 'invite_link_example_value';

describe('экран по payload запуска', () => {
  it.each([
    [`n_${ID}`, `/report?house=${ID}`, `/report?house=${ID}`],
    [`i_${ID}`, `/incident/${ID}`, `/uk/incident/${ID}`],
    [`h_${ID}`, `/house/${ID}`, `/uk/houses/${ID}`],
    [`r_${ID}`, `/incident/${ID}/result`, `/uk/incident/${ID}`],
    [`a_${ID}`, `/incident/${ID}/act`, `/uk/incident/${ID}`],
    [`o_${TOKEN}`, `/owner/${TOKEN}`, `/owner/${TOKEN}`],
    [`c_${TOKEN}`, '/error/forbidden', `/uk/bind/${TOKEN}`],
  ])('%s → житель %s, УК %s', (payload, forResident, forStaff) => {
    expect(routeForStart(payload, resident)).toBe(forResident);
    expect(routeForStart(payload, staff)).toBe(forStaff);
  });

  it('сотрудник, который живёт в доме (демо-роль проверяющего): итог и акт — как житель', () => {
    const both: Who = { ...staff, residencies: resident.residencies };
    expect(routeForStart(`r_${ID}`, both)).toBe(`/incident/${ID}/result`);
    expect(routeForStart(`a_${ID}`, both)).toBe(`/incident/${ID}/act`);
    expect(routeForStart(`i_${ID}`, both)).toBe(`/uk/incident/${ID}`);
    // «Мой дом» из меню жителя — свой дом как житель; чужой дом УК — экран УК.
    expect(routeForStart('h_dom1model1', both)).toBe('/house/dom1model1');
    expect(routeForStart(`h_${ID}`, both)).toBe(`/uk/houses/${ID}`);
  });

  it('без payload — корень роли', () => {
    expect(routeForStart(null, resident)).toBe('/house/dom1model1');
    expect(routeForStart(null, staff)).toBe('/uk');
    expect(routeForStart(null, newcomer)).toBe('/onboarding/residence');
  });

  it('неизвестный payload — «Ссылка устарела»', () => {
    expect(routeForStart('x_123', resident)).toBe('/error/expired');
    expect(routeForStart('i_short', resident)).toBe('/error/expired');
  });
});

describe('регистрация перед экраном', () => {
  it('без согласия — S01, затем запрошенный экран', () => {
    expect(onboardingFor(newcomer, `/incident/${ID}`)).toBe(`/onboarding?next=${encodeURIComponent(`/incident/${ID}`)}`);
  });

  it('без квартиры — S02', () => {
    expect(onboardingFor({ ...newcomer, consentRequired: false }, `/incident/${ID}`)).toBe(`/onboarding/residence?next=${encodeURIComponent(`/incident/${ID}`)}`);
  });

  it('сам экран регистрации не становится «следующим» — нет петли', () => {
    expect(onboardingFor(newcomer, '/onboarding/residence')).toBe('/onboarding');
    expect(onboardingFor({ ...newcomer, consentRequired: false }, '/onboarding/residence')).toBeNull();
    expect(safeNext('/onboarding/residence', '/house/dom1model1')).toBe('/house/dom1model1');
  });

  it('УК, приглашение собственника и системные экраны — без регистрации', () => {
    expect(onboardingFor(staff, '/uk')).toBeNull();
    expect(onboardingFor(newcomer, `/owner/${TOKEN}`)).toBeNull();
    expect(onboardingFor(newcomer, '/error/expired')).toBeNull();
    expect(onboardingFor(resident, `/incident/${ID}`)).toBeNull();
  });
});

describe('служебное', () => {
  it('safeNext принимает только внутренние пути', () => {
    expect(safeNext('/profile', '/')).toBe('/profile');
    expect(safeNext('//evil.example', '/')).toBe('/');
    expect(safeNext('https://evil.example', '/')).toBe('/');
    expect(safeNext(null, '/uk')).toBe('/uk');
  });

  it('дом из ссылки для S02', () => {
    expect(houseFromTarget(`/report?house=${ID}`)).toBe(ID);
    expect(houseFromTarget(`/house/${ID}`)).toBe(ID);
    expect(houseFromTarget(`/incident/${ID}`)).toBeNull();
  });

  it('корень роли', () => {
    expect(homePath(staff)).toBe('/uk');
    expect(homePath(resident)).toBe('/house/dom1model1');
  });
});
