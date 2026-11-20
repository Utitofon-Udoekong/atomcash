import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1";
import { SignatureTemplate } from "@solidcash/solidcash";
import { ElectrumNetworkProvider } from "@solidcash/solidcash/network/electrum";
import {
  FEE,
  claimTx,
  instantiate,
  newSecret,
  refundTx,
  sha256,
  type Side,
} from "../src/lib/atom";
import { lockFromPublicKey, listUtxos } from "../src/lib/live";

const FAUCET = "https://apecs.dev/v1/faucet/bch";
console.log("chipnet start");

function zeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    let mask = 0x80;
    while ((byte & mask) === 0) {
      bits += 1;
      mask >>= 1;
    }
    break;
  }
  return bits;
}

function solve(challengeHex: string, difficulty: number): number {
  const challenge = Buffer.from(challengeHex, "hex");
  const nonceBytes = Buffer.alloc(8);
  for (let nonce = 0; nonce < 20_000_000; nonce += 1) {
    nonceBytes.writeBigUInt64LE(BigInt(nonce));
    const hash = createHash("sha256").update(challenge).update(nonceBytes).digest();
    if (zeroBits(hash) >= difficulty) return nonce;
  }
  throw new Error("pow");
}

async function claimFaucet(address: string): Promise<{ txid: string; sats: string }> {
  let last = "faucet";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const challenge = (await (await fetch(`${FAUCET}/challenge`)).json()) as {
      challenge: string;
      difficulty: number;
      drip_sat: string;
    };
    const nonce = solve(challenge.challenge, challenge.difficulty);
    const response = await fetch(`${FAUCET}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge: challenge.challenge, nonce, address }),
    });
    const claimed = (await response.json()) as {
      ok?: boolean;
      txid?: string;
      amount_sat?: string;
      error?: { code?: string; message?: string } | string;
    };
    if (claimed.ok && claimed.txid !== undefined) {
      return { txid: claimed.txid, sats: claimed.amount_sat ?? challenge.drip_sat };
    }
    last = typeof claimed.error === "string" ? claimed.error : claimed.error?.message ?? response.statusText;
    console.log("faucet retry", attempt, last);
  }
  throw new Error(last);
}

function keypair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = secp256k1.utils.randomPrivateKey();
  return { privateKey, publicKey: secp256k1.getPublicKey(privateKey, true) };
}

async function waitCoins(address: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const coins = await listUtxos("chipnet", address);
    const plain = coins.filter((coin) => coin.tokenCategory === undefined);
    const sats = plain.reduce((sum, coin) => sum + BigInt(coin.satoshis), 0n);
    if (sats > 0n) return plain;
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  throw new Error("unseen");
}

const provider = new ElectrumNetworkProvider("chipnet");
const funder = keypair();
const receiver = keypair();
const funderLock = lockFromPublicKey(funder.publicKey, "chipnet", false);
const receiverLock = lockFromPublicKey(receiver.publicKey, "chipnet", false);
mkdirSync(".secrets", { recursive: true });
writeFileSync(
  ".secrets/chipnet.txt",
  `${Buffer.from(funder.privateKey).toString("hex")}\n${funderLock.address}\n${Buffer.from(receiver.privateKey).toString("hex")}\n${receiverLock.address}\n`,
);

const faucet = await claimFaucet(funderLock.address);
console.log("faucet", faucet.txid, faucet.sats, funderLock.address);
const coins = await waitCoins(funderLock.address);
const purse = coins.reduce((sum, coin) => sum + BigInt(coin.satoshis), 0n);
console.log("seen", purse.toString());

const secret = newSecret();
const claimSide: Side = {
  timeout: BigInt(Math.floor(Date.now() / 1000) + 3600),
  secretHash: sha256(secret),
  payoutLock: receiverLock.lockingBytecode,
  refundLock: funderLock.lockingBytecode,
  tokenCategory: new Uint8Array(),
  tokenAmount: 0n,
  fee: FEE,
};
const claimContract = instantiate(provider, claimSide);
const locked = 4_000n + FEE;
const signer = new SignatureTemplate(funder.privateKey);
const funding = provider;
const builder = (await import("@solidcash/solidcash")).TransactionBuilder;
const fundTx = new builder({ provider: funding });
for (const coin of coins) {
  fundTx.addInput(
    { txid: coin.txid, vout: coin.vout, satoshis: BigInt(coin.satoshis) },
    signer.unlockP2PKH(),
  );
}
fundTx.addOutput({ to: claimContract.address, amount: locked });
const change = purse - locked - 600n;
if (change >= 546n) fundTx.addOutput({ to: funderLock.address, amount: change });
const funded = await fundTx.send();
console.log("fund", funded.txid);

const contractCoins = await waitCoins(claimContract.address);
const utxo = {
  txid: contractCoins[0]?.txid ?? "",
  vout: contractCoins[0]?.vout ?? 0,
  satoshis: BigInt(contractCoins[0]?.satoshis ?? "0"),
};
const claimed = await claimTx(provider, claimContract, utxo, secret, receiverLock.lockingBytecode).send();
console.log("claim", claimed.txid);

const refundCoins = await waitCoins(receiverLock.address);
const refundPurse = refundCoins.reduce((sum, coin) => sum + BigInt(coin.satoshis), 0n);
const refundSide: Side = {
  timeout: 1n,
  secretHash: sha256(newSecret()),
  payoutLock: funderLock.lockingBytecode,
  refundLock: receiverLock.lockingBytecode,
  tokenCategory: new Uint8Array(),
  tokenAmount: 0n,
  fee: FEE,
};
const refundContract = instantiate(provider, refundSide);
const refundLocked = 2_000n + FEE;
const refundSigner = new SignatureTemplate(receiver.privateKey);
const refundFund = new builder({ provider });
for (const coin of refundCoins) {
  refundFund.addInput(
    { txid: coin.txid, vout: coin.vout, satoshis: BigInt(coin.satoshis) },
    refundSigner.unlockP2PKH(),
  );
}
refundFund.addOutput({ to: refundContract.address, amount: refundLocked });
const refundChange = refundPurse - refundLocked - 500n;
if (refundChange >= 546n) refundFund.addOutput({ to: receiverLock.address, amount: refundChange });
const refundFunded = await refundFund.send();
console.log("refund-fund", refundFunded.txid);
const refundUtxos = await waitCoins(refundContract.address);
const refunded = await refundTx(
  provider,
  refundContract,
  {
    txid: refundUtxos[0]?.txid ?? "",
    vout: refundUtxos[0]?.vout ?? 0,
    satoshis: BigInt(refundUtxos[0]?.satoshis ?? "0"),
  },
  receiverLock.lockingBytecode,
  1,
).send();
console.log("refund", refunded.txid);

const report = {
  address: funderLock.address,
  receive: receiverLock.address,
  faucetTxid: faucet.txid,
  faucetSats: faucet.sats,
  fundTxid: funded.txid,
  claimTxid: claimed.txid,
  claimHex: claimed.hex,
  refundFundTxid: refundFunded.txid,
  refundTxid: refunded.txid,
  refundHex: refunded.hex,
  contract: claimContract.address,
};
mkdirSync("evidence", { recursive: true });
writeFileSync("evidence/chipnet.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await provider.disconnect().catch(() => false);
