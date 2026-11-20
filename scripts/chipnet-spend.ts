import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1";
import { SignatureTemplate, TransactionBuilder } from "@solidcash/solidcash";
import { ElectrumNetworkProvider } from "@solidcash/solidcash/network/electrum";
import { FEE, claimTx, instantiate, newSecret, refundTx, sha256, type Side } from "../src/lib/atom";
import { listUtxos, lockFromPublicKey } from "../src/lib/live";

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
if (funderLock.address !== funderAddress) throw new Error(`address ${funderLock.address}`);

async function waitCoins(address: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const coins = (await listUtxos("chipnet", address)).filter((coin) => coin.tokenCategory === undefined);
    const sats = coins.reduce((sum, coin) => sum + BigInt(coin.satoshis), 0n);
    console.log("poll", address.slice(0, 20), sats.toString());
    if (sats > 0n) return coins;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`unseen ${address}`);
}

const provider = new ElectrumNetworkProvider("chipnet");
console.log("waiting", funderAddress);
const coins = await waitCoins(funderAddress);
const purse = coins.reduce((sum, coin) => sum + BigInt(coin.satoshis), 0n);
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
const locked = 20_000n + FEE;
const signer = new SignatureTemplate(funderKey);
const fundTx = new TransactionBuilder({ provider });
for (const coin of coins) {
  fundTx.addInput({ txid: coin.txid, vout: coin.vout, satoshis: BigInt(coin.satoshis) }, signer.unlockP2PKH());
}
fundTx.addOutput({ to: claimContract.address, amount: locked });
const change = purse - locked - 800n;
if (change >= 546n) fundTx.addOutput({ to: funderLock.address, amount: change });
const funded = await fundTx.send();
console.log("fund", funded.txid);

const contractCoins = await waitCoins(claimContract.address);
const claimed = await claimTx(provider, claimContract, {
  txid: contractCoins[0]?.txid ?? "",
  vout: contractCoins[0]?.vout ?? 0,
  satoshis: BigInt(contractCoins[0]?.satoshis ?? "0"),
}, secret, receiverLock.lockingBytecode).send();
console.log("claim", claimed.txid);

const refundCoins = await waitCoins(receiverAddress);
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
const refundLocked = 8_000n + FEE;
const refundFund = new TransactionBuilder({ provider });
const refundSigner = new SignatureTemplate(receiverKey);
for (const coin of refundCoins) {
  refundFund.addInput({ txid: coin.txid, vout: coin.vout, satoshis: BigInt(coin.satoshis) }, refundSigner.unlockP2PKH());
}
refundFund.addOutput({ to: refundContract.address, amount: refundLocked });
const refundChange = refundPurse - refundLocked - 700n;
if (refundChange >= 546n) refundFund.addOutput({ to: receiverLock.address, amount: refundChange });
const refundFunded = await refundFund.send();
console.log("refund-fund", refundFunded.txid);
const refundUtxos = await waitCoins(refundContract.address);
const refunded = await refundTx(provider, refundContract, {
  txid: refundUtxos[0]?.txid ?? "",
  vout: refundUtxos[0]?.vout ?? 0,
  satoshis: BigInt(refundUtxos[0]?.satoshis ?? "0"),
}, receiverLock.lockingBytecode, 1).send();
console.log("refund", refunded.txid);

const report = {
  address: funderAddress,
  receive: receiverAddress,
  faucetTxid: "6e3efc41c1cfb6f694f3109ce8c376f63ee9755be6aaa232d16e516c54c05680",
  faucetSats: "1017000",
  fundTxid: funded.txid,
  claimTxid: claimed.txid,
  claimHex: claimed.hex,
  refundFundTxid: refundFunded.txid,
  refundTxid: refunded.txid,
  refundHex: refunded.hex,
  contract: claimContract.address,
  refundContract: refundContract.address,
};
mkdirSync("evidence", { recursive: true });
writeFileSync("evidence/chipnet.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await provider.disconnect().catch(() => false);
