/** Вызовы API по контракту docs/api/openapi.yaml (типы — из packages/shared). */
import type {
  ActInfo,
  ActReadyRequest,
  AdsRegistrationRequest,
  ChatBindingInfo,
  ChatBindingResponse,
  CreateIncidentRequest,
  DemoNeighboursResponse,
  DemoResetResponse,
  HeatingPollResponse,
  HeatMap,
  HouseDetail,
  HouseMonthResponse,
  HouseSearchResponse,
  HouseSummary,
  IncidentDetail,
  JoinRequest,
  JoinResponse,
  Me,
  ObservationRequest,
  OwnerInviteCreateResponse,
  OwnerInviteDecisionResponse,
  OwnerInviteView,
  ParticipationResponse,
  RecalculationResponse,
  ResidencyRequest,
  ResidencyResponse,
  ResidentDecisionResponse,
  ResidentsResponse,
  Result,
  SendToDmResponse,
  ServiceType,
  SessionResponse,
  SettingsResponse,
  UkHouseDetail,
  UkHousesResponse,
  UkIncidentDetail,
  UkIncidentsResponse,
  UkStatusRequest,
  VersionResponse,
} from '@vsemdomom/shared';
import { newIdempotencyKey, request } from './client.ts';

export type UkListStatus = 'open' | 'expired' | 'closed';

export const api = {
  version: () => request<VersionResponse>('GET', '/version'),
  authMax: (initData: string) => request<SessionResponse>('POST', '/auth/max', { body: { initData } }),
  authDev: (userId: number, role: 'resident' | 'uk', startParam: string | null) =>
    request<SessionResponse>('POST', '/auth/dev', { body: { userId, role, ...(startParam ? { startParam } : {}) } }),

  me: () => request<Me>('GET', '/me'),
  consent: (version: string) => request<undefined>('POST', '/me/consent', { body: { version } }),
  residency: (body: ResidencyRequest) => request<ResidencyResponse>('PUT', '/me/residency', { body }),
  deleteMe: () => request<undefined>('DELETE', '/me'),
  demoUkRole: (code: string) => request<Me>('POST', '/me/demo-uk-role', { body: { code } }),
  settings: (notifyDefault: boolean) => request<SettingsResponse>('PATCH', '/me/settings', { body: { notifyDefault } }),

  searchHouses: (q?: string) => request<HouseSearchResponse>('GET', '/houses/search', { query: { q } }),
  houseSummary: (id: string) => request<HouseSummary>('GET', `/houses/${id}/summary`),
  house: (id: string) => request<HouseDetail>('GET', `/houses/${id}`),
  houseMonth: (id: string, service: ServiceType, month?: string) =>
    request<HouseMonthResponse>('GET', `/houses/${id}/month`, { query: { service, month } }),

  createIncident: (body: CreateIncidentRequest, key: string = newIdempotencyKey()) =>
    request<IncidentDetail>('POST', '/incidents', { body, headers: { 'idempotency-key': key } }),
  incident: (id: string) => request<IncidentDetail>('GET', `/incidents/${id}`),
  join: (id: string, body: JoinRequest) => request<JoinResponse>('POST', `/incidents/${id}/join`, { body }),
  leave: (id: string) => request<IncidentDetail>('POST', `/incidents/${id}/leave`, { body: {} }),
  ads: (id: string, body: AdsRegistrationRequest) => request<IncidentDetail>('POST', `/incidents/${id}/ads-registration`, { body }),
  observe: (id: string, body: ObservationRequest) => request<IncidentDetail>('POST', `/incidents/${id}/observations`, { body }),
  participation: (id: string, notify: boolean) => request<ParticipationResponse>('PATCH', `/incidents/${id}/participation`, { body: { notify } }),
  result: (id: string) => request<Result>('GET', `/incidents/${id}/result`),
  recalculate: (id: string, monthlyCharge: number) =>
    request<RecalculationResponse>('POST', `/incidents/${id}/recalculation`, { body: { monthlyCharge }, headers: { 'idempotency-key': newIdempotencyKey() } }),
  sendToDm: (id: string, text: string) => request<SendToDmResponse>('POST', `/incidents/${id}/application/send-to-dm`, { body: { text } }),
  actReady: (id: string, body: ActReadyRequest) => request<ActInfo>('POST', `/incidents/${id}/act/ready`, { body }),

  createOwnerInvite: (incidentId: string) => request<OwnerInviteCreateResponse>('POST', '/owner-invites', { body: { incidentId } }),
  ownerInvite: (token: string) => request<OwnerInviteView>('GET', `/owner-invites/${token}`),
  confirmOwnerInvite: (token: string) => request<OwnerInviteDecisionResponse>('POST', `/owner-invites/${token}/confirm`, { body: {} }),
  rejectOwnerInvite: (token: string) => request<OwnerInviteDecisionResponse>('POST', `/owner-invites/${token}/reject`, { body: {} }),

  ukIncidents: (status: UkListStatus, houseId?: string) => request<UkIncidentsResponse>('GET', '/uk/incidents', { query: { status, houseId } }),
  ukIncident: (id: string) => request<UkIncidentDetail>('GET', `/uk/incidents/${id}`),
  ukStatus: (id: string, version: number, body: UkStatusRequest) =>
    request<UkIncidentDetail>('POST', `/uk/incidents/${id}/status`, { body, headers: { 'if-match': String(version) } }),
  ukMerge: (id: string, version: number, intoId: string) =>
    request<UkIncidentDetail>('POST', `/uk/incidents/${id}/merge`, { body: { intoId }, headers: { 'if-match': String(version) } }),
  ukHouses: () => request<UkHousesResponse>('GET', '/uk/houses'),
  ukHouse: (id: string) => request<UkHouseDetail>('GET', `/uk/houses/${id}`),
  chatBinding: (token: string) => request<ChatBindingInfo>('GET', `/uk/chat-bindings/${token}`),
  bindChat: (token: string, houseId: string) => request<ChatBindingResponse>('POST', '/uk/chat-bindings', { body: { token, houseId } }),
  heatmap: (houseId: string) => request<HeatMap>('GET', `/uk/houses/${houseId}/heatmap`),
  startHeatingPoll: (houseId: string) => request<HeatingPollResponse>('POST', `/uk/houses/${houseId}/polls/heating`, { body: {} }),
  residents: (houseId?: string) => request<ResidentsResponse>('GET', '/uk/residents', { query: { status: 'pending', houseId } }),
  confirmResident: (id: string) => request<ResidentDecisionResponse>('POST', `/uk/residents/${id}/confirm`, { body: {} }),
  rejectResident: (id: string) => request<ResidentDecisionResponse>('POST', `/uk/residents/${id}/reject`, { body: {} }),
  demoNeighbours: (houseId: string) => request<DemoNeighboursResponse>('POST', `/uk/houses/${houseId}/demo/neighbours`, { body: {} }),
  demoTimeShift: (incidentId: string) => request<UkIncidentDetail>('POST', `/uk/incidents/${incidentId}/demo/time-shift`, { body: {} }),
  demoReset: (houseId: string) => request<DemoResetResponse>('POST', `/uk/houses/${houseId}/demo/reset`, { body: {} }),
};
