#!/usr/bin/env node
/**
 * Re-encodes every model under public/assets/glb as a binary .glb with meshopt geometry.
 * Textured models also get KTX2 (ETC1S) textures when KTX-Software is installed.
 *
 * Usage:
 *   node scripts/encode-glb-assets.mjs           encode every *.glb.gz.b64 into a sibling *.glb.gz
 *
 *   node scripts/encode-glb-assets.mjs --check   compare each pair: counts, names, mesh bounds and skins
 *
 * The game fetches *.glb.gz: Cloudflare does not compress model/gltf-binary, so the gzip layer lives in the file.
 * /assets/* is served immutable for a year: after re-encoding, bump ASSET_CACHE_VER in src/wizardChessEngine.js.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { NodeIO, PropertyType, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ASSET_DIR = path.join(process.cwd(), 'public/assets/glb');
const BOUNDS_TOLERANCE = 0.01;

function listSources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return entry.name.endsWith('.glb.gz.b64') ? [full] : [];
  });
}

const decodeB64 = (file) => zlib.gunzipSync(Buffer.from(fs.readFileSync(file, 'utf8'), 'base64'));
const glbPathFor = (source) => source.replace(/\.glb\.gz\.b64$/, '.glb');
const gzPathFor = (source) => `${glbPathFor(source)}.gz`;

function findKtxTool() {
  for (const tool of ['ktx', 'toktx']) {
    try {
      execFileSync('which', [tool], { stdio: 'ignore' });
      return tool;
    } catch {}
  }
  return null;
}

async function createIO() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

async function encode() {
  const io = await createIO();
  const ktxTool = findKtxTool();
  let totalB64 = 0;
  let totalGlb = 0;

  for (const source of listSources(ASSET_DIR)) {
    const doc = await io.readBinary(new Uint8Array(decodeB64(source)));
    // meshopt() reorders and quantizes on its own; simplify/resample are left out because they change shapes and clips.
    // Materials are never merged: the engine finds some of them by name (e.g. the cathedral's Lancet glass).
    await doc.transform(
      dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
      prune({ keepAttributes: true }),
      weld(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' })
    );
    // The plain .glb is only a scratch file for the optional KTX2 step; the game ships the .glb.gz.
    const out = path.join(os.tmpdir(), `meshopt-${path.basename(glbPathFor(source))}`);
    fs.writeFileSync(out, await io.writeBinary(doc));

    if (doc.getRoot().listTextures().length > 0) {
      if (ktxTool) {
        const tmp = path.join(os.tmpdir(), `etc1s-${path.basename(out)}`);
        execFileSync('npx', ['gltf-transform', 'etc1s', out, tmp, '--quality', '128'], { stdio: 'inherit' });
        fs.renameSync(tmp, out);
      } else {
        console.log(`toktx not found: install KTX-Software to encode KTX2 (${path.basename(out)} keeps JPEG)`);
      }
    }

    fs.writeFileSync(gzPathFor(source), zlib.gzipSync(fs.readFileSync(out), { level: 9 }));
    fs.rmSync(out);

    const b64Bytes = fs.statSync(source).size;
    const glbBytes = fs.statSync(gzPathFor(source)).size;
    totalB64 += b64Bytes;
    totalGlb += glbBytes;
    console.log(`${path.relative(ASSET_DIR, gzPathFor(source))} b64=${b64Bytes} glb=${glbBytes} ratio=${(glbBytes / b64Bytes).toFixed(2)} (glb.gz)`);
  }
  console.log(`TOTAL b64=${totalB64} glb.gz=${totalGlb}`);
}

function multiplyMat4(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    }
  }
  return out;
}

/**
 * Bind-pose bounds of a skinned mesh. meshopt quantizes skinned positions and folds the scale into the
 * inverse bind matrices, so raw accessor ranges differ by design; the skinned result must not.
 */
function skinnedBounds(node) {
  const skin = node.getSkin();
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const jointMatrices = joints.map((joint, j) => multiplyMat4(joint.getWorldMatrix(), ibm.getElement(j, [])));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const v = [];
  const js = [];
  const ws = [];
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const jointsAttr = prim.getAttribute('JOINTS_0');
    const weightsAttr = prim.getAttribute('WEIGHTS_0');
    if (!jointsAttr || !weightsAttr) return null;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      jointsAttr.getElement(i, js);
      weightsAttr.getElement(i, ws);
      const total = ws.reduce((n, w) => n + w, 0) || 1;
      for (let axis = 0; axis < 3; axis++) {
        let value = 0;
        for (let k = 0; k < 4; k++) {
          const m = jointMatrices[js[k]];
          if (!ws[k] || !m) continue;
          value += (ws[k] / total) * (m[axis] * v[0] + m[4 + axis] * v[1] + m[8 + axis] * v[2] + m[12 + axis]);
        }
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  }
  return { min, max };
}

function summarize(doc) {
  const root = doc.getRoot();
  const meshBounds = {};
  const skinnedMeshes = {};
  for (const node of root.listNodes()) {
    if (!node.getMesh()) continue;
    const skin = node.getSkin();
    if (!skin) {
      meshBounds[node.getName()] = getBounds(node);
      continue;
    }
    skinnedMeshes[node.getName()] = {
      joints: skin.listJoints().length,
      inverseBindMatrices: skin.getInverseBindMatrices()?.getCount() ?? 0,
      bounds: skinnedBounds(node)
    };
  }
  return {
    meshes: root.listMeshes().length,
    skins: root.listSkins().length,
    animations: root.listAnimations().map((a) => a.getName()).sort(),
    channels: root.listAnimations().reduce((n, a) => n + a.listChannels().length, 0),
    meshNames: root.listMeshes().map((m) => m.getName()).sort(),
    materialNames: root.listMaterials().map((m) => m.getName()).sort(),
    meshBounds,
    skinnedMeshes
  };
}

function compareBounds(a, b) {
  if (![...a.min, ...a.max, ...b.min, ...b.max].every(Number.isFinite)) return false;
  for (let axis = 0; axis < 3; axis++) {
    const extent = Math.max(a.max[axis] - a.min[axis], 1e-6);
    const drift = Math.max(Math.abs(a.min[axis] - b.min[axis]), Math.abs(a.max[axis] - b.max[axis]));
    if (drift > extent * BOUNDS_TOLERANCE) return false;
  }
  return true;
}

async function check() {
  const io = await createIO();
  const problems = [];
  const sources = listSources(ASSET_DIR);

  for (const source of sources) {
    const name = path.relative(ASSET_DIR, gzPathFor(source));
    if (!fs.existsSync(gzPathFor(source))) {
      problems.push(`${name}: missing`);
      continue;
    }
    const before = summarize(await io.readBinary(new Uint8Array(decodeB64(source))));
    const after = summarize(await io.readBinary(new Uint8Array(zlib.gunzipSync(fs.readFileSync(gzPathFor(source))))));
    for (const key of ['meshes', 'skins', 'channels']) {
      if (before[key] !== after[key]) problems.push(`${name}: ${key} ${before[key]} -> ${after[key]}`);
    }
    for (const key of ['animations', 'meshNames', 'materialNames']) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        problems.push(`${name}: ${key} differ`);
      }
    }
    for (const [nodeName, bounds] of Object.entries(before.meshBounds)) {
      const other = after.meshBounds[nodeName];
      if (!other || !compareBounds(bounds, other)) problems.push(`${name}: bounds of node "${nodeName}" moved`);
    }
    for (const [nodeName, skin] of Object.entries(after.skinnedMeshes)) {
      if (skin.joints !== skin.inverseBindMatrices) {
        problems.push(`${name}: skin of "${nodeName}" has ${skin.joints} joints but ${skin.inverseBindMatrices} inverse bind matrices`);
      }
      if (!skin.bounds) problems.push(`${name}: skinned mesh "${nodeName}" lost JOINTS_0/WEIGHTS_0`);
    }
    for (const [nodeName, skin] of Object.entries(before.skinnedMeshes)) {
      const other = after.skinnedMeshes[nodeName];
      if (!other) problems.push(`${name}: skinned node "${nodeName}" missing`);
      else if (skin.bounds && other.bounds && !compareBounds(skin.bounds, other.bounds)) {
        problems.push(`${name}: bind-pose bounds of skinned node "${nodeName}" moved`);
      }
    }
  }

  if (problems.length) {
    for (const p of problems) console.log(`MISMATCH ${p}`);
    process.exit(1);
  }
  console.log(`CHECK OK ${sources.length}`);
}

await (process.argv.includes('--check') ? check() : encode());
