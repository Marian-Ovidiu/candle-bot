import { floorToInterval } from '../utils/time';
import type { Candle } from './candleTypes';

export class CandleBuilder {
  private readonly intervalMs: number;
  private currentCandle: Candle | undefined;
  private lastTimestampMs: number | undefined;

  rejectedOutOfOrderCount = 0;

  constructor(intervalMs: number = 300_000) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('intervalMs must be greater than zero');
    }

    this.intervalMs = intervalMs;
  }

  update(timestampMs: number, price: number): Candle | undefined {
    if (this.lastTimestampMs !== undefined && timestampMs < this.lastTimestampMs) {
      this.rejectedOutOfOrderCount += 1;
      return undefined;
    }

    const bucketStartTimeMs = floorToInterval(timestampMs, this.intervalMs);
    const bucketEndTimeMs = bucketStartTimeMs + this.intervalMs;

    if (this.currentCandle === undefined) {
      this.currentCandle = this.createCandle(
        bucketStartTimeMs,
        bucketEndTimeMs,
        price,
      );
      this.lastTimestampMs = timestampMs;
      return undefined;
    }

    if (bucketStartTimeMs !== this.currentCandle.startTimeMs) {
      const closedCandle = this.currentCandle;
      this.currentCandle = this.createCandle(
        bucketStartTimeMs,
        bucketEndTimeMs,
        price,
      );
      this.lastTimestampMs = timestampMs;
      return closedCandle;
    }

    this.currentCandle = {
      ...this.currentCandle,
      high: Math.max(this.currentCandle.high, price),
      low: Math.min(this.currentCandle.low, price),
      close: price,
      sampleCount: this.currentCandle.sampleCount + 1,
    };
    this.lastTimestampMs = timestampMs;

    return undefined;
  }

  flush(): Candle | undefined {
    if (this.currentCandle === undefined) {
      return undefined;
    }

    const closedCandle = this.currentCandle;
    this.currentCandle = undefined;
    return closedCandle;
  }

  private createCandle(
    startTimeMs: number,
    endTimeMs: number,
    price: number,
  ): Candle {
    return {
      startTimeMs,
      endTimeMs,
      open: price,
      high: price,
      low: price,
      close: price,
      sampleCount: 1,
    };
  }
}
