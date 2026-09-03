# ArkSwap V1 — static analysis review

llm.txt s23 requires Slither findings to be **reviewed**, and explicitly says not
to dismiss a finding merely because the code came from Uniswap. This file records
the disposition of every detector that fired.

Reproduce with `make slither`.

```
contracts/core       (solc 0.5.16) — 11 contracts, 102 detectors, 42 results
contracts/periphery  (solc 0.6.6)  — 11 contracts, 102 detectors, 58 results
```

Slither cannot analyse all three compiler trees at once, so each is run against
the compiler its pragma pins.

**Status: reviewed, no code changes made.** Every finding is either a known
upstream Uniswap V2 pattern with a compensating control, or informational. Where
a finding is genuinely mitigated somewhere other than the contract, the
mitigation is named and tested.

---

## Core (`contracts/core`)

### `reentrancy-no-eth`, `reentrancy-benign`, `reentrancy-events` — mitigated by `lock`

Fires on `ArkSwapPair.burn`, `ArkSwapPair.swap` and `ArkSwapFactory.createPair`.

`burn` and `swap` perform external token calls (and, in `swap`, the
`arkSwapCall` flash-swap callback) before writing `reserve0`/`reserve1`/
`blockTimestampLast`/`kLast`. Slither does not model the `lock` modifier, so it
reports the write-after-call pattern.

Every affected function is `lock`-guarded, and the guard is the reason the
pattern is safe. Because ArkSwap must not rely on a static analyser understanding
that, the guard is tested directly — an attacker contract re-enters from inside
`arkSwapCall` against all three entry points:

- `test/core/Pair.t.sol::test_reentrancyLockBlocksSwap`
- `test/core/Pair.t.sol::test_reentrancyLockBlocksSync`
- `test/core/Pair.t.sol::test_reentrancyLockBlocksSkim`

All three revert with `ArkSwap: LOCKED`.

`ArkSwapFactory.createPair` calls `initialize` on a contract it just deployed via
CREATE2 with known bytecode, before writing `getPair`. The callee cannot be
attacker-controlled: its code is fixed by the init-code hash, which
`test/core/InitCodeHash.t.sol` pins.

### `weak-prng` — not a PRNG

`blockTimestamp = uint32(block.timestamp % 2**32)` in `_update`. This is the
deliberate 32-bit timestamp truncation that makes the TWAP accumulator overflow
cleanly roughly every 136 years; no randomness is derived from it. Upstream
Uniswap V2 behaviour, unchanged (llm.txt s54).

### `incorrect-equality` — both correct

- `_totalSupply == 0` in `mint` distinguishes the first deposit, which must mint `sqrt(k) - MINIMUM_LIQUIDITY` and lock the floor. An inequality would be wrong.
- `data.length == 0` in `_safeTransfer` is the standard non-compliant-ERC20 accommodation: tokens returning no data are accepted, tokens returning `false` are rejected.

Covered by `test_mintInitialLiquidity`, `test_minimumLiquidityLocked`.

### `timestamp` — inherent to the design

Comparisons against `block.timestamp` for the TWAP accumulator and permit
deadlines. Miner/validator timestamp influence is bounded and is the accepted
tradeoff in the V2 oracle design. **This is exactly why ArkSwap's spot price must
not be treated as a secure oracle** (llm.txt s48) — see the warning below.

### `low-level-calls`, `assembly` — required

`token.call(...)` in `_safeTransfer` is required to tolerate non-compliant
ERC-20s. The `create2` assembly block in `createPair` is required for
deterministic pair addressing, and its salt is unmodified from upstream.

### `missing-zero-check` — factory `feeToSetter`

`ArkSwapFactory`'s constructor does not reject `address(0)` for `feeToSetter`.
Upstream behaviour, left unchanged. Deploying with a zero `feeToSetter` would
permanently freeze protocol-fee configuration — it could never enable fees. It
could not endanger user funds. `script/DeployFactory.s.sol` requires
`FEE_TO_SETTER` to be a non-zero address and asserts it after deployment.

### `naming-convention`, `too-many-digits`, `solc-version`, `pragma` — informational

`DOMAIN_SEPARATOR`, `PERMIT_TYPEHASH` and `MINIMUM_LIQUIDITY` are
deliberately-uppercase EIP-2612 / protocol constants. `too-many-digits` fires on
`type(ArkSwapPair).creationCode`, not a literal. `solc-version`/`pragma` flag
0.5.16 as old — retaining the exact upstream compiler is a deliberate decision
(llm.txt s4); see `docs/UPSTREAM-DIFF.md` §9.

---

## Periphery (`contracts/periphery`)

### `unchecked-transfer` — safe by construction

`IArkSwapPair(pair).transferFrom(msg.sender, pair, liquidity)` in
`removeLiquidity` ignores the boolean return. The callee is always an
`ArkSwapPair`, i.e. `ArkSwapERC20`, whose `transferFrom` either reverts
(`ds-math-sub-underflow` on insufficient balance or allowance) or returns `true`.
It is never an arbitrary token. Upstream behaviour, unchanged.

Covered by `test_removeLiquidity`, `test_lpTransferFromRevertsWithoutAllowance`.

### `unused-return` — deliberate in every case

- `sortTokens(...)` discarding `token1`: only `token0` is needed to orient reserves.
- `getReserves()` discarding `blockTimestampLast`: not needed for quoting.
- `IArkSwapFactory(factory).createPair(...)` discarding the new address: the router immediately re-derives it with `ArkSwapLibrary.pairFor`. That equivalence is the single most important property in the system and is gated by `test/core/PairAddress.t.sol`, including under fuzzing over arbitrary token addresses.

### `missing-zero-check` — router constructor

`ArkSwapRouter02`'s constructor does not reject a zero `_factory` or `_WKASH`.
Upstream behaviour, left unchanged deliberately: llm.txt s54 lists the Router as
review-gated, and adding a require would diverge from the audited upstream
bytecode for a condition that is fully preventable at deployment time.

The compensating control is in `script/DeployRouter.s.sol`, which before
broadcasting requires that:

- `ARKSWAP_FACTORY_ADDRESS` and `WKASH_ADDRESS` are non-zero,
- both have deployed code,
- WKASH reports `symbol() == "WKASH"` and `decimals() == 18`,
- the compiled pair init-code hash matches the pinned value,

and after broadcasting asserts `router.factory()`, `router.WETH()` and
`router.WKASH()` all match what was intended.

### `reentrancy-balance` — WKASH unwrap path

Fires where the router calls `IWKASH(WETH).withdraw(...)` then
`safeTransferETH`. The router holds no user funds between transactions; the
invariant suite asserts this continuously:

- `invariant_G_routerHoldsNoFunds` — router holds zero native KASH, WKASH, mUSDC, mUSDT and LP tokens
- `invariant_H_wkashFullyBackedByNativeKash` — WKASH stays 1:1 backed

`receive()` additionally restricts inbound native KASH to the WKASH contract, and
`test_routerOnlyAcceptsNativeFromWkashReceivePath` proves a direct transfer fails.

### `calls-loop` — inherent to multi-hop routing

`_swap` and `_swapSupportingFeeOnTransferTokens` call `swap()` on each pair along
the path. This is what multi-hop routing is. Path length is caller-supplied and
bounded by gas. Covered by `test_multiHopSwap`.

### `external-function`, `naming-convention`, `solc-version`, `pragma` — informational

`WETH()`'s naming is the intentional ABI-compatibility choice (llm.txt s12
option A); see `docs/UPSTREAM-DIFF.md` §4.

---

## Standing warnings (not Slither findings)

These come from llm.txt s48 and remain true regardless of static analysis:

- **ArkSwap's spot reserve price is not a secure oracle.** It is manipulable within a single transaction via flash swaps. External lending or derivatives protocols must not trust an instantaneous ArkSwap pool price. The `price0CumulativeLast`/`price1CumulativeLast` accumulators are TWAP *primitives*, and safe use requires the consumer to sample them over a meaningful window.
- **Fee-on-transfer and rebasing tokens** must use the `SupportingFeeOnTransferTokens` router paths. The standard paths correctly revert (`ArkSwap: K`) rather than silently shortchanging the user — see `test_feeOnTransferRevertsOnStandardPath`.
- **ERC-777 / callback tokens** can re-enter during `swap`'s optimistic transfer. The `lock` modifier blocks re-entry into the same pair; cross-pair interactions remain the integrator's responsibility.
- **Token spoofing / malicious token lists** are a frontend concern. ArkSwap's registry is an explicit allowlist in `frontend/src/config/tokens.ts`, and devnet mocks carry a mandatory "no real value" badge.
- **`feeToSetter` privilege** covers protocol-fee configuration only. It cannot seize liquidity, pause pairs, blacklist, or alter swap math. It should be a multisig for any long-lived deployment (llm.txt s25).

## What this review is not

This is a static-analysis triage, not a security audit. llm.txt s19 and s53
require a formal audit and a full readiness review before testnet or mainnet.
**ArkSwap V1 is not production-ready on the strength of this document.**
