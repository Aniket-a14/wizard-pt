export interface RequestIdentity {
  key: string;
  snapshot: string;
}

/** Reuse a key only when retrying the exact same payload after an uncertain response. */
export function requestIdentity(previous: RequestIdentity | null, snapshot: string): RequestIdentity {
  return previous?.snapshot === snapshot ? previous : { key: crypto.randomUUID(), snapshot };
}
