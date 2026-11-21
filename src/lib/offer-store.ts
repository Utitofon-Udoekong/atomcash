import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listUtxos, prepare } from "./live";
import { viewOf, type Offer, type OfferAsset, type OfferView } from "./offer";

const OPEN_MS = 30 * 60 * 1000;
const TAKEN_MS = 20 * 60 * 1000;
const ALICE_WINDOW = 180;
const BOB_WINDOW = 120;
const FILE = path.join(process.cwd(), "data", "offers.json");

interface Board {
  offers: Offer[];
}

const globalBoard = globalThis as typeof globalThis & { __atomcashOffers?: Board };

function readBoard(): Board {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Board;
    if (!Array.isArray(parsed.offers)) return { offers: [] };
    return parsed;
  } catch {
    return { offers: [] };
  }
}

function board(): Board {
  if (globalBoard.__atomcashOffers === undefined) {
    globalBoard.__atomcashOffers = readBoard();
  }
  return globalBoard.__atomcashOffers;
}

function save(next: Board): void {
  globalBoard.__atomcashOffers = next;
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(next));
  } catch {
    // The warm server keeps the board in memory when the disk is read-only.
  }
}

function prune(offers: Offer[], now = Date.now()): Offer[] {
  return offers.filter((offer) => {
    const age = now - offer.createdAt;
    return offer.status === "open" ? age < OPEN_MS : age < TAKEN_MS;
  });
}

let tail: Promise<void> = Promise.resolve();

function lock<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function isHex(value: string, size?: number): boolean {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) return false;
  if (size === undefined) return value.length >= 40 && value.length <= 520;
  return value.length === size * 2;
}

function assertAsset(asset: OfferAsset): void {
  if (asset.kind !== "bch" && asset.kind !== "token") throw new Error("asset");
  if (!/^\d+(\.\d+)?$/.test(asset.text)) throw new Error("amount");
  if (!/^\d+$/.test(asset.base) || BigInt(asset.base) <= 0n) throw new Error("amount");
  if (asset.symbol.trim() === "" || asset.symbol.length > 24) throw new Error("symbol");
  if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 18) throw new Error("decimals");
  if (asset.kind === "bch") {
    if (asset.category !== "") throw new Error("token");
    return;
  }
  if (!isHex(asset.category, 32)) throw new Error("token");
}

export interface OpenInput {
  id: string;
  send: OfferAsset;
  want: OfferAsset;
  secretHash: string;
  makerRefundLock: string;
  makerPayoutLock: string;
}

export function listOffers(): OfferView[] {
  const next = prune(board().offers);
  save({ offers: next });
  return next
    .filter((offer) => offer.status === "open")
    .sort((left, right) => right.createdAt - left.createdAt)
    .map(viewOf);
}

export function readOffer(id: string): Offer | undefined {
  const next = prune(board().offers);
  save({ offers: next });
  return next.find((offer) => offer.id === id);
}

export function openOffer(input: OpenInput): Offer {
  if (!/^[0-9a-fA-F]{16}$/.test(input.id)) throw new Error("id");
  if (!isHex(input.secretHash, 32)) throw new Error("secret");
  if (!isHex(input.makerRefundLock) || !isHex(input.makerPayoutLock)) throw new Error("lock");
  assertAsset(input.send);
  assertAsset(input.want);
  const next = prune(board().offers);
  const existing = next.find((offer) => offer.id === input.id);
  if (existing !== undefined) {
    save({ offers: next });
    return existing;
  }
  const offer: Offer = {
    id: input.id,
    createdAt: Date.now(),
    status: "open",
    send: input.send,
    want: input.want,
    secretHash: input.secretHash.toLowerCase(),
    makerRefundLock: input.makerRefundLock.toLowerCase(),
    makerPayoutLock: input.makerPayoutLock.toLowerCase(),
  };
  save({ offers: [offer, ...next] });
  return offer;
}

export function takeOffer(id: string, takerRefundLock: string, takerPayoutLock: string): Promise<Offer> {
  if (!isHex(takerRefundLock) || !isHex(takerPayoutLock)) return Promise.reject(new Error("lock"));
  return lock(async () => {
    const next = prune(board().offers);
    const offer = next.find((row) => row.id === id);
    if (offer === undefined) throw new Error("missing");
    if (offer.status !== "open") throw new Error("taken");
    offer.status = "taken";
    save({ offers: next });
    try {
      const now = Math.floor(Date.now() / 1000);
      const aliceSide = {
        timeout: now + ALICE_WINDOW,
        secretHash: offer.secretHash,
        payoutLock: takerPayoutLock.toLowerCase(),
        refundLock: offer.makerRefundLock,
        tokenCategory: offer.send.kind === "token" ? offer.send.category : "",
        tokenAmount: offer.send.kind === "token" ? offer.send.base : "0",
      };
      const bobSide = {
        timeout: now + BOB_WINDOW,
        secretHash: offer.secretHash,
        payoutLock: offer.makerPayoutLock,
        refundLock: takerRefundLock.toLowerCase(),
        tokenCategory: offer.want.kind === "token" ? offer.want.category : "",
        tokenAmount: offer.want.kind === "token" ? offer.want.base : "0",
      };
      const alice = await prepare("mainnet", aliceSide);
      const bob = await prepare("mainnet", bobSide);
      offer.alice = { address: alice.address, side: aliceSide };
      offer.bob = { address: bob.address, side: bobSide };
      save({ offers: next });
      return offer;
    } catch (error) {
      offer.status = "open";
      offer.alice = undefined;
      offer.bob = undefined;
      save({ offers: next });
      throw error;
    }
  });
}

export async function releaseOffer(id: string): Promise<void> {
  await lock(async () => {
    const next = prune(board().offers);
    const offer = next.find((row) => row.id === id);
    if (offer === undefined || offer.status !== "taken" || offer.bob === undefined) return;
    const [aliceUtxos, bobUtxos] = await Promise.all([
      offer.alice === undefined ? Promise.resolve([]) : listUtxos("mainnet", offer.alice.address),
      listUtxos("mainnet", offer.bob.address),
    ]);
    if (aliceUtxos.length > 0 || bobUtxos.length > 0) return;
    offer.status = "open";
    offer.alice = undefined;
    offer.bob = undefined;
    save({ offers: next });
  });
}
