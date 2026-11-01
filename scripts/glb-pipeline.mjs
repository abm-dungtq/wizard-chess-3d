#!/usr/bin/env node
/**
 * GLB <-> .glb.gz.b64 Pipeline for Wizard Chess 3D + Blender MCP
 * Usage:
 *   node scripts/glb-pipeline.mjs unpack [targetDir]
 *   node scripts/glb-pipeline.mjs pack [sourceDir]
 *   node scripts/glb-pipeline.mjs restore-backup
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const GLB_ASSET_DIR = path.join(ROOT, 'public/assets/glb');
const DEFAULT_WS_DIR = path.join(ROOT, '.tools/blender-workspace/redesigned');
const BACKUP_B64_DIR = path.join(ROOT, '.tools/blender-workspace/backup_b64');

const PIECE_NAMES = [
  'pawn_white',
  'rook_white',
  'knight_white',
  'bishop_white',
  'queen_white',
  'king_white',
];

const mode = process.argv[2] || 'pack';
const customDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_WS_DIR;

if (mode === 'unpack') {
  fs.mkdirSync(customDir, { recursive: true });
  for (const name of PIECE_NAMES) {
    const b64Path = path.join(GLB_ASSET_DIR, `${name}.glb.gz.b64`);
    const b64Text = fs.readFileSync(b64Path, 'utf-8').trim();
    const glbBuf = zlib.gunzipSync(Buffer.from(b64Text, 'base64'));
    const outPath = path.join(customDir, `${name}.glb`);
    fs.writeFileSync(outPath, glbBuf);
    console.log(`[glb:unpack] ${name}.glb (${(glbBuf.length / 1024).toFixed(1)} KB) -> ${outPath}`);
  }
} else if (mode === 'pack') {
  for (const name of PIECE_NAMES) {
    const inPath = path.join(customDir, `${name}.glb`);
    if (!fs.existsSync(inPath)) {
      throw new Error(`Missing source GLB: ${inPath}`);
    }
    const glbBuf = fs.readFileSync(inPath);
    const magic = glbBuf.toString('ascii', 0, 4);
    if (magic !== 'glTF') {
      throw new Error(`Invalid glTF binary header in ${inPath}`);
    }
    const gzBuf = zlib.gzipSync(glbBuf, { level: 9 });
    const b64Text = gzBuf.toString('base64');
    const outPath = path.join(GLB_ASSET_DIR, `${name}.glb.gz.b64`);
    fs.writeFileSync(outPath, b64Text, 'utf-8');
    console.log(`[glb:pack] ${name}.glb.gz.b64 (${(b64Text.length / 1024).toFixed(1)} KB b64) <- ${inPath}`);
  }
} else if (mode === 'restore-backup') {
  for (const name of PIECE_NAMES) {
    const bakPath = path.join(BACKUP_B64_DIR, `${name}.glb.gz.b64`);
    const outPath = path.join(GLB_ASSET_DIR, `${name}.glb.gz.b64`);
    fs.copyFileSync(bakPath, outPath);
    console.log(`[glb:restore] Restored ${name}.glb.gz.b64 from backup`);
  }
} else {
  console.error(`Unknown mode: ${mode}. Use 'unpack', 'pack', or 'restore-backup'.`);
  process.exit(1);
}
