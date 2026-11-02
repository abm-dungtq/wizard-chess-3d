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

const XIANGQI_PIECE_NAMES = [
  'king_white',
  'advisor_white',
  'elephant_white',
  'rook_white',
  'cannon_white',
  'knight_white',
  'pawn_white',
];

const isXiangqi = process.argv.includes('--xiangqi');
const positionalArgs = process.argv.slice(2).filter((arg) => arg !== '--xiangqi');
const mode = positionalArgs[0] || 'pack';
const activeNames = isXiangqi ? XIANGQI_PIECE_NAMES : PIECE_NAMES;
const activeAssetDir = isXiangqi ? path.join(GLB_ASSET_DIR, 'xiangqi') : GLB_ASSET_DIR;
const defaultWs = isXiangqi ? path.join(ROOT, '.tools/blender-workspace/xiangqi') : DEFAULT_WS_DIR;
const customDir = positionalArgs[1] ? path.resolve(positionalArgs[1]) : defaultWs;

if (mode === 'unpack') {
  fs.mkdirSync(customDir, { recursive: true });
  for (const name of activeNames) {
    const b64Path = path.join(activeAssetDir, `${name}.glb.gz.b64`);
    const b64Text = fs.readFileSync(b64Path, 'utf-8').trim();
    const glbBuf = zlib.gunzipSync(Buffer.from(b64Text, 'base64'));
    const outPath = path.join(customDir, `${name}.glb`);
    fs.writeFileSync(outPath, glbBuf);
    console.log(`[glb:unpack] ${name}.glb (${(glbBuf.length / 1024).toFixed(1)} KB) -> ${outPath}`);
  }
} else if (mode === 'pack') {
  fs.mkdirSync(activeAssetDir, { recursive: true });
  for (const name of activeNames) {
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
    const outPath = path.join(activeAssetDir, `${name}.glb.gz.b64`);
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
