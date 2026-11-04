#!/usr/bin/env node
/**
 * GLB <-> shipped .glb.gz Pipeline for Wizard Chess 3D + Blender MCP
 * Usage:
 *   node scripts/glb-pipeline.mjs unpack [targetDir]     shipped .glb.gz -> plain .glb (meshopt and quantization removed for Blender)
 *   node scripts/glb-pipeline.mjs pack [sourceDir]       plain .glb -> shipped .glb.gz via scripts/encode-glb-assets.mjs
 *   node scripts/glb-pipeline.mjs restore-backup         old .glb.gz.b64 backups -> workspace .glb -> shipped .glb.gz
 * Add --xiangqi to work on the xiangqi models. After pack or restore-backup, bump ASSET_CACHE_VER in src/wizardChessEngine.js.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = process.cwd();
const GLB_ASSET_DIR = path.join(ROOT, 'public/assets/glb');
const DEFAULT_WS_DIR = path.join(ROOT, '.tools/blender-workspace/redesigned');
const BACKUP_B64_DIR = path.join(ROOT, '.tools/blender-workspace/backup_b64');
const ENCODER = path.join(ROOT, 'scripts/encode-glb-assets.mjs');

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

function assertGlbSources(dir, names) {
  for (const name of names) {
    const inPath = path.join(dir, `${name}.glb`);
    if (!fs.existsSync(inPath)) {
      throw new Error(`Missing source GLB: ${inPath}`);
    }
    if (fs.readFileSync(inPath).toString('ascii', 0, 4) !== 'glTF') {
      throw new Error(`Invalid glTF binary header in ${inPath}`);
    }
  }
}

// The encoder writes every .glb in sourceDir, so only the named pieces are staged for it.
function encodeInto(sourceDir, names, targetDir) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'glb-pack-'));
  try {
    for (const name of names) fs.copyFileSync(path.join(sourceDir, `${name}.glb`), path.join(stage, `${name}.glb`));
    execFileSync(process.execPath, [ENCODER, stage, targetDir], { stdio: 'inherit' });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (mode === 'unpack') {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  fs.mkdirSync(customDir, { recursive: true });
  for (const name of activeNames) {
    const gzPath = path.join(activeAssetDir, `${name}.glb.gz`);
    const doc = await io.readBinary(new Uint8Array(zlib.gunzipSync(fs.readFileSync(gzPath))));
    await doc.transform(dequantize());
    for (const ext of doc.getRoot().listExtensionsUsed()) {
      if (ext.extensionName === 'EXT_meshopt_compression' || ext.extensionName === 'KHR_mesh_quantization') ext.dispose();
    }
    const glbBuf = await io.writeBinary(doc);
    const outPath = path.join(customDir, `${name}.glb`);
    fs.writeFileSync(outPath, glbBuf);
    console.log(`[glb:unpack] ${name}.glb (${(glbBuf.length / 1024).toFixed(1)} KB) -> ${outPath}`);
  }
} else if (mode === 'pack') {
  assertGlbSources(customDir, activeNames);
  fs.mkdirSync(activeAssetDir, { recursive: true });
  encodeInto(customDir, activeNames, activeAssetDir);
  console.log(`[glb:pack] ${activeNames.length} models <- ${customDir}. Bump ASSET_CACHE_VER before deploying.`);
} else if (mode === 'restore-backup') {
  fs.mkdirSync(DEFAULT_WS_DIR, { recursive: true });
  for (const name of PIECE_NAMES) {
    const bakPath = path.join(BACKUP_B64_DIR, `${name}.glb.gz.b64`);
    const glbBuf = zlib.gunzipSync(Buffer.from(fs.readFileSync(bakPath, 'utf-8').trim(), 'base64'));
    fs.writeFileSync(path.join(DEFAULT_WS_DIR, `${name}.glb`), glbBuf);
    console.log(`[glb:restore] ${name}.glb <- ${bakPath}`);
  }
  assertGlbSources(DEFAULT_WS_DIR, PIECE_NAMES);
  encodeInto(DEFAULT_WS_DIR, PIECE_NAMES, GLB_ASSET_DIR);
  console.log('[glb:restore] Bump ASSET_CACHE_VER before deploying.');
} else {
  console.error(`Unknown mode: ${mode}. Use 'unpack', 'pack', or 'restore-backup'.`);
  process.exit(1);
}
