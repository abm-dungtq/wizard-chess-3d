#!/usr/bin/env node
/**
 * Prints one JSON line of model statistics per file: size, vertex and triangle counts, material slots,
 * texture count, joints and animation clips.
 *
 * Usage: node scripts/glb-stats.mjs <file.glb|file.glb.gz> [more files...]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

async function createIO() {
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

function summarize(file, doc) {
  const root = doc.getRoot();
  let vertices = 0;
  let triangles = 0;
  const primitives = [];
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      const count = position ? position.getCount() : 0;
      const indices = prim.getIndices();
      vertices += count;
      triangles += (indices ? indices.getCount() : count) / 3;
      primitives.push(prim.getMaterial()?.getName() ?? '');
    }
  }
  const skin = root.listSkins()[0];
  const durations = {};
  for (const animation of root.listAnimations()) {
    let end = 0;
    for (const sampler of animation.listSamplers()) {
      const input = sampler.getInput();
      if (input) end = Math.max(end, input.getMax([])[0]);
    }
    durations[animation.getName()] = Math.round(end * 1000) / 1000;
  }
  return {
    file,
    bytes: fs.statSync(file).size,
    vertices,
    triangles,
    primitives,
    textures: root.listTextures().length,
    joints: skin ? skin.listJoints().map((joint) => joint.getName()) : [],
    clips: Object.keys(durations).sort(),
    durations
  };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/glb-stats.mjs <file.glb|file.glb.gz> [more files...]');
  process.exit(2);
}

const io = await createIO();
for (const file of files) {
  const raw = fs.readFileSync(file);
  const bytes = file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw;
  const doc = await io.readBinary(new Uint8Array(bytes));
  console.log(JSON.stringify(summarize(file, doc)));
}
