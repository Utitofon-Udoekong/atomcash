import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  binToHex,
  decodeTransaction,
  hexToBin,
  lockingBytecodeToCashAddress,
  CashAddressNetworkPrefix,
} from "@bitauth/libauth";
import { bigIntToVmNumber } from "@bitauth/libauth/build/lib/vm/instruction-sets/common/instruction-sets-utils.js";
import { createCompilerBch } from "@bitauth/libauth/build/lib/compiler/compiler-bch/compiler-bch.js";
import { SignatureTemplate, TransactionBuilder } from "@solidcash/solidcash";
import { ElectrumNetworkProvider } from "@solidcash/solidcash/network/electrum";
import { Engine, XO_SUPPORTED_NETWORKS } from "@xo-cash/engine";
import { serializeInvitation } from "@xo-cash/utils";
import { FEE, fund, instantiate, newSecret, refundTx, sha256, strictProvider, type Side } from "../src/lib/atom";
import { listUtxos, lockFromPublicKey, type Coin } from "../src/lib/live";

const template = JSON.parse(readFileSync("xo/atom-swap.template.json", "utf8")) as {
  scripts: Record<string, string>;
};

const [funderHex, funderAddress] = readFileSync(".secrets/chipnet.txt", "utf8")
  .split(/\r?\n/)
  .filter((line) => line.length > 0);
if (funderHex === undefined || funderAddress === undefined) throw new Error("key");
const funderKey = Buffer.from(funderHex, "hex");
const funderPub = secp256k1.getPublicKey(funderKey, true);
const funderLock = lockFromPublicKey(funderPub, "chipnet", false);
const receiverLock = lockFromPublicKey(funderPub, "chipnet", false);

let side: Side = {
  timeout: 1n,
  secretHash: sha256(newSecret()),
  payoutLock: receiverLock.lockingBytecode,
  refundLock: funderLock.lockingBytecode,
  tokenCategory: new Uint8Array(),
  tokenAmount: 0n,
  fee: FEE,
};

function rememberSide(fundTxid?: string) {
  mkdirSync("evidence", { recursive: true });
  const current = existsSync("evidence/xo-open.json")
    ? (JSON.parse(readFileSync("evidence/xo-open.json", "utf8")) as { fundTxid?: string })
    : {};
  writeFileSync(
    "evidence/xo-open.json",
    JSON.stringify(
      {
        timeout: side.timeout.toString(),
        secretHash: binToHex(side.secretHash),
        payoutLock: binToHex(side.payoutLock),
        refundLock: binToHex(side.refundLock),
        fundTxid: fundTxid ?? current.fundTxid,
      },
      null,
      2,
    ),
  );
}

function loadSide() {
  if (!existsSync("evidence/xo-open.json")) {
    rememberSide();
    return;
  }
  const saved = JSON.parse(readFileSync("evidence/xo-open.json", "utf8")) as {
    timeout: string;
    secretHash: string;
    payoutLock: string;
    refundLock: string;
  };
  side = {
    timeout: BigInt(saved.timeout),
    secretHash: hexToBin(saved.secretHash),
    payoutLock: hexToBin(saved.payoutLock),
    refundLock: hexToBin(saved.refundLock),
    tokenCategory: new Uint8Array(),
    tokenAmount: 0n,
    fee: FEE,
  };
}

function pushData(): Record<string, Uint8Array> {
  return {
    fee: bigIntToVmNumber(side.fee),
    tokenAmount: bigIntToVmNumber(side.tokenAmount),
    tokenCategory: side.tokenCategory,
    refundLock: side.refundLock,
    payoutLock: side.payoutLock,
    secretHash: side.secretHash,
    timeout: bigIntToVmNumber(side.timeout),
  };
}

const walletData = Object.fromEntries(
  ["fee", "tokenAmount", "tokenCategory", "refundLock", "payoutLock", "secretHash", "timeout", "secret"].map((name) => [
    name,
    { type: "WalletData" },
  ]),
);

function compiled(scriptId: string, locking: boolean): Uint8Array {
  const compiler = createCompilerBch({
    scripts: template.scripts,
    variables: walletData,
    lockingScriptTypes: locking ? { redeem: "p2sh32" } : {},
    unlockingScripts: { refundUnlock: "redeem", claimUnlock: "redeem" },
  });
  const result = compiler.generateBytecode({
    scriptId,
    data: { bytecode: pushData() },
  });
  if (!result.success) {
    throw new Error(result.errors.map((error: { error: string }) => error.error).join("; "));
  }
  return result.bytecode;
}

function assertSame(name: string, left: Uint8Array, right: Uint8Array) {
  if (binToHex(left) !== binToHex(right)) {
    throw new Error(`${name} mismatch ${left.length} ${right.length}`);
  }
}

async function matchContract() {
  const provider = strictProvider();
  const contract = instantiate(provider, side);
  assertSame("redeem", compiled("redeem", false), hexToBin(contract.bytecode));
  assertSame("lock", compiled("redeem", true), hexToBin(contract.lockingBytecode));
  const utxo = await fund(provider, contract, 5_000n + FEE);
  const hex = refundTx(provider, contract, utxo, side.refundLock, 1).build();
  const decoded = decodeTransaction(hexToBin(hex));
  if (typeof decoded === "string") throw new Error(decoded);
  const unlocking = decoded.inputs[0]?.unlockingBytecode;
  if (unlocking === undefined) throw new Error("unlock");
  assertSame("refund unlock", compiled("refundUnlock", true), unlocking);
  const encoded = lockingBytecodeToCashAddress({
    bytecode: hexToBin(contract.lockingBytecode),
    prefix: CashAddressNetworkPrefix.testnet,
    tokenSupport: false,
  });
  if (typeof encoded === "string" || encoded.address !== contract.address) {
    throw new Error("address");
  }
  console.log("template address", contract.address);
  return contract.address;
}

function outpointHash(txid: string): Uint8Array {
  return hexToBin(txid);
}

function variables() {
  return [
    { variableIdentifier: "timeout", value: side.timeout },
    { variableIdentifier: "secretHash", value: binToHex(side.secretHash) },
    { variableIdentifier: "payoutLock", value: binToHex(side.payoutLock) },
    { variableIdentifier: "refundLock", value: binToHex(side.refundLock) },
    { variableIdentifier: "tokenCategory", value: "0x" },
    { variableIdentifier: "tokenAmount", value: side.tokenAmount },
    { variableIdentifier: "fee", value: side.fee },
  ];
}

async function waitPlain(address: string, txid: string): Promise<Coin> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const coins = await listUtxos("chipnet", address);
    const coin = coins.find((item) => item.txid === txid && item.vout === 0 && item.tokenCategory === undefined);
    if (coin !== undefined) return coin;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`unseen ${address}`);
}

async function main() {
  if (existsSync("evidence/xo-chipnet.json")) {
    const done = JSON.parse(readFileSync("evidence/xo-chipnet.json", "utf8")) as { refundTxid?: string };
    if (done.refundTxid !== undefined) {
      console.log("xo-refund", done.refundTxid);
      return;
    }
  }
  if (funderLock.address !== funderAddress) throw new Error(`address ${funderLock.address}`);
  loadSide();
  const address = await matchContract();
  mkdirSync(".xo", { recursive: true });
  const engine = await Engine.create(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    {
      network: XO_SUPPORTED_NETWORKS.chipnet,
      storageType: "indexeddb" as never,
      databasePath: ".xo",
      databaseFilename: "atomcash",
    },
  );
  try {
    const imported = await engine.importTemplate(template as never);
    await engine.setDefaultPolicies({ address: { templateIdentifier: imported.templateIdentifier } });
    const generated = await engine.generateLockingBytecodeFromDefaultPolicy("address", {
      timeout: side.timeout,
      secretHash: binToHex(side.secretHash),
      payoutLock: binToHex(side.payoutLock),
      refundLock: binToHex(side.refundLock),
      tokenCategory: "0x",
      tokenAmount: side.tokenAmount,
      fee: side.fee,
    });
    const provider = strictProvider();
    const contract = instantiate(provider, side);
    if (generated !== contract.lockingBytecode) throw new Error("engine lock");
    console.log("engine lock matches", address);

    const electrum = new ElectrumNetworkProvider("chipnet");
    const locked = 5_000n + FEE;
    const open = existsSync("evidence/xo-open.json")
      ? (JSON.parse(readFileSync("evidence/xo-open.json", "utf8")) as { fundTxid?: string })
      : {};
    let fundTxid = open.fundTxid;
    if (fundTxid === undefined) {
      const coins = (await listUtxos("chipnet", funderAddress)).filter((coin) => coin.tokenCategory === undefined);
      const signer = new SignatureTemplate(funderKey);
      const builder = new TransactionBuilder({ provider: electrum });
      let sats = 0n;
      const picked: Coin[] = [];
      for (const coin of coins) {
        picked.push(coin);
        sats += BigInt(coin.satoshis);
        if (sats >= locked + 2_000n) break;
      }
      if (sats < locked + 1_000n) throw new Error("funds");
      for (const coin of picked) {
        builder.addInput({ txid: coin.txid, vout: coin.vout, satoshis: BigInt(coin.satoshis) }, signer.unlockP2PKH());
      }
      builder.addOutput({ to: address, amount: locked });
      const change = sats - locked - 1000n;
      if (change >= 800n) builder.addOutput({ to: funderAddress, amount: change });
      const funded = await builder.send();
      fundTxid = funded.txid;
      rememberSide(fundTxid);
      console.log("xo-fund", fundTxid);
    } else {
      console.log("xo-fund", fundTxid);
    }
    const contractCoin = await waitPlain(address, fundTxid);
    const unlock = compiled("refundUnlock", true);
    const created = await engine.createInvitation({
      templateIdentifier: imported.templateIdentifier,
      actionIdentifier: "refund",
      roleIdentifier: "seller",
      transactionVersion: 2,
      transactionLocktime: 1,
      variables: variables(),
      inputs: [
        {
          inputIdentifier: "refundInput",
          transactionIndex: 0,
          outpointTransactionHash: outpointHash(contractCoin.txid),
          outpointIndex: contractCoin.vout,
          sequenceNumber: 0,
          unlockingBytecode: unlock,
          valueSatoshis: BigInt(contractCoin.satoshis),
        },
      ],
      outputs: [
        {
          outputIdentifier: "refundOutput",
          transactionIndex: 0,
          valueSatoshis: BigInt(contractCoin.satoshis) - FEE,
        },
      ],
    });
    const executed = await engine.executeAction(created.invitation.invitationIdentifier, { broadcastTransaction: true });
    console.log("xo-refund", executed.builtTransaction.transactionHash);
    writeFileSync("xo/invitation.json", serializeInvitation(executed.storedInvitation.invitation));
    writeFileSync(
      "evidence/xo-chipnet.json",
      JSON.stringify(
        {
          address,
          lockingBytecode: generated,
          fundTxid,
          refundTxid: executed.builtTransaction.transactionHash,
          invitationIdentifier: created.invitation.invitationIdentifier,
        },
        null,
        2,
      ),
    );
    await electrum.disconnect().catch(() => false);
  } finally {
    await engine.stop().catch(() => false);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

process.on("unhandledRejection", (error: unknown) => {
  if (error instanceof AggregateError) return;
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
