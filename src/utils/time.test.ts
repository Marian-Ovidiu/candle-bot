import { describe, expect, it } from 'vitest';
import { createSessionId, floorToInterval } from './time';

describe('time utilities', () => {
  it('floors timestamps to the requested interval', () => {
    expect(floorToInterval(12_345, 1_000)).toBe(12_000);
    expect(floorToInterval(300_001, 300_000)).toBe(300_000);
  });

  it('creates a stable session id from a timestamp', () => {
    expect(createSessionId(Date.parse('2026-04-28T10:00:00.000Z'))).toBe(
      'session-2026-04-28T10-00-00-000Z',
    );
  });
});
