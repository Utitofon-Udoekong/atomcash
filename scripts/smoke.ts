import { p2pkhLock, sha256, newSecret } from "../src/lib/atom";
import { buildSpend, prepare } from "../src/lib/live";
import { secp256k1 } from "@noble/curves/secp256k1";

const payout = Buffer.from(p2pkhLock(secp256k1.getPublicKey(secp256k1.utils.randomPrivateKey(), true))).toString("hex");
const refund = Buffer.from(p2pkhLock(secp256k1.getPublicKey(secp256k1.utils.randomPrivateKey(), true))).toString("hex");
const secret = newSecret();
const secretHash = Buffer.from(sha256(secret)).toString("hex");
const side = {
  timeout: 1,
  secretHash,
  payoutLock: payout,
  refundLock: refund,
  tokenCategory: "",
  tokenAmount: "0",
};
const prepared = await prepare("chipnet", side);
console.log("address", prepared.address);
const spent = await buildSpend({
  network: "chipnet",
  action: "claim",
  side: { ...side, timeout: 2_000_000_000 },
  utxo: { txid: "11".repeat(32), vout: 0, satoshis: "10800" },
  secret: Buffer.from(secret).toString("hex"),
  outputLock: payout,
});
console.log(spent.ok ? `claim ${spent.txid} ${spent.hex.length}` : `fail ${spent.reason}`);
const broken = await buildSpend({
  network: "chipnet",
  action: "claim",
  side: { ...side, timeout: 2_000_000_000 },
  utxo: { txid: "11".repeat(32), vout: 0, satoshis: "10800" },
  secret: Buffer.from(secret).toString("hex").replace(/^../, (byte) => (byte === "00" ? "01" : "00")),
  outputLock: payout,
});
console.log(broken.ok ? "broken unexpectedly ok" : `broken ${broken.reason}`);
