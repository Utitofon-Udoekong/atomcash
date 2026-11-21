import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "history.json");

export interface TradeRecord {
  at: number;
  pair: string;
  claim: string;
  payout?: string;
}

interface Book {
  trades: TradeRecord[];
}

const RECORDED: TradeRecord = {
  at: 1795261212686,
  pair: "0.00005214 BCH → 0.01 PUSD",
  claim: "1a4ef4d7cfb587f775b66b718f48aba5a234183e41d14f2e895ef95c8d4017ac",
  payout: "4c1dd8c13e69ef86f17c81c860bd3bcf82330541637374ece41635ee28c7b75b",
};

const globalBook = globalThis as typeof globalThis & { __atomcashHistory?: Book };

function readBook(): Book {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Book;
    if (!Array.isArray(parsed.trades)) return { trades: [RECORDED] };
    return parsed;
  } catch {
    return { trades: [RECORDED] };
  }
}

function book(): Book {
  if (globalBook.__atomcashHistory === undefined) {
    globalBook.__atomcashHistory = readBook();
  }
  return globalBook.__atomcashHistory;
}

function save(next: Book): void {
  globalBook.__atomcashHistory = next;
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(next));
  } catch {
    // The warm server keeps the book in memory when the disk is read-only.
  }
}

function isTxid(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

export function listTrades(): TradeRecord[] {
  const next = withRecorded(book());
  save(next);
  return [...next.trades].sort((left, right) => right.at - left.at);
}

function withRecorded(current: Book): Book {
  if (current.trades.some((trade) => trade.claim === RECORDED.claim)) return current;
  return { trades: [RECORDED, ...current.trades] };
}

export function recordTrade(input: { pair: string; claim: string; payout?: string; at?: number }): TradeRecord {
  const pair = input.pair.trim();
  if (pair === "" || pair.length > 80) throw new Error("pair");
  if (!isTxid(input.claim)) throw new Error("claim");
  if (input.payout !== undefined && !isTxid(input.payout)) throw new Error("payout");
  const current = withRecorded(book());
  const claim = input.claim.toLowerCase();
  const existing = current.trades.find((trade) => trade.claim === claim);
  const row: TradeRecord = {
    at: input.at ?? Date.now(),
    pair,
    claim,
    payout: input.payout?.toLowerCase() ?? existing?.payout,
  };
  const trades = existing === undefined ? [row, ...current.trades] : current.trades.map((trade) => (trade.claim === claim ? row : trade));
  save({ trades });
  return row;
}
