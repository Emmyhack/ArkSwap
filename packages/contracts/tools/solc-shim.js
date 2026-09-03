#!/usr/bin/env node
/*
 * solc shim for Apple Silicon (and any host lacking an x86_64 solc).
 *
 * Upstream solc releases on the 0.5.x/0.6.x lines ship macOS binaries for
 * x86_64 only, so `solc-0.5.16` / `solc-0.6.6` cannot execute on arm64 without
 * Rosetta 2. This shim presents the official emscripten (solc-js) build of the
 * exact same compiler commit behind the standard solc CLI surface that Foundry
 * drives (`--version` and `--standard-json` on stdin).
 *
 * Solidity guarantees reproducible bytecode across platforms for a given
 * version + settings, and Blockscout/Etherscan verify using these same
 * emscripten builds, so artifacts match a native build byte-for-byte. This
 * matters here because ArkSwapPair's creation code determines the CREATE2
 * init-code hash baked into ArkSwapLibrary (llm.txt s7).
 *
 * Version is selected by ARKSWAP_SOLC_VERSION, set by the generated wrapper in
 * ~/.svm/<version>/solc-<version>. See tools/install-solc.sh.
 */
const path = require('path');

const version = process.env.ARKSWAP_SOLC_VERSION;
if (!version) {
  process.stderr.write('solc-shim: ARKSWAP_SOLC_VERSION is not set\n');
  process.exit(1);
}

const modulePath = path.join(__dirname, 'solc', version, 'node_modules', 'solc');
let solc;
try {
  solc = require(modulePath);
} catch (e) {
  process.stderr.write(
    'solc-shim: could not load solc ' + version + ' from ' + modulePath + '\n' +
      'Run: tools/install-solc.sh\n'
  );
  process.exit(1);
}

if (process.argv.includes('--version')) {
  process.stdout.write(
    'solc, the solidity compiler commandline interface\nVersion: ' + solc.version() + '\n'
  );
  process.exit(0);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  process.stdout.write(solc.compile(input));
});
