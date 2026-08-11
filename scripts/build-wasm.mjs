import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'public', 'wasm');
mkdirSync(out, { recursive: true });

function has(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const jsFile = join(out, 'rweb_wasm.js');
const wasmFile = join(out, 'rweb_wasm_bg.wasm');

if (has('wasm-pack')) {
  console.log('[wasm] wasm-pack found; compiling Rust release build…');
  execFileSync('wasm-pack', ['build', 'wasm', '--target', 'web', '--release', '--out-dir', '../public/wasm', '--out-name', 'rweb_wasm'], {
    cwd: root,
    stdio: 'inherit',
  });
} else {
  console.warn('[wasm] wasm-pack not found; building static JS fallback. Install Rust + wasm-pack for the Rust engine.');
  if (existsSync(wasmFile)) rmSync(wasmFile);
  writeFileSync(jsFile, `export default async function init(){ throw new Error('Rust WASM bundle was not built. Install wasm-pack and rerun npm run build.'); }\nexport class Simulation { constructor(){ throw new Error('WASM unavailable'); } }\n`);
}
