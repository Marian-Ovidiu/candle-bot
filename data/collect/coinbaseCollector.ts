import fs from "fs";
import path from "path";

const PRODUCT = "BTC-USD";
const INTERVAL_MS = 1000;

const OUTPUT_DIR = path.join(process.cwd(), "data", "collect");

function getTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

async function fetchBestBidAsk() {
    const res = await fetch(
        `https://api.exchange.coinbase.com/products/${PRODUCT}/book?level=1`
    );

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();

    const bestBid = Number(json.bids[0][0]);
    const bestAsk = Number(json.asks[0][0]);

    return { bestBid, bestAsk };
}

async function run() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const filename = `coinbase-${PRODUCT}-${getTimestamp()}.jsonl`;
    const filepath = path.join(OUTPUT_DIR, filename);

    console.log(`Writing to ${filepath}`);

    const stream = fs.createWriteStream(filepath, { flags: "a" });

    setInterval(async () => {
        try {
            const { bestBid, bestAsk } = await fetchBestBidAsk();

            const row = {
                timestampMs: Date.now(),
                bestBid,
                bestAsk,
            };

            stream.write(JSON.stringify(row) + "\n");
        } catch (err) {
            console.error("fetch error", err);
        }
    }, INTERVAL_MS);
}

run();