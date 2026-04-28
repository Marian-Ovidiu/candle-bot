import { describe, expect, it } from 'vitest';
import { CandleBuilder } from './candleBuilder';

describe('CandleBuilder', () => {
  it('creates the first candle from the first tick', () => {
    const builder = new CandleBuilder(300_000);

    expect(builder.update(1_000, 100)).toBeUndefined();
    expect(builder.flush()).toEqual({
      startTimeMs: 0,
      endTimeMs: 300_000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      sampleCount: 1,
    });
  });

  it('updates high low and close within the same bucket', () => {
    const builder = new CandleBuilder(300_000);

    builder.update(1_000, 100);
    builder.update(2_000, 105);
    builder.update(3_000, 98);
    builder.update(4_000, 101);

    expect(builder.flush()).toEqual({
      startTimeMs: 0,
      endTimeMs: 300_000,
      open: 100,
      high: 105,
      low: 98,
      close: 101,
      sampleCount: 4,
    });
  });

  it('closes the current candle when the bucket changes', () => {
    const builder = new CandleBuilder(300_000);

    builder.update(1_000, 100);
    builder.update(2_000, 102);

    expect(builder.update(300_000, 110)).toEqual({
      startTimeMs: 0,
      endTimeMs: 300_000,
      open: 100,
      high: 102,
      low: 100,
      close: 102,
      sampleCount: 2,
    });

    expect(builder.flush()).toEqual({
      startTimeMs: 300_000,
      endTimeMs: 600_000,
      open: 110,
      high: 110,
      low: 110,
      close: 110,
      sampleCount: 1,
    });
  });

  it('flushes the last candle at the end of the backtest', () => {
    const builder = new CandleBuilder(300_000);

    builder.update(10_000, 200);
    builder.update(20_000, 190);

    expect(builder.flush()).toEqual({
      startTimeMs: 0,
      endTimeMs: 300_000,
      open: 200,
      high: 200,
      low: 190,
      close: 190,
      sampleCount: 2,
    });

    expect(builder.flush()).toBeUndefined();
  });

  it('ignores out-of-order ticks deterministically', () => {
    const builder = new CandleBuilder(300_000);

    builder.update(10_000, 100);
    expect(builder.update(9_000, 120)).toBeUndefined();
    expect(builder.rejectedOutOfOrderCount).toBe(1);

    expect(builder.flush()).toEqual({
      startTimeMs: 0,
      endTimeMs: 300_000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      sampleCount: 1,
    });
  });
});
