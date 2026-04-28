# Project Rules

This project is a clean 5-minute candle trading research bot.

Core rules:
- Do not add real trading execution yet.
- Do not use private exchange APIs yet.
- Backtest first, paper live second, real live last.
- Keep modules small, pure, and testable.
- No direct process.env access outside src/config/config.ts.
- All decisions and trades must be written as JSONL.
- Every strategy change must be measurable through summary metrics.

Architecture:
- data builds candles
- strategy produces decisions
- paper engine simulates trades
- backtest orchestrates
- reporting writes outputs

Do not import strategy logic into data modules.
Do not import reporting logic into strategy modules.