# ArkSwap

A Uniswap V2-style decentralized exchange built for Ark Constellation, enabling
permissionless token swaps and liquidity through KASH, WKASH, and EVM assets.

ArkSwap V1 is a **minimal semantic fork** of Uniswap V2: constant-product
(`x * y = k`) pools, a 0.30% trade fee, deterministic CREATE2 pair addresses, and
a Router02-shaped periphery. The economic model and core math are unmodified.
Every deviation from upstream is enumerated in [`docs/UPSTREAM-DIFF.md`](docs/UPSTREAM-DIFF.md).

> **Status: not deployed.** The contracts build and the full suite passes, but
> deployment is blocked on Ark Constellation network values and a canonical WKASH
> address. See [Deployment status](#deployment-status).

---

## Layout

```
contracts/core/        ArkSwapFactory, ArkSwapPair, ArkSwapERC20   (solc 0.5.16)
contracts/periphery/   ArkSwapRouter01/02, ArkSwapLibrary          (solc 0.6.6)
contracts/test/        mocks and fixtures — never deployed         (solc 0.8.24)
test/                  unit, fuzz and invariant suites             (solc 0.8.24)
script/                deployment + smoke-test scripts
frontend/              Next.js + wagmi/viem swap and pool UI
tools/                 solc shims, init-code-hash generator, slither runner
deployments/           deployment manifest (template until deployed)
docs/                  upstream diff, static-analysis review
```

Core and periphery keep their **original upstream compiler versions**. Modernising
to 0.8.x while also changing behaviour is exactly what llm.txt s4 warns against,
and it would invalidate the applicability of upstream audit history. The 0.8.x
test suite reaches across the version boundary by deploying the real compiled
artifacts with `vm.deployCode`, so tests exercise the exact bytecode destined for Ark.

## Quick start

```bash
make install     # forge-std + pinned solc 0.5.16 / 0.6.6
make build
make test
```

On Apple Silicon, `make install` is required: solc 0.5.16 and 0.6.6 ship x86-only
macOS binaries. `tools/install-solc.sh` installs the official emscripten builds of
the **same compiler commits** behind the solc CLI Foundry drives, which produce
identical bytecode. Any existing native binary is preserved as
`solc-<version>.native.bak`. Details in `docs/UPSTREAM-DIFF.md` §9.

## Tests

```
129 passed, 0 failed
```

| Suite | What it covers |
| --- | --- |
| `test/core/InitCodeHash.t.sol` | library constant matches compiled pair bytecode |
| `test/core/PairAddress.t.sol` | `createPair()` == `pairFor()`, incl. fuzzed token addresses |
| `test/core/Factory.t.sol` | pair creation, sorting, duplicates, `feeToSetter` privilege |
| `test/core/Pair.t.sol` | mint/burn/swap, k-invariant, TWAP, reentrancy, flash swaps, protocol fee |
| `test/core/LPToken.t.sol` | ERC-20 behaviour, EIP-2612 permit, replay protection |
| `test/periphery/Library.t.sol` | quoting, rounding direction, 0.30% fee recovery |
| `test/periphery/Router.t.sol` | liquidity, all six swap paths, slippage, deadlines, KASH wrap/unwrap, fee-on-transfer |
| `test/fuzz/Swap.fuzz.t.sol` | k never decreases, no free output, uint112 bounds, proportional minting |
| `test/invariant/` | invariants A–H from llm.txt s22 |

`make test-deep` runs the pre-deployment gate: 10,000 fuzz runs and 1024×256
invariant runs. `make slither` runs static analysis; findings are triaged in
[`docs/SECURITY-REVIEW.md`](docs/SECURITY-REVIEW.md).

## The pair init-code hash

```
PAIR_INIT_CODE_HASH = 0x30820c342fc28c16c80e536d138c0c5290a90de3583c2a126a9e19b519432e74
```

Renaming `UniswapV2Pair` to `ArkSwapPair` changes creation bytecode, so Uniswap's
historical hash is invalid here and must never be copied. If this constant ever
drifts from the compiled artifact, `ArkSwapLibrary.pairFor()` derives addresses no
pair occupies and router swaps break.

Three independent guards enforce it: `InitCodeHash.t.sol`, `PairAddress.t.sol`, and
a hard precondition in `script/DeployRouter.s.sol`. Regenerate with
`make init-code-hash` after **any** change to pair bytecode or compiler settings,
then re-run the tests and re-review.

## KASH, WKASH, and the `ETH` names

ArkSwap runs in **ABI-compatibility mode** (llm.txt s12, option A). The router
keeps Uniswap's function names — `addLiquidityETH`, `swapExactETHForTokens`, and
so on — so Uniswap-shaped frontends and tooling work unchanged.

**On Ark, those functions move native KASH.** `msg.value` is KASH. The `ETH` in
the ABI is inherited terminology and nothing more. The router also exposes
`WKASH()` alongside `WETH()`; both return the same canonical WKASH address.

The UI must always say KASH, never ETH. Native KASH and WKASH remain distinct
assets in the token selector: choosing one never silently gives the other.

## Deployment status

**Blocked. Nothing has been deployed.**

Two prerequisites are missing, and llm.txt s3/s14/s57 forbid inventing either:

1. **Ark Constellation network values** — RPC URL, EVM chain id, and Blockscout endpoints are not available in this repository or its environment.
2. **A canonical WKASH address** — the sibling `kashwrappedtoken` project's manifest is still a template (`_status: "TEMPLATE — NOT YET DEPLOYED"`, `canonical.approvedByArkCoreTeam: false`). ArkSwap must never deploy or accept a substitute wrapper.

The scripts are written to fail loudly rather than guess. Each one requires its
env vars, asserts `block.chainid == ARK_EVM_CHAIN_ID` before broadcasting, and
verifies WKASH's `symbol()`/`decimals()` on-chain.

Once both prerequisites exist, fill `.env` from `.env.example` and run in order:

```bash
make deploy-mocks      # 4.  devnet mock stablecoins
make deploy-factory    # 5.  ArkSwapFactory
make gate              # 7.  MANDATORY: init-code hash + pairFor == createPair
make deploy-router     # 8.  ArkSwapRouter02 (re-runs the gate itself)
make create-pairs      # 11. WKASH/mUSDC and friends
make seed              # 13. seed liquidity
make smoke             # 14. live swaps, both directions
make verify-factory verify-router   # 16. Blockscout
```

Then record everything in `deployments/ark-devnet.json` and configure the
frontend from it.

## Frontend

```bash
cd frontend
cp .env.example .env.local   # fill from deployments/ark-devnet.json
npm install && npm run dev
```

Next.js + TypeScript + wagmi + viem, with `/swap` and `/pool` routes. There are
**no hardcoded addresses**: with configuration missing the app renders a blocking
"Configuration required" screen naming each absent variable, rather than
presenting a swap form that could send funds nowhere.

Quotes are computed locally from pool reserves for display, but execution is
always bounded on-chain by `amountOutMin` / `amountInMax`. `amountOutMin = 0` is
never sent: zero is not offered as a slippage preset and is rejected on entry.
Price impact is shown separately from the 0.30% LP fee, and trades above 15%
impact are blocked outright.

## Security

- **ArkSwap's spot price is not a secure oracle.** It is manipulable within a single transaction. External protocols must not trust an instantaneous pool price; the cumulative-price accumulators are TWAP primitives requiring a meaningful sampling window.
- **Protocol fee ships disabled** (`feeTo == address(0)`). The full LP fee stays in the pool. Enabling it requires an economics proposal, a treasury decision, and review (llm.txt s49).
- **`feeToSetter` is scoped to fee configuration only.** It cannot seize liquidity, pause pairs, blacklist, or change swap math. Use a multisig for any long-lived deployment.
- **ArkSwap is non-custodial.** No backend ever holds user funds or signs user swaps. The invariant suite asserts the router retains nothing.
- **Devnet mocks are not real assets.** mUSDC and mUSDT have unrestricted minting and no value; the UI badges them accordingly.

`docs/SECURITY-REVIEW.md` is a static-analysis triage, **not an audit**. A formal
audit and the full readiness review in llm.txt s53 are required before testnet or
mainnet.

## Licensing

ArkSwap derives from Uniswap V2, which is GPL-3.0(-or-later). Every derived file
carries an accurate SPDX header and upstream attribution.

**The repository root currently carries an MIT `LICENSE`, which does not
accurately describe the GPL-derived contracts.** This needs an explicit decision —
see [`LICENSING.md`](LICENSING.md). Both license texts are in `LICENSES/`.

ArkSwap matches Uniswap's functionality and UX; it does not use Uniswap's name,
logo, or branding, and claims no affiliation.
