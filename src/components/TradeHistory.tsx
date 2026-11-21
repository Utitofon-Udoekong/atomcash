interface TradeRecord {
  at: number;
  pair: string;
  claim: string;
  payout?: string;
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…${id.slice(-8)}`;
}

export function TradeHistory({ trades }: { trades: TradeRecord[] }) {
  return (
    <section className="history" aria-label="Trade history">
      <div className="trades-head">
        <h2>Trade history</h2>
        <span>Check both wallets</span>
      </div>
      {trades.length === 0 ? (
        <p className="trades-empty">No completed trades.</p>
      ) : (
        <div>
          {trades.map((trade) => (
            <div key={trade.claim} className="history-row">
              <span className="trade-pair">{trade.pair}</span>
              <span className="history-ids">
                <a href={`https://imaginary.cash/tx/${trade.claim}`} title={trade.claim}>
                  {shortId(trade.claim)}
                </a>
                {trade.payout !== undefined ? (
                  <a href={`https://imaginary.cash/tx/${trade.payout}`} title={trade.payout}>
                    {shortId(trade.payout)}
                  </a>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
