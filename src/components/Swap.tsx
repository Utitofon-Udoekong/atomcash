"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { DappConnectionManager } from "@wizardconnect/dapp";
import { initiateDappRelay, type DappRelayResult } from "@wizardconnect/core";

type NetName = "mainnet";
type AssetKind = "bch" | "token";
type Mode = "float" | "fixed";

interface Asset {
  kind: AssetKind;
  category: string;
  symbol: string;
  decimals: number;
  icon?: string;
  usd?: number;
}

interface MarketToken {
  category: string;
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  usd: number;
}

interface Coin {
  txid: string;
  vout: number;
  satoshis: string;
  tokenCategory?: string;
  tokenAmount?: string;
  address: string;
  pathName: string;
  pathIndex: number;
}

interface SideInput {
  timeout: number;
  secretHash: string;
  payoutLock: string;
  refundLock: string;
  tokenCategory: string;
  tokenAmount: string;
}

interface Prepared {
  address: string;
  side: SideInput;
}

interface Session {
  secret: string;
  secretHash: string;
  send: Asset;
  receive: Asset;
  sendSats: string;
  receiveSats: string;
  sendTokens: string;
  receiveTokens: string;
  alice: Prepared;
  bob: Prepared;
  payoutLock: string;
  refundLock: string;
  solverLock: string;
  aliceTimeout: number;
  bobTimeout: number;
  network: NetName;
  changeAddress: string;
}

interface UtxoSeen {
  txid: string;
  vout: number;
  satoshis: string;
  tokenCategory?: string;
  tokenAmount?: string;
}

type Phase =
  | { name: "idle" }
  | { name: "quote" }
  | { name: "deposit_shown"; session: Session }
  | { name: "payment_seen"; session: Session; deposit: UtxoSeen; mirror?: UtxoSeen }
  | { name: "output_shown"; session: Session; txid: string }
  | { name: "refund_available"; session: Session; deposit: UtxoSeen; txid?: string };

interface WireSource {
  outpointTransactionHash: string;
  outpointIndex: number;
  sequenceNumber: number;
  unlockingBytecode: string;
  lockingBytecode: string;
  valueSatoshis: string;
  token?: { amount: string; category: string };
}

const ALICE_WINDOW = 180;
const BOB_WINDOW = 120;
const MINER_FEE_SATS = 800;
const OWNER_FEE_SATS = 1_000;
const FEE_SATS = MINER_FEE_SATS + OWNER_FEE_SATS;
const BCH_RESERVE = 3_000n;
const PORTIONS = [25, 50, 75, 100] as const;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return bytesToHex(new Uint8Array(digest));
}

function satsOf(text: string): bigint {
  const [whole, frac = ""] = text.split(".");
  const padded = `${frac}00000000`.slice(0, 8);
  return BigInt(whole === "" ? "0" : whole) * 100_000_000n + BigInt(padded);
}

function bchOf(sats: bigint): string {
  const whole = sats / 100_000_000n;
  const frac = (sats % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac === "" ? whole.toString() : `${whole}.${frac}`;
}

function fromBase(amount: bigint, decimals: number): string {
  if (decimals <= 0) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const frac = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac === "" ? whole.toString() : `${whole}.${frac}`;
}

function categoryKey(coin: Coin): string | undefined {
  const raw = coin.tokenCategory?.replace(/^0x/, "").toLowerCase();
  if (raw === undefined || raw === "") return undefined;
  return raw;
}

function toBase(text: string, decimals: number): string {
  if (!/^\d*\.?\d*$/.test(text)) return "0";
  const [whole, frac = ""] = text.split(".");
  const places = Math.max(0, decimals);
  const padded = `${frac}${"0".repeat(places)}`.slice(0, places);
  const scale = 10n ** BigInt(places);
  const fraction = padded === "" ? 0n : BigInt(padded);
  return (BigInt(whole === "" ? "0" : whole) * scale + fraction).toString();
}

function usdPerUnit(asset: Asset, bchPrice: number): number {
  if (asset.kind === "bch") return bchPrice;
  return asset.usd ?? 0;
}

function quotedReceive(send: Asset, receive: Asset, sendAmount: string, bchPrice: number): string {
  const sendUsd = send.kind === "bch" ? (Number(satsOf(sendAmount)) / 1e8) * bchPrice : Number(sendAmount) * (send.usd ?? 0);
  const unit = usdPerUnit(receive, bchPrice);
  if (!Number.isFinite(sendUsd) || unit <= 0) return "0";
  const amount = sendUsd / unit;
  if (receive.kind === "bch") return bchOf(BigInt(Math.round(amount * 1e8)));
  const places = Math.min(receive.decimals, 6);
  return amount.toFixed(places).replace(/\.?0+$/, "");
}

async function post<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/bch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? "rejected");
  }
  return json;
}

function headline(phase: Phase): string {
  switch (phase.name) {
    case "idle":
    case "quote":
      return "";
    case "deposit_shown":
      return phase.session.alice.address;
    case "payment_seen":
      return phase.session.bob.address;
    case "output_shown":
      return phase.txid;
    case "refund_available":
      return phase.txid ?? phase.session.alice.address;
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

function slipLabel(phase: Phase): string {
  switch (phase.name) {
    case "idle":
    case "quote":
      return "";
    case "deposit_shown":
      return "Deposit address";
    case "payment_seen":
      return "Counterparty contract";
    case "output_shown":
      return "Claim";
    case "refund_available":
      return phase.txid === undefined ? "Deposit address" : "Refund";
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

function statusLine(phase: Phase): string {
  switch (phase.name) {
    case "idle":
    case "quote":
      return "";
    case "deposit_shown":
      return "Waiting for the deposit";
    case "payment_seen":
      return phase.mirror === undefined ? "Deposit seen" : "Both contracts are funded";
    case "output_shown":
      return "Payout broadcast";
    case "refund_available":
      return phase.txid === undefined ? "Refund available" : "Refund broadcast";
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

let pairing: { manager: DappConnectionManager; relay: DappRelayResult } | null = null;

function openPairing(): { manager: DappConnectionManager; relay: DappRelayResult } {
  if (pairing !== null) return pairing;
  const manager = new DappConnectionManager("AtomCash", undefined, { session: false });
  const relay = initiateDappRelay((payload) => {
    manager.updateConnection(payload.client, payload.status);
  });
  manager.attachRelay(relay);
  pairing = { manager, relay };
  return pairing;
}

function qrTarget(phase: Phase, showConnect: boolean, uri: string | null): string | null {
  if (showConnect) return uri;
  switch (phase.name) {
    case "idle":
    case "quote":
    case "output_shown":
      return null;
    case "deposit_shown":
      return phase.session.alice.address;
    case "payment_seen":
      return phase.session.bob.address;
    case "refund_available":
      return phase.txid === undefined ? phase.session.alice.address : null;
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

function pairRate(send: Asset, receive: Asset, sendText: string, receiveText: string): string | null {
  const sendN = Number(sendText);
  const receiveN = Number(receiveText);
  if (!(sendN > 0) || !(receiveN > 0)) return null;
  if (send.kind === "bch") return `1 BCH = ${(receiveN / sendN).toFixed(4)} ${receive.symbol}`;
  if (receive.kind === "bch") return `1 BCH = ${(sendN / receiveN).toFixed(4)} ${send.symbol}`;
  return `1 ${send.symbol} = ${(receiveN / sendN).toFixed(4)} ${receive.symbol}`;
}

export function Swap() {
  const network: NetName = "mainnet";
  const [sendText, setSendText] = useState("0");
  const [receiveText, setReceiveText] = useState("0");
  const [sendAsset, setSendAsset] = useState<Asset>({ kind: "bch", category: "", symbol: "BCH", decimals: 8 });
  const [receiveAsset, setReceiveAsset] = useState<Asset>({
    kind: "token",
    category: "",
    symbol: "CashToken",
    decimals: 0,
  });
  const [tokens, setTokens] = useState<MarketToken[]>([]);
  const [bchUsd, setBchUsd] = useState(0);
  const [oracleTxid, setOracleTxid] = useState("");
  const [mode, setMode] = useState<Mode>("float");
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [copied, setCopied] = useState(false);
  const [manager, setManager] = useState<DappConnectionManager | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [portion, setPortion] = useState<number | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [wallet, setWallet] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [secretEdit, setSecretEdit] = useState<string | null>(null);
  const bobFunded = useRef(false);
  const claimed = useRef<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void fetch("/api/market")
      .then((response) => response.json())
      .then((body: { bchUsd?: number; oracleTxid?: string; tokens?: MarketToken[] }) => {
        if (cancel || body.tokens === undefined || body.bchUsd === undefined) return;
        setTokens(body.tokens);
        setBchUsd(body.bchUsd);
        setOracleTxid(body.oracleTxid ?? "");
        const first = body.tokens[0];
        if (first !== undefined) {
          setReceiveAsset({
            kind: "token",
            category: first.category,
            symbol: first.symbol,
            decimals: first.decimals,
            icon: first.icon,
            usd: first.usd,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (mode !== "float" || bchUsd <= 0) return;
    setReceiveText(quotedReceive(sendAsset, receiveAsset, sendText, bchUsd));
  }, [mode, bchUsd, sendAsset, receiveAsset, sendText]);

  async function accountOf(current: DappConnectionManager): Promise<void> {
    const pub = current.getPubkey(0, 0n);
    if (pub === undefined) return;
    const lock = await post<{ address: string }>({
      op: "lock",
      network,
      pubkeyHex: bytesToHex(pub),
      token: true,
    });
    setAccount(lock.address);
  }

  useEffect(() => {
    const session = openPairing();
    const onReady = () => {
      setWallet(true);
      setShowConnect(false);
      void accountOf(session.manager).catch(() => undefined);
    };
    const onDisconnect = () => {
      setWallet(false);
      setAccount(null);
      setCoins([]);
      setPortion(null);
    };
    session.manager.on("walletready", onReady);
    session.manager.on("disconnect", onDisconnect);
    setManager(session.manager);
    setUri(session.relay.uri);
    setQrUri(session.relay.qrUri);
    if (session.manager.isWalletDiscovered()) {
      setWallet(true);
      void accountOf(session.manager).catch(() => undefined);
    }
    return () => {
      session.manager.off("walletready", onReady);
      session.manager.off("disconnect", onDisconnect);
    };
  }, []);

  useEffect(() => {
    if (!wallet || manager === null) return;
    void accountOf(manager).catch(() => undefined);
  }, [wallet, manager]);

  const scan = qrTarget(phase, showConnect, qrUri);

  useEffect(() => {
    if (scan === null) {
      setQr(null);
      return;
    }
    let cancel = false;
    void QRCode.toDataURL(scan, { margin: 1, width: 320, color: { dark: "#141614", light: "#ffffff" } }).then((url) => {
      if (!cancel) setQr(url);
    });
    return () => {
      cancel = true;
    };
  }, [scan]);

  useEffect(() => {
    if (phase.name !== "deposit_shown" && phase.name !== "payment_seen") return;
    const session = phase.session;
    const timer = setInterval(() => {
      void (async () => {
        const listed = await post<{ utxos: Coin[] }>({
          op: "utxos",
          network: session.network,
          address: session.alice.address,
        });
        const deposit = listed.utxos[0];
        if (deposit === undefined) return;
        const mirrorListed = await post<{ utxos: Coin[] }>({
          op: "utxos",
          network: session.network,
          address: session.bob.address,
        });
        const mirror = mirrorListed.utxos[0];
        if (Date.now() / 1000 >= session.aliceTimeout) {
          setPhase({ name: "refund_available", session, deposit });
          return;
        }
        if (phase.name === "deposit_shown") {
          setPhase({ name: "payment_seen", session, deposit, mirror });
          return;
        }
        if (mirror !== undefined && phase.mirror === undefined) {
          setPhase({ name: "payment_seen", session, deposit, mirror });
        }
      })();
    }, 4000);
    return () => clearInterval(timer);
  }, [phase]);

  const quoted = useMemo(() => {
    if (!/^\d*\.?\d*$/.test(sendText)) return false;
    if (sendAsset.kind === "bch") return satsOf(sendText) > 0n;
    return BigInt(toBase(sendText, sendAsset.decimals)) > 0n;
  }, [sendAsset.decimals, sendAsset.kind, sendText]);

  useEffect(() => {
    setPhase((current) => {
      if (current.name === "idle" && quoted) return { name: "quote" };
      if (current.name === "quote" && !quoted) return { name: "idle" };
      return current;
    });
  }, [quoted]);

  function writeSend(value: string, nextPortion: number | null) {
    setPortion(nextPortion);
    setSendText(value);
    if (mode === "float") setReceiveText(quotedReceive(sendAsset, receiveAsset, value, bchUsd));
  }

  function onSend(value: string) {
    writeSend(value, null);
  }

  function chooseSend(asset: Asset) {
    setPortion(null);
    setSendAsset(asset);
  }

  function flipAssets() {
    setPortion(null);
    setSendAsset(receiveAsset);
    setReceiveAsset(sendAsset);
    setSendText(receiveText);
    setReceiveText(sendText);
  }

  useEffect(() => {
    const watching = phase.name === "idle" || phase.name === "quote";
    if (!wallet || manager === null || !watching) return;
    let cancel = false;
    async function load() {
      if (manager === null) return;
      const receive = manager.getPubkey(0, 0n);
      const change = manager.getPubkey(1, 0n);
      if (receive === undefined || change === undefined) return;
      const specs = [
        { pub: receive, token: false, pathName: "receive", pathIndex: 0 },
        { pub: receive, token: true, pathName: "receive", pathIndex: 0 },
        { pub: change, token: false, pathName: "change", pathIndex: 0 },
        { pub: change, token: true, pathName: "change", pathIndex: 0 },
      ];
      const locks = await Promise.all(
        specs.map((row) =>
          post<{ address: string }>({
            op: "lock",
            network,
            pubkeyHex: bytesToHex(row.pub),
            token: row.token,
          }),
        ),
      );
      const seenAddress = new Set<string>();
      const targets: { address: string; pathName: string; pathIndex: number }[] = [];
      specs.forEach((row, index) => {
        const address = locks[index]?.address;
        if (address === undefined || seenAddress.has(address)) return;
        seenAddress.add(address);
        targets.push({ address, pathName: row.pathName, pathIndex: row.pathIndex });
      });
      const listed = await coinsOf(targets);
      const seenCoin = new Set<string>();
      const unique = listed.filter((coin) => {
        const key = `${coin.txid}:${coin.vout}`;
        if (seenCoin.has(key)) return false;
        seenCoin.add(key);
        return true;
      });
      if (!cancel) setCoins(unique);
    }
    void load().catch(() => undefined);
    const timer = setInterval(() => {
      void load().catch(() => undefined);
    }, 12000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [wallet, manager, network, phase.name]);

  async function locks() {
    if (manager === null || !wallet) throw new Error("wallet");
    const pubs = [0, 1, 2].map((index) => {
      const pub = manager.getPubkey(0, BigInt(index));
      if (pub === undefined) throw new Error("wallet");
      return bytesToHex(pub);
    });
    const changePub = manager.getPubkey(1, 0n);
    if (changePub === undefined) throw new Error("wallet");
    const encoded = await Promise.all(
      pubs.map((pubkeyHex, index) =>
        post<{ address: string; lockingBytecode: string }>({
          op: "lock",
          network,
          pubkeyHex,
          token: index !== 0,
        }),
      ),
    );
    const change = await post<{ address: string }>({
      op: "lock",
      network,
      pubkeyHex: bytesToHex(changePub),
      token: false,
    });
    return { encoded, changeAddress: change.address };
  }

  async function coinsOf(addresses: { address: string; pathName: string; pathIndex: number }[]): Promise<Coin[]> {
    const lists = await Promise.all(
      addresses.map(async (row) => {
        const listed = await post<{ utxos: Coin[] }>({ op: "utxos", network, address: row.address });
        return listed.utxos.map((coin) => ({ ...coin, pathName: row.pathName, pathIndex: row.pathIndex }));
      }),
    );
    return lists.flat();
  }

  async function fundSide(session: Session, which: "alice" | "bob", coins: Coin[]) {
    const prepared = session[which];
    const sellingToken = prepared.side.tokenCategory !== "";
    const payoutSats = sellingToken ? "0" : prepared.side.tokenAmount === "0" ? (which === "alice" ? session.sendSats : session.receiveSats) : "0";
    const built = await post<{
      transactionHex: string;
      sourceOutputs: WireSource[];
      inputPaths: [number, string, number][];
    }>({
      op: "fund",
      network,
      payoutLock: prepared.side.payoutLock,
      refundLock: prepared.side.refundLock,
      timeout: prepared.side.timeout,
      secretHash: prepared.side.secretHash,
      tokenCategory: prepared.side.tokenCategory,
      tokenAmount: prepared.side.tokenAmount,
      payoutSats: which === "alice" ? session.sendSats : session.receiveSats,
      coins,
      changeAddress: session.changeAddress,
    });
    if (manager === null) throw new Error("wallet");
    const signed = await manager.signTransaction({
      transaction: {
        transaction: built.transactionHex,
        sourceOutputs: built.sourceOutputs.map((row) => ({
          outpointTransactionHash: hexToBytes(row.outpointTransactionHash),
          outpointIndex: row.outpointIndex,
          sequenceNumber: row.sequenceNumber,
          unlockingBytecode: hexToBytes(row.unlockingBytecode),
          lockingBytecode: hexToBytes(row.lockingBytecode),
          valueSatoshis: BigInt(row.valueSatoshis),
          token:
            row.token === undefined
              ? undefined
              : { amount: BigInt(row.token.amount), category: hexToBytes(row.token.category) },
        })),
        userPrompt: "AtomCash",
        broadcast: false,
      },
      inputPaths: built.inputPaths,
    });
    if (signed.error) throw new Error(signed.error);
    await post({ op: "broadcast", network, hex: signed.signedTransaction });
  }

  async function exchange() {
    setFail(null);
    bobFunded.current = false;
    claimed.current = null;
    if (!wallet) {
      setShowConnect(true);
      return;
    }
    const secretBytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = bytesToHex(secretBytes);
    const secretHash = await sha256Hex(secretBytes);
    const { encoded, changeAddress } = await locks();
    const refundLock = encoded[0]?.lockingBytecode;
    const payoutLock = encoded[1]?.lockingBytecode;
    const solverLock = encoded[2]?.lockingBytecode;
    if (refundLock === undefined || payoutLock === undefined || solverLock === undefined) return;
    const now = Math.floor(Date.now() / 1000);
    const sendTokens = sendAsset.kind === "token" ? toBase(sendText, sendAsset.decimals) : "0";
    const receiveTokens = receiveAsset.kind === "token" ? toBase(receiveText, receiveAsset.decimals) : "0";
    const sendSats = sendAsset.kind === "bch" ? satsOf(sendText).toString() : "0";
    const receiveSats = receiveAsset.kind === "bch" ? satsOf(receiveText).toString() : "0";
    const aliceSide: SideInput = {
      timeout: now + ALICE_WINDOW,
      secretHash,
      payoutLock: solverLock,
      refundLock,
      tokenCategory: sendAsset.kind === "token" ? sendAsset.category : "",
      tokenAmount: sendTokens,
    };
    const bobSide: SideInput = {
      timeout: now + BOB_WINDOW,
      secretHash,
      payoutLock,
      refundLock: solverLock,
      tokenCategory: receiveAsset.kind === "token" ? receiveAsset.category : "",
      tokenAmount: receiveTokens,
    };
    const alicePrep = await post<{ address: string }>({ op: "prepare", network, side: aliceSide });
    const bobPrep = await post<{ address: string }>({ op: "prepare", network, side: bobSide });
    const session: Session = {
      secret,
      secretHash,
      send: sendAsset,
      receive: receiveAsset,
      sendSats,
      receiveSats,
      sendTokens,
      receiveTokens,
      alice: { address: alicePrep.address, side: aliceSide },
      bob: { address: bobPrep.address, side: bobSide },
      payoutLock,
      refundLock,
      solverLock,
      aliceTimeout: aliceSide.timeout,
      bobTimeout: bobSide.timeout,
      network,
      changeAddress,
    };
    setSecretEdit(secret);
    setPhase({ name: "deposit_shown", session });
    const walletCoins = await coinsOf([
      { address: encoded[0]?.address ?? "", pathName: "receive", pathIndex: 0 },
      { address: changeAddress, pathName: "change", pathIndex: 0 },
    ]);
    await fundSide(session, "alice", walletCoins);
  }

  async function finish(session: Session, deposit: UtxoSeen, mirror: UtxoSeen | undefined) {
    if (mirror === undefined) {
      const { encoded } = await locks();
      const walletCoins = await coinsOf([
        { address: encoded[0]?.address ?? "", pathName: "receive", pathIndex: 0 },
        { address: session.changeAddress, pathName: "change", pathIndex: 0 },
      ]);
      try {
        await fundSide(session, "bob", walletCoins);
      } catch (error) {
        setFail(error instanceof Error ? error.message : "funds");
        return;
      }
      return;
    }
    const secret = secretEdit ?? session.secret;
    const claimed = await post<{ ok: boolean; hex?: string; txid?: string; reason?: string }>({
      op: "spend",
      network: session.network,
      action: "claim",
      side: session.bob.side,
      utxo: mirror,
      secret,
      outputLock: session.payoutLock,
    });
    if (!claimed.ok || claimed.hex === undefined) {
      setFail(claimed.reason ?? "rejected");
      return;
    }
    const broadcasted = await post<{ txid: string }>({ op: "broadcast", network: session.network, hex: claimed.hex });
    setFail(null);
    setPhase({ name: "output_shown", session, txid: broadcasted.txid });
    void post({
      op: "spend",
      network: session.network,
      action: "claim",
      side: session.alice.side,
      utxo: deposit,
      secret,
      outputLock: session.solverLock,
    }).then(async (other) => {
      const row = other as { ok: boolean; hex?: string };
      if (row.ok && row.hex !== undefined) {
        await post({ op: "broadcast", network: session.network, hex: row.hex });
      }
    });
  }

  async function refund(session: Session, deposit: UtxoSeen) {
    const spent = await post<{ ok: boolean; hex?: string; reason?: string }>({
      op: "spend",
      network: session.network,
      action: "refund",
      side: session.alice.side,
      utxo: deposit,
      outputLock: session.refundLock,
    });
    if (!spent.ok || spent.hex === undefined) {
      setFail(spent.reason ?? "timeout");
      return;
    }
    const broadcasted = await post<{ txid: string }>({ op: "broadcast", network: session.network, hex: spent.hex });
    setPhase({ name: "refund_available", session, deposit, txid: broadcasted.txid });
  }

  useEffect(() => {
    if (phase.name !== "payment_seen" || phase.mirror !== undefined || bobFunded.current) return;
    bobFunded.current = true;
    void finish(phase.session, phase.deposit, undefined).catch((error: unknown) => {
      setFail(error instanceof Error ? error.message : "rejected");
    });
  }, [phase]);

  useEffect(() => {
    if (phase.name !== "payment_seen" || phase.mirror === undefined) return;
    if ((secretEdit ?? phase.session.secret) !== phase.session.secret) return;
    if (claimed.current === phase.mirror.txid) return;
    claimed.current = phase.mirror.txid;
    void finish(phase.session, phase.deposit, phase.mirror).catch((error: unknown) => {
      setFail(error instanceof Error ? error.message : "rejected");
    });
  }, [phase, secretEdit]);

  const form = phase.name === "idle" || phase.name === "quote";
  const proof = headline(phase);
  const oracleText =
    bchUsd > 0 && receiveAsset.kind === "token" && receiveAsset.usd !== undefined
      ? `1 BCH = ${(bchUsd / receiveAsset.usd).toFixed(4)} ${receiveAsset.symbol}`
      : bchUsd > 0 && sendAsset.kind === "token" && sendAsset.usd !== undefined
        ? `1 BCH = ${(bchUsd / sendAsset.usd).toFixed(4)} ${sendAsset.symbol}`
        : bchUsd > 0
          ? `1 BCH = $${bchUsd.toFixed(2)}`
          : "";
  const rateText = mode === "fixed" ? (pairRate(sendAsset, receiveAsset, sendText, receiveText) ?? "") : oracleText;
  const bchHeld = coins.reduce((sum, coin) => (categoryKey(coin) === undefined ? sum + BigInt(coin.satoshis) : sum), 0n);
  const tokenHeld = new Map<string, { total: bigint; largest: bigint }>();
  for (const coin of coins) {
    const key = categoryKey(coin);
    if (key === undefined) continue;
    const amount = BigInt(coin.tokenAmount ?? "0");
    const row = tokenHeld.get(key) ?? { total: 0n, largest: 0n };
    row.total += amount;
    if (amount > row.largest) row.largest = amount;
    tokenHeld.set(key, row);
  }
  const spendableSend =
    sendAsset.kind === "bch"
      ? bchHeld > BCH_RESERVE
        ? bchHeld - BCH_RESERVE
        : 0n
      : (tokenHeld.get(sendAsset.category.replace(/^0x/, "").toLowerCase())?.largest ?? 0n);
  const availableText =
    sendAsset.kind === "bch"
      ? `${bchOf(spendableSend)} BCH`
      : `${fromBase(spendableSend, sendAsset.decimals)} ${sendAsset.symbol}`;

  function assetForCategory(category: string): Asset {
    const known = tokens.find((token) => token.category.toLowerCase() === category);
    if (known !== undefined) {
      return {
        kind: "token",
        category: known.category,
        symbol: known.symbol,
        decimals: known.decimals,
        icon: known.icon,
        usd: known.usd,
      };
    }
    if (sendAsset.kind === "token" && sendAsset.category.replace(/^0x/, "").toLowerCase() === category) return sendAsset;
    if (receiveAsset.kind === "token" && receiveAsset.category.replace(/^0x/, "").toLowerCase() === category) return receiveAsset;
    return { kind: "token", category, symbol: `${category.slice(0, 4)}…${category.slice(-4)}`, decimals: 0 };
  }

  function applyPortion(percent: number) {
    if (!wallet) {
      setShowConnect(true);
      return;
    }
    if (spendableSend === 0n) return;
    const amount = (spendableSend * BigInt(percent)) / 100n;
    const text = sendAsset.kind === "bch" ? bchOf(amount) : fromBase(amount, sendAsset.decimals);
    writeSend(text, percent);
  }

  async function copyProof() {
    if (proof === "") return;
    await navigator.clipboard.writeText(proof);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <main className="desk">
      <div className="banner">
        <a href="https://docs.google.com/presentation/d/1l9lZHeEuW5-V57Ha4488Wa_kLiUlvMMkAVRS8xoqun4/edit?usp=sharing">Presentation</a>
        <a href="https://github.com/Utitofon-Udoekong/atomcash">Repository</a>
        <span>
          EMBER2026 <span className="banner-addr">bitcoincash:zq5hh46r4kudjpsayg58gu99h03p00nw4csaumqgy0</span>
        </span>
      </div>
      <header className="nav">
        <span className="mark">
          <img src="/logo.png" alt="" width={22} height={22} />
          AtomCash
        </span>
        <div className="nav-actions">
          <button className="connect" type="button" onClick={() => setShowConnect(true)}>
            {wallet ? "Connected" : "Connect"}
          </button>
        </div>
      </header>
      {account !== null ? <p className="account">{account}</p> : null}
      <section className="stage">
        <div className="brief">
          <h1>Start a private swap</h1>
          <div className="facts">
            <div>
              <span>Fee</span>
              {FEE_SATS.toLocaleString("en-US")} sats
            </div>
            <div>
              <span>Refund</span>3 min
            </div>
            <div>
              <span>Claim</span>Preimage
            </div>
            <div>
              <span>Hold</span>Neither side
            </div>
          </div>
        </div>
        <div className="ticket">
          {form ? (
            <>
              <div className="modes" role="group" aria-label="Rate">
                <button className={mode === "float" ? "on" : ""} type="button" aria-pressed={mode === "float"} onClick={() => setMode("float")}>
                  Floating rate
                </button>
                <button className={mode === "fixed" ? "on" : ""} type="button" aria-pressed={mode === "fixed"} onClick={() => setMode("fixed")}>
                  Fixed rate
                </button>
              </div>
              {wallet ? (
                <div className="holdings" aria-label="Wallet balances">
                  <button type="button" onClick={() => chooseSend({ kind: "bch", category: "", symbol: "BCH", decimals: 8, usd: bchUsd })}>
                    {bchOf(bchHeld)} BCH
                  </button>
                  {[...tokenHeld].map(([category, row]) => {
                    const asset = assetForCategory(category);
                    return (
                      <button key={category} type="button" onClick={() => chooseSend(asset)}>
                        {fromBase(row.total, asset.decimals)} {asset.symbol}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="field">
                <span className="field-label">You send</span>
                <div className="field-row">
                  <input aria-label="You send" value={sendText} onChange={(event) => onSend(event.target.value)} inputMode="decimal" />
                  <AssetSelect
                    asset={sendAsset}
                    tokens={tokens}
                    bchUsd={bchUsd}
                    onChange={(asset) => {
                      setPortion(null);
                      setSendAsset(asset);
                    }}
                  />
                </div>
                <div className="available">
                  <span>Available</span>
                  <span>{wallet ? availableText : "Connect a wallet"}</span>
                </div>
                <div className="stops" role="group" aria-label="Portion of available balance">
                  {PORTIONS.map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      aria-pressed={portion === percent}
                      disabled={wallet && spendableSend === 0n}
                      onClick={() => applyPortion(percent)}
                    >
                      {percent}%
                    </button>
                  ))}
                </div>
              </div>
              <button className="switch" type="button" onClick={flipAssets}>
                Switch
              </button>
              <div className="field">
                <span className="field-label">You receive</span>
                <div className="field-row">
                  <input aria-label="You receive" value={receiveText} onChange={(event) => setReceiveText(event.target.value)} inputMode="decimal" />
                  <AssetSelect asset={receiveAsset} tokens={tokens} bchUsd={bchUsd} onChange={setReceiveAsset} />
                </div>
              </div>
              <TokenId
                label="Send token id"
                asset={sendAsset}
                onChange={(category) => {
                  setPortion(null);
                  setSendAsset({ ...sendAsset, kind: "token", category });
                }}
              />
              <TokenId
                label="Receive token id"
                asset={receiveAsset}
                onChange={(category) => setReceiveAsset({ ...receiveAsset, kind: "token", category })}
              />
              {rateText !== "" ? (
                <div className="rate">
                  <span>Rate</span>
                  <span title={oracleTxid}>{rateText}</span>
                </div>
              ) : null}
              <button className="go" type="button" onClick={() => void exchange().catch((error: unknown) => setFail(error instanceof Error ? error.message : "rejected"))}>
                Create transaction
              </button>
            </>
          ) : (
            <>
              <p className="status">{statusLine(phase)}</p>
              <div className="slip">
                <div className="slip-head">
                  <span>{slipLabel(phase)}</span>
                  <button type="button" onClick={() => void copyProof()}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p>{proof}</p>
              </div>
              {qr !== null && !showConnect ? <img className="qr" alt="" src={qr} /> : null}
              {phase.name === "payment_seen" || phase.name === "deposit_shown" ? (
                <label className="secret">
                  <span>Preimage</span>
                  <input
                    aria-label="Preimage"
                    value={secretEdit ?? ""}
                    spellCheck={false}
                    onChange={(event) => setSecretEdit(event.target.value.trim())}
                  />
                </label>
              ) : null}
              {phase.name === "payment_seen" ? (
                <button
                  className="go"
                  type="button"
                  onClick={() => void finish(phase.session, phase.deposit, phase.mirror).catch((error: unknown) => setFail(error instanceof Error ? error.message : "rejected"))}
                >
                  {phase.mirror === undefined ? "Fund the other side" : "Claim payout"}
                </button>
              ) : null}
              {phase.name === "refund_available" && phase.txid === undefined ? (
                <button className="go" type="button" onClick={() => void refund(phase.session, phase.deposit)}>
                  Refund deposit
                </button>
              ) : null}
            </>
          )}
          {fail !== null ? <p className="fail">{fail}</p> : null}
        </div>
      </section>
      <footer className="foot">
        <span>AtomCash</span>
        <span>mainnet</span>
      </footer>
      {showConnect && uri !== null ? (
        <div className="overlay" onClick={() => setShowConnect(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title" onClick={(event) => event.stopPropagation()}>
            <div className="slip-head">
              <h2 id="connect-title">Connect a wallet</h2>
              <button type="button" onClick={() => setShowConnect(false)}>
                Close
              </button>
            </div>
            {qr !== null ? <img className="qr" alt="" src={qr} /> : null}
            <p className="uri">{uri}</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function TokenId({ asset, label, onChange }: { asset: Asset; label: string; onChange: (category: string) => void }) {
  if (asset.kind !== "token") return null;
  return (
    <label className="token-id">
      <span>{label}</span>
      <textarea aria-label={label} rows={2} value={asset.category} spellCheck={false} onChange={(event) => onChange(event.target.value.trim())} />
    </label>
  );
}

function AssetSelect({
  asset,
  tokens,
  bchUsd,
  onChange,
}: {
  asset: Asset;
  tokens: MarketToken[];
  bchUsd: number;
  onChange: (asset: Asset) => void;
}) {
  const [open, setOpen] = useState(false);
  const bch: Asset = { kind: "bch", category: "", symbol: "BCH", decimals: 8, usd: bchUsd };
  return (
    <div className="asset">
      <button type="button" className="pick" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Mark asset={asset} />
        {asset.symbol}
      </button>
      {open ? (
        <div className="menu">
          <button
            type="button"
            onClick={() => {
              onChange(bch);
              setOpen(false);
            }}
          >
            <Mark asset={bch} />
            <span className="sym">BCH</span>
            <span className="sub">Bitcoin Cash</span>
          </button>
          {tokens.map((token) => (
            <button
              key={token.category}
              type="button"
              onClick={() => {
                onChange({
                  kind: "token",
                  category: token.category,
                  symbol: token.symbol,
                  decimals: token.decimals,
                  icon: token.icon,
                  usd: token.usd,
                });
                setOpen(false);
              }}
            >
              <Mark asset={{ kind: "token", symbol: token.symbol, icon: token.icon }} />
              <span className="sym">{token.symbol}</span>
              <span className="sub">{token.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Mark({ asset }: { asset: { kind: AssetKind; symbol: string; icon?: string } }) {
  if (asset.icon) return <img src={asset.icon} alt="" />;
  const letter = asset.kind === "bch" ? "B" : asset.symbol.slice(0, 1).toUpperCase();
  return <span className={asset.kind === "bch" ? "mark-b" : "mark-b token"}>{letter}</span>;
}
