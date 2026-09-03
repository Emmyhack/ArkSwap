# `packages/gointernal`

Shared Go packages for the ArkSwap analytics backend.

Go's `internal/` visibility is module-scoped, so code shared by `apps/api` and
`apps/indexer` lives in this module rather than an `internal/` directory neither
could import.

| Package | Responsibility | Status |
| --- | --- | --- |
| `models` | Domain types, exact decimal handling | done, tested |
| `processor` | Event normalisation (swap direction) | done, tested |
| `pricing` | USD price routes (llm.txt s23–24) | done, tested |
| `analytics` | TVL, volume, fees, APR (llm.txt s26–28) | done, tested |
| `config` | Env + deployment manifest loading | done, tested |
| `contracts` | ABIs and event decoders | done, tested |
| `chain` | JSON-RPC client, retries, reorg detection | next |
| `database` | pgx store, atomic block commits | next |
| `indexer` | Historical + live sync | next |
| `api` | chi handlers | next |

## Rules that shaped this code

- **No `float64` for money.** Raw amounts are `big.Int`; USD values are `big.Rat`
  and round exactly once, at the API boundary (llm.txt s5).
- **Unknown is not zero.** An unpriced token, an unknown decimal count, or a
  malformed swap yields `nil`, never a fabricated `0` that would silently
  understate TVL or volume.
- **Volume counts one side.** A $100 swap contributes ~$100, not $200 (llm.txt s27).
- **Stability is declared, not inferred.** A token is a USD anchor only if
  explicitly configured; symbol text is never trusted (llm.txt s23).
- **Prices are for display only.** They are pool spot prices, manipulable within
  a single transaction, and must never back liquidation or settlement (llm.txt s25).

```bash
go test ./...
```
