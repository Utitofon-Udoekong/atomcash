import { createHash, randomBytes } from "node:crypto";
import {
  Contract,
  TransactionBuilder,
  randomUtxo,
  type Artifact,
  type NetworkProvider,
  type TransactionDetails,
  type Utxo,
} from "@solidcash/solidcash";
import { MockNetworkProvider } from "@solidcash/solidcash/network/mock";
import artifactJson from "../../artifacts/solidcash/AtomSwap.json";

export const FEE = 800n;
/** Token outputs on the 2026 dust schedule need at least 651 sats. */
export const DUST = 800n;
export const artifact = artifactJson as unknown as Artifact;

export interface Side {
  timeout: bigint;
  secretHash: Uint8Array;
  payoutLock: Uint8Array;
  refundLock: Uint8Array;
  tokenCategory: Uint8Array;
  tokenAmount: bigint;
  fee: bigint;
}

export function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

export function newSecret(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

export function p2pkhLock(publicKey: Uint8Array): Uint8Array {
  const sha = createHash("sha256").update(publicKey).digest();
  const hash = createHash("ripemd160").update(sha).digest();
  const out = new Uint8Array(25);
  out[0] = 0x76;
  out[1] = 0xa9;
  out[2] = 0x14;
  out.set(hash, 3);
  out[23] = 0x88;
  out[24] = 0xac;
  return out;
}

/** Display-order category hex (no 0x) → consensus order, which is what the VM compares. */
export function consensusCategory(displayHex: string): Uint8Array {
  const hex = displayHex.replace(/^0x/, "");
  if (hex.length !== 64) {
    throw new Error("category must be 32 bytes");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number.parseInt(hex.slice((31 - i) * 2, (32 - i) * 2), 16);
  }
  return out;
}

export function hexOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function flipByte(bytes: Uint8Array, index = bytes.length - 1): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
}

export function strictProvider(): MockNetworkProvider {
  return new MockNetworkProvider({
    consensusLimits: {
      maximumInputBytes: 10_000,
      maximumStackItemBytes: 10_000,
      maximumTransactionBytes: 100_000,
      maximumNftCommitmentBytes: 128,
      operationCostBudgetPerByte: 800,
      hashDigestIterationsPerByte: 10_000_000,
    },
    policy: { enforceDust: true },
  });
}

export function instantiate(provider: NetworkProvider, side: Side): Contract {
  return new Contract(
    artifact,
    [
      side.timeout,
      side.secretHash,
      side.payoutLock,
      side.refundLock,
      side.tokenCategory,
      side.tokenAmount,
      side.fee,
    ],
    { provider },
  );
}

export async function fund(
  provider: MockNetworkProvider,
  contract: Contract,
  satoshis: bigint,
  token?: { category: string; amount: bigint },
): Promise<Utxo> {
  return provider.addUtxo(
    contract.address,
    randomUtxo({
      satoshis,
      token: token === undefined ? undefined : { amount: token.amount, category: token.category },
    }),
  );
}

export function claimTx(
  provider: NetworkProvider,
  contract: Contract,
  utxo: Utxo,
  secret: Uint8Array,
  payoutLock: Uint8Array,
  token?: { category: string; amount: bigint },
): TransactionBuilder {
  return new TransactionBuilder({ provider })
    .addInput(utxo, contract.unlock.claim(secret))
    .addOutput({
      to: payoutLock,
      amount: utxo.satoshis - FEE,
      token: token === undefined ? undefined : { amount: token.amount, category: token.category },
    });
}

export function refundTx(
  provider: NetworkProvider,
  contract: Contract,
  utxo: Utxo,
  refundLock: Uint8Array,
  locktime: number,
  token?: { category: string; amount: bigint },
): TransactionBuilder {
  return new TransactionBuilder({ provider })
    .addInput(utxo, contract.unlock.refund())
    .addOutput({
      to: refundLock,
      amount: utxo.satoshis - FEE,
      token: token === undefined ? undefined : { amount: token.amount, category: token.category },
    })
    .setLocktime(locktime);
}

export async function broadcast(tx: TransactionBuilder): Promise<TransactionDetails> {
  return tx.send();
}
