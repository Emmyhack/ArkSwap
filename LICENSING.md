# ArkSwap V1 — licensing

**This file records a licensing conflict that needs an explicit decision from the
project owner. It is not legal advice.**

## The situation

ArkSwap V1 is a semantic fork of Uniswap V2:

| Upstream | License | ArkSwap files derived from it |
| --- | --- | --- |
| [Uniswap/v2-core](https://github.com/Uniswap/v2-core) | GPL-3.0 | `contracts/core/**` |
| [Uniswap/v2-periphery](https://github.com/Uniswap/v2-periphery) | GPL-3.0-or-later | `contracts/periphery/**` |
| [Uniswap/uniswap-lib](https://github.com/Uniswap/uniswap-lib) (`TransferHelper`) | GPL-3.0-or-later | `contracts/periphery/libraries/TransferHelper.sol` |

The repository root currently carries an **MIT** `LICENSE` (`Copyright (c) 2026
Olajumoke Emmanuel`), which predates the fork.

GPL-3.0 is a copyleft license. Files derived from it, and works distributed with
them, generally cannot be relicensed under MIT by a downstream forker. The root
MIT license therefore **does not accurately describe** `contracts/core/**` or
`contracts/periphery/**` as they currently stand.

Every derived source file already carries an accurate
`// SPDX-License-Identifier: GPL-3.0-or-later` header, and upstream attribution is
preserved in the contract-level NatSpec, per llm.txt's license requirement. The
open question is only what the **repository-level** license should say.

## What is actually GPL-derived

Derived from Uniswap (GPL-3.0-or-later):

- `contracts/core/` — factory, pair, LP token, `Math`, `SafeMath`, `UQ112x112`, interfaces
- `contracts/periphery/` — routers, `ArkSwapLibrary`, `SafeMath`, `TransferHelper`, interfaces
- `contracts/test/DeflatingERC20.sol` — mirrors the upstream periphery test fixture

Written for ArkSwap, not derived from Uniswap:

- `contracts/test/` (except `DeflatingERC20.sol`) — mocks, `WKASH9` (WETH9-derived, see below), harnesses
- `test/`, `script/`, `tools/`, `frontend/`

`contracts/test/WKASH9.sol` is a test double derived from
[gnosis/canonical-weth](https://github.com/gnosis/canonical-weth) (`WETH9.sol`),
which is GPL-3.0. It is never deployed.

## Options

1. **Relicense the repository as GPL-3.0-or-later.** Simplest and the most common
   choice for a Uniswap V2 fork. Replace the root `LICENSE` with
   `LICENSES/GPL-3.0.txt` and keep the copyright line.
2. **Keep MIT only for genuinely original directories** and make the licensing
   per-directory explicit, with the root `LICENSE` pointing at this file. The
   GPL-derived trees stay GPL-3.0-or-later regardless.
3. **Seek legal review** before publishing, if ArkSwap intends a proprietary or
   differently-licensed distribution.

Until this is decided, `LICENSES/` holds both texts, and the root `LICENSE` is
left untouched.

## Trademarks

Matching Uniswap's functionality and UX is permitted by llm.txt s50; using
Uniswap's name, logo, or branding assets is not. ArkSwap must not present itself
as Uniswap or claim affiliation.
