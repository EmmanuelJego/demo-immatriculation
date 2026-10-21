export const EVENT_TYPES = [
  'ProjectRegistered',
  'SourceKeyAttached',
  'ProjectsMerged',
  'ProjectSplit',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// Only values that survive a round trip through jsonb unchanged.
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };

export interface NewEvent {
  readonly type: EventType;
  readonly projectIds: readonly string[];
  readonly payload: JsonObject;
}

export interface EventLogEntry extends NewEvent {
  readonly sequence: number;
  readonly occurredAt: Date;
}
