const DELPHI = "be0d0d8324e8cda41d34b85bd203ce2482256eb337a0ad0fea82c2ddd7306c88";
const INDEXER = "https://indexer.riften.net";

interface ListedToken {
  token_id: string;
  display_symbol?: string;
  display_name?: string;
  price_now_usd?: number;
  bcmr?: {
    name?: string;
    token?: { symbol?: string; decimals?: number; category?: string };
    uris?: { icon?: string };
  };
}

export interface MarketToken {
  category: string;
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  usd: number;
}

let cache: { at: number; body: { bchUsd: number; oracleTxid: string; tokens: MarketToken[] } } | undefined;

function iconUrl(icon: string): string {
  if (icon.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${icon.slice("ipfs://".length)}`;
  return icon;
}

function listed(row: ListedToken): MarketToken | undefined {
  const icon = row.bcmr?.uris?.icon;
  const usd = row.price_now_usd;
  if (icon === undefined || icon === "" || usd === undefined || usd <= 0) return undefined;
  const symbol = row.bcmr?.token?.symbol ?? row.display_symbol ?? "TOKEN";
  const name = row.bcmr?.name ?? row.display_name ?? "CashToken";
  const label = `${symbol} ${name}`.toLowerCase();
  if (label.includes("nigga") || label.includes("nigger")) return undefined;
  return {
    category: row.token_id,
    symbol,
    name,
    decimals: row.bcmr?.token?.decimals ?? 0,
    icon: iconUrl(icon),
    usd,
  };
}
export async function loadMarket(): Promise<{ bchUsd: number; oracleTxid: string; tokens: MarketToken[] }> {
  if (cache !== undefined && Date.now() - cache.at < 60_000) return cache.body;
  const [oracleResponse, listResponse] = await Promise.all([
    fetch(`${INDEXER}/oracle/delphi/closest?token_id=${DELPHI}`),
    fetch(`${INDEXER}/cauldron/tokens/list_cached?limit=24&by=volume&order=desc`),
  ]);
  if (!oracleResponse.ok || !listResponse.ok) {
    throw new Error("oracle");
  }
  const oracle = (await oracleResponse.json()) as { oracle_price?: number; txid?: string };
  const rows = (await listResponse.json()) as ListedToken[];
  const bchUsd = (oracle.oracle_price ?? 0) / 100;
  const tokens = rows.flatMap((row) => {
    const token = listed(row);
    return token === undefined ? [] : [token];
  });
  const body = { bchUsd, oracleTxid: oracle.txid ?? "", tokens };
  cache = { at: Date.now(), body };
  return body;
}
