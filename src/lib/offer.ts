export interface OfferAsset {
  kind: "bch" | "token";
  category: string;
  symbol: string;
  decimals: number;
  text: string;
  base: string;
}

export interface OfferContract {
  address: string;
  side: {
    timeout: number;
    secretHash: string;
    payoutLock: string;
    refundLock: string;
    tokenCategory: string;
    tokenAmount: string;
  };
}

export interface Offer {
  id: string;
  createdAt: number;
  status: "open" | "taken";
  send: OfferAsset;
  want: OfferAsset;
  secretHash: string;
  makerRefundLock: string;
  makerPayoutLock: string;
  alice?: OfferContract;
  bob?: OfferContract;
}

export interface OfferView {
  id: string;
  createdAt: number;
  send: OfferAsset;
  want: OfferAsset;
}

export function viewOf(offer: Offer): OfferView {
  return { id: offer.id, createdAt: offer.createdAt, send: offer.send, want: offer.want };
}

export function offerAgo(createdAt: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - createdAt) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function offerLine(offer: OfferView): string {
  return `${offer.want.text} ${offer.want.symbol} → ${offer.send.text} ${offer.send.symbol}`;
}

export function sameOfferAsset(left: OfferAsset, right: OfferAsset): boolean {
  if (left.kind !== right.kind || left.base !== right.base) return false;
  if (left.kind === "bch") return true;
  return left.category.replace(/^0x/, "").toLowerCase() === right.category.replace(/^0x/, "").toLowerCase();
}

export function matchingOffer(rows: OfferView[], send: OfferAsset, want: OfferAsset): OfferView | undefined {
  return rows.find((row) => sameOfferAsset(row.want, send) && sameOfferAsset(row.send, want));
}
