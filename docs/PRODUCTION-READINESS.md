# ArkSwap V1 — production readiness

**Status: deployed to Ark Constellation devnet. NOT production-ready.**

llm.txt s53 is explicit: *"DO NOT migrate directly from devnet to mainnet."* and
s57 requires that the deployment is not called production-ready until security
review is complete. This document records what is done, and what is not.

---

## Devnet: complete

The full llm.txt s26 deployment order ran against chain id 9000, and s56's
"Definition of Done — devnet" is satisfied:

| Step | Result |
| --- | --- |
| Canonical WKASH confirmed | `symbol()` = `WKASH`, `decimals()` = 18, code present |
| Factory / Pair / Router compile | 3 compiler versions, clean |
| Pair init-code hash correct | derivation matches the deployed factory for all 3 pairs |
| Unit + fuzz + invariant tests | 129 passing; deep profile 10k fuzz / 1024×256 invariants |
| Static analysis reviewed | `docs/SECURITY-REVIEW.md` |
| Mocks deployed | mUSDC, mUSDT (6 decimals) |
| Factory deployed | `feeTo == address(0)` — protocol fee disabled |
| Router02 deployed | `factory()`, `WETH()`, `WKASH()` all verified on-chain |
| Pairs created | WKASH/mUSDC, WKASH/mUSDT, mUSDC/mUSDT |
| Liquidity seeded | 1 KASH = 1 mUSDC devnet reference pricing |
| KASH → mUSDC swap | succeeded |
| mUSDC → KASH swap | succeeded |
| Multi-hop mUSDT → WKASH → mUSDC | succeeded, delivered exactly the quoted amount |
| Liquidity removal | succeeded, LP received principal plus accrued fees |
| Blockscout verification | factory, router, mocks, WKASH verified — **pairs pending, see below** |
| Deployment manifest | `deployments/ark-devnet.json` |
| Frontend | reads live reserves; UI quote matches the router exactly |

Addresses are in `deployments/ark-devnet.json`.

---

## Open items found during this deployment

### 1. Pair contracts are not verified on Blockscout

The three pairs are live and functioning, but this Blockscout instance does not
index CREATE2 contract creations from internal transactions. Verification fails
with `Could not detect deployment: The address is not a smart contract`, even
though the address holds ~11 KB of code and serves calls.

This is an explorer indexing gap, not a contract problem. Retry with
`make verify-pairs` once the instance indexes internal transactions, or ask the
Ark team to enable trace/internal-transaction indexing.

### 2. Gas estimation on Ark under-estimates swaps

The `mUSDC → KASH` leg of the first smoke run reverted with `ReentrancySentryOOG`.
Root cause: forge estimated 115,976 gas from in-simulation state where storage
slots touched by the preceding transaction were already warm. On-chain those
slots are cold (EIP-2929), and the real requirement was ~140,092. The shortfall
left the pair's `SSTORE` in `_update()` with ≤ 2300 gas, tripping the EIP-2200
reentrancy sentry — which surfaces as `ReentrancySentryOOG` rather than a plain
out-of-gas.

**This is not a V2/Ark incompatibility.** The swap succeeded immediately when
resent with adequate gas. Mitigation is in the Makefile: deployment targets now
run with `--slow --gas-estimate-multiplier 300`.

Wallet-driven frontend swaps are unaffected — wallets estimate against live
state, not a simulation. Anything scripted or batched on Ark needs the headroom.

### 3. Devnet liquidity is thin

Pools were sized to the deployer's 75.7 KASH balance (40 KASH into WKASH/mUSDC,
15 into WKASH/mUSDT). A 1 KASH swap already moves the price ~3.4%. Top up from
the faucet and seed more before asking others to test, or every trade will look
like it has terrible execution.

### 4. `feeToSetter` is a single EOA

Currently the deployer EOA — acceptable for devnet (llm.txt s25), unacceptable
for anything long-lived. It controls protocol-fee configuration permanently and
can never be revoked without `setFeeToSetter`.

### 5. Repository licensing is unresolved

ArkSwap derives from Uniswap V2 (GPL-3.0-or-later) but the root `LICENSE` is
still MIT. Per-file SPDX headers are correct; the repository-level claim is not.
See `LICENSING.md`. Resolve before any public release.

---

## Gates that remain before testnet or mainnet

From llm.txt s53. None of these can be cleared by writing more code.

- [ ] **Formal security audit** by an independent firm, on a frozen commit.
- [ ] **Freeze the exact source commit** that will be deployed.
- [ ] **Re-run the full suite on that commit**: unit, fuzz (`make test-deep`), invariants, static analysis.
- [ ] **Re-review every semantic difference from upstream** (`docs/UPSTREAM-DIFF.md`), in particular the `arkSwapCall` callback rename, which is source-breaking for Uniswap V2 flash-swap integrators.
- [ ] **Re-verify the pair init-code hash** against the frozen commit and the exact compiler settings.
- [ ] **Replace `feeToSetter` with a multisig or governance-controlled address.**
- [ ] **Confirm the canonical WKASH** is the address the Ark core team endorses for production. The sibling `kashwrappedtoken` manifest still carries `canonical.approvedByArkCoreTeam: false`.
- [ ] **Decide the protocol-fee policy.** `feeTo` is `address(0)`; enabling it needs an economics proposal, a treasury destination, and `kLast` behaviour review (llm.txt s49).
- [ ] **Review frontend approvals, slippage defaults and the token list** for spoofing risk.
- [ ] **Deploy and soak on a production-like Ark testnet** before mainnet.
- [ ] **Verify every contract**, pairs included.
- [ ] **Use a controlled deployment signing process** — not a loose EOA key in a `.env`.
- [ ] **Publish the deployment manifest and canonical addresses.**
- [ ] **Coordinate with the Ark core team** on timing, addresses and announcements.

## Standing warnings

- ArkSwap's spot reserve price is **not a secure oracle**. It is manipulable within a single transaction. External lending or derivatives protocols must not trust an instantaneous pool price.
- Fee-on-transfer tokens must use the `SupportingFeeOnTransferTokens` router paths.
- Devnet mock stablecoins have unrestricted minting and no value. They must never be presented as real assets, and their mint privileges must never carry into production.
