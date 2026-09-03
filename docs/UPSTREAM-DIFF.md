# ArkSwap V1 — deviations from Uniswap V2

llm.txt s57 requires every semantic deviation from upstream to be explained.
This is that list. It is exhaustive as of the current commit.

Upstream references:

- Core: <https://github.com/Uniswap/v2-core> (Solidity `=0.5.16`, GPL-3.0)
- Periphery: <https://github.com/Uniswap/v2-periphery> (Solidity `=0.6.6`, GPL-3.0-or-later)
- `TransferHelper`: <https://github.com/Uniswap/uniswap-lib>

**Nothing in llm.txt s54's "must not be changed without review" list has been
changed.** Swap fee math, `MINIMUM_LIQUIDITY`, the CREATE2 salt, pair sorting,
reserve types, reserve update logic, LP mint/burn math, the k-invariant check,
`feeOn` logic, permit mechanics, flash-swap callback *behaviour*, cumulative-price
logic, and the Router's slippage/deadline arguments are all byte-for-byte upstream.

---

## 1. Naming (no behavioural change)

| Upstream | ArkSwap |
| --- | --- |
| `UniswapV2Factory` | `ArkSwapFactory` |
| `UniswapV2Pair` | `ArkSwapPair` |
| `UniswapV2ERC20` | `ArkSwapERC20` |
| `UniswapV2Router01` | `ArkSwapRouter01` |
| `UniswapV2Router02` | `ArkSwapRouter02` |
| `UniswapV2Library` | `ArkSwapLibrary` |
| `IUniswapV2*` | `IArkSwap*` |
| `IWETH` | `IWKASH` |

Revert-string prefixes were renamed to match: `UniswapV2:` → `ArkSwap:`,
`UniswapV2Library:` → `ArkSwapLibrary:`, `UniswapV2Router:` → `ArkSwapRouter:`.

**Not renamed on purpose:** `ds-math-add-overflow` / `ds-math-sub-underflow` /
`ds-math-mul-overflow` (DappHub provenance) and `TransferHelper: *`. Existing
tooling matches on these strings.

**Consequence:** renaming changes `ArkSwapPair` creation bytecode, so the CREATE2
init-code hash differs from Uniswap's. See §5.

## 2. LP token metadata — changes the EIP-712 domain

`ArkSwapERC20`:

```solidity
string public constant name   = 'ArkSwap V1';   // upstream: 'Uniswap V2'
string public constant symbol = 'ARK-V1-LP';    // upstream: 'UNI-V2'
```

`DOMAIN_SEPARATOR` binds `keccak256(bytes(name))`, so ArkSwap LP permit
signatures are **not** interchangeable with Uniswap V2 LP permit signatures. That
is the intended consequence of the rebrand, and llm.txt s55 explicitly permits the
LP name/symbol change. The permit *mechanism* — typehash, nonce handling, deadline
check, `ecrecover` validation — is unmodified. Covered by
`test/core/LPToken.t.sol::test_domainSeparator`.

## 3. Flash-swap callback selector — **breaking for integrators**

```solidity
// upstream: IUniswapV2Callee.uniswapV2Call(address,uint,uint,bytes)
interface IArkSwapCallee {
    function arkSwapCall(address sender, uint amount0, uint amount1, bytes calldata data) external;
}
```

Arguments, ordering and call position inside `swap()` are identical; only the
4-byte selector differs. **A flash-swap integrator written against Uniswap V2 will
not receive ArkSwap callbacks until it renames its callback function.** This is
the only deviation that breaks source compatibility for third-party contracts, and
it is worth reconsidering if ArkSwap expects to inherit Uniswap V2 flash-swap
tooling. Covered by `test/core/Pair.t.sol::test_flashSwap*`.

## 4. `ArkSwapRouter02.WKASH()` — additive, non-breaking

Upstream Router02 exposes only `WETH()`. ArkSwap keeps `WETH()` (ABI
compatibility, llm.txt s12 option A) and adds:

```solidity
address public immutable override WETH;
address public immutable override WKASH;   // same value, Ark-native name
```

Both are assigned from the same constructor argument on adjacent lines. Two
immutables cost bytecode, not storage. Nothing reads `WKASH` internally, so the
addition cannot affect swap or liquidity behaviour. Rationale: llm.txt s30 asks
deployment verification to check whichever getter the fork exposes, and s41 asks
frontends never to show users "ETH"; a correctly named getter serves both without
breaking Uniswap-shaped integrations. Covered by
`test/periphery/Router.t.sol::test_routerConfiguration`.

**Naming note:** every `...ETH...` entry point moves native **KASH**. On Ark,
`msg.value` is KASH. The `ETH` in those names is inherited ABI terminology only,
and frontends must render it as KASH (llm.txt s41).

## 5. Pair init-code hash — recomputed, as required

```
PAIR_INIT_CODE_HASH = 0x30820c342fc28c16c80e536d138c0c5290a90de3583c2a126a9e19b519432e74
```

Because §1 changes `ArkSwapPair` bytecode, Uniswap's historical hash
(`0x96e8ac42...`) is invalid here and must never be copied (llm.txt s7). The value
above is `keccak256(type(ArkSwapPair).creationCode)` under the exact compiler
settings recorded in `foundry.toml` and `deployments/ark-devnet.json`.

Two tests gate it, and `script/DeployRouter.s.sol` refuses to broadcast if it drifts:

- `test/core/InitCodeHash.t.sol` — library constant matches compiled artifact, and matches the pinned value
- `test/core/PairAddress.t.sol` — `factory.createPair()` address equals `ArkSwapLibrary.pairFor()`, including under fuzzing over arbitrary token addresses

Regenerate with `make init-code-hash` after any bytecode or compiler-settings change.

## 6. `chainid` → `chainid()` in inline assembly

`ArkSwapERC20`'s constructor uses `chainId := chainid()` where upstream uses the
bare `chainid`. Solidity 0.5.16 accepts the bare form only as deprecated
"non-functional instruction" syntax and warns. Both compile to the identical
`CHAINID` opcode, so bytecode is unaffected; this only silences a warning.

## 7. Structural: periphery imports core interfaces

Upstream v2-periphery vendors its own copies of `IUniswapV2Factory` /
`IUniswapV2Pair`. ArkSwap imports `contracts/core/interfaces/` directly (their
pragma is `>=0.5.0`, so `=0.6.6` can consume them). This removes a class of
drift where the two copies disagree. No behavioural change.

## 8. `ArkSwapRouter01` is present but never deployed

Kept so the fork can be diffed against upstream file-for-file.
`ArkSwapRouter02` is the canonical periphery contract; no deployment script
references Router01 (llm.txt s13).

## 9. Compiler settings

| Setting | Value | Rationale |
| --- | --- | --- |
| core solc | `0.5.16` | exact upstream |
| periphery solc | `0.6.6` | exact upstream |
| optimizer | on, 999999 runs | matches upstream build config |
| `evm_version` | `istanbul` | the default for both 0.5.16 and 0.6.6, and the newest target 0.5.16 supports |
| `via_ir` | false | upstream did not use the IR pipeline |

Core and periphery were **not** modernised to 0.8.x. llm.txt s4 warns against
modernising while simultaneously changing behaviour; keeping the original
compilers keeps upstream audit history maximally applicable. A 0.8.x port would
be a materially modified protocol requiring fresh review.

### Compiler binaries on arm64

solc 0.5.16 and 0.6.6 ship macOS binaries for x86_64 only, and this machine has
no Rosetta 2. `tools/install-solc.sh` installs the **official emscripten
(solc-js) builds of the same compiler commits** — `0.5.16+commit.9c3226ce` and
`0.6.6+commit.6c089d02` — behind the solc CLI that Foundry drives. Solidity
guarantees reproducible bytecode across platforms for a given version and
settings, and Blockscout/Etherscan verify against these same emscripten builds,
so artifacts match a native build. Any pre-existing native binary is preserved as
`solc-<version>.native.bak` rather than deleted.

## 10. Test-only additions (never deployed)

`contracts/test/` — `MockERC20`, `MockUSDC`, `MockUSDT`, `DeflatingERC20`,
`WKASH9`, `ArkSwapLibraryHarness`, `FlashBorrower`, `ReentrantCallee`.

`WKASH9` is a WETH9-derived test double so the local suite can exercise
wrap/unwrap. **ArkSwap must always be pointed at the canonical Ark WKASH
deployment and must never deploy its own wrapper** (llm.txt s14, s57). No
deployment script deploys `WKASH9`.

---

## Protocol parameters — unchanged from Uniswap V2

| Parameter | Value |
| --- | --- |
| Trade fee | 0.30% (`997/1000`) |
| Protocol fee | disabled (`feeTo == address(0)`) |
| Protocol fee share when enabled | 1/6 of growth in `sqrt(k)` |
| `MINIMUM_LIQUIDITY` | 1000, burned to `address(0)` |
| Reserve type | `uint112` |
| CREATE2 salt | `keccak256(abi.encodePacked(token0, token1))` |
