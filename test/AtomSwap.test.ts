import { mkdirSync, writeFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1";
import "@solidcash/solidcash/vitest";
import {
  DUST,
  FEE,
  OWNER_FEE,
  OWNER_LOCK,
  claimTx,
  consensusCategory,
  flipByte,
  fund,
  hexOf,
  instantiate,
  newSecret,
  p2pkhLock,
  refundTx,
  sha256,
  strictProvider,
  type Side,
} from "../src/lib/atom.js";

const TOKEN = "cd".repeat(32);
const TOKEN_AMOUNT = 50n;
const BCH_PAYOUT = 10_000n;

function keyLock(): Uint8Array {
  return p2pkhLock(secp256k1.getPublicKey(secp256k1.utils.randomPrivateKey(), true));
}

function side(overrides: Partial<Side> & Pick<Side, "payoutLock" | "refundLock">): Side {
  return {
    timeout: 2_000_000_000n,
    secretHash: sha256(newSecret()),
    tokenCategory: new Uint8Array(),
    tokenAmount: 0n,
    fee: FEE,
    ...overrides,
  };
}

describe("AtomSwap", () => {
  beforeAll(() => {
    mkdirSync("evidence", { recursive: true });
  });

  it("pays the committed output when the preimage matches", async () => {
    const provider = strictProvider();
    const secret = newSecret();
    const payout = keyLock();
    const refund = keyLock();
    const params = side({
      secretHash: sha256(secret),
      payoutLock: payout,
      refundLock: refund,
      tokenCategory: consensusCategory(TOKEN),
      tokenAmount: TOKEN_AMOUNT,
    });
    const contract = instantiate(provider, params);
    const utxo = await fund(provider, contract, DUST + FEE + OWNER_FEE, {
      category: TOKEN,
      amount: TOKEN_AMOUNT,
    });
    const tx = claimTx(provider, contract, utxo, secret, payout, {
      category: TOKEN,
      amount: TOKEN_AMOUNT,
    });
    expect(tx).not.toFailRequire();
    const sent = await tx.send();
    expect(sent.hex.length).toBeGreaterThan(100);
    expect(sent.txid).toMatch(/^[0-9a-f]{64}$/);
    const paid = await provider.getUtxosForLockingBytecode(payout);
    expect(paid).toHaveLength(1);
    expect(paid[0]?.token?.amount).toBe(TOKEN_AMOUNT);
    expect(paid[0]?.token?.category).toBe(TOKEN);
    expect(paid[0]?.satoshis).toBe(DUST);
    const owner = await provider.getUtxosForLockingBytecode(OWNER_LOCK);
    expect(owner[0]?.satoshis).toBe(OWNER_FEE);
    expect(owner[0]?.token).toBeUndefined();
    mkdirSync("evidence", { recursive: true });
    mkdirSync("evidence", { recursive: true });
    writeFileSync(
      "evidence/claim.json",
      JSON.stringify({ txid: sent.txid, hex: sent.hex, address: contract.address }, null, 2),
    );
  });

  it("refunds only the committed address after the timeout", async () => {
    const provider = strictProvider();
    const payout = keyLock();
    const refund = keyLock();
    const params = side({
      timeout: 1n,
      payoutLock: payout,
      refundLock: refund,
    });
    const contract = instantiate(provider, params);
    const utxo = await fund(provider, contract, BCH_PAYOUT + FEE + OWNER_FEE);
    const early = refundTx(provider, contract, utxo, refund, 0);
    expect(early).toFailRequireWith("timeout");
    const ready = refundTx(provider, contract, utxo, refund, 1);
    expect(ready).not.toFailRequire();
    const sent = await ready.send();
    const back = await provider.getUtxosForLockingBytecode(refund);
    expect(back).toHaveLength(1);
    expect(back[0]?.satoshis).toBe(BCH_PAYOUT);
    expect(back[0]?.token).toBeUndefined();
    writeFileSync(
      "evidence/refund.json",
      JSON.stringify({ txid: sent.txid, hex: sent.hex }, null, 2),
    );
  });

  it("rejects a preimage or payout lock that differs by one byte, then still refunds", async () => {
    const provider = strictProvider();
    const secret = newSecret();
    const payout = keyLock();
    const refund = keyLock();
    const params = side({
      timeout: 1n,
      secretHash: sha256(secret),
      payoutLock: payout,
      refundLock: refund,
      tokenCategory: consensusCategory(TOKEN),
      tokenAmount: TOKEN_AMOUNT,
    });
    const contract = instantiate(provider, params);
    const utxo = await fund(provider, contract, DUST + FEE + OWNER_FEE, {
      category: TOKEN,
      amount: TOKEN_AMOUNT,
    });
    const token = { category: TOKEN, amount: TOKEN_AMOUNT };
    const badSecret = claimTx(provider, contract, utxo, flipByte(secret, 0), payout, token);
    expect(badSecret).toFailRequireWith("secret");
    const badLock = claimTx(provider, contract, utxo, secret, flipByte(payout), token);
    expect(badLock).toFailRequireWith("lock");
    const stillThere = await provider.getUtxos(contract.address);
    expect(stillThere).toHaveLength(1);
    const sent = await refundTx(provider, contract, utxo, refund, 1, token).send();
    const back = await provider.getUtxosForLockingBytecode(refund);
    expect(back[0]?.token?.amount).toBe(TOKEN_AMOUNT);
    expect(sent.txid).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(
      "evidence/broken-byte.json",
      JSON.stringify(
        {
          secretByte: hexOf(secret).slice(0, 2),
          flippedSecretByte: hexOf(flipByte(secret, 0)).slice(0, 2),
          refundTxid: sent.txid,
          refundHex: sent.hex,
        },
        null,
        2,
      ),
    );
  });

  it("rejects a token category or amount that is not the one locked in", async () => {
    const provider = strictProvider();
    const secret = newSecret();
    const payout = keyLock();
    const refund = keyLock();
    const params = side({
      secretHash: sha256(secret),
      payoutLock: payout,
      refundLock: refund,
      tokenCategory: consensusCategory(TOKEN),
      tokenAmount: TOKEN_AMOUNT,
    });
    const contract = instantiate(provider, params);
    const utxo = await fund(provider, contract, DUST + FEE + OWNER_FEE, {
      category: TOKEN,
      amount: TOKEN_AMOUNT,
    });
    const other = "ab".repeat(32);
    const badCategory = claimTx(provider, contract, utxo, secret, payout, {
      category: other,
      amount: TOKEN_AMOUNT,
    });
    expect(badCategory).toFailRequireWith("category");
    const badAmount = claimTx(provider, contract, utxo, secret, payout, {
      category: TOKEN,
      amount: TOKEN_AMOUNT - 1n,
    });
    expect(badAmount).toFailRequireWith("amount");
    const stillThere = await provider.getUtxos(contract.address);
    expect(stillThere).toHaveLength(1);
  });

  it("completes both sides or neither: the revealed preimage spends the mirror", async () => {
    const provider = strictProvider();
    const secret = newSecret();
    const secretHash = sha256(secret);
    const aliceReceive = keyLock();
    const aliceRefund = keyLock();
    const bobReceive = keyLock();
    const bobRefund = keyLock();
    const alice = instantiate(
      provider,
      side({
        timeout: 2_000_000_000n,
        secretHash,
        payoutLock: bobReceive,
        refundLock: aliceRefund,
        tokenCategory: consensusCategory(TOKEN),
        tokenAmount: TOKEN_AMOUNT,
      }),
    );
    const bob = instantiate(
      provider,
      side({
        timeout: 1_900_000_000n,
        secretHash,
        payoutLock: aliceReceive,
        refundLock: bobRefund,
      }),
    );
    const aliceUtxo = await fund(provider, alice, DUST + FEE + OWNER_FEE, {
      category: TOKEN,
      amount: TOKEN_AMOUNT,
    });
    const bobUtxo = await fund(provider, bob, BCH_PAYOUT + FEE + OWNER_FEE);
    const aliceClaimsBob = await claimTx(
      provider,
      bob,
      bobUtxo,
      secret,
      aliceReceive,
    ).send();
    const bobClaimsAlice = await claimTx(provider, alice, aliceUtxo, secret, bobReceive, {
      category: TOKEN,
      amount: TOKEN_AMOUNT,
    }).send();
    const aliceGot = await provider.getUtxosForLockingBytecode(aliceReceive);
    const bobGot = await provider.getUtxosForLockingBytecode(bobReceive);
    expect(aliceGot[0]?.satoshis).toBe(BCH_PAYOUT);
    expect(aliceGot[0]?.token).toBeUndefined();
    expect(bobGot[0]?.token?.amount).toBe(TOKEN_AMOUNT);
    expect(aliceClaimsBob.hex).not.toBe(bobClaimsAlice.hex);
    writeFileSync(
      "evidence/atomic.json",
      JSON.stringify(
        {
          aliceClaimTxid: aliceClaimsBob.txid,
          bobClaimTxid: bobClaimsAlice.txid,
          aliceClaimHex: aliceClaimsBob.hex,
          bobClaimHex: bobClaimsAlice.hex,
        },
        null,
        2,
      ),
    );
  });
});
