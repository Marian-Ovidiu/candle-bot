export type Direction = 'LONG' | 'SHORT';

export interface MarketTick {
  timestampMs: number;
  price: number;
  volume?: number;
  symbol?: string;
  source?: string;
}

export interface NormalizedPricePoint {
  timestampMs: number;
  price: number;
  volume?: number;
}
