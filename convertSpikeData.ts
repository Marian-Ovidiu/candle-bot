import fs from "fs";
import readline from "readline";
import path from "path";

type InputRow = any;

type OutputRow =
    | { timestampMs: number; price: number }
    | { timestampMs: number; bestBid: number; bestAsk: number };

function normalize(row: InputRow): OutputRow | null {
    // Caso 1: già pronto
    if (row.timestampMs && row.price) {
        return {
            timestampMs: Number(row.timestampMs),
            price: Number(row.price),
        };
    }

    // Caso 2: bestBid / bestAsk
    if (row.timestampMs && row.bestBid && row.bestAsk) {
        return {
            timestampMs: Number(row.timestampMs),
            bestBid: Number(row.bestBid),
            bestAsk: Number(row.bestAsk),
        };
    }

    // Caso 3: formato coinbase book (tipico tuo vecchio progetto)
    if (row.time || row.timestamp) {
        const timestampMs = new Date(row.time || row.timestamp).getTime();

        const bestBid =
            row.bestBid ||
            row.bid ||
            (row.bids && row.bids[0] && Number(row.bids[0][0]));

        const bestAsk =
            row.bestAsk ||
            row.ask ||
            (row.asks && row.asks[0] && Number(row.asks[0][0]));

        if (bestBid && bestAsk) {
            return {
                timestampMs,
                bestBid: Number(bestBid),
                bestAsk: Number(bestAsk),
            };
        }
    }

    return null;
}

async function run() {
    const inputFile = process.argv[2];
    const outputFile = process.argv[3];

    if (!inputFile || !outputFile) {
        console.error(
            "Usage: tsx src/data/convertSpikeData.ts input.jsonl output.jsonl"
        );
        process.exit(1);
    }

    const rl = readline.createInterface({
        input: fs.createReadStream(inputFile),
        crlfDelay: Infinity,
    });

    const outStream = fs.createWriteStream(outputFile);

    let total = 0;
    let converted = 0;
    let skipped = 0;

    for await (const line of rl) {
        total++;

        try {
            const parsed = JSON.parse(line);
            const normalized = normalize(parsed);

            if (normalized) {
                outStream.write(JSON.stringify(normalized) + "\n");
                converted++;
            } else {
                skipped++;
            }
        } catch (e) {
            skipped++;
        }
    }

    outStream.end();

    console.log({
        inputFile,
        outputFile,
        total,
        converted,
        skipped,
    });
}

run();