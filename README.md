# AtomCash

Template: https://docs.google.com/presentation/d/1l9lZHeEuW5-V57Ha4488Wa_kLiUlvMMkAVRS8xoqun4/edit?usp=sharing
github: https://github.com/Utitofon-Udoekong/atomcash
site: not published
cashtokenaddress: bitcoincash:zq5hh46r4kudjpsayg58gu99h03p00nw4csaumqgy0

Swap BCH for a CashToken, or one CashToken for another, without a custodian. Each side locks its own asset. One preimage pays both sides. A timeout sends each deposit home.

## The problem

Swapping on Bitcoin Cash usually means handing both assets to an exchange. That person can keep one side, freeze the trade, or change the payout. AtomCash removes that person. The covenant checks the payout lock, the category, and the amount. A changed byte does not broadcast.

## How it works

One SolidCash contract, two instances, one SHA-256 preimage. Alice's timeout is 180 seconds. Bob's is 120. The page is mainnet. WizardConnect signs only the funding transaction. Claim and refund are already complete, so the wallet cannot rewrite the output.

A claim pays two outputs. Output 0 is the committed lock, category, and amount. Output 1 is 1,000 sats to the CashTokens address above. 800 sats stay for the miner. A refund waits for `tx.time`, then pays the refund lock and the same 1,000 sats.

The preimage that releases one side releases the other. One wrong byte fails the claim, so the preimage is never published, and both sides can still refund.

Chipnet recordings, from before the page was locked to mainnet. No mainnet transaction was broadcast from this workspace. Explorer: https://chipnet.imaginary.cash/tx/

| Step | Txid |
| --- | --- |
| BCH fund | `78b45ea722b28b57bebc211bed035f6bcfa93a0da815855e317d7e02bb2ef52b` |
| BCH claim | `0059e8dca0a8d21d8e6a6c3c496b4c2310e2983aa2d1912ea760ce72b789be17` |
| BCH refund | `fb24afd2348b978d18e02017b775e297e718b1752f6e3c17e69950a7ad78dfd7` |
| Alice funds token A | `42510d2f42468a79ddfc81ad4abf3b2db35733b433c4d51be431933b44595f5c` |
| Bob funds token B | `8cbe13cb59374eae040793f5eefeea6fa8b81a205bb97374bfd7d33dabde3bb2` |
| Claims of A and B | `d3a6f0738add3dafbfbbcec8c0d236ad4214cde67c7c4a632e7ac1d38b186c74`, `c6d1854a9c32b6a25ba12201101908d9ef2b24075e11a81cb518a186efe00b3f` |
| XO fund and refund | `b2e7968a5b4898085cad96dd358cb974601b357408bdf126967c0d63fe36b030`, `d48630e8cd953841810d0d14029485811154f7362c7f41736f8e089759a1f16a` |

Category A is `1ec3a4717811372e0f8a3507f52545636fbd9202997d391e27248fe67608df75`. Category B is `cd536c0ad219d7919d43a0cc8bb4565418ffeb6990bb04a9bf0bbe8d7206b73f`. A wrong category and a wrong amount were rejected and not broadcast. The XO invitation is `xo/invitation.json`. Import `xo/atom-swap.template.json` at https://blaze.xo.cash on chipnet, then join that invitation.

## Key features

- **Mainnet connect.** WizardConnect. The address under the header is the connected wallet.
- **What you can send.** Chips show the BCH and CashToken balances. Type an amount, or press 25%, 50%, 75%, or 100%.
- **Either asset.** BCH, or a CashToken category. Floating rate uses the Riften oracle. Fixed rate leaves both amounts as typed.
- **One payout.** Claim pays the committed output. Change one preimage byte and the page shows `secret` without broadcasting.
- **A refund.** After about three minutes, Refund deposit pays the funding address.
- **Recorded payments.** The chipnet transactions above. A mainnet payment appears when a wallet broadcasts one from the page.

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
| Package manager | pnpm, Node 18+ |

## Hackathon requirements

| Requirement | Where it is |
| --- | --- |
| No custodian holds both assets | Two AtomSwap instances, one preimage |
| The payout cannot be redirected | Lock, category, and amount are checked in the covenant |
| A wrong byte does not pay | Claim fails and the preimage is not broadcast |
| Either side can still refund | Alice 180 seconds, Bob 120 seconds |
| Bitcoin Cash or a CashToken | Empty category, or the 32-byte category id |
| A mainnet transaction from the app | Connect, create a swap, the wallet broadcasts it |
| WizardConnect | The Connect button |
| An XO template and invitation | `xo/atom-swap.template.json`, `xo/invitation.json`, chipnet refund above |
| Working demo | `pnpm dev`, then a mainnet wallet |
| Top-of-page banner | Presentation, GitHub, and the EMBER2026 address |

## Run

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. Connect a mainnet wallet, enter an amount, and create a swap.

Contract tests:

```bash
pnpm test
```
