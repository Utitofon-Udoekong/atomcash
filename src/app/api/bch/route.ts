import { NextResponse } from "next/server";
import {
  addressOfLock,
  broadcast,
  buildFunding,
  buildSpend,
  inspectAddress,
  listUtxos,
  listWallet,
  lockFromPublicKey,
  prepare,
  type Coin,
  type NetName,
  type SideInput,
} from "@/lib/live";

interface LockBody {
  op: "lock";
  network: NetName;
  pubkeyHex: string;
  token: boolean;
}

interface PrepareBody {
  op: "prepare";
  network: NetName;
  side: SideInput;
}

interface UtxoBody {
  op: "utxos";
  network: NetName;
  address: string;
}

interface CoinsBody {
  op: "coins";
  network: NetName;
  rows: { pubkeyHex: string; pathName: string; pathIndex: number }[];
}

interface FundBody {
  op: "fund";
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
}

interface SpendBody {
  op: "spend";
  network: NetName;
  action: "claim" | "refund";
  side: SideInput;
  utxo: { txid: string; vout: number; satoshis: string; tokenCategory?: string; tokenAmount?: string };
  secret?: string;
  outputLock: string;
}

interface BroadcastBody {
  op: "broadcast";
  network: NetName;
  hex: string;
}

interface AddressBody {
  op: "address";
  network: NetName;
  lock: string;
  token: boolean;
}

interface InspectBody {
  op: "inspect";
  network: NetName;
  address: string;
  secretHash?: string;
}

type Body = LockBody | PrepareBody | UtxoBody | CoinsBody | FundBody | SpendBody | BroadcastBody | AddressBody | InspectBody;

function isNet(value: string): value is NetName {
  return value === "mainnet";
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as Body;
  if (!isNet(body.network)) {
    return NextResponse.json({ error: "network" }, { status: 400 });
  }
  try {
    switch (body.op) {
      case "lock": {
        const publicKey = Uint8Array.from(Buffer.from(body.pubkeyHex, "hex"));
        const lock = lockFromPublicKey(publicKey, body.network, body.token);
        return NextResponse.json({
          address: lock.address,
          lockingBytecode: Buffer.from(lock.lockingBytecode).toString("hex"),
        });
      }
      case "prepare":
        return NextResponse.json(await prepare(body.network, body.side));
      case "utxos":
        return NextResponse.json({ utxos: await listUtxos(body.network, body.address) });
      case "coins": {
        if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 40) throw new Error("wallet");
        return NextResponse.json({ utxos: await listWallet(body.network, body.rows) });
      }
      case "fund":
        return NextResponse.json(await buildFunding(body));
      case "spend":
        return NextResponse.json(await buildSpend(body));
      case "broadcast":
        return NextResponse.json({ txid: await broadcast(body.network, body.hex) });
      case "address":
        return NextResponse.json({ address: addressOfLock(body.lock, body.network, body.token) });
      case "inspect":
        return NextResponse.json(await inspectAddress(body.network, body.address, body.secretHash));
      default: {
        const unreachable: never = body;
        return NextResponse.json({ error: "op", unreachable }, { status: 400 });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "rejected";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
