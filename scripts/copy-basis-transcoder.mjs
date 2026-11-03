#!/usr/bin/env node
// Copies the Basis Universal transcoder that KTX2Loader fetches at runtime into public/assets/basis/.
import fs from 'node:fs';
import path from 'node:path';

const SOURCE_DIR = path.join(process.cwd(), 'node_modules/three/examples/jsm/libs/basis');
const TARGET_DIR = path.join(process.cwd(), 'public/assets/basis');
const FILES = ['basis_transcoder.js', 'basis_transcoder.wasm'];

fs.mkdirSync(TARGET_DIR, { recursive: true });
for (const file of FILES) {
  const from = path.join(SOURCE_DIR, file);
  if (!fs.existsSync(from)) {
    console.error(`copy-basis-transcoder: missing ${from}`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(TARGET_DIR, file));
}
