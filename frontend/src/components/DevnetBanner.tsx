export function DevnetBanner() {
  return (
    <div className="alert alert--warn" style={{marginTop: 0, marginBottom: 16}}>
      <strong>Ark Constellation devnet.</strong> Tokens marked{' '}
      <span className="badge badge--devnet">devnet</span> are test fixtures with unrestricted minting.
      They are not real stablecoins and have no value.
    </div>
  );
}
