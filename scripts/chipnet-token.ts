import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1";
import { SignatureTemplate, TransactionBuilder, type Utxo } from "@solidcash/solidcash";
import { ElectrumNetworkProvider } from "@solidcash/solidcash/network/electrum";
import {
  DUST,
  FEE,
  claimTx,
  consensusCategory,
  instantiate,
  newSecret,
  sha256,
  type Side,
} from "../src/lib/atom";
import { listUtxos, lockFromPublicKey, type Coin } from "../src/lib/live";

const [funderHex, funderAddress, receiverHex, receiverAddress] = readFileSync(".secrets/chipnet.txt", "utf8")
  .split(/\r?\n/)
  .filter((line) => line.length > 0);
if (funderHex === undefined || receiverHex === undefined || funderAddress === undefined || receiverAddress === undefined) {
  throw new Error("key");
}

const funderKey = Buffer.from(funderHex, "hex");
const receiverKey = Buffer.from(receiverHex, "hex");
const funderPub = secp256k1.getPublicKey(funderKey, true);
const receiverPub = secp256k1.getPublicKey(receiverKey, true);
const funderLock = lockFromPublicKey(funderPub, "chipnet", false);
const receiverLock = lockFromPublicKey(receiverPub, "chipnet", false);
const funderToken = lockFromPublicKey(funderPub, "chipnet", true);
const receiverToken = lockFromPublicKey(receiverPub, "chipnet", true);
if (funderLock.address !== funderAddress) throw new Error(`address ${funderLock.address}`);

const provider = new ElectrumNetworkProvider("chipnet");
const funderSigner = new SignatureTemplate(funderKey);
const receiverSigner = new SignatureTemplate(receiverKey);
const TX_FEE = 1200n;
const SUPPLY = 1000n;
const SWAP = 100n;

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

function plain(coins: Coin[]): Coin[] {
  return coins.filter((coin) => coin.tokenCategory === undefined);
}

async function coinsOf(address: string): Promise<Coin[]> {
  return listUtxos("chipnet", address);
}

async function waitCoins(address: string, ready: (coins: Coin[]) => boolean): Promise<Coin[]> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const coins = await coinsOf(address);
    if (ready(coins)) return coins;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`unseen ${address}`);
}

async function spend(
  inputs: Coin[],
  outputs: { to: string | Uint8Array; amount: bigint; token?: { category: string; amount: bigint } }[],
  signer: SignatureTemplate,
  changeTo: string,
) {
  const builder = new TransactionBuilder({ provider });
  let inSats = 0n;
  for (const coin of inputs) {
    builder.addInput(asUtxo(coin), signer.unlockP2PKH());
    inSats += BigInt(coin.satoshis);
  }
  let outSats = 0n;
  for (const output of outputs) {
    builder.addOutput(output);
    outSats += output.amount;
  }
  const change = inSats - outSats - TX_FEE;
  if (change < 0n) throw new Error(`short ${change.toString()}`);
  if (change >= 800n) builder.addOutput({ to: changeTo, amount: change });
  return builder.send();
}

function pickPlain(coins: Coin[], need: bigint): Coin[] {
  const sorted = plain(coins).sort((a, b) => (BigInt(a.satoshis) < BigInt(b.satoshis) ? -1 : 1));
  const picked: Coin[] = [];
  let sats = 0n;
  for (const coin of sorted) {
    picked.push(coin);
    sats += BigInt(coin.satoshis);
    if (sats >= need) return picked;
  }
  throw new Error(`funds ${sats.toString()} < ${need.toString()}`);
}

async function mint(holderAddress: string, tokenAddress: string, signer: SignatureTemplate): Promise<string> {
  const purse = await coinsOf(holderAddress);
  const parentAmount = 20_000n;
  const parent = await spend(
    pickPlain(purse, parentAmount + TX_FEE),
    [{ to: holderAddress, amount: parentAmount }],
    signer,
    holderAddress,
  );
  console.log("parent", parent.txid);
  const parentCoin = (
    await waitCoins(holderAddress, (coins) => coins.some((coin) => coin.txid === parent.txid && coin.vout === 0))
  ).find((coin) => coin.txid === parent.txid && coin.vout === 0);
  if (parentCoin === undefined) throw new Error("parent vout");
  const minted = await spend(
    [parentCoin],
    [{ to: tokenAddress, amount: DUST, token: { category: parent.txid, amount: SUPPLY } }],
    signer,
    holderAddress,
  );
  console.log("mint", minted.txid, parent.txid);
  const held = await waitCoins(
    holderAddress,
    (coins) => coins.some((coin) => coin.tokenCategory === parent.txid && BigInt(coin.tokenAmount ?? "0") >= SUPPLY),
  );
  const token = held.find((coin) => coin.tokenCategory === parent.txid);
  if (token === undefined) throw new Error("mint unseen");
  return parent.txid;
}

function sideOf(payout: Uint8Array, refund: Uint8Array, category: string, secretHash: Uint8Array, timeout: bigint): Side {
  return {
    timeout,
    secretHash,
    payoutLock: payout,
    refundLock: refund,
    tokenCategory: consensusCategory(category),
    tokenAmount: SWAP,
    fee: FEE,
  };
}

function requireRejects(tx: TransactionBuilder, word: string) {
  let text = "";
  try {
    text = JSON.stringify(tx.debug(), (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
  } catch (error) {
    text = error instanceof Error ? error.message : String(error);
  }
  if (!text.includes(word)) {
    throw new Error(`expected ${word}: ${text.slice(0, 400)}`);
  }
}

async function main() {
  const secret = newSecret();
  const secretHash = sha256(secret);
  const now = BigInt(Math.floor(Date.now() / 1000));
  console.log("funder", funderAddress);
  console.log("receiver", receiverAddress);

  const receiverPlain = plain(await coinsOf(receiverAddress));
  const receiverSats = receiverPlain.reduce((sum, coin) => sum + BigInt(coin.satoshis), 0n);
  if (receiverSats < 30_000n) {
    const topped = await spend(
      pickPlain(await coinsOf(funderAddress), 40_000n + TX_FEE),
      [{ to: receiverAddress, amount: 40_000n }],
      funderSigner,
      funderAddress,
    );
    console.log("topup", topped.txid);
    await waitCoins(receiverAddress, (coins) => plain(coins).some((coin) => coin.txid === topped.txid));
  }

  const categoryA = await mint(funderAddress, funderToken.address, funderSigner);
  const categoryB = await mint(receiverAddress, receiverToken.address, receiverSigner);
  console.log("categories", categoryA, categoryB);

  const alice = instantiate(provider, sideOf(receiverLock.lockingBytecode, funderLock.lockingBytecode, categoryA, secretHash, now + 7200n));
  const bob = instantiate(provider, sideOf(funderLock.lockingBytecode, receiverLock.lockingBytecode, categoryB, secretHash, now + 3600n));

  const funderCoins = await coinsOf(funderAddress);
  const aliceHolder = funderCoins.find((coin) => coin.tokenCategory === categoryA && BigInt(coin.tokenAmount ?? "0") >= SWAP);
  if (aliceHolder === undefined) throw new Error("alice token");
  const aliceFund = await spend(
    [aliceHolder, ...pickPlain(funderCoins, DUST + FEE + TX_FEE)],
    [
      {
        to: alice.tokenAddress,
        amount: DUST + FEE,
        token: { category: categoryA, amount: SWAP },
      },
      {
        to: funderToken.address,
        amount: DUST,
        token: { category: categoryA, amount: BigInt(aliceHolder.tokenAmount ?? "0") - SWAP },
      },
    ],
    funderSigner,
    funderAddress,
  );
  console.log("alice-fund", aliceFund.txid);

  const receiverCoins = await coinsOf(receiverAddress);
  const bobHolder = receiverCoins.find((coin) => coin.tokenCategory === categoryB && BigInt(coin.tokenAmount ?? "0") >= SWAP);
  if (bobHolder === undefined) throw new Error("bob token");
  const bobFund = await spend(
    [bobHolder, ...pickPlain(receiverCoins, DUST + FEE + TX_FEE)],
    [
      {
        to: bob.tokenAddress,
        amount: DUST + FEE,
        token: { category: categoryB, amount: SWAP },
      },
      {
        to: receiverToken.address,
        amount: DUST,
        token: { category: categoryB, amount: BigInt(bobHolder.tokenAmount ?? "0") - SWAP },
      },
    ],
    receiverSigner,
    receiverAddress,
  );
  console.log("bob-fund", bobFund.txid);

  const aliceUtxo = (
    await waitCoins(alice.tokenAddress, (coins) => coins.some((coin) => coin.txid === aliceFund.txid && coin.tokenCategory === categoryA))
  ).find((coin) => coin.txid === aliceFund.txid && coin.tokenCategory === categoryA);
  const bobUtxo = (
    await waitCoins(bob.tokenAddress, (coins) => coins.some((coin) => coin.txid === bobFund.txid && coin.tokenCategory === categoryB))
  ).find((coin) => coin.txid === bobFund.txid && coin.tokenCategory === categoryB);
  if (aliceUtxo === undefined || bobUtxo === undefined) throw new Error("contract coin");

  const wrongCategory = `${categoryA.slice(0, 2) === "00" ? "01" : "00"}${categoryA.slice(2)}`;
  requireRejects(
    claimTx(provider, alice, asUtxo(aliceUtxo), secret, receiverLock.lockingBytecode, { category: wrongCategory, amount: SWAP }),
    "category",
  );
  requireRejects(
    claimTx(provider, alice, asUtxo(aliceUtxo), secret, receiverLock.lockingBytecode, { category: categoryA, amount: SWAP + 1n }),
    "amount",
  );
  console.log("rejected category and amount");

  const bobClaim = await claimTx(provider, bob, asUtxo(bobUtxo), secret, funderLock.lockingBytecode, {
    category: categoryB,
    amount: SWAP,
  }).send();
  console.log("bob-claim", bobClaim.txid);
  const aliceClaim = await claimTx(provider, alice, asUtxo(aliceUtxo), secret, receiverLock.lockingBytecode, {
    category: categoryA,
    amount: SWAP,
  }).send();
  console.log("alice-claim", aliceClaim.txid);

  const report = {
    categoryA,
    categoryB,
    supply: SUPPLY.toString(),
    amount: SWAP.toString(),
    aliceContract: alice.tokenAddress,
    bobContract: bob.tokenAddress,
    aliceFundTxid: aliceFund.txid,
    bobFundTxid: bobFund.txid,
    bobClaimTxid: bobClaim.txid,
    aliceClaimTxid: aliceClaim.txid,
    rejected: ["category", "amount"],
  };
  mkdirSync("evidence", { recursive: true });
  writeFileSync("evidence/chipnet-token.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await provider.disconnect().catch(() => false);
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await provider.disconnect().catch(() => false);
  process.exit(1);
});
