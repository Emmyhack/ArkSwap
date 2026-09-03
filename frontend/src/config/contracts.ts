import type {Address} from 'viem';

/**
 * ArkSwap deployed addresses (llm.txt s40).
 *
 * These are populated from `deployments/ark-devnet.json` after deployment and
 * supplied to the app as environment variables. Nothing is hardcoded: shipping a
 * placeholder address would risk users approving tokens to a contract that does
 * not exist, or worse, one an attacker controls.
 *
 *   NEXT_PUBLIC_WKASH_ADDRESS=
 *   NEXT_PUBLIC_ARKSWAP_FACTORY_ADDRESS=
 *   NEXT_PUBLIC_ARKSWAP_ROUTER_ADDRESS=
 */

/**
 * Each `process.env.NEXT_PUBLIC_*` read must be written out statically -- see the
 * note in `chain.ts`. A computed key resolves to `undefined` in the browser
 * bundle and breaks hydration.
 */
function address(value: string | undefined): Address | undefined {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : undefined;
}

export const WKASH_ADDRESS = address(process.env.NEXT_PUBLIC_WKASH_ADDRESS);
export const ARKSWAP_FACTORY_ADDRESS = address(process.env.NEXT_PUBLIC_ARKSWAP_FACTORY_ADDRESS);
export const ARKSWAP_ROUTER_ADDRESS = address(process.env.NEXT_PUBLIC_ARKSWAP_ROUTER_ADDRESS);

/**
 * keccak256 of ArkSwapPair creation code, for client-side CREATE2 pair derivation.
 *
 * Must match `ArkSwapLibrary.PAIR_INIT_CODE_HASH` and the value in
 * `deployments/ark-devnet.json`. If ArkSwapPair bytecode changes, regenerate with
 * `make init-code-hash` and update this constant, or every derived pair address
 * will be wrong (llm.txt s7, s40).
 */
export const PAIR_INIT_CODE_HASH =
  '0x30820c342fc28c16c80e536d138c0c5290a90de3583c2a126a9e19b519432e74' as const;

export function contractConfigProblems(): {key: string; hint: string}[] {
  const problems: {key: string; hint: string}[] = [];
  if (!WKASH_ADDRESS) {
    problems.push({
      key: 'NEXT_PUBLIC_WKASH_ADDRESS',
      hint: 'Canonical WKASH address. ArkSwap never deploys its own wrapper.',
    });
  }
  if (!ARKSWAP_FACTORY_ADDRESS) {
    problems.push({key: 'NEXT_PUBLIC_ARKSWAP_FACTORY_ADDRESS', hint: 'From deployments/ark-devnet.json.'});
  }
  if (!ARKSWAP_ROUTER_ADDRESS) {
    problems.push({key: 'NEXT_PUBLIC_ARKSWAP_ROUTER_ADDRESS', hint: 'From deployments/ark-devnet.json.'});
  }
  return problems;
}
