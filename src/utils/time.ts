export function floorToInterval(timestampMs: number, intervalMs: number): number {
  if (intervalMs <= 0) {
    throw new Error('intervalMs must be greater than zero');
  }

  return Math.floor(timestampMs / intervalMs) * intervalMs;
}

export function createSessionId(timestampMs: number = Date.now()): string {
  return `session-${new Date(timestampMs).toISOString().replace(/[:.]/g, '-')}`;
}
