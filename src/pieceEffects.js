import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

// Short-lived effects around a piece: landing dust, the fading trace of a move, the struck piece breaking
// into pieces of itself, and the mark a capture leaves on its square. Everything here removes itself; nothing
// stays on the board once its life ends, so the squares return to their measured values.

// How heavy each piece type lands and breaks. A skin package may pass its own table.
export const PIECE_EFFECT_WEIGHTS = {
  pawn: 0.55,
  advisor: 0.6,
  bishop: 0.7,
  knight: 0.85,
  cannon: 0.9,
  queen: 0.9,
  elephant: 1.0,
  rook: 1.0,
  king: 1.1
};

const DUST_COLOR = 0x9a927f;
const CHUNK_PLANE_COUNT = 4;
const CHUNK_LIFE = 2.4;
const CHUNK_FADE = 0.55;
const GRAVITY = 9.8;
// How far a chunk's pivot sits from the piece's axis, toward its own half.
const WEDGE_OFFSET = 0.07;

function makeCanvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDustTexture() {
  return makeCanvasTexture(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

// Alpha ramp along the travel direction: faint at the origin square, strongest behind the piece.
function makeRibbonTexture() {
  return makeCanvasTexture(64, (ctx, s) => {
    const along = ctx.createLinearGradient(0, s, 0, 0);
    along.addColorStop(0, 'rgba(255,255,255,0)');
    along.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = along;
    ctx.fillRect(0, 0, s, s);
    const across = ctx.createLinearGradient(0, 0, s, 0);
    across.addColorStop(0, 'rgba(0,0,0,1)');
    across.addColorStop(0.5, 'rgba(0,0,0,0)');
    across.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, s, s);
  });
}

// A dark blast mark with a few radial cracks.
function makeScorchTexture() {
  return makeCanvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3 * Math.sin(i * 12.9898);
      const len = s * (0.3 + 0.16 * Math.abs(Math.sin(i * 78.233)));
      const bend = a + 0.35 * Math.sin(i * 4.1);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(s / 2, s / 2);
      ctx.lineTo(s / 2 + Math.cos(a) * len * 0.55, s / 2 + Math.sin(a) * len * 0.55);
      ctx.lineTo(s / 2 + Math.cos(bend) * len, s / 2 + Math.sin(bend) * len);
      ctx.stroke();
    }
  });
}

/**
 * @param {{ scene: THREE.Scene, boardY: number, tableHalf: number, getMotionLevel: () => string, getQualityTier: () => string }} deps
 */
export function createPieceEffects({ scene, boardY, tableHalf, getMotionLevel, getQualityTier }) {
  const dustTex = makeDustTexture();
  const ribbonTex = makeRibbonTexture();
  const scorchTex = makeScorchTexture();
  const flatPlaneGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const contactRingGeo = new THREE.RingGeometry(0.72, 1.0, 40).rotateX(-Math.PI / 2);

  /** @type {{ obj: THREE.Object3D, mat: THREE.Material, life: number, maxLife: number, step: (fx: any, t: number, dt: number) => void }[]} */
  const transient = [];
  const chunks = [];
  // Chunk materials are kept for the whole session, keyed by source material and chunk slot, so every
  // shatter after the first reuses compiled programs instead of compiling at the moment of impact.
  const chunkMaterialPool = new Map();
  const chunkPlanes = [];

  const animated = () => getMotionLevel() !== 'off';

  function addTransient(obj, mat, life, step) {
    obj.raycast = () => {};
    obj.castShadow = false;
    obj.receiveShadow = false;
    scene.add(obj);
    transient.push({ obj, mat, life, maxLife: life, step });
  }

  function spawnDust(pos, weight = 1, count = 5) {
    if (!animated()) return;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: dustTex,
        color: DUST_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(mat);
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.8;
      const speed = (0.22 + Math.random() * 0.2) * weight;
      const vx = Math.cos(ang) * speed;
      const vz = Math.sin(ang) * speed;
      const size = (0.16 + Math.random() * 0.1) * weight;
      sprite.position.set(pos.x + Math.cos(ang) * 0.1, boardY + 0.04, pos.z + Math.sin(ang) * 0.1);
      sprite.scale.setScalar(size);
      addTransient(sprite, mat, 0.55 + Math.random() * 0.2, (fx, t, dt) => {
        sprite.position.x += vx * dt * (1 - t);
        sprite.position.z += vz * dt * (1 - t);
        sprite.position.y += 0.12 * dt;
        sprite.scale.setScalar(size * (1 + t * 1.6));
        mat.opacity = 0.34 * weight * Math.sin(Math.min(1, t * 4) * Math.PI * 0.5) * (1 - t);
      });
    }
  }

  // A dark ring that spreads from under the piece as it comes to rest.
  function spawnContactRing(pos, weight = 1) {
    if (!animated()) return;
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
    const ring = new THREE.Mesh(contactRingGeo, mat);
    ring.position.set(pos.x, boardY + 0.006, pos.z);
    const radius = 0.2 + 0.1 * weight;
    addTransient(ring, mat, 0.38, (fx, t) => {
      ring.scale.setScalar(radius * (0.7 + t * 1.1));
      mat.opacity = 0.3 * weight * (1 - t);
    });
  }

  function spawnLanding(pos, type) {
    const weight = PIECE_EFFECT_WEIGHTS[type] || 0.8;
    spawnDust(pos, weight, weight >= 0.85 ? 6 : 4);
    spawnContactRing(pos, weight);
  }

  // The trace of a move: it follows the piece while it travels, then fades out completely.
  function spawnPathRibbon(from, to, colorHex, travelTime) {
    if (!animated()) return;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.05) return;
    const mat = new THREE.MeshBasicMaterial({
      map: ribbonTex,
      color: colorHex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const ribbon = new THREE.Mesh(flatPlaneGeo, mat);
    ribbon.rotation.y = Math.atan2(dx, dz) + Math.PI;
    const fade = 0.45;
    const life = travelTime + fade;
    addTransient(ribbon, mat, life, (fx, t) => {
      const elapsed = t * life;
      const grow = Math.min(1, elapsed / travelTime);
      const reach = Math.max(0.02, length * (grow * grow * (3 - 2 * grow)));
      ribbon.scale.set(0.16, 1, reach);
      ribbon.position.set(from.x + (dx / length) * reach * 0.5, boardY + 0.009, from.z + (dz / length) * reach * 0.5);
      const out = elapsed <= travelTime ? 1 : 1 - (elapsed - travelTime) / fade;
      mat.opacity = 0.3 * Math.min(1, elapsed / 0.12) * out;
    });
  }

  function spawnScorch(pos, weight = 1) {
    const mat = new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, opacity: 0, depthWrite: false });
    const mark = new THREE.Mesh(flatPlaneGeo, mat);
    mark.position.set(pos.x, boardY + 0.007, pos.z);
    mark.rotation.y = Math.random() * Math.PI * 2;
    mark.scale.set(0.42 + 0.12 * weight, 1, 0.42 + 0.12 * weight);
    addTransient(mark, mat, 4.0, (fx, t) => {
      mat.opacity = 0.6 * Math.min(1, t * 30) * (1 - t) * (1 - t);
    });
  }

  function chunkLayout() {
    return getQualityTier() === 'base' ? { layers: 2, wedges: 2 } : { layers: 3, wedges: 2 };
  }

  function planesForSlot(slot) {
    while (chunkPlanes.length <= slot) {
      chunkPlanes.push(Array.from({ length: CHUNK_PLANE_COUNT }, () => new THREE.Plane()));
    }
    return chunkPlanes[slot];
  }

  function pooledChunkMaterial(source, slot) {
    const key = `${source.uuid}:${slot}`;
    let mat = chunkMaterialPool.get(key);
    if (!mat) {
      mat = source.clone();
      chunkMaterialPool.set(key, mat);
    } else {
      mat.copy(source);
    }
    mat.clippingPlanes = planesForSlot(slot);
    mat.clipShadows = false;
    // The cut exposes the inside of the shell; drawing both faces makes a chunk look solid.
    mat.side = THREE.DoubleSide;
    return mat;
  }

  // A copy of the piece that draws only the part of it inside one chunk's clipping planes.
  function makeChunkCopy(pieceRoot, mySlot) {
    // Piece nodes keep back-references in userData, which Object3D.copy cannot serialise.
    const held = [];
    pieceRoot.traverse((o) => {
      held.push([o, o.userData]);
      o.userData = {};
    });
    let copy;
    try {
      copy = cloneSkeleton(pieceRoot);
    } finally {
      for (const [o, data] of held) o.userData = data;
    }
    const drop = [];
    copy.traverse((o) => {
      if (o === copy) return;
      if (o.isSprite || o.isLight) drop.push(o);
      if (!o.isMesh) return;
      if (o.name === 'PieceHitboxProxy' || o.name === 'PiecePedestalRing' || !o.visible) {
        drop.push(o);
        return;
      }
      o.material = pooledChunkMaterial(o.material, mySlot);
      o.castShadow = false;
      o.frustumCulled = false;
      o.raycast = () => {};
    });
    for (const o of drop) o.removeFromParent();
    return copy;
  }

  function clearChunks() {
    for (const ch of chunks) scene.remove(ch.pivot);
    chunks.length = 0;
  }

  /**
   * Breaks a piece into chunks of its own mesh. Each chunk is a frozen copy of the piece seen through a
   * few clipping planes, so the fragments keep the piece's shape, pose and materials.
   * @param {THREE.Object3D} pieceRoot the struck piece, still in the scene and in its final pose
   * @param {{ height: number, type: string, dirX: number, dirZ: number }} opts
   */
  function spawnShatterChunks(pieceRoot, { height, type, dirX, dirZ }) {
    const weight = PIECE_EFFECT_WEIGHTS[type] || 0.8;
    const origin = pieceRoot.position;
    spawnScorch(origin, weight);
    if (!animated()) return;
    spawnDust(origin, weight * 1.5, 8);
    clearChunks();

    pieceRoot.updateMatrixWorld(true);
    const { layers, wedges } = chunkLayout();
    const baseY = origin.y;
    const top = baseY + height * 1.25;
    let slot = 0;
    for (let layer = 0; layer < layers; layer++) {
      const y0 = layer === 0 ? baseY - 1 : baseY + (height * layer) / layers;
      const y1 = layer === layers - 1 ? top + 1 : baseY + (height * (layer + 1)) / layers;
      const centreY = baseY + (height * (layer + 0.5)) / layers;
      // Each layer is split along a different vertical plane so the cuts do not line up.
      const splitAngle = Math.random() * Math.PI;
      for (let w = 0; w < wedges; w++) {
        const side = w === 0 ? 1 : -1;
        const nx = Math.cos(splitAngle) * side;
        const nz = Math.sin(splitAngle) * side;
        const pivot = new THREE.Group();
        pivot.position.set(origin.x + nx * WEDGE_OFFSET, centreY, origin.z + nz * WEDGE_OFFSET);
        scene.add(pivot);
        pivot.updateMatrixWorld(true);

        const mySlot = slot++;
        const planes = planesForSlot(mySlot);
        const copy = makeChunkCopy(pieceRoot, mySlot);
        scene.add(copy);
        pivot.attach(copy);

        // Planes in the pivot's own space; they are carried into world space every frame.
        const c = pivot.position;
        const local = [
          new THREE.Plane(new THREE.Vector3(0, 1, 0), -(y0 - c.y)),
          new THREE.Plane(new THREE.Vector3(0, -1, 0), y1 - c.y),
          new THREE.Plane(new THREE.Vector3(nx, 0, nz), WEDGE_OFFSET),
          new THREE.Plane(new THREE.Vector3(nx, 0, nz), WEDGE_OFFSET)
        ];

        const lift = 0.9 + (layer / Math.max(1, layers - 1)) * 1.5 + Math.random() * 0.6;
        const out = 0.7 + Math.random() * 0.6;
        const push = (0.9 + Math.random() * 0.7) * weight;
        chunks.push({
          pivot,
          local,
          world: planes,
          vel: new THREE.Vector3(nx * out + dirX * push, lift, nz * out + dirZ * push),
          spin: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 9),
          rest: boardY + Math.max(0.05, (height / layers) * 0.3),
          life: CHUNK_LIFE,
          landed: false
        });
      }
    }
    syncChunkPlanes();
  }

  function syncChunkPlanes() {
    for (const ch of chunks) {
      ch.pivot.updateMatrixWorld(true);
      for (let i = 0; i < CHUNK_PLANE_COUNT; i++) {
        ch.world[i].copy(ch.local[i]).applyMatrix4(ch.pivot.matrixWorld);
      }
    }
  }

  function updateChunks(dt) {
    for (let i = chunks.length - 1; i >= 0; i--) {
      const ch = chunks[i];
      ch.life -= dt;
      if (ch.life <= 0) {
        scene.remove(ch.pivot);
        chunks.splice(i, 1);
        continue;
      }
      const p = ch.pivot.position;
      ch.vel.y -= GRAVITY * dt;
      p.addScaledVector(ch.vel, dt);
      ch.pivot.rotation.x += ch.spin.x * dt;
      ch.pivot.rotation.y += ch.spin.y * dt;
      ch.pivot.rotation.z += ch.spin.z * dt;
      const onTable = Math.abs(p.x) < tableHalf && Math.abs(p.z) < tableHalf;
      if (onTable && p.y < ch.rest && ch.vel.y < 0) {
        p.y = ch.rest;
        if (!ch.landed) {
          ch.landed = true;
          spawnDust(p, 0.6, 2);
        }
        ch.vel.y *= -0.28;
        ch.vel.x *= 0.55;
        ch.vel.z *= 0.55;
        ch.spin.multiplyScalar(0.45);
        if (Math.abs(ch.vel.y) < 0.35) {
          ch.vel.y = 0;
          ch.spin.multiplyScalar(0.2);
        }
      }
      ch.pivot.scale.setScalar(Math.min(1, ch.life / CHUNK_FADE));
    }
    syncChunkPlanes();
  }

  function update(dt) {
    for (let i = transient.length - 1; i >= 0; i--) {
      const fx = transient[i];
      fx.life -= dt;
      if (fx.life <= 0) {
        scene.remove(fx.obj);
        fx.mat.dispose();
        transient.splice(i, 1);
        continue;
      }
      fx.step(fx, 1 - fx.life / fx.maxLife, dt);
    }
    if (chunks.length > 0) updateChunks(dt);
  }

  function clear() {
    for (const fx of transient) {
      scene.remove(fx.obj);
      fx.mat.dispose();
    }
    transient.length = 0;
    clearChunks();
  }

  return {
    spawnDust,
    spawnLanding,
    spawnPathRibbon,
    spawnShatterChunks,
    update,
    clear,
    getActiveCounts: () => ({ transient: transient.length, chunks: chunks.length })
  };
}
