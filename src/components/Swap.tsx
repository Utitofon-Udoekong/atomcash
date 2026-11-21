"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { DappConnectionManager } from "@wizardconnect/dapp";
import { initiateDappRelay, type DappRelayResult } from "@wizardconnect/core";
import { sourceOutputToRelay, type SourceOutput } from "@wizardconnect/core/hdwalletv1-serialize";
import { matchingOffer, type Offer, type OfferAsset, type OfferView } from "@/lib/offer";
import { displayCategory } from "@/lib/token";
import { OpenTrades } from "@/components/OpenTrades";
import { TradeHistory } from "@/components/TradeHistory";

type NetName = "mainnet";
type AssetKind = "bch" | "token";
type Mode = "float" | "fixed";
type TakeResult = "done" | "failed" | "gone";

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
  role: "maker" | "taker";
  sendText: string;
  receiveText: string;
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
  | { name: "offering"; offerId: string; session: Session }
  | { name: "taking"; offerId: string; session: Session }
  | { name: "deposit_shown"; session: Session }
  | { name: "payment_seen"; session: Session; deposit: UtxoSeen; mirror?: UtxoSeen }
  | { name: "output_shown"; session: Session; txid: string }
  | { name: "refund_available"; session: Session; deposit: UtxoSeen; txid?: string; which?: "alice" | "bob" };

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
const MAKER_KEY = "atomcash-maker";

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

function quotedSend(send: Asset, receive: Asset, receiveAmount: string, bchPrice: number): string {
  return quotedReceive(receive, send, receiveAmount, bchPrice);
}

function said(code: string): string {
  switch (code) {
    case "wallet":
      return "The wallet is not connected. Click Connect and approve it in the wallet.";
    case "funds":
    case "bch-funds":
      return "This wallet does not hold enough BCH. The lock needs the amount plus 1,800 sats.";
    case "token-funds":
      return "This wallet does not hold enough of that CashToken on its receive or change addresses.";
    case "rejected":
      return "The wallet or the network rejected the transaction.";
    case "timeout":
      return "The refund is not open yet. Wait for the timeout.";
    case "taken":
      return "Someone already took that offer.";
    case "missing":
      return "That offer is no longer in the pool.";
    case "secret":
      return "The preimage does not match this contract.";
    case "token":
      return "Choose the CashToken.";
    case "amount":
      return "Enter an amount greater than zero.";
    default:
      return code;
  }
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
    case "offering":
      return phase.offerId;
    case "taking":
      return phase.session.bob.address;
    case "deposit_shown":
      return phase.session.alice.address;
    case "payment_seen":
      return phase.session.bob.address;
    case "output_shown":
      return phase.txid;
    case "refund_available":
      return phase.txid ?? (phase.which === "bob" ? phase.session.bob.address : phase.session.alice.address);
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
    case "offering":
      return "Offer id";
    case "taking":
      return "Your contract";
    case "deposit_shown":
      return "Your contract";
    case "payment_seen":
      return "Their contract";
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
    case "offering":
      return `In the pool for 30 minutes. ${phase.session.sendText} ${phase.session.send.symbol} → ${phase.session.receiveText} ${phase.session.receive.symbol}. Keep this page open.`;
    case "taking":
      return "Waiting for them";
    case "deposit_shown":
      return "Waiting for your lock";
    case "payment_seen":
      return phase.mirror === undefined ? "Waiting for them" : "Both sides are locked";
    case "output_shown":
      return "Payout broadcast. Check both wallets.";
    case "refund_available":
      return phase.txid === undefined
        ? "Refund available. Check the wallet before refunding."
        : "Refund broadcast. Check the wallet.";
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

let pairing: { manager: DappConnectionManager; relay: DappRelayResult } | null = null;

function closePairing(): void {
  const current = pairing;
  if (current === null) return;
  pairing = null;
  current.manager.clearStoredSession();
  void current.manager.sendDisconnect("Disconnect").catch(() => undefined);
  current.relay.cleanup();
  void current.manager.destroy();
}

function openPairing(): { manager: DappConnectionManager; relay: DappRelayResult } {
  if (pairing !== null) return pairing;
  const manager = new DappConnectionManager("AtomCash");
  const stored = manager.loadStoredSession();
  const existing =
    stored?.privateKey !== undefined && stored.secret !== undefined && stored.walletPublicKey !== undefined
      ? { privateKey: stored.privateKey, secret: stored.secret, walletPublicKey: stored.walletPublicKey }
      : undefined;
  const relay = initiateDappRelay(
    (payload) => {
      manager.updateConnection(payload.client, payload.status);
    },
    existing === undefined ? undefined : { existingCredentials: existing },
  );
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
    case "offering":
      return null;
    case "taking":
      return phase.session.bob.address === "" ? null : phase.session.bob.address;
    case "deposit_shown":
      return phase.session.alice.address;
    case "payment_seen":
      return phase.session.bob.address;
    case "refund_available":
      return phase.txid === undefined ? (phase.which === "bob" ? phase.session.bob.address : phase.session.alice.address) : null;
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

function baseOf(asset: Asset, text: string): bigint {
  const trimmed = text.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return 0n;
  return asset.kind === "bch" ? satsOf(trimmed) : BigInt(toBase(trimmed, asset.decimals));
}

function asOffer(asset: Asset, text: string): OfferAsset {
  const trimmed = text.trim();
  const base = baseOf(asset, trimmed).toString();
  return {
    kind: asset.kind,
    category: asset.kind === "token" ? asset.category.replace(/^0x/, "").toLowerCase() : "",
    symbol: asset.symbol,
    decimals: asset.decimals,
    text: trimmed,
    base,
  };
}

function withContracts(session: Session, offer: Offer): Session {
  if (offer.alice === undefined || offer.bob === undefined) return session;
  return {
    ...session,
    alice: offer.alice,
    bob: offer.bob,
    aliceTimeout: offer.alice.side.timeout,
    bobTimeout: offer.bob.side.timeout,
    payoutLock: offer.bob.side.payoutLock,
    refundLock: offer.alice.side.refundLock,
    solverLock: offer.alice.side.payoutLock,
    secretHash: offer.secretHash,
  };
}

async function offerSend<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/offers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(json.error ?? "rejected");
  return json;
}

async function offerRead(id: string): Promise<Offer | null> {
  const response = await fetch(`/api/offers?id=${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  const json = (await response.json()) as Offer & { error?: string };
  if (!response.ok) throw new Error(json.error ?? "rejected");
  return json;
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
  const [offers, setOffers] = useState<OfferView[]>([]);
  const [history, setHistory] = useState<{ at: number; pair: string; claim: string; payout?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [seeking, setSeeking] = useState(false);
  const [pairGeneration, setPairGeneration] = useState(0);
  const bobFunded = useRef(false);
  const claimed = useRef<string | null>(null);
  const pendingOffer = useRef<OfferView | null>(null);
  const joining = useRef(false);
  const takerClaimed = useRef(false);
  const resumed = useRef(false);
  const quoteFrom = useRef<"send" | "receive">("send");
  const takeRef = useRef<(offer: OfferView) => Promise<TakeResult>>(async () => "failed");

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
    if (quoteFrom.current === "receive") {
      setSendText(quotedSend(sendAsset, receiveAsset, receiveText, bchUsd));
      return;
    }
    setReceiveText(quotedReceive(sendAsset, receiveAsset, sendText, bchUsd));
  }, [mode, bchUsd, sendAsset, receiveAsset, receiveText, sendText]);

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
      session.manager.clearStoredSession();
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
    if (session.manager.isWalletDiscovered() || session.manager.getPubkey(0, 0n) !== undefined) {
      setWallet(true);
      void accountOf(session.manager).catch(() => undefined);
    }
    return () => {
      session.manager.off("walletready", onReady);
      session.manager.off("disconnect", onDisconnect);
    };
  }, [pairGeneration]);

  function disconnectWallet() {
    closePairing();
    setWallet(false);
    setAccount(null);
    setCoins([]);
    setPortion(null);
    setShowConnect(false);
    setManager(null);
    setUri(null);
    setQrUri(null);
    setPairGeneration((value) => value + 1);
  }

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
    quoteFrom.current = "send";
    setPortion(nextPortion);
    setSendText(value);
    if (mode === "float") setReceiveText(quotedReceive(sendAsset, receiveAsset, value, bchUsd));
  }

  function onSend(value: string) {
    writeSend(value, null);
  }

  function onReceive(value: string) {
    quoteFrom.current = "receive";
    setPortion(null);
    setReceiveText(value);
    if (mode === "float") setSendText(quotedSend(sendAsset, receiveAsset, value, bchUsd));
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

  async function scanWallet(current: DappConnectionManager): Promise<Coin[]> {
    const chains = [
      { child: 0, pathName: "receive", count: 20 },
      { child: 1, pathName: "change", count: 10 },
    ] as const;
    const rows: { pubkeyHex: string; pathName: string; pathIndex: number }[] = [];
    for (const chain of chains) {
      for (let index = 0; index < chain.count; index += 1) {
        const pub = current.getPubkey(chain.child, BigInt(index));
        if (pub === undefined) break;
        rows.push({ pubkeyHex: bytesToHex(pub), pathName: chain.pathName, pathIndex: index });
      }
    }
    if (rows.length === 0) return [];
    const listed = await post<{ utxos: Coin[] }>({ op: "coins", network, rows });
    const known = tokens.map((token) => token.category);
    const seen = new Set<string>();
    const unique: Coin[] = [];
    for (const coin of listed.utxos) {
      const key = `${coin.txid}:${coin.vout}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const category = displayCategory(coin.tokenCategory, known);
      unique.push(category === undefined ? coin : { ...coin, tokenCategory: category });
    }
    return unique;
  }

  useEffect(() => {
    const watching = phase.name === "idle" || phase.name === "quote";
    if (!wallet || manager === null || !watching) return;
    let cancel = false;
    async function load() {
      if (manager === null) return;
      const unique = await scanWallet(manager);
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
  }, [wallet, manager, network, phase.name, tokens]);

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
        sourceOutputs: built.sourceOutputs.map((row) => {
          const native: SourceOutput = {
            outpointTransactionHash: hexToBytes(row.outpointTransactionHash),
            outpointIndex: Number(row.outpointIndex),
            sequenceNumber: Number(row.sequenceNumber),
            unlockingBytecode: hexToBytes(row.unlockingBytecode),
            lockingBytecode: hexToBytes(row.lockingBytecode),
            valueSatoshis: BigInt(row.valueSatoshis),
            token:
              row.token === undefined
                ? undefined
                : { amount: BigInt(row.token.amount), category: hexToBytes(row.token.category) },
          };
          return sourceOutputToRelay(native);
        }),
        userPrompt: "AtomCash",
        broadcast: false,
      },
      inputPaths: built.inputPaths,
    });
    if (signed.error) throw new Error(signed.error);
    await post({ op: "broadcast", network, hex: signed.signedTransaction });
  }

  async function fundingCoins(): Promise<{ coins: Coin[]; changeAddress: string; refundLock: string; payoutLock: string }> {
    const { encoded, changeAddress } = await locks();
    const refundLock = encoded[0]?.lockingBytecode;
    const payoutLock = encoded[1]?.lockingBytecode;
    if (refundLock === undefined || payoutLock === undefined || manager === null) throw new Error("wallet");
    const unique = await scanWallet(manager);
    return { coins: unique, changeAddress, refundLock, payoutLock };
  }

  function blankSide(secretHash: string, payoutLock: string, refundLock: string): SideInput {
    return { timeout: 0, secretHash, payoutLock, refundLock, tokenCategory: "", tokenAmount: "0" };
  }

  async function listedOffers(): Promise<OfferView[]> {
    const response = await fetch("/api/offers");
    const body = (await response.json()) as { offers?: OfferView[] };
    return body.offers ?? [];
  }

  async function lookForMatch(send: OfferAsset, want: OfferAsset): Promise<OfferView | undefined> {
    const ready = matchingOffer(await listedOffers(), send, want);
    if (ready !== undefined) return ready;
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return matchingOffer(await listedOffers(), send, want);
  }

  async function publish() {
    setFail(null);
    bobFunded.current = false;
    claimed.current = null;
    joining.current = false;
    if (!wallet || !quoted || seeking) return;
    const send = asOffer(sendAsset, sendText);
    const want = asOffer(receiveAsset, receiveText);
    if (BigInt(send.base) <= 0n || BigInt(want.base) <= 0n) return;
    if ((send.kind === "token" && send.category === "") || (want.kind === "token" && want.category === "")) {
      setFail("Choose the token.");
      return;
    }
    setSeeking(true);
    try {
      const match = await lookForMatch(send, want);
      if (match !== undefined && (await take(match)) !== "gone") return;
      const secretBytes = crypto.getRandomValues(new Uint8Array(32));
      const secret = bytesToHex(secretBytes);
      const secretHash = await sha256Hex(secretBytes);
      const { changeAddress, refundLock, payoutLock } = await fundingCoins();
      const id = bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
      await offerSend({ op: "open", id, send, want, secretHash, makerRefundLock: refundLock, makerPayoutLock: payoutLock });
      const session: Session = {
        secret,
        secretHash,
        send: sendAsset,
        receive: receiveAsset,
        sendSats: send.kind === "bch" ? send.base : "0",
        receiveSats: want.kind === "bch" ? want.base : "0",
        sendTokens: send.kind === "token" ? send.base : "0",
        receiveTokens: want.kind === "token" ? want.base : "0",
        sendText: send.text,
        receiveText: want.text,
        alice: { address: "", side: blankSide(secretHash, payoutLock, refundLock) },
        bob: { address: "", side: blankSide(secretHash, payoutLock, refundLock) },
        payoutLock,
        refundLock,
        solverLock: payoutLock,
        aliceTimeout: 0,
        bobTimeout: 0,
        network,
        changeAddress,
        role: "maker",
      };
      setSecretEdit(secret);
      sessionStorage.setItem(MAKER_KEY, JSON.stringify({ offerId: id, session }));
      setPhase({ name: "offering", offerId: id, session });
    } finally {
      setSeeking(false);
    }
  }

  async function take(offer: OfferView): Promise<TakeResult> {
    if (!wallet) {
      pendingOffer.current = offer;
      setShowConnect(true);
      return "failed";
    }
    if (phase.name === "offering" && phase.offerId === offer.id) return "failed";
    setFail(null);
    setWorking("Checking the wallet for that CashToken.");
    setBusy(true);
    takerClaimed.current = false;
    let reserved: Offer | null = null;
    try {
      const { coins: walletCoins, changeAddress, refundLock, payoutLock } = await fundingCoins();
      reserved = await offerSend<Offer>({ op: "take", id: offer.id, takerRefundLock: refundLock, takerPayoutLock: payoutLock });
      if (reserved.alice === undefined || reserved.bob === undefined) throw new Error("rejected");
      const session: Session = withContracts(
        {
          secret: "",
          secretHash: reserved.secretHash,
          send: {
            kind: reserved.send.kind,
            category: reserved.send.category,
            symbol: reserved.send.symbol,
            decimals: reserved.send.decimals,
          },
          receive: {
            kind: reserved.want.kind,
            category: reserved.want.category,
            symbol: reserved.want.symbol,
            decimals: reserved.want.decimals,
          },
          sendSats: reserved.send.kind === "bch" ? reserved.send.base : "0",
          receiveSats: reserved.want.kind === "bch" ? reserved.want.base : "0",
          sendTokens: reserved.send.kind === "token" ? reserved.send.base : "0",
          receiveTokens: reserved.want.kind === "token" ? reserved.want.base : "0",
          sendText: reserved.send.text,
          receiveText: reserved.want.text,
          alice: reserved.alice,
          bob: reserved.bob,
          payoutLock: reserved.bob.side.payoutLock,
          refundLock: reserved.bob.side.refundLock,
          solverLock: reserved.alice.side.payoutLock,
          aliceTimeout: reserved.alice.side.timeout,
          bobTimeout: reserved.bob.side.timeout,
          network,
          changeAddress,
          role: "taker",
        },
        reserved,
      );
      await fundSide(session, "bob", walletCoins);
      setSecretEdit(null);
      setPhase({ name: "taking", offerId: offer.id, session });
      return "done";
    } catch (error) {
      if (reserved !== null) {
        await offerSend({ op: "release", id: offer.id }).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : "rejected";
      if (message === "taken" || message === "missing") return "gone";
      setFail(said(message));
      return "failed";
    } finally {
      setBusy(false);
      setWorking(null);
    }
  }

  takeRef.current = take;

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
        setFail(said(error instanceof Error ? error.message : "bch-funds"));
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
      setFail(said(claimed.reason ?? "rejected"));
      return;
    }
    const broadcasted = await post<{ txid: string }>({ op: "broadcast", network: session.network, hex: claimed.hex });
    setFail(null);
    sessionStorage.removeItem(MAKER_KEY);
    setPhase({ name: "output_shown", session, txid: broadcasted.txid });
    const pair = `${session.sendText} ${session.send.symbol} → ${session.receiveText} ${session.receive.symbol}`;
    void (async () => {
      let payout: string | undefined;
      try {
        const other = await post<{ ok: boolean; hex?: string }>({
          op: "spend",
          network: session.network,
          action: "claim",
          side: session.alice.side,
          utxo: deposit,
          secret,
          outputLock: session.solverLock,
        });
        if (other.ok && other.hex !== undefined) {
          const sent = await post<{ txid: string }>({ op: "broadcast", network: session.network, hex: other.hex });
          payout = sent.txid;
        }
      } catch {
        payout = undefined;
      }
      await fetch("/api/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pair, claim: broadcasted.txid, payout }),
      });
    })();
  }

  async function refund(session: Session, deposit: UtxoSeen, which: "alice" | "bob" = "alice") {
    const prepared = session[which];
    const spent = await post<{ ok: boolean; hex?: string; reason?: string }>({
      op: "spend",
      network: session.network,
      action: "refund",
      side: prepared.side,
      utxo: deposit,
      outputLock: prepared.side.refundLock,
    });
    if (!spent.ok || spent.hex === undefined) {
      setFail(said(spent.reason ?? "timeout"));
      return;
    }
    const broadcasted = await post<{ txid: string }>({ op: "broadcast", network: session.network, hex: spent.hex });
    sessionStorage.removeItem(MAKER_KEY);
    setPhase({ name: "refund_available", session, deposit, txid: broadcasted.txid, which });
  }

  useEffect(() => {
    if (phase.name !== "payment_seen" || phase.mirror !== undefined || bobFunded.current) return;
    if (phase.session.role !== "taker") return;
    bobFunded.current = true;
    void finish(phase.session, phase.deposit, undefined).catch((error: unknown) => {
      setFail(said(error instanceof Error ? error.message : "rejected"));
    });
  }, [phase]);

  useEffect(() => {
    let cancel = false;
    async function load() {
      const response = await fetch("/api/offers");
      const body = (await response.json()) as { offers?: OfferView[] };
      if (!cancel) setOffers(body.offers ?? []);
    }
    void load().catch(() => undefined);
    const timer = setInterval(() => {
      void load().catch(() => undefined);
    }, 5000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!wallet || pendingOffer.current === null) return;
    const row = pendingOffer.current;
    pendingOffer.current = null;
    void takeRef.current(row).catch((error: unknown) => {
      setFail(said(error instanceof Error ? error.message : "rejected"));
    });
  }, [wallet]);

  useEffect(() => {
    let cancel = false;
    async function load() {
      const response = await fetch("/api/history");
      const body = (await response.json()) as { trades?: { at: number; pair: string; claim: string; payout?: string }[] };
      if (!cancel) setHistory(body.trades ?? []);
    }
    void load().catch(() => undefined);
    const timer = setInterval(() => {
      void load().catch(() => undefined);
    }, 12000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!wallet || phase.name !== "idle" || resumed.current) return;
    const raw = sessionStorage.getItem(MAKER_KEY);
    if (raw === null) return;
    resumed.current = true;
    try {
      const saved = JSON.parse(raw) as { offerId?: string; session?: Session };
      if (saved.offerId === undefined || saved.session?.role !== "maker") return;
      setSecretEdit(saved.session.secret);
      setPhase({ name: "offering", offerId: saved.offerId, session: saved.session });
    } catch {
      sessionStorage.removeItem(MAKER_KEY);
    }
  }, [wallet, phase.name]);

  useEffect(() => {
    if (phase.name !== "offering") return;
    const session = phase.session;
    const offerId = phase.offerId;
    let cancel = false;
    async function watch() {
      if (cancel || joining.current) return;
      const row = await offerRead(offerId);
      if (cancel || row === null) {
        if (!cancel && row === null) {
          sessionStorage.removeItem(MAKER_KEY);
          setFail("The offer left the pool after 30 minutes. Nothing was locked, so there is nothing to refund.");
          setPhase({ name: "idle" });
        }
        return;
      }
      if (row.status !== "taken" || row.bob === undefined) return;
      const bob = await post<{ utxos: UtxoSeen[] }>({ op: "inspect", network: session.network, address: row.bob.address });
      if (cancel || bob.utxos[0] === undefined) return;
      joining.current = true;
      try {
        const next = withContracts(session, row);
        const alice = await post<{ utxos: UtxoSeen[] }>({ op: "inspect", network: next.network, address: next.alice.address });
        if (alice.utxos[0] === undefined) {
          const { coins: walletCoins } = await fundingCoins();
          await fundSide(next, "alice", walletCoins);
        }
        if (!cancel) setPhase({ name: "deposit_shown", session: next });
      } catch (error) {
        joining.current = false;
        if (!cancel) setFail(said(error instanceof Error ? error.message : "bch-funds"));
      }
    }
    void watch().catch((error: unknown) => {
      if (!cancel) setFail(said(error instanceof Error ? error.message : "rejected"));
    });
    const timer = setInterval(() => {
      void watch().catch(() => undefined);
    }, 5000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase.name !== "taking") return;
    const session = phase.session;
    let cancel = false;
    async function watch() {
      if (cancel || session.bob.address === "" || session.alice.address === "") return;
      const bob = await post<{ utxos: UtxoSeen[]; hasHistory: boolean; latestTxid?: string; preimage?: string }>({
        op: "inspect",
        network: session.network,
        address: session.bob.address,
        secretHash: session.secretHash,
      });
      const alice = await post<{ utxos: UtxoSeen[]; hasHistory: boolean; latestTxid?: string }>({
        op: "inspect",
        network: session.network,
        address: session.alice.address,
      });
      if (cancel) return;
      if (alice.utxos[0] !== undefined && bob.utxos[0] === undefined && bob.hasHistory && bob.preimage !== undefined && !takerClaimed.current) {
        takerClaimed.current = true;
        const claimedSide = await post<{ ok: boolean; hex?: string; reason?: string }>({
          op: "spend",
          network: session.network,
          action: "claim",
          side: session.alice.side,
          utxo: alice.utxos[0],
          secret: bob.preimage,
          outputLock: session.solverLock,
        });
        if (!claimedSide.ok || claimedSide.hex === undefined) {
          takerClaimed.current = false;
          setFail(said(claimedSide.reason ?? "rejected"));
          return;
        }
        const broadcasted = await post<{ txid: string }>({ op: "broadcast", network: session.network, hex: claimedSide.hex });
        if (!cancel) setPhase({ name: "output_shown", session, txid: broadcasted.txid });
        return;
      }
      if (alice.utxos[0] === undefined && alice.hasHistory && bob.utxos[0] === undefined) {
        setPhase({ name: "output_shown", session, txid: alice.latestTxid ?? session.alice.address });
        return;
      }
      if (Date.now() / 1000 >= session.bobTimeout && bob.utxos[0] !== undefined && alice.utxos[0] === undefined) {
        setPhase({ name: "refund_available", session, deposit: bob.utxos[0], which: "bob" });
      }
    }
    const timer = setInterval(() => {
      void watch().catch((error: unknown) => {
        if (!cancel) setFail(said(error instanceof Error ? error.message : "rejected"));
      });
    }, 5000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase.name !== "payment_seen" || phase.mirror === undefined) return;
    if ((secretEdit ?? phase.session.secret) !== phase.session.secret) return;
    if (claimed.current === phase.mirror.txid) return;
    claimed.current = phase.mirror.txid;
    void finish(phase.session, phase.deposit, phase.mirror).catch((error: unknown) => {
      setFail(said(error instanceof Error ? error.message : "rejected"));
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
          {wallet ? (
            <button className="connect" type="button" onClick={disconnectWallet}>
              Disconnect
            </button>
          ) : null}
        </div>
      </header>
      {account !== null ? <p className="account">{account}</p> : null}
      <section className="stage">
        <div className="brief">
          <div className="intro">
            <h1>Trade with someone</h1>
            <p className="lede">You lock what you hold. They lock what you want. Both are paid, or you take yours back.</p>
          </div>
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
        <div className="columns">
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
                <span className="field-label">You lock</span>
                <div className="field-row">
                  <input aria-label="You lock" value={sendText} onChange={(event) => onSend(event.target.value)} inputMode="decimal" />
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
                <span className="field-label">They lock</span>
                <div className="field-row">
                  <input aria-label="They lock" value={receiveText} onChange={(event) => onReceive(event.target.value)} inputMode="decimal" />
                  <AssetSelect asset={receiveAsset} tokens={tokens} bchUsd={bchUsd} onChange={setReceiveAsset} />
                </div>
              </div>
              <TokenId
                label="Your token id"
                asset={sendAsset}
                onChange={(category) => {
                  setPortion(null);
                  setSendAsset({ ...sendAsset, kind: "token", category });
                }}
              />
              <TokenId
                label="Their token id"
                asset={receiveAsset}
                onChange={(category) => setReceiveAsset({ ...receiveAsset, kind: "token", category })}
              />
              {rateText !== "" ? (
                <div className="rate">
                  <span>Rate</span>
                  <span title={oracleTxid}>{rateText}</span>
                </div>
              ) : null}
              <button
                className="go"
                type="button"
                disabled={!wallet || !quoted || seeking}
                onClick={() => void publish().catch((error: unknown) => setFail(said(error instanceof Error ? error.message : "rejected")))}
              >
                {seeking ? "Looking" : "Lock your side"}
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
              {phase.name === "payment_seen" && phase.mirror !== undefined ? (
                <button
                  className="go"
                  type="button"
                  onClick={() => void finish(phase.session, phase.deposit, phase.mirror).catch((error: unknown) => setFail(said(error instanceof Error ? error.message : "rejected")))}
                >
                  Claim payout
                </button>
              ) : null}
              {phase.name === "refund_available" && phase.txid === undefined ? (
                <button className="go" type="button" onClick={() => void refund(phase.session, phase.deposit, phase.which ?? "alice")}>
                  Refund deposit
                </button>
              ) : null}
            </>
          )}
          {working !== null ? <p className="status">{working}</p> : null}
          {fail !== null ? <p className="fail">{fail}</p> : null}
        </div>
        <div className="trades-slot">
          <OpenTrades
            offers={offers}
            icons={Object.fromEntries(tokens.map((token) => [token.category.toLowerCase(), token.icon]))}
            mineId={phase.name === "offering" ? phase.offerId : null}
            busy={busy}
            onTake={(offer) => void take(offer)}
          />
        </div>
        </div>
        <TradeHistory trades={history} />
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
            <div className="connect-body">
              {qr !== null ? <img className="qr" alt="" src={qr} /> : null}
              <p className="uri">{uri}</p>
              {wallet ? (
                <button className="go" type="button" onClick={disconnectWallet}>
                  Disconnect
                </button>
              ) : null}
            </div>
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
