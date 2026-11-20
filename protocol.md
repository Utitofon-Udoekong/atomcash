# AtomCash protocol

Same-chain atomic swap of BCH and CashTokens. One covenant, two instances, one preimage. No custodian holds both assets.

## What was read

**BLAZE.** Submission deadline is 2026-11-22 14:00 UTC. Judging is 23–27 November, payouts after the 28th. A project may enter several bounties.

Mainnet track (Community Choice needs this too): original work, at least one real BCH mainnet transaction, a live demo a judge can open, WizardConnect, the Widget Factory deck (https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit), a public repo, Telegram check-in, and attendance at a prep stream. Community Choice also needs a CashTokens address that can receive EMBER2026.

Best SolidCash Application (3.5 BCH): a Solidity contract compiled with SolidCash, runnable on chipnet or mainnet, exercised through solidhat. The contract is the point; the UI only has to walk the lifecycle. Untested code is called out as low value.

Build with XO (0.3 BCH, up to 10) and Migrate to XO (1 BCH, up to 5): a novel template, a chipnet or mainnet invitation the debug tool can open, follow-up actions where the contract has them, reproduction steps, and a personally written XO note. That note is not included here; an AI draft would be rejected.

FoldingCash (26M FLDCH) is a different product: Merkle roots of Folding@home points, a pull-claim pool, receipt NFTs, a root-update timelock. It is not this swap.

**Covenants.** CashScript HTLCs (smartbch/atomic-swap-covenants, BIP-199) spend with a hash preimage or refund after `OP_CHECKLOCKTIMEVERIFY`. OPTN’s CashTokens note is the rule this contract follows: the builder proposes outputs, the covenant checks locking bytecode, category, and amount. IntentLock (Cashtoken-Studio) is the other same-chain shape: one offer UTXO, a solver fills it in the same transaction. Jedex in the CashTokens spec is a multi-covenant DEX, larger than a two-party swap. SolidSwap is the UI reference for a non-custodial CashToken AMM with a wallet connect, not the contract this demo uses.

**BCH–XMR.** Thread 545 on Bitcoin Cash Research and the VES thread (1266) describe a real atomic swap: Monero cannot check a Bitcoin hashlock, so the production path is adaptor signatures or one-time verifiably encrypted signatures, plus a Monero refund transaction. BasicSwap and mainnet_pat’s work are the implementations that already do this. A minimal adaptor path is future work. The working demo is this same-chain covenant.

**SolidCash.** `pragma solidcash` contracts compile to Bitcoin Script. Stateful contracts keep up to 128 bytes of local state in an NFT commitment so the locking bytecode can stay constant. solidhat’s mock network runs the BCH 2026 VM. A green default mock is not a mainnet proof unless size and dust limits are turned on. This swap does not use a shared NFT covenant: each offer is its own P2SH32, so two swaps never fight over one UTXO. The contract still rejects an NFT commitment on the payout, so a fungible offer cannot carry hidden state.

**XO.** A template lists roles, actions, variables, transactions, and locking scripts. An invitation is a sequence of commits (take a role, add variables, add inputs) that ends in `executeAction`. Follow-up actions live on the locking script. The engine, not the webpage, is the source of truth for the invitation transaction. `@xo-cash/engine` `0.1.1-next.18170561234` substitutes the constructor, compiles the same P2SH32 locking bytecode as SolidCash, and broadcast the chipnet refund in `evidence/xo-chipnet.json`. The invitation is `xo/invitation.json`. `pnpm evidence` still builds the claim transaction from the same redeem script.

**Privacy and atomicity.** Either both claims land or both sides refund. Nobody else can redirect a payout: claim and refund have no signature, and the output is fixed by the redeem script. The funder’s address appears only on the funding transaction. The receiver’s address appears only on the claim. The contract outpoint is the only on-chain link. A same-wallet fill that also spends the receiver’s coins in the claim transaction would add a second link; the UI funds from one address and pays a later receive address, and the claim spends only the contract.

## Contract

`contracts/AtomSwap.scash`, compiled by solidc in native mode (`evmCompat` off). One instance is one side of the swap. Bytecode equality is the opcode compare, so one changed byte of a lock, category, or amount fails closed. SolidCash 0.51 is the release this was compiled with. The project treats it as mocknet-beta for anything larger than a two-party swap: the strict mock enforces mainnet input size, dust, and the operation-cost budget, and the same artifact is what the Electrum mainnet provider instantiates. A public mainnet broadcast still needs the funding wallet to hold the coins.

Constructor parameters, in order:

| Parameter | Type | Meaning |
| --- | --- | --- |
| `timeout` | bigint | Absolute nLocktime. Alice’s is later than Bob’s. |
| `secretHash` | bytes32 | `SHA256(preimage)`. Same hash on both sides. |
| `payoutLock` | bytes | Locking bytecode paid on claim. |
| `refundLock` | bytes | Locking bytecode paid on refund. |
| `tokenCategory` | bytes | Consensus-order category, or empty for BCH. |
| `tokenAmount` | bigint | Fungible amount, or 0 for BCH. |
| `fee` | bigint | Sats retained as the miner fee. 800. |

The redeem script is hashed with HASH256 and wrapped as P2SH32. The cashaddr uses the `bchtest:` prefix on chipnet and `bitcoincash:` on mainnet, token-aware form.

### Happy path

Alice draws a 32-byte preimage and keeps it in the browser. She tells Bob only the hash, the amounts, and the two payout bytecodes.

1. **Alice funding.** Inputs are Alice’s P2PKH (and a token input if she is selling a CashToken). Output 0 is her AtomSwap P2SH32. Its value is `payout + fee`. Its token is the asset she is selling, or none. Change, if any, goes back to her change address.
2. **Bob funding.** Same shape, his asset, his AtomSwap instance, same `secretHash`. His timeout is earlier.
3. **Alice claims Bob’s contract.** One input (the contract). Locktime 0. One output: Alice’s payout bytecode, value `input − fee`, the same token category and amount. Unlocking bytecode pushes the preimage and selects `claim`. This publishes the preimage.
4. **Bob claims Alice’s contract.** Same shape, using the preimage now visible in Alice’s claim. Output is Bob’s payout bytecode.

WizardConnect signs the funding inputs only (`SIGHASH_ALL | FORKID | UTXOS`). Claim and refund are complete transactions; the wallet cannot rewrite the output.

### Refund path

`refund` requires `tx.time >= timeout`, one input, one output, the committed refund bytecode, the same token, and value `input − fee`. The input sequence is `0xfffffffe` and nLocktime is the timeout.

If Alice never claims, Bob refunds after his timeout and Alice refunds after hers. Bob’s earlier timeout is what keeps Alice from waiting until Bob has refunded and then claiming with a preimage he can no longer use on a contract that is already spent. If Alice has claimed, the preimage is public and Bob can claim until Alice’s later timeout.

Anyone may broadcast a refund. They can only pay `refundLock`.

### What a judge does

1. Open https://atomcash.vercel.app/. Click Connect and approve WizardConnect. The wallet must hold the asset being sent and, for a one-wallet demo, the asset being received. The page uses mainnet.
2. Enter the amounts. Pick BCH, or pick a CashToken and paste its category in Send token id or Receive token id.
3. Click Create transaction. The deposit cashaddr is the send-side contract.
4. Send to that address from the wallet. The page polls until that outpoint exists.
5. If the receive asset is already in the wallet, click Fund the other side and approve it. If it is not, the counterparty address stays on screen until someone else funds it.
6. Click Claim payout. The slip shows the claim transaction id. That id pays the bought asset to the committed receive address.
7. To break it: change one byte of the Preimage field, then click Claim payout. The status shows `secret` and no payout id appears. After the timeout, Refund deposit broadcasts the refund.

### How one byte breaks atomicity

`claim` is a consensus predicate. `SHA256(preimage)` must equal the committed hash, and output 0’s locking bytecode must equal `payoutLock`.

- Flip one byte of the preimage. `SHA256` no longer matches. The claim transaction is invalid, so it is not broadcast and the preimage is not published. Both contracts can still refund. Neither payout is created.
- Flip one byte of the payout locking bytecode in the claim output. The preimage still matches, but `lockingBytecode == payoutLock` fails. Same result: nothing is spent. The UI evaluates before broadcast, so a matching preimage is not published in a rejected transaction.
- Flip one byte of the token category or change the token amount. `tokenCategory ==` or `tokenAmount ==` fails. The locked output stays put.
- Flip one byte inside the constructor parameters. The P2SH32 address changes. Coins sent to the original address are not spendable by the mutated script at all.

A partial swap would require one claim to be valid while the mirror claim is invalid. The only way the first claim becomes valid is by revealing the preimage that makes the second claim valid, and the second claim’s payout address is fixed. Changing a byte on either check makes that claim invalid without creating a substitute output.
