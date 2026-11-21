import { createHash } from "node:crypto";
import {
  binToHex,
  cashAddressToLockingBytecode,
  CashAddressNetworkPrefix,
  hexToBin,
  lockingBytecodeToCashAddress,
  publicKeyToP2pkhLockingBytecode,
} from "@bitauth/libauth";
import { TransactionBuilder, type Utxo } from "@solidcash/solidcash";
import { ElectrumNetworkProvider } from "@solidcash/solidcash/network/electrum";
import { placeholderP2PKHUnlocker } from "@solidcash/solidcash/walletconnect";
import {
  DUST,
  FEE,
  OWNER_FEE,
  claimTx,
  consensusCategory,
  instantiate,
  refundTx,
  type Side,
} from "./atom";
import { categoryHex, sameCategory } from "./token";

export type NetName = "chipnet" | "mainnet";

export interface Coin {
  txid: string;
  vout: number;
  satoshis: string;
  tokenCategory?: string;
  tokenAmount?: string;
  address: string;
  pathName: string;
  pathIndex: number;
}

export interface WireSource {
  outpointTransactionHash: string;
  outpointIndex: number;
  sequenceNumber: number;
  unlockingBytecode: string;
  lockingBytecode: string;
  valueSatoshis: string;
  token?: { amount: string; category: string };
}

const PREFIX = {
  chipnet: CashAddressNetworkPrefix.testnet,
  mainnet: CashAddressNetworkPrefix.mainnet,
} as const;

export function providerFor(network: NetName): ElectrumNetworkProvider {
  return new ElectrumNetworkProvider(network);
}

export function bytesFromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error("hex");
  }
  return hexToBin(clean);
}

export function lockFromPublicKey(publicKey: Uint8Array, network: NetName, token: boolean): {
  lockingBytecode: Uint8Array;
  address: string;
} {
  const lockingBytecode = publicKeyToP2pkhLockingBytecode({ publicKey });
  if (typeof lockingBytecode === "string") {
    throw new Error(lockingBytecode);
  }
  const encoded = lockingBytecodeToCashAddress({
    bytecode: lockingBytecode,
    prefix: PREFIX[network],
    tokenSupport: token,
  });
  if (typeof encoded === "string") {
    throw new Error(encoded);
  }
  return { lockingBytecode, address: encoded.address };
}

function cashaddr(bytecode: Uint8Array, network: NetName, token: boolean): string {
  const encoded = lockingBytecodeToCashAddress({
    bytecode,
    prefix: PREFIX[network],
    tokenSupport: token,
  });
  if (typeof encoded === "string") {
    throw new Error(encoded);
  }
  return encoded.address;
}

export interface SideInput {
  timeout: number;
  secretHash: string;
  payoutLock: string;
  refundLock: string;
  tokenCategory: string;
  tokenAmount: string;
  fee?: string;
}

export function sideFromInput(input: SideInput): Side {
  const category = input.tokenCategory === "" ? new Uint8Array() : consensusCategory(input.tokenCategory);
  return {
    timeout: BigInt(input.timeout),
    secretHash: bytesFromHex(input.secretHash),
    payoutLock: bytesFromHex(input.payoutLock),
    refundLock: bytesFromHex(input.refundLock),
    tokenCategory: category,
    tokenAmount: BigInt(input.tokenAmount),
    fee: input.fee === undefined ? FEE : BigInt(input.fee),
  };
}

export async function prepare(network: NetName, input: SideInput) {
  const provider = providerFor(network);
  try {
    const side = sideFromInput(input);
    const contract = instantiate(provider, side);
    const token = side.tokenAmount > 0n || side.tokenCategory.length > 0;
    return {
      address: token ? contract.tokenAddress : contract.address,
      depositSats: (token ? DUST : 0n).toString(),
      fee: FEE.toString(),
      lockingBytecode: binToHex(bytesFromHex(contract.lockingBytecode)),
    };
  } finally {
    await provider.disconnect().catch(() => false);
  }
}

export async function listWallet(
  network: NetName,
  rows: { pubkeyHex: string; pathName: string; pathIndex: number }[],
): Promise<Coin[]> {
  const provider = providerFor(network);
  try {
    const groups: Coin[][] = [];
    for (let start = 0; start < rows.length; start += 6) {
      const slice = rows.slice(start, start + 6);
      const part = await Promise.all(
        slice.map(async (row) => {
          if (row.pathName !== "receive" && row.pathName !== "change") throw new Error("wallet");
          if (!Number.isInteger(row.pathIndex) || row.pathIndex < 0 || row.pathIndex > 40) throw new Error("wallet");
          const lock = lockFromPublicKey(bytesFromHex(row.pubkeyHex), network, true);
          const utxos = await provider.getUtxos(lock.address);
          return utxos.map((utxo) => ({
            txid: utxo.txid,
            vout: utxo.vout,
            satoshis: utxo.satoshis.toString(),
            tokenCategory: utxo.token?.category,
            tokenAmount: utxo.token?.amount.toString(),
            address: lock.address,
            pathName: row.pathName,
            pathIndex: row.pathIndex,
          }));
        }),
      );
      groups.push(...part);
    }
    const seen = new Set<string>();
    const coins: Coin[] = [];
    for (const group of groups) {
      for (const coin of group) {
        const key = `${coin.txid}:${coin.vout}`;
        if (seen.has(key)) continue;
        seen.add(key);
        coins.push(coin);
      }
    }
    return coins;
  } finally {
    await provider.disconnect().catch(() => false);
  }
}

export async function listUtxos(network: NetName, address: string): Promise<Coin[]> {
  const provider = providerFor(network);
  try {
    const rows = await provider.getUtxos(address);
    return rows.map((row) => ({
      txid: row.txid,
      vout: row.vout,
      satoshis: row.satoshis.toString(),
      tokenCategory: row.token?.category,
      tokenAmount: row.token?.amount.toString(),
      address,
      pathName: "receive",
      pathIndex: 0,
    }));
  } finally {
    await provider.disconnect().catch(() => false);
  }
}

function asUtxo(coin: Coin): Utxo {
  return {
    txid: coin.txid,
    vout: coin.vout,
    satoshis: BigInt(coin.satoshis),
    token:
      coin.tokenCategory === undefined
        ? undefined
        : { category: coin.tokenCategory, amount: BigInt(coin.tokenAmount ?? "0") },
  };
}

export async function buildFunding(args: {
  network: NetName;
  payoutLock: string;
  refundLock: string;
  timeout: number;
  secretHash: string;
  tokenCategory: string;
  tokenAmount: string;
  payoutSats: string;
  coins: Coin[];
  changeAddress: string;
}): Promise<{ transactionHex: string; sourceOutputs: WireSource[]; inputPaths: [number, string, number][] }> {
  const provider = providerFor(args.network);
  try {
    const side = sideFromInput({
      timeout: args.timeout,
      secretHash: args.secretHash,
      payoutLock: args.payoutLock,
      refundLock: args.refundLock,
      tokenCategory: args.tokenCategory,
      tokenAmount: args.tokenAmount,
    });
    const contract = instantiate(provider, side);
    const sellingToken = side.tokenCategory.length > 0;
    const wanted = categoryHex(args.tokenCategory);
    const lockedSats = (sellingToken ? DUST : BigInt(args.payoutSats)) + FEE + OWNER_FEE;
    const selected: Coin[] = [];
    let sats = 0n;
    let token = 0n;
    if (sellingToken) {
      const holders = args.coins
        .filter((coin) => sameCategory(wanted, coin.tokenCategory) && BigInt(coin.tokenAmount ?? "0") > 0n)
        .sort((left, right) => (BigInt(left.tokenAmount ?? "0") < BigInt(right.tokenAmount ?? "0") ? 1 : -1));
      for (const holder of holders) {
        if (token >= side.tokenAmount) break;
        selected.push({ ...holder, tokenCategory: wanted });
        sats += BigInt(holder.satoshis);
        token += BigInt(holder.tokenAmount ?? "0");
      }
      if (token < side.tokenAmount) throw new Error("token-funds");
    }
    const tokenChange = sellingToken && token > side.tokenAmount ? DUST : 0n;
    const plain = args.coins
      .filter((coin) => coin.tokenCategory === undefined && !selected.includes(coin))
      .sort((a, b) => (BigInt(a.satoshis) < BigInt(b.satoshis) ? -1 : 1));
    for (const coin of plain) {
      if (sats >= lockedSats + tokenChange + 2500n) break;
      selected.push(coin);
      sats += BigInt(coin.satoshis);
    }
    if (sats < lockedSats + tokenChange + 500n) {
      throw new Error("bch-funds");
    }
    const tokenOut = sellingToken ? { category: wanted, amount: side.tokenAmount } : undefined;
    const destination = sellingToken ? contract.tokenAddress : contract.address;
    const builder = new TransactionBuilder({ provider });
    for (const coin of selected) {
      builder.addInput(asUtxo(coin), placeholderP2PKHUnlocker(coin.address));
    }
    builder.addOutput({ to: destination, amount: lockedSats, token: tokenOut });
    if (sellingToken && token > side.tokenAmount) {
      builder.addOutput({
        to: args.changeAddress,
        amount: DUST,
        token: { category: wanted, amount: token - side.tokenAmount },
      });
    }
    builder.addBchChangeOutputIfNeeded({ to: args.changeAddress, feeRate: 2 });
    const hex = builder.build();
    const wire = builder.generateWcTransactionObject({ broadcast: false, userPrompt: "AtomCash" });
    const sourceOutputs: WireSource[] = wire.sourceOutputs.map((row) => ({
      outpointTransactionHash: binToHex(row.outpointTransactionHash),
      outpointIndex: Number(row.outpointIndex),
      sequenceNumber: Number(row.sequenceNumber),
      unlockingBytecode: binToHex(row.unlockingBytecode),
      lockingBytecode: binToHex(row.lockingBytecode),
      valueSatoshis: row.valueSatoshis.toString(),
      token:
        row.token === undefined
          ? undefined
          : { amount: row.token.amount.toString(), category: binToHex(row.token.category) },
    }));
    return {
      transactionHex: hex,
      sourceOutputs,
      inputPaths: selected.map((coin, index) => [index, coin.pathName, coin.pathIndex]),
    };
  } finally {
    await provider.disconnect().catch(() => false);
  }
}

function requireReason(error: unknown): string {
  if (typeof error === "object" && error !== null && "requireStatement" in error) {
    const statement = (error as { requireStatement?: { message?: string } }).requireStatement;
    if (statement?.message) return statement.message;
  }
  if (error instanceof Error) {
    const match = /following message: ([^\n.]+)/.exec(error.message);
    if (match?.[1]) return match[1];
    return error.message.split("\n")[0] ?? "rejected";
  }
  return "rejected";
}

export async function buildSpend(args: {
  network: NetName;
  action: "claim" | "refund";
  side: SideInput;
  utxo: { txid: string; vout: number; satoshis: string; tokenCategory?: string; tokenAmount?: string };
  secret?: string;
  outputLock: string;
}): Promise<{ ok: true; hex: string; txid: string } | { ok: false; reason: string }> {
  const provider = providerFor(args.network);
  try {
    const side = sideFromInput(args.side);
    const contract = instantiate(provider, side);
    const utxo: Utxo = {
      txid: args.utxo.txid,
      vout: args.utxo.vout,
      satoshis: BigInt(args.utxo.satoshis),
      token:
        args.utxo.tokenCategory === undefined
          ? undefined
          : { category: args.utxo.tokenCategory, amount: BigInt(args.utxo.tokenAmount ?? "0") },
    };
    const outputLock = bytesFromHex(args.outputLock);
    const token =
      utxo.token === undefined
        ? undefined
        : { category: utxo.token.category, amount: utxo.token.amount };
    let tx: TransactionBuilder;
    if (args.action === "claim") {
      if (args.secret === undefined) return { ok: false, reason: "secret" };
      tx = claimTx(provider, contract, utxo, bytesFromHex(args.secret), outputLock, token);
    } else {
      const now = await provider.getMedianTimePast();
      if (BigInt(now) < side.timeout) return { ok: false, reason: "timeout" };
      tx = refundTx(provider, contract, utxo, outputLock, Number(side.timeout), token);
    }
    try {
      tx.debug();
    } catch (error) {
      return { ok: false, reason: requireReason(error) };
    }
    const hex = tx.build();
    return { ok: true, hex, txid: txidOf(hex) };
  } finally {
    await provider.disconnect().catch(() => false);
  }
}

function txidOf(hex: string): string {
  const raw = Buffer.from(hex, "hex");
  const hash = createHash("sha256").update(createHash("sha256").update(raw).digest()).digest();
  return Buffer.from(hash).reverse().toString("hex");
}

export async function broadcast(network: NetName, hex: string): Promise<string> {
  const provider = providerFor(network);
  try {
    return await provider.sendRawTransaction(hex);
  } finally {
    await provider.disconnect().catch(() => false);
  }
}

export function addressOfLock(lockHex: string, network: NetName, token: boolean): string {
  return cashaddr(bytesFromHex(lockHex), network, token);
}

function scriptHashOf(address: string): string {
  const decoded = cashAddressToLockingBytecode(address);
  if (typeof decoded === "string") throw new Error(decoded);
  const hash = createHash("sha256").update(decoded.bytecode).digest();
  return Buffer.from(hash.reverse()).toString("hex");
}

function preimageInRaw(hex: string, secretHash: string): string | null {
  const raw = Buffer.from(hex, "hex");
  for (let index = 0; index < raw.length - 33; index += 1) {
    if (raw[index] !== 0x20) continue;
    const push = raw.subarray(index + 1, index + 33);
    const hash = createHash("sha256").update(push).digest("hex");
    if (hash === secretHash) return push.toString("hex");
  }
  return null;
}

export async function inspectAddress(
  network: NetName,
  address: string,
  secretHash?: string,
): Promise<{ utxos: Coin[]; hasHistory: boolean; latestTxid?: string; preimage?: string }> {
  const utxos = await listUtxos(network, address);
  const provider = providerFor(network);
  try {
    const history = (await provider.performRequest("blockchain.scripthash.get_history", scriptHashOf(address))) as {
      tx_hash?: string;
    }[];
    const ids = (Array.isArray(history) ? history : [])
      .map((row) => row.tx_hash)
      .filter((txid): txid is string => typeof txid === "string" && txid !== "");
    let preimage: string | undefined;
    if (secretHash !== undefined) {
      const want = secretHash.toLowerCase();
      for (const txid of ids.slice(-8).reverse()) {
        const raw = await provider.getRawTransaction(txid);
        const found = preimageInRaw(raw, want);
        if (found !== null) {
          preimage = found;
          break;
        }
      }
    }
    return { utxos, hasHistory: ids.length > 0, latestTxid: ids.at(-1), preimage };
  } finally {
    await provider.disconnect().catch(() => false);
  }
}
