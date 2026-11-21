# AtomCash

Template: https://docs.google.com/presentation/d/1l9lZHeEuW5-V57Ha4488Wa_kLiUlvMMkAVRS8xoqun4/edit?usp=sharing
github: https://github.com/Utitofon-Udoekong/atomcash
site: https://atomcash.vercel.app/
cashtokenaddress: bitcoincash:zq5hh46r4kudjpsayg58gu99h03p00nw4csaumqgy0

Both parties must be present. AtomCash will not lock your funds until the other person’s address is known.

A person-to-person exchange that requires both parties to be present.

You and the other person open the page at the same time. The page writes both of your addresses into the two contracts, then asks each wallet to lock. One shared preimage pays both sides. If the other person never locks, you refund after the timeout and take your funds back.

You cannot leave a funded order open for a stranger. The contract pays only to the address written into it at creation. Locking first with an empty address would let anyone who later sees the preimage claim the coins.

## The problem

Swapping on Bitcoin Cash usually means handing both assets to an exchange. That person can keep one side, freeze the trade, or change the payout. AtomCash removes that person. The covenant checks the payout lock, the category, and the amount. A changed byte does not broadcast.

## How it works

Both parties must be online before either side locks. The page waits until the second address is known, writes both payout addresses into the contracts, and only then requests the funding signatures. This is required by the covenant: a claim pays only the committed address.

One SolidCash contract, two instances, one SHA-256 preimage. Alice's timeout is 180 seconds. Bob's is 120. The page is mainnet. WizardConnect signs only the funding transaction. Claim and refund are already complete, so the wallet cannot rewrite the output.

A claim pays two outputs. Output 0 is the committed lock, category, and amount. Output 1 is 1,000 sats to the CashTokens address above. 800 sats stay for the miner. A refund waits for `tx.time`, then pays the refund lock and the same 1,000 sats.

The preimage that releases one side releases the other. One wrong byte fails the claim, so the preimage is never published, and both sides can still refund.

## Mainnet

One completed swap, 0.00005214 BCH for 0.01 PUSD. Explorer: https://imaginary.cash/tx/

| Step | Txid |
| --- | --- |
| PUSD claim | `1a4ef4d7cfb587f775b66b718f48aba5a234183e41d14f2e895ef95c8d4017ac` paid 0.01 PUSD to `bitcoincash:zq5hh46r4kudjpsayg58gu99h03p00nw4csaumqgy0` |
| BCH claim | `4c1dd8c13e69ef86f17c81c860bd3bcf82330541637374ece41635ee28c7b75b` paid 0.00005214 BCH to `bitcoincash:zpgn4m5xa08wqrlf3570070vjsdxj9emdv9gmqxgjp` |

Each claim also paid 1,000 sats to the CashTokens address above.

## The pool

The pool is how the other person finds your trade.

You post the token and the amounts. That row is the offer. Your coins stay in your wallet. When someone clicks Take, both addresses are written into the contracts, their wallet locks, and yours locks — but only if your page is still open. If you have closed the page, they cannot complete the swap with you.

The pool is a meeting place. It is not a pile of coins that are already locked.

## Key features

- **Mainnet connect.** WizardConnect. The address under the header is the connected wallet.
- **What you can lock.** Chips show the BCH and CashToken balances. Type an amount, or press 25%, 50%, 75%, or 100%.
- **Either asset.** BCH, or a CashToken category. Floating rate uses the Riften oracle. Fixed rate leaves both amounts as typed.
- **One payout.** Claim pays the committed output. Change one preimage byte and the page shows `secret` without broadcasting.
- **A refund.** After about three minutes, Refund deposit pays the funding address.
- **Recorded payments.** The mainnet claims above. A completed swap also appears under Trade history.

## Tech stack

| Piece | What it is |
| --- | --- |
| App | Next.js 15, React 19, TypeScript, port 3000 |
| Contract | SolidCash `contracts/AtomSwap.scash`, compiled and tested with solidhat 0.51 |
| Wallet | `@wizardconnect/dapp` 0.2.8 |
| Chain | Electrum through `@solidcash/solidcash`, mainnet |
| Rates | Riften Delphi oracle, Cauldron token list |
| XO | `@xo-cash/engine` 0.1.1-next.18170561234, `xo/atom-swap.template.json` |
| Tests | `pnpm test`: claim, refund, flipped preimage, wrong payout, wrong category, wrong amount, early refund, second input |


## Hackathon requirements

| Requirement | Where it is |
| --- | --- |
| No custodian holds both assets | Two AtomSwap instances, one preimage |
| The payout cannot be redirected | Lock, category, and amount are checked in the covenant |
| A wrong byte does not pay | Claim fails and the preimage is not broadcast |
| Either side can still refund | Alice 180 seconds, Bob 120 seconds |
| Bitcoin Cash or a CashToken | Empty category, or the 32-byte category id |
| A mainnet transaction from the app | PUSD claim `1a4ef4d7cfb587f775b66b718f48aba5a234183e41d14f2e895ef95c8d4017ac`, BCH claim `4c1dd8c13e69ef86f17c81c860bd3bcf82330541637374ece41635ee28c7b75b` |
| WizardConnect | The Connect button |
| An XO template and invitation | `xo/atom-swap.template.json`, `xo/invitation.json` |
| Working demo | https://atomcash.vercel.app/ |

## Run

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. Both people keep the page open. One posts the offer. The other clicks Take.

Contract tests:

```bash
pnpm test
```
