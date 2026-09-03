# ArkSwap V1
.PHONY: help install build test test-deep fmt lint init-code-hash slither gate \
        deploy-mocks deploy-factory deploy-router create-pairs seed smoke verify-factory verify-router clean

SHELL := /bin/bash

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install forge-std and the pinned solc-js compilers (0.5.16 / 0.6.6)
	forge install foundry-rs/forge-std || true
	./tools/install-solc.sh

build: ## Compile all three compiler trees
	forge build

test: ## Run the full suite
	forge test -vv

test-deep: ## Pre-deployment gate: 10k fuzz runs, 1024 invariant runs (llm.txt s21, s53)
	FOUNDRY_PROFILE=deep forge test -vv

fmt: ## Check formatting
	forge fmt --check

init-code-hash: ## Recompute PAIR_INIT_CODE_HASH and write it into ArkSwapLibrary (llm.txt s7)
	./tools/gen-init-code-hash.sh

slither: ## Static analysis (llm.txt s23)
	./tools/run-slither.sh

## ---------------------------------------------------------------------------
## gate: everything that must pass before the Router may be deployed.
## ---------------------------------------------------------------------------
gate: build ## MANDATORY pre-deployment gate (llm.txt s7, s20, s29)
	@echo "==> pair init-code hash + deterministic pair addressing"
	forge test --match-path 'test/core/{InitCodeHash,PairAddress}.t.sol' -vv
	@echo "==> full suite"
	forge test
	@echo
	@echo "GATE PASSED. Router deployment is permitted."

## ---------------------------------------------------------------------------
## Deployment. Every target below requires a populated .env and refuses to run
## against a chain whose id does not match ARK_EVM_CHAIN_ID (llm.txt s3, s26).
## ---------------------------------------------------------------------------
# --gas-estimate-multiplier 300
#   Ark's estimates for these scripts come from the in-simulation state, where
#   storage slots touched by an earlier transaction in the same run are already
#   warm. On-chain those same slots are cold (EIP-2929: 2100 vs 100 for SLOAD,
#   2600 vs 100 for account access), so a swap can need ~25k more gas than was
#   estimated. When that happens the pair's SSTORE in _update() is left with
#   <= 2300 gas and trips the EIP-2200 reentrancy sentry, which surfaces as
#   `ReentrancySentryOOG` rather than a plain out-of-gas. Observed on the
#   mUSDC -> KASH leg of the smoke test: estimated 115,976, actually needed
#   ~140,092. The multiplier gives ample headroom; unused gas is refunded.
#
# --slow
#   Send transactions one at a time, waiting for each receipt, so a later
#   transaction never estimates against state an earlier one has not committed.
FORGE_SCRIPT = forge script --rpc-url "$$ARK_RPC_URL" --broadcast --slow \
                 --gas-estimate-multiplier 300 -vvv

deploy-mocks: ## Step 4: deploy devnet mock stablecoins
	source .env && $(FORGE_SCRIPT) script/DeployMocks.s.sol:DeployMocks

deploy-factory: ## Step 5: deploy ArkSwapFactory
	source .env && $(FORGE_SCRIPT) script/DeployFactory.s.sol:DeployFactory

deploy-router: gate ## Step 8: deploy ArkSwapRouter02 (runs the gate first)
	source .env && $(FORGE_SCRIPT) script/DeployRouter.s.sol:DeployRouter

create-pairs: ## Steps 11-12: create the initial pairs
	source .env && $(FORGE_SCRIPT) script/CreatePairs.s.sol:CreatePairs

seed: ## Step 13: seed WKASH/mUSDC liquidity
	source .env && $(FORGE_SCRIPT) script/SeedLiquidity.s.sol:SeedLiquidity

smoke: ## Steps 14-15: live devnet swaps both directions
	source .env && $(FORGE_SCRIPT) script/SmokeTest.s.sol:SmokeTest

## ---------------------------------------------------------------------------
## Blockscout verification (llm.txt s36)
## ---------------------------------------------------------------------------
verify-factory: ## Verify ArkSwapFactory on Blockscout
	source .env && forge verify-contract "$$ARKSWAP_FACTORY_ADDRESS" \
	  contracts/core/ArkSwapFactory.sol:ArkSwapFactory \
	  --verifier blockscout --verifier-url "$$ARK_BLOCKSCOUT_API_URL" \
	  --compiler-version v0.5.16+commit.9c3226ce --num-of-optimizations 999999 \
	  --constructor-args $$(cast abi-encode "constructor(address)" "$$FEE_TO_SETTER") --watch

verify-router: ## Verify ArkSwapRouter02 on Blockscout
	source .env && forge verify-contract "$$ARKSWAP_ROUTER_ADDRESS" \
	  contracts/periphery/ArkSwapRouter02.sol:ArkSwapRouter02 \
	  --verifier blockscout --verifier-url "$$ARK_BLOCKSCOUT_API_URL" \
	  --compiler-version v0.6.6+commit.6c089d02 --num-of-optimizations 999999 \
	  --constructor-args $$(cast abi-encode "constructor(address,address)" "$$ARKSWAP_FACTORY_ADDRESS" "$$WKASH_ADDRESS") --watch

verify-mocks: ## Verify the devnet mock stablecoins on Blockscout
	source .env && forge verify-contract "$$MOCK_USDC_ADDRESS" contracts/test/MockUSDC.sol:MockUSDC \
	  --verifier blockscout --verifier-url "$$ARK_BLOCKSCOUT_API_URL" \
	  --compiler-version v0.8.24+commit.e11b9ed9 --num-of-optimizations 999999 \
	  --constructor-args $$(cast abi-encode "constructor(uint256)" 0) --watch
	source .env && forge verify-contract "$$MOCK_USDT_ADDRESS" contracts/test/MockUSDT.sol:MockUSDT \
	  --verifier blockscout --verifier-url "$$ARK_BLOCKSCOUT_API_URL" \
	  --compiler-version v0.8.24+commit.e11b9ed9 --num-of-optimizations 999999 \
	  --constructor-args $$(cast abi-encode "constructor(uint256)" 0) --watch

## Pairs are CREATE2-deployed by the factory and take no constructor arguments.
## This fails with "The address is not a smart contract" until the explorer has
## indexed contract creations from internal transactions. Retry once it has.
verify-pairs: ## Verify deployed ArkSwapPair contracts on Blockscout
	source .env && for p in $$(python3 -c "import json;print(' '.join(json.load(open('deployments/ark-devnet.json'))['pairs'].values()))"); do \
	  echo "--- $$p ---"; \
	  forge verify-contract "$$p" contracts/core/ArkSwapPair.sol:ArkSwapPair \
	    --verifier blockscout --verifier-url "$$ARK_BLOCKSCOUT_API_URL" \
	    --compiler-version v0.5.16+commit.9c3226ce --num-of-optimizations 999999 --watch || true; \
	done

## Attest the deployed pairs by bytecode comparison, for as long as the explorer
## cannot register factory-created contracts (see tools/verify-pairs-onchain.sh).
verify-pairs-local: ## Prove deployed pairs match the compiled ArkSwapPair bytecode
	set -a && source .env && set +a && ./tools/verify-pairs-onchain.sh

verify-all: verify-factory verify-router verify-mocks verify-pairs ## Verify every deployed contract

clean:
	forge clean
