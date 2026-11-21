import { useState } from "react";
import { offerAgo, type OfferAsset, type OfferView } from "@/lib/offer";

type Direction = "bch-token" | "token-bch";

interface OpenTradesProps {
  offers: OfferView[];
  icons: Record<string, string>;
  mineId: string | null;
  busy: boolean;
  onTake: (offer: OfferView) => void;
}

function waited(createdAt: number): string {
  const label = offerAgo(createdAt);
  return label === "now" ? "just now" : `${label} ago`;
}

function directionOf(offer: OfferView): Direction | null {
  if (offer.want.kind === "bch" && offer.send.kind === "token") return "bch-token";
  if (offer.want.kind === "token" && offer.send.kind === "bch") return "token-bch";
  return null;
}

function tokenSide(offer: OfferView, direction: Direction): OfferAsset {
  return direction === "bch-token" ? offer.send : offer.want;
}

function Coin({ asset, icons }: { asset: OfferAsset; icons: Record<string, string> }) {
  const icon = asset.kind === "token" ? icons[asset.category.toLowerCase()] : undefined;
  if (icon !== undefined) return <img src={icon} alt="" />;
  const letter = asset.kind === "bch" ? "B" : asset.symbol.slice(0, 1).toUpperCase();
  return <span className={asset.kind === "bch" ? "mark-b" : "mark-b token"}>{letter}</span>;
}

function Leg({ asset, icons, iconFirst }: { asset: OfferAsset; icons: Record<string, string>; iconFirst: boolean }) {
  const coin = <Coin asset={asset} icons={icons} />;
  const label = (
    <span>
      {asset.text} {asset.symbol}
    </span>
  );
  return (
    <span className="trade-leg">
      {iconFirst ? coin : label}
      {iconFirst ? label : coin}
    </span>
  );
}

export function OpenTrades({ offers, icons, mineId, busy, onTake }: OpenTradesProps) {
  const [direction, setDirection] = useState<Direction>("bch-token");
  const [category, setCategory] = useState("");
  const directed = offers.filter((offer) => directionOf(offer) === direction);
  const tokens = new Map<string, string>();
  for (const offer of directed) {
    const token = tokenSide(offer, direction);
    if (!tokens.has(token.category)) tokens.set(token.category, token.symbol);
  }
  const chosen = tokens.has(category) ? category : "";
  const shown = directed
    .filter((offer) => chosen === "" || tokenSide(offer, direction).category === chosen)
    .sort((left, right) => right.createdAt - left.createdAt);

  return (
    <section className="trades" aria-label="Open trades">
      <div className="trades-head">
        <h2>Open trades</h2>
        <span>You lock → you receive</span>
      </div>
      <div className="trade-switch" role="group" aria-label="Direction">
        <button type="button" className={direction === "bch-token" ? "on" : ""} aria-pressed={direction === "bch-token"} onClick={() => setDirection("bch-token")}>
          BCH → CashToken
        </button>
        <button type="button" className={direction === "token-bch" ? "on" : ""} aria-pressed={direction === "token-bch"} onClick={() => setDirection("token-bch")}>
          CashToken → BCH
        </button>
      </div>
      <div className="trade-tokens" role="group" aria-label="CashToken">
        <button type="button" className={chosen === "" ? "on" : ""} aria-pressed={chosen === ""} onClick={() => setCategory("")}>
          All
        </button>
        {[...tokens].map(([id, symbol]) => (
          <button key={id} type="button" className={chosen === id ? "on" : ""} aria-pressed={chosen === id} onClick={() => setCategory(id)}>
            <Coin asset={{ kind: "token", category: id, symbol, decimals: 0, text: "", base: "0" }} icons={icons} />
            {symbol}
          </button>
        ))}
      </div>
      <div className="trades-body">
        {shown.length === 0 ? (
          <p className="trades-empty">No one is waiting on this side.</p>
        ) : (
          <div className="queue">
            {shown.map((offer) => {
              const mine = offer.id === mineId;
              const body = (
                <>
                  <span className="trade-main">
                    <span className="trade-pair">
                      <Leg asset={offer.want} icons={icons} iconFirst={false} />
                      <span className="trade-arrow">→</span>
                      <Leg asset={offer.send} icons={icons} iconFirst />
                    </span>
                    <span className="trade-meta">{mine ? `${waited(offer.createdAt)} · your offer` : waited(offer.createdAt)}</span>
                  </span>
                  <span className="trade-act">{mine ? "Yours" : busy ? "Checking" : "Take"}</span>
                </>
              );
              if (mine) {
                return (
                  <div key={offer.id} className="trade-row">
                    {body}
                  </div>
                );
              }
              return (
                <button key={offer.id} type="button" className="trade-row" disabled={busy} onClick={() => onTake(offer)}>
                  {body}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
