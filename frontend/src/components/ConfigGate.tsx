'use client';

import {chainConfigProblems} from '@/config/chain';
import {contractConfigProblems} from '@/config/contracts';

/**
 * Blocks the app until Ark network values and ArkSwap addresses are configured.
 *
 * llm.txt s3/s57 forbid inventing network values, so there are no fallbacks to
 * fall back to. Rendering a swap form against an unconfigured chain would invite
 * users to approve tokens to a zero or wrong address.
 */
export function ConfigGate({children}: {children: React.ReactNode}) {
  const problems = [...chainConfigProblems(), ...contractConfigProblems()];
  if (problems.length === 0) return <>{children}</>;

  return (
    <div className="card">
      <div className="card__header">
        <h2 className="card__title">Configuration required</h2>
      </div>
      <div className="card__pad" style={{paddingTop: 0}}>
        <p className="muted" style={{marginTop: 0, fontSize: 14, lineHeight: 1.6}}>
          ArkSwap has no hardcoded network or contract addresses. Set these in{' '}
          <code>frontend/.env.local</code> from Ark Constellation documentation and{' '}
          <code>deployments/ark-devnet.json</code>.
        </p>
      </div>
      <ul className="token-list" style={{maxHeight: 'none'}}>
        {problems.map((problem) => (
          <li key={problem.key}>
            <div style={{padding: 12}}>
              <code style={{fontSize: 13, color: 'var(--accent-hi)'}}>{problem.key}</code>
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
