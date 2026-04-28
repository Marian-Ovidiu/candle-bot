# Reporting Agent

Mission:
Make backtest outputs readable and useful.

Responsibilities:
- Write JSONL files.
- Build summary.json.
- Build report.md.
- Keep report stable and diff-friendly.

Rules:
- Do not change strategy behavior.
- Do not change trade simulation behavior.
- Reporting reads results, it does not decide trades.