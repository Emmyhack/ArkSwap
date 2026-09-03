'use client';

import {chainConfigProblems} from '@/config/chain';
import {contractConfigProblems} from '@/config/contracts';

/**
 * Blocks the app until Ark network values and ArkSwap addresses are configured.
 *
 * llm.txt s3 and s57 forbid inventing network values, so the UI has no fallbacks
 * to fall back to. Rendering a swap form against an unconfigured chain would
 * invite users to approve tokens to a zero or wrong address, so the app refuses
 * to render one and says exactly what is missing instead.
 */
export function ConfigGate({children}: {children: React.ReactNode}) {
  const problems = [...chainConfigProblems(), ...contractConfigProblems()];
  if (problems.length === 0) return <>{children}</>;

  return (
    <div className="card">
      <div className="card__header">
        <h1 className="card__title">Configuration required</h1>
      </div>
      <p className="muted" style={{marginTop: 0, fontSize: 14, lineHeight: 1.6}}>
        ArkSwap has no hardcoded network or contract addresses. Set the values below in{' '}
        <code>frontend/.env.local</code> using real Ark Constellation devnet documentation and the
        addresses recorded in <code>deployments/ark-devnet.json</code>.
      </p>
      <ul className="token-list" style={{marginTop: 16}}>
        {problems.map((problem) => (
          <li key={problem.key}>
            <div style={{padding: '12px 4px'}}>
              <code style={{fontSize: 13}}>{problem.key}</code>
              <div className="token-list__meta" style={{marginTop: 4}}>
                {problem.hint}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
