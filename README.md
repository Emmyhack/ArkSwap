# ArkSwap

A Uniswap V2-style decentralized exchange built for Ark Constellation, enabling
permissionless token swaps and liquidity through KASH, WKASH, and EVM assets.

ArkSwap V1 is a **minimal semantic fork** of Uniswap V2: constant-product
(`x * y = k`) pools, a 0.30% trade fee, deterministic CREATE2 pair addresses, and
a Router02-shaped periphery. The economic model and core math are unmodified.
Every deviation from upstream is enumerated in [`docs/UPSTREAM-DIFF.md`](docs/UPSTREAM-DIFF.md).

> **Status: deployed to Ark Constellation devnet. Not production-ready.**
> A formal audit, a multisig `feeToSetter` and Ark core-team coordination remain
> outstanding — see [`docs/PRODUCTION-READINESS.md`](docs/PRODUCTION-READINESS.md).

---

## Layout

```
apps/
  web/                  Next.js frontend (@arkswap/web)
  api/                  Go REST API            — see "Backend status"
  indexer/              Go blockchain indexer  — see "Backend status"
packages/
  contracts/            Foundry project (core solc 0.5.16, periphery 0.6.6)
  abis/                 GENERATED ABIs + pair init-code hash
  addresses/            Canonical deployment manifests
  config/               Shared chain and token configuration
  types/                Shared analytics API types
  sdk/                  AMM math + analytics API client
infra/
  postgres/migrations/  SQL migrations
  docker/               Dockerfiles
scripts/                generate-abis, deploy, verify, seed-liquidity
docs/                   upstream diff, security review, readiness
```

pnpm workspaces + Turborepo orchestrate the TypeScript side. Foundry stays the
contract toolchain and Go modules stay independent — neither is forced into pnpm.

**One source of truth per fact.** ABIs are generated from the compiled artifacts
into `packages/abis`; addresses live only in `packages/addresses`; the pair
init-code hash is generated, never hand-copied. `apps/web` consumes all three
rather than keeping its own copies.

```
packages/contracts ──> packages/abis ──┐
                  └──> packages/addresses ──┼──> apps/web, apps/api, apps/indexer
                                            └──> PostgreSQL (indexer)
```

### Commands

```bash
pnpm install
pnpm web:dev            # frontend on :3000
pnpm contracts:build
pnpm contracts:test
pnpm contracts:gate     # MANDATORY init-code-hash + pairFor gate
pnpm abis:generate      # regenerate packages/abis from Foundry artifacts
pnpm build              # turbo: all TS packages
pnpm typecheck
```

Contract work still runs through the Makefile in `packages/contracts`
(`make gate`, `make deploy-router`, `make verify-all`, `make verify-pairs-local`).

### Compilers

Core and periphery keep their **original upstream compiler versions**. Modernising
to 0.8.x while also changing behaviour is exactly what llm.txt s4 warns against.
The 0.8.x test suite reaches across the version boundary by deploying the real
compiled artifacts with `vm.deployCode`.

On Apple Silicon, `packages/contracts/tools/install-solc.sh` is required: solc
0.5.16 and 0.6.6 ship x86-only macOS binaries. It installs the official emscripten
builds of the **same compiler commits** behind the solc CLI Foundry drives. The
generated `~/.svm` wrappers embed an absolute path, so **re-run it after moving
the repository**.

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

## Deployed — Ark Constellation devnet (chain id 9000)

| Contract | Address | Verified |
| --- | --- | --- |
| ArkSwapFactory | `0x594f74aDCa63Af06d10Ee06fEe8F237DBb560e06` | yes |
| ArkSwapRouter02 | `0xF2a7fD4072d70D2e7eDF5a5eB653965CEe0871b6` | yes |
| WKASH (canonical) | `0x6792d2fD02d8A55c543F627d0e90526f9278C6d6` | yes |
| mUSDC (devnet mock) | `0xC8d15f9A42Ee3107ab1257E38199e3Bf899dCfB3` | yes |
| mUSDT (devnet mock) | `0x073D643F712C136D2e7F71d683d9E26b6EFC845b` | yes |
| WKASH/mUSDC pair | `0x022850A98a241FF9E3978Cd1B596295cF1451719` | bytecode-attested¹ |
| WKASH/mUSDT pair | `0x5575dB26621DEe45d6067D647c58648F98DCf160` | bytecode-attested¹ |
| mUSDC/mUSDT pair | `0x6120C976169e4fEcfD7b5ab1C024f4015a60daB4` | bytecode-attested¹ |

`feeTo` is `address(0)` — the protocol fee is disabled and the full 0.30% stays
with liquidity providers. Full metadata, transaction hashes and blocks are in
[`deployments/ark-devnet.json`](deployments/ark-devnet.json).

¹ **The pairs cannot be verified on this explorer, and the cause is upstream of
ArkSwap.** The Ark devnet JSON-RPC node exposes no trace API — `debug_traceTransaction`,
`trace_transaction`, `debug_traceBlockByNumber` and `trace_block` all return
*"does not exist/is not available"*. Blockscout's internal-transaction fetcher
needs one of them to see the factory's CREATE2 call, so it never records a
creation for these addresses and rejects verification server-side with *"The
address is not a smart contract"* — before any source is compared.

Instead, the deployment is attested by bytecode. `ArkSwapPair` has no immutables
and no constructor arguments, so every pair the factory deploys must carry
byte-identical runtime code. All three do, and it matches this repository's
compiled artifact exactly:

```
keccak256(runtime bytecode) = 0x2ecfe3b325ceceff28477c0c7f82692713e4c2e8d08a11d1ffc535c19af1d75f
solc 0.5.16 · optimizer 999999 runs · evmVersion istanbul
```

Reproduce it yourself with `make verify-pairs-local`. Once the Ark team enables
tracing on the node (in Cosmos EVM, add `debug` to `--json-rpc.api` and let
Blockscout re-index), `make verify-pairs` will publish source in the usual way.

**Live checks performed:** KASH → mUSDC and mUSDC → KASH swaps, a multi-hop
mUSDT → WKASH → mUSDC route that delivered exactly the quoted amount, and a 25%
liquidity removal that returned principal plus accrued fees. The off-chain
`ArkSwapLibrary.pairFor` derivation was checked against the deployed factory for
all three pairs.

### Reproducing the deployment

Fill `.env` from `.env.example`, then:

```bash
make deploy-mocks      # 4.  devnet mock stablecoins
make deploy-factory    # 5.  ArkSwapFactory
make gate              # 7.  MANDATORY: init-code hash + pairFor == createPair
make deploy-router     # 8.  ArkSwapRouter02 (re-runs the gate itself)
make create-pairs      # 11. WKASH/mUSDC and friends
make seed              # 13. seed liquidity
make smoke             # 14. live swaps, both directions
make verify-all        # 16. Blockscout
```

Deployment targets run with `--slow --gas-estimate-multiplier 300`. Ark's
in-simulation gas estimates assume warm storage and under-estimate swaps by
roughly 25k gas; without the headroom a swap can leave the pair's `SSTORE` with
≤ 2300 gas and trip the EIP-2200 sentry as `ReentrancySentryOOG`. See
`docs/PRODUCTION-READINESS.md`.

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
