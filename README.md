# AtomCash

Non-custodial same-chain atomic swap of BCH and CashTokens. The contract is `contracts/AtomSwap.scash`. One SolidCash covenant, two instances, one preimage. The seller's contract times out later than the buyer's, so either both claims pay the committed addresses or both sides refund. No server holds either asset or the preimage. The preimage stays in the browser until the claim is broadcast. There is no custodian and no other-chain settlement.

## Judge

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. Chipnet is already selected. There is no hosted demo. This directory is not a git repository, so there is no GitHub URL.

1. Click **Connect** and approve the WizardConnect QR. The button changes to **Connected**. The funding key and the refund key are that wallet. The payout lock is the next receive address and is not shown.
2. Leave the rate on **Floating rate**, or click **Fixed rate** and type both amounts. Pick **BCH** on each side, or pick a CashToken and paste its 64-character category in **Send token id** or **Receive token id**. BCH amounts are coins (`0.0001`). Token amounts are base units.
3. Click **Create transaction**. The slip shows the deposit address. Send that amount from the wallet. The status moves from waiting, to deposit seen, to both contracts funded.
4. Click **Fund the other side** if the same wallet holds the asset being bought, then **Claim payout**. The slip shows the claim transaction id.
5. To break it: before the claim, change one byte of the **Preimage** field and click **Claim payout**. The status shows `secret` and nothing is broadcast. After about three minutes, **Refund deposit** appears. That id is the refund back to the funding address. Alice's timeout is 180 seconds. Bob's is 120.

A chipnet wallet with only test BCH can finish a BCH swap. A CashToken swap needs the wallet to hold the category you paste. The recorded token swap below minted two categories and claimed both sides.

Chipnet coins: https://tbch.googol.cash/ and https://chipnet.bch.ninja/

## Contract proof

`pnpm test` compiles with solidhat, then runs the solidhat Vitest preset. `solidhat test` itself shells out to `npx vitest`; use that form on a machine where `npx` is installed.

Four cases on the strict mock (10,000-byte inputs, dust, operation cost 800):

| Case | Result |
| --- | --- |
| Claim pays the committed CashToken output | `674e6ae3a360f9a37357b49d822bda978fdad95332ba94e3edf9163e4da5892c` |
| Refund pays only after the timeout | `503d7142cd79a0dcab7bf197b4515aef207f8234bf673f0ee7b975dd56699ba5` |
| One flipped preimage byte fails `secret`, then refund still pays | `dce7f7cd2a1e6b529949b149757c3f5e6bbd342bfe505175473f6451f4a759d2` |
| Both sides: Alice claims Bob, Bob claims Alice with the same preimage | `f361653235e8fd4d2d4b1f716907e70e1658cd095e287b30e63718705117b67e` and `6263a09da18b555703313c2da6d57ecc1e2dd01b105057c7fadca6595165d118` |

`pnpm exec tsx scripts/smoke.ts` builds a chipnet (`bchtest:`) P2SH32 and a claim transaction, and checks that a one-byte preimage change fails closed.

## Chipnet, BCH

Recorded by `scripts/chipnet-spend.ts` on 2026-11-19. The googol faucet funded the key after the apecs drip's broadcaster returned a Fulcrum error.

| Step | Txid |
| --- | --- |
| Faucet 0.01017 tBCH to `bchtest:qzklqedw4hcyz8rk7de0eqavlslqhey4jvhv9cldcu` | `6e3efc41c1cfb6f694f3109ce8c376f63ee9755be6aaa232d16e516c54c05680` |
| Fund the claim contract | `78b45ea722b28b57bebc211bed035f6bcfa93a0da815855e317d7e02bb2ef52b` |
| Claim to `bchtest:qptkd3m89wnjygpxjn377cp0g2delzxuguuql8p3d8` | `0059e8dca0a8d21d8e6a6c3c496b4c2310e2983aa2d1912ea760ce72b789be17` |
| Fund the refund contract | `aa1bfbe54f04e68fee8202ebfa45dba149b0909d51919ce2074c7a6b84c6dd45` |
| Refund | `fb24afd2348b978d18e02017b775e297e718b1752f6e3c17e69950a7ad78dfd7` |

## Chipnet, CashToken

Recorded by `scripts/chipnet-token.ts`. Category A is `1ec3a4717811372e0f8a3507f52545636fbd9202997d391e27248fe67608df75`. Category B is `cd536c0ad219d7919d43a0cc8bb4565418ffeb6990bb04a9bf0bbe8d7206b73f`. Each side locked 100 of a 1000 supply. A claim with the wrong category and a claim with the wrong amount both failed in `debug()` and were not broadcast.

| Step | Txid |
| --- | --- |
| Alice funds 100 of A (`bchtest:rw2gev502z459atwpxvakrpmnngvwuw6cx2kg8l8yegp4xectvfpwzvg8w3zf`) | `42510d2f42468a79ddfc81ad4abf3b2db35733b433c4d51be431933b44595f5c` |
| Bob funds 100 of B (`bchtest:r0txcem9yzy6vrkehw4lkds2zfttnj8s3w9zw9xhev55zsxgf8kj565lz4v6s`) | `8cbe13cb59374eae040793f5eefeea6fa8b81a205bb97374bfd7d33dabde3bb2` |
| Funder claims B | `c6d1854a9c32b6a25ba12201101908d9ef2b24075e11a81cb518a186efe00b3f` |
| Receiver claims A | `d3a6f0738add3dafbfbbcec8c0d236ad4214cde67c7c4a632e7ac1d38b186c74` |

Explorer: https://chipnet.imaginary.cash/tx/

## XO

`xo/atom-swap.template.json` is the redeem script with the constructor pushes in front. `@xo-cash/engine` `0.1.1-next.18170561234` compiled it to the same locking bytecode and address as SolidCash, then broadcast the refund. `scripts/xo-chipnet.ts` is that run.

| | |
| --- | --- |
| Contract | `bchtest:pw5afw7xs59dphfy9g98u8rug90s2dll2yseduhw04ajqdhl3r76q8szw335r` |
| Fund | `b2e7968a5b4898085cad96dd358cb974601b357408bdf126967c0d63fe36b030` |
| Refund | `d48630e8cd953841810d0d14029485811154f7362c7f41736f8e089759a1f16a` |
| Invitation | `b076b2552c8cbcd57213625958cb6e5e` |

To see that refund in the inspector:

1. Open https://blaze.xo.cash. Create an account and set the network to chipnet.
2. On Home, click **Import Template**, paste `xo/atom-swap.template.json`, and click **Import JSON**. Templates lists AtomCash, id `b395cdde2a5e0f58cf3d7be5e2bc5004cf418bc347362fffded5981850d9b255`.
3. Click **Join Invitation**, paste `xo/invitation.json`, and click **View invitation**.
4. The result block is `refundTransaction` with hash `d48630e8cd953841810d0d14029485811154f7362c7f41736f8e089759a1f16a`.

Import the template before the invitation. The file uses `<bigint: …>` and `<uint8array: …>` tags. `xo/NOTES.md` is a fact list for the personal write-up.

## Mainnet

`src/lib/live.ts` builds the same funding and spend transactions for mainnet through Electrum, and the page has a **Mainnet** button. No mainnet transaction was broadcast. The chipnet key's mainnet address `bitcoincash:qzklqedw4hcyz8rk7de0eqavlslqhey4jvn7pla6lq` has a zero balance. The EMBER key was not spent.

## Hackathon

- Protocol: `protocol.md`
- Widget Factory deck: https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit
- Title card for that deck: `public/widget-factory-banner.svg`
- Live demo: http://localhost:3000 after `pnpm dev`
- GitHub: none
- EMBER2026 CashTokens address: `bitcoincash:zp3vcvfxxr5kwwjyg7zgwj5xvw5zavl6gsluj6u4sx`
- The matching key is in `.secrets/ember.txt` (hex, gitignored). It was not spent.
- XO template and follow-up actions: `xo/atom-swap.template.json`. Notes for a personal XO write-up: `xo/NOTES.md`.
- Deadline on DoraHacks: 2026-11-22 14:00 UTC. https://dorahacks.io/hackathon/bchblaze2026

## Scripts

- `pnpm dev` — the page
- `pnpm test` — solidhat
- `pnpm compile` — solidc only
- `pnpm exec tsx scripts/smoke.ts` — chipnet address and a claim hex
