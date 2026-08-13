import { getJson, postJson } from './client';
import type { PrepareRainfallEventResult, RainfallEventList } from './types';
export function listRainfallEvents(): Promise<RainfallEventList> {
  return getJson<RainfallEventList>('/api/rainfall-events');
}
export function prepareRainfallEvent(eventDate: string): Promise<PrepareRainfallEventResult> {
  return postJson<PrepareRainfallEventResult>(`/api/rainfall-events/${eventDate}/prepare`, {});
}
