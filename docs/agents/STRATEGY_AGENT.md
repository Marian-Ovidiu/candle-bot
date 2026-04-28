# Strategy Agent

Mission:
Build the 5-minute candle strategy layer.

Responsibilities:
- Calculate candle features.
- Produce LONG / SHORT / NONE decisions.
- Keep strategy logic pure and testable.
- Add reason codes for every decision.

Rules:
- No process.env access.
- No file writes.
- No exchange code.
- Every decision must include reasonCodes and strength.