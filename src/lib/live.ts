import { createHash } from "node:crypto";
import {
  binToHex,
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
  claimTx,
  consensusCategory,
  instantiate,
  refundTx,
  type Side,
} from "./atom";

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
    const lockedSats = (sellingToken ? DUST : BigInt(args.payoutSats)) + FEE;
    const selected: Coin[] = [];
    let sats = 0n;
    let token = 0n;
    if (sellingToken) {
      const holder = args.coins.find(
        (coin) =>
          coin.tokenCategory?.toLowerCase() === args.tokenCategory.toLowerCase() &&
          BigInt(coin.tokenAmount ?? "0") >= side.tokenAmount,
      );
      if (holder === undefined) {
        throw new Error("funds");
      }
      selected.push(holder);
      sats += BigInt(holder.satoshis);
      token += BigInt(holder.tokenAmount ?? "0");
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
      throw new Error("funds");
    }
    const tokenOut = sellingToken ? { category: args.tokenCategory, amount: side.tokenAmount } : undefined;
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
        token: { category: args.tokenCategory, amount: token - side.tokenAmount },
      });
    }
    builder.addBchChangeOutputIfNeeded({ to: args.changeAddress, feeRate: 2 });
    const hex = builder.build();
    const wire = builder.generateWcTransactionObject({ broadcast: false, userPrompt: "AtomCash" });
    const sourceOutputs: WireSource[] = wire.sourceOutputs.map((row) => ({
      outpointTransactionHash: binToHex(row.outpointTransactionHash),
      outpointIndex: row.outpointIndex,
      sequenceNumber: row.sequenceNumber,
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
