# AtomCash

Non-custodial same-chain atomic swap of BCH and CashTokens. Neither side holds both assets. There is no custodian and no other-chain settlement.

## The problem

Swapping BCH for a CashToken, or one CashToken for another, usually means handing both assets to an exchange. The person in the middle can keep one side, freeze the trade, or change the payout. AtomCash removes that person. Each side locks its own asset in a covenant. The only ways out are the agreed payout, or a refund after a timeout.

## How it works

One SolidCash contract, two instances, one SHA256 preimage. Alice's timeout is later than Bob's.

1. Each side funds its own AtomSwap address. The constructor commits the payout lock, the refund lock, the token category, the token amount, the fee, and the secret hash.
2. A claim is valid only when the preimage hashes to that secret and the single output matches the committed lock, category, and amount. The value is the input minus the fee.
3. A refund is valid only when `tx.time` has reached the timeout, and it pays only the committed refund lock.
4. Publishing the preimage makes the other side's claim valid too. Changing one byte makes the claim invalid, and the preimage is not broadcast.

The page signs only the funding transaction, through WizardConnect. Claim and refund are complete transactions. The wallet cannot rewrite the output.

## Key features

- Connect a mainnet wallet with WizardConnect.
- Choose BCH or a CashToken on each side. Floating rates come from the Riften oracle. The token list comes from Cauldron. Fixed mode leaves both amounts as typed.
- Create the swap, send the deposit, and read the claim transaction id on the slip.
- Change one preimage byte. The page shows `secret` and does not broadcast.
- Refund after the timeout. Alice waits 180 seconds. Bob waits 120.
- Open the same contract as an XO invitation at https://blaze.xo.cash.

## Tech stack

- Contract: SolidCash (`contracts/AtomSwap.scash`), compiled and tested with solidhat on the BCH 2026 VM.
- Page: Next.js, React. Wallet: `@wizardconnect/dapp`.
- Chain: Electrum through `@solidcash/solidcash`, on mainnet.
- Rates and tokens: Riften Delphi oracle, public Cauldron token list.
- XO: `@xo-cash/engine` `0.1.1-next.18170561234` and `xo/atom-swap.template.json`. The engine compiles the same P2SH32 address as SolidCash.

## Hackathon requirements

Top of the home page:

- Presentation, based on the [Widget Factory template](https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit?usp=sharing): `public/AtomCash-BLAZE-2026.pptx` (also `Downloads\AtomCash BLAZE 2026.pptx`). Google Slides link: [BLANK]
- GitHub repository: https://github.com/Utitofon-Udoekong/atomcash
- EMBER2026 CashTokens address: `bitcoincash:zq5hh46r4kudjpsayg58gu99h03p00nw4csaumqgy0`

The title card for the deck is `public/widget-factory-banner.svg`.

Live demo: [BLANK]. Locally, `pnpm install` then `pnpm dev`, and open http://localhost:3000.

YouTube: [BLANK]

Team: [BLANK]

WizardConnect is the Connect button. The XO template is `xo/atom-swap.template.json`. A chipnet refund invitation is `xo/invitation.json`.

The page broadcasts on mainnet. A wallet with mainnet BCH can fund, claim, or refund. No mainnet transaction was broadcast from this workspace.

### Judge, on chipnet

1. Click **Connect** and approve WizardConnect.
2. Leave **Floating rate**, or click **Fixed rate** and type both amounts. Pick **BCH**, or pick a CashToken and paste its 64-character category.
3. Click **Create transaction**. Send the deposit to the address on the slip.
4. Click **Fund the other side** if the same wallet holds the other asset, then **Claim payout**.
5. Optional: change one byte of **Preimage**. The status shows `secret` and nothing is broadcast. After about three minutes, **Refund deposit** pays the funding address.

Chipnet coins: https://tbch.googol.cash/ and https://chipnet.bch.ninja/

### Recorded chipnet transactions

BCH, from `scripts/chipnet-spend.ts`:

| Step | Txid |
| --- | --- |
| Faucet | `6e3efc41c1cfb6f694f3109ce8c376f63ee9755be6aaa232d16e516c54c05680` |
| Fund the claim contract | `78b45ea722b28b57bebc211bed035f6bcfa93a0da815855e317d7e02bb2ef52b` |
| Claim | `0059e8dca0a8d21d8e6a6c3c496b4c2310e2983aa2d1912ea760ce72b789be17` |
| Fund the refund contract | `aa1bfbe54f04e68fee8202ebfa45dba149b0909d51919ce2074c7a6b84c6dd45` |
| Refund | `fb24afd2348b978d18e02017b775e297e718b1752f6e3c17e69950a7ad78dfd7` |

CashToken, from `scripts/chipnet-token.ts`. Category A is `1ec3a4717811372e0f8a3507f52545636fbd9202997d391e27248fe67608df75`. Category B is `cd536c0ad219d7919d43a0cc8bb4565418ffeb6990bb04a9bf0bbe8d7206b73f`. Wrong category and wrong amount were rejected and not broadcast.

| Step | Txid |
| --- | --- |
| Alice funds 100 of A | `42510d2f42468a79ddfc81ad4abf3b2db35733b433c4d51be431933b44595f5c` |
| Bob funds 100 of B | `8cbe13cb59374eae040793f5eefeea6fa8b81a205bb97374bfd7d33dabde3bb2` |
| Funder claims B | `c6d1854a9c32b6a25ba12201101908d9ef2b24075e11a81cb518a186efe00b3f` |
| Receiver claims A | `d3a6f0738add3dafbfbbcec8c0d236ad4214cde67c7c4a632e7ac1d38b186c74` |

XO refund, broadcast by the engine:

| | |
| --- | --- |
| Fund | `b2e7968a5b4898085cad96dd358cb974601b357408bdf126967c0d63fe36b030` |
| Refund | `d48630e8cd953841810d0d14029485811154f7362c7f41736f8e089759a1f16a` |

Explorer: https://chipnet.imaginary.cash/tx/

To see the refund in the inspector: open https://blaze.xo.cash on chipnet, import `xo/atom-swap.template.json`, then join `xo/invitation.json`. The result is `refundTransaction` `d48630e8cd953841810d0d14029485811154f7362c7f41736f8e089759a1f16a`.

`pnpm test` covers claim, refund, a flipped preimage, the wrong payout, the wrong category, the wrong amount, an early refund, and a second input.

Deadline: 2026-11-22 14:00 UTC. https://dorahacks.io/hackathon/bchblaze2026
