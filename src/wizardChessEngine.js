import * as THREE_NS from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createPieceEffects, PIECE_EFFECT_WEIGHTS } from './pieceEffects.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import {
  extractPureBoard,
  getPureLegalMovesForPiece,
  getAllPureLegalMoves,
  computePositionHash,
  evaluateDrawState,
  chooseBestAIMove,
  chooseBestAIMoveAsync
} from './chessAI.ts';
import {
  createInitialXiangqiBoard,
  extractPureXiangqiBoard,
  getXiangqiLegalMovesForPiece,
  getAllXiangqiLegalMoves,
  getXiangqiBlockedPointsForPiece,
  isXiangqiGeneralInCheck,
  computeXiangqiPositionHash,
  evaluateXiangqiDrawState,
  chooseBestXiangqiMove,
  chooseBestXiangqiMoveAsync,
  XIANGQI_ROLE_METADATA
} from './xiangqiAI.ts';
import { wizardAudio } from './soundEngine.ts';
import { runTweens } from './tweenRunner.ts';
import {
  downgradeTier,
  loadVisualSettings,
  pickQualityTier,
  resolveMotionLevel,
  saveVisualSettings
} from './visualSettings.ts';

/** @type {any} */
const THREE = THREE_NS;
const SkeletonUtils = { clone: cloneSkeleton };

export function initWizardChess() {
    // =========================================================================
    // Constants & Board Coordinates (Dual-Mode: 8x8 Chess & 9x10 Xiangqi)
    // =========================================================================
    const PIECE_TYPES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
    const XIANGQI_PIECE_TYPES = ['king', 'advisor', 'elephant', 'rook', 'cannon', 'knight', 'pawn'];
    const PIECE_VALUES = {
      pawn: 100,
      advisor: 200,
      elephant: 200,
      knight: 320,
      bishop: 330,
      cannon: 450,
      rook: 500,
      queen: 900,
      king: 20000
    };
    const BOARD_SQ_SIZE = 0.44;
    const PIECE_SCALE_FACTOR = 0.66;
    const XIANGQI_SQ_SIZE = 0.38;
    const XIANGQI_SCALE_FACTOR = 0.61;
    const BOARD_SURFACE_Y = 0.775;
    let gameVariant = 'chess'; // 'chess' | 'xiangqi'
    function getBoardRows() {
      return gameVariant === 'xiangqi' ? 10 : 8;
    }
    function getBoardCols() {
      return gameVariant === 'xiangqi' ? 9 : 8;
    }
    function getActiveSqSize() {
      return gameVariant === 'xiangqi' ? XIANGQI_SQ_SIZE : BOARD_SQ_SIZE;
    }
    const ROLE_SCALE_MULTIPLIERS = {
      pawn: 0.94,
      advisor: 0.94,
      knight: 0.96,
      cannon: 0.97,
      bishop: 0.98,
      elephant: 1.00,
      rook: 1.02,
      queen: 1.05,
      king: 1.10
    };
    const ROLE_ANISOTROPIC_RATIOS = {
      chess: {
        pawn:     { sx: 0.96, sy: 0.96, sz: 0.96 },
        knight:   { sx: 1.04, sy: 1.02, sz: 1.08 },
        bishop:   { sx: 0.90, sy: 1.00, sz: 0.90 },
        rook:     { sx: 1.06, sy: 1.00, sz: 1.06 },
        queen:    { sx: 0.85, sy: 1.04, sz: 0.85 },
        king:     { sx: 1.16, sy: 1.25, sz: 1.16 }
      },
      xiangqi: {
        pawn:     { sx: 0.94, sy: 0.94, sz: 0.94 },
        cannon:   { sx: 1.30, sy: 1.30, sz: 1.30 }, // a low field gun with a long trail: enlarged to stand with the others
        knight:   { sx: 1.04, sy: 1.02, sz: 1.08 },
        elephant: { sx: 1.14, sy: 0.96, sz: 1.14 },
        advisor:  { sx: 0.84, sy: 0.90, sz: 0.84 },
        rook:     { sx: 1.06, sy: 1.00, sz: 1.06 },
        king:     { sx: 1.16, sy: 1.25, sz: 1.16 }
      }
    };
    function getPieceWorldScale(type) {
      if (gameVariant === 'xiangqi') {
        return XIANGQI_SQ_SIZE * XIANGQI_SCALE_FACTOR * (ROLE_SCALE_MULTIPLIERS[type] || 1.0);
      }
      return BOARD_SQ_SIZE * PIECE_SCALE_FACTOR * (ROLE_SCALE_MULTIPLIERS[type] || 1.0);
    }
    function getPieceAnisotropicScale(type) {
      const base = getPieceWorldScale(type);
      const map = gameVariant === 'xiangqi' ? ROLE_ANISOTROPIC_RATIOS.xiangqi : ROLE_ANISOTROPIC_RATIOS.chess;
      const ratio = map[type] || { sx: 1, sy: 1, sz: 1 };
      return {
        sx: base * ratio.sx,
        sy: base * ratio.sy,
        sz: base * ratio.sz
      };
    }
    function applyPieceBaseScale(mesh, type, mulXZ = 1, mulY = 1) {
      if (!mesh) return;
      const { sx, sy, sz } = getPieceAnisotropicScale(type);
      mesh.scale.set(sx * mulXZ, sy * mulY, sz * mulXZ);
    }
    const PIECE_ROLE_METADATA = {
      pawn: {
        viName: 'Tốt',
        enName: 'Pawn',
        shortVi: 'Tốt',
        glyphW: '♙',
        glyphB: '♟',
        moveHint: 'Đi thẳng 1 ô (nước đầu 2 ô), ăn chéo 1 ô'
      },
      rook: {
        viName: 'Xe',
        enName: 'Rook',
        shortVi: 'Xe',
        glyphW: '♖',
        glyphB: '♜',
        moveHint: 'Đi ngang và dọc không giới hạn số ô'
      },
      knight: {
        viName: 'Mã',
        enName: 'Knight',
        shortVi: 'Mã',
        glyphW: '♘',
        glyphB: '♞',
        moveHint: 'Đi hình chữ L (2+1 ô), nhảy qua đầu quân khác'
      },
      bishop: {
        viName: 'Tượng',
        enName: 'Bishop',
        shortVi: 'Tượng',
        glyphW: '♗',
        glyphB: '♝',
        moveHint: 'Đi đường chéo không giới hạn số ô'
      },
      queen: {
        viName: 'Hậu',
        enName: 'Queen',
        shortVi: 'Hậu',
        glyphW: '♕',
        glyphB: '♛',
        moveHint: 'Đi ngang, dọc và chéo mọi khoảng cách'
      },
      king: {
        viName: 'Vua',
        enName: 'King',
        shortVi: 'Vua',
        glyphW: '♔',
        glyphB: '♚',
        moveHint: 'Đi 1 ô mọi hướng • Mất Vua là thua ván cờ'
      },
      advisor: XIANGQI_ROLE_METADATA.advisor,
      elephant: XIANGQI_ROLE_METADATA.elephant,
      cannon: XIANGQI_ROLE_METADATA.cannon
    };
    function getRoleMetadata(type) {
      if (gameVariant === 'xiangqi' && XIANGQI_ROLE_METADATA[type]) {
        return XIANGQI_ROLE_METADATA[type];
      }
      return PIECE_ROLE_METADATA[type] || PIECE_ROLE_METADATA.pawn;
    }
    const PIECE_HEIGHTS = {
      pawn: 0.30,
      advisor: 0.37,
      cannon: 0.35,
      rook: 0.39,
      elephant: 0.41,
      knight: 0.42,
      bishop: 0.43,
      queen: 0.46,
      king: 0.50
    };
    const MIN_PIECE_SEP = 0.305; // Spacious 0.44m squares with 0.66 scale factor give +58% clear gap between adjacent pieces
    const MELEE_STANDOFF = 0.36; // Optimal melee standoff for 0.44m squares so weapon blades cleave cleanly into defender before burst

    function boardToWorld(r, c) {
      if (gameVariant === 'xiangqi') {
        return new THREE.Vector3(
          (c - 4.0) * XIANGQI_SQ_SIZE,
          BOARD_SURFACE_Y,
          (r - 4.5) * XIANGQI_SQ_SIZE
        );
      }
      return new THREE.Vector3(
        (c - 3.5) * BOARD_SQ_SIZE,
        BOARD_SURFACE_Y,
        (r - 3.5) * BOARD_SQ_SIZE
      );
    }

    function easeInOutCubic(x) {
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }

    function easeOutCubic(x) {
      return 1 - Math.pow(1 - x, 3);
    }

    // =========================================================================
    // Scene, Camera, Renderer, and Cathedral Lighting
    // =========================================================================
    const container = document.getElementById('canvas-container') || document.getElementById('viewport-container');
    if (container) container.innerHTML = '';
    const isAutomatedTest = Boolean(
      navigator.webdriver || new URLSearchParams(window.location.search).get('autotest') === '1'
    );
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: isAutomatedTest
    });
    const deviceDprCap = Math.min(window.devicePixelRatio || 1, 1.35);
    let maxTargetDpr = deviceDprCap;
    const coarsePointerQuery = window.matchMedia?.('(pointer: coarse)');
    const isCoarseOrMobile = Boolean(window.innerWidth <= 768 || coarsePointerQuery?.matches);
    const nativeDeviceDpr = window.devicePixelRatio || 1;
    const mobileRetinaDpr = Math.min(Math.max(nativeDeviceDpr, 1.75), 2.0);
    let currentActiveDpr = isCoarseOrMobile ? mobileRetinaDpr : maxTargetDpr;
    let rollingFrameMs = 16.67;
    let highFrameTimeStreak = 0;
    let lowFrameTimeStreak = 0;
    let lastDprAdjustTime = 0;
    let isWebGLContextLost = false;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(currentActiveDpr);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.24;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Every frame goes through renderFrame and every size change through applyRendererSize, so the
    // post-processing composer (present on the high and ultra tiers) can never fall out of step.
    let postComposer = null;
    function renderFrame(dt = 0) {
      if (postComposer) postComposer.render(dt);
      else renderer.render(scene, camera);
    }
    function applyRendererSize() {
      renderer.setPixelRatio(currentActiveDpr);
      renderer.setSize(window.innerWidth, window.innerHeight);
      if (postComposer) resizePostComposer();
    }
    let postPasses = { gtao: null, bokeh: null, bloom: null };
    let builtTier = null;
    function resizePostComposer() {
      if (!postComposer) return;
      postComposer.setPixelRatio(currentActiveDpr);
      postComposer.setSize(window.innerWidth, window.innerHeight);
      // The composer resizes every pass to full size, so GTAO is halved afterwards. Bloom halves its input
      // internally, so passing half the buffer gives quarter-resolution bloom targets.
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (postPasses.gtao) postPasses.gtao.setSize(Math.ceil(size.x / 2), Math.ceil(size.y / 2));
      if (postPasses.bloom) postPasses.bloom.setSize(Math.ceil(size.x / 2), Math.ceil(size.y / 2));
    }
    function disposePostComposer() {
      if (!postComposer) return;
      // GTAOPass.dispose() leaves these two materials behind.
      postPasses.gtao?.gtaoMaterial?.dispose();
      postPasses.gtao?.blendMaterial?.dispose();
      for (const pass of postComposer.passes) pass.dispose?.();
      if (typeof postComposer.dispose === 'function') {
        postComposer.dispose();
      } else {
        postComposer.renderTarget1.dispose();
        postComposer.renderTarget2.dispose();
      }
      postComposer = null;
      postPasses = { gtao: null, bokeh: null, bloom: null };
    }
    // GTAO and Bokeh redraw the scene with depth/normal override materials, which turns flames, particles and
    // glass into solid shapes and paints dark AO silhouettes behind them. Those passes skip see-through objects.
    // The scan runs per frame because attack effects add and remove see-through meshes at any time.
    const isSeeThrough = (m) => m.transparent || m.depthWrite === false;
    const hiddenForDepth = [];
    // clearBackground: Bokeh packs depth into colour, so the scene background colour would read as near depth.
    function skipSeeThroughObjects(pass, clearBackground = false) {
      const render = pass.render.bind(pass);
      pass.render = (...args) => {
        const background = scene.background;
        if (clearBackground) scene.background = null;
        scene.traverseVisible((o) => {
          const m = o.material;
          if (m && (Array.isArray(m) ? m.some(isSeeThrough) : isSeeThrough(m))) hiddenForDepth.push(o);
        });
        for (const o of hiddenForDepth) o.visible = false;
        try {
          render(...args);
        } finally {
          for (const o of hiddenForDepth) o.visible = true;
          hiddenForDepth.length = 0;
          scene.background = background;
        }
      };
      return pass;
    }
    /** ultra: AO + depth of field (off until the kill-cam) + bloom; high: bloom; base: plain render. */
    function buildPostComposer(tier) {
      disposePostComposer();
      builtTier = tier;
      if (tier === 'base' || isWebGLContextLost) return;
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const halfFloatOk =
        renderer.capabilities.isWebGL2 &&
        Boolean(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
      // Composer targets ignore the canvas antialias flag. SMAA smooths edges instead of MSAA on the target:
      // multisampled float targets cost ~10 ms a frame on ANGLE Metal at DPR 1.35.
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: halfFloatOk ? THREE.HalfFloatType : THREE.UnsignedByteType
      });
      postComposer = new EffectComposer(renderer, rt);
      postComposer.addPass(new RenderPass(scene, camera));
      if (tier === 'ultra') {
        const gtao = skipSeeThroughObjects(new GTAOPass(scene, camera, size.x, size.y));
        gtao.blendIntensity = 0.85;
        gtao.updateGtaoMaterial({ radius: 0.25, distanceExponent: 1, thickness: 1, scale: 1, samples: 8 });
        postComposer.addPass(gtao);
        postPasses.gtao = gtao;
        const bokeh = skipSeeThroughObjects(new BokehPass(scene, camera, { focus: 6, aperture: 0.0025, maxblur: 0.008 }), true);
        bokeh.enabled = false;
        postComposer.addPass(bokeh);
        postPasses.bokeh = bokeh;
      }
      const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.45, 1.0);
      postComposer.addPass(bloom);
      postPasses.bloom = bloom;
      postComposer.addPass(new OutputPass());
      // SMAA expects tone-mapped sRGB input: its edge threshold and gamma-corrected blend assume display values.
      postComposer.addPass(new SMAAPass(size.x, size.y));
      resizePostComposer();
    }

    // Motion level and quality tier: saved choices win over the OS setting and device detection.
    function readGpuRendererString() {
      try {
        const gl = renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '');
      } catch {
        return '';
      }
    }
    const gpuRendererString = readGpuRendererString();
    const detectQualityTier = () =>
      pickQualityTier({
        // Not isCoarseOrMobile: a narrow desktop window must not be locked into the base tier.
        coarsePointer: Boolean(coarsePointerQuery?.matches),
        maxTouchPoints: navigator.maxTouchPoints || 0,
        gpuRenderer: gpuRendererString,
        isAutomatedTest
      });
    const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let visualSettings = loadVisualSettings();
    let motionLevel = resolveMotionLevel(visualSettings.motion, Boolean(reducedMotionQuery?.matches));
    let qualityPreference = visualSettings.quality || 'auto';
    let qualityTier = qualityPreference === 'auto' ? detectQualityTier() : qualityPreference;
    let qualityTierSource = qualityPreference === 'auto' ? 'auto' : 'saved';
    let slowFrameSeconds = 0;
    let lastTierAdjustTime = 0;

    // CSS reads the tier and motion level from <body> (the HUD glass drops its refraction on `base`).
    function syncVisualDataset() {
      document.body.dataset.qualityTier = qualityTier;
      document.body.dataset.motion = motionLevel;
    }
    syncVisualDataset();
    // navigator.userAgentData exists only in Chromium, so Safari and Firefox never get the SVG refraction.
    const supportsSvgBackdrop =
      'userAgentData' in navigator && window.CSS?.supports?.('backdrop-filter', 'url(#a)') === true;
    document.body.classList.toggle('svg-backdrop', supportsSvgBackdrop);

    function announceVisualSettings() {
      syncVisualDataset();
      window.dispatchEvent(
        new CustomEvent('wizardchess:visual-settings', {
          detail: { motionLevel, qualityTier, qualityTierSource, qualityPreference }
        })
      );
    }

    function setMotionLevel(level, persist = true) {
      if (level !== 'full' && level !== 'quick' && level !== 'off') return motionLevel;
      motionLevel = level;
      if (persist) visualSettings = saveVisualSettings({ motion: level });
      announceVisualSettings();
      return motionLevel;
    }

    /** `auto` re-runs device detection; any other value is saved as the user's choice. */
    function setQualityTier(preference, persist = true) {
      if (preference !== 'auto' && preference !== 'ultra' && preference !== 'high' && preference !== 'base') {
        return qualityTier;
      }
      qualityPreference = preference;
      qualityTier = preference === 'auto' ? detectQualityTier() : preference;
      qualityTierSource = preference === 'auto' ? 'auto' : 'saved';
      slowFrameSeconds = 0;
      if (persist) visualSettings = saveVisualSettings({ quality: preference });
      announceVisualSettings();
      return qualityTier;
    }

    reducedMotionQuery?.addEventListener?.('change', (e) => {
      if (!visualSettings.motion) setMotionLevel(e.matches ? 'off' : 'full', false);
    });
    if (renderer.debug) {
      renderer.debug.checkShaderErrors = false;
    }
    container.appendChild(renderer.domElement);

    renderer.domElement.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault();
        isWebGLContextLost = true;
        disposePostComposer();
      },
      false
    );
    renderer.domElement.addEventListener(
      'webglcontextrestored',
      () => {
        isWebGLContextLost = false;
        try {
          scene.environment = createCathedralPMREMEnvironment(renderer);
        } catch (err) {}
        scene.traverse((obj) => {
          if (obj.isMesh && obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const m of mats) {
              if (m) m.needsUpdate = true;
            }
          }
        });
        renderer.shadowMap.needsUpdate = true;
        buildPostComposer(qualityTier);
        renderFrame();
      },
      false
    );

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070a12);
    scene.fog = new THREE.FogExp2(0x080b14, 0.015);

    // Self-contained Cathedral PMREM Environment (inspired by three-gpu-pathtracer & realism-effects)
    function createCathedralPMREMEnvironment(glRenderer) {
      const pmremGen = new THREE.PMREMGenerator(glRenderer);
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x161412);
      const boxGeo = new THREE.BoxGeometry(1, 1, 1);
      const addPanel = (colorHex, intensity, pos, scl) => {
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(colorHex).multiplyScalar(intensity)
        });
        const m = new THREE.Mesh(boxGeo, mat);
        m.position.fromArray(pos);
        m.scale.fromArray(scl);
        envScene.add(m);
      };
      // Upper Gothic clerestory & Rose Window light panels
      addPanel(0xdce6f7, 2.4, [0, 9.5, -12.0], [10.0, 2.0, 1.5]);
      addPanel(0xffe0b5, 2.2, [0, 9.5, 12.0], [10.0, 2.0, 1.5]);
      addPanel(0xd4deee, 1.8, [-9.0, 6.5, 0.0], [1.2, 4.5, 16.0]);
      addPanel(0xd4deee, 1.8, [9.0, 6.5, 0.0], [1.2, 4.5, 16.0]);
      // Warm twin fire cauldron & limestone floor bounce panels
      addPanel(0xff9438, 3.2, [-4.5, 1.6, 0.0], [2.2, 2.2, 4.0]);
      addPanel(0xff9438, 3.2, [4.5, 1.6, 0.0], [2.2, 2.2, 4.0]);
      addPanel(0x6e5c49, 0.9, [0, -4.0, 0.0], [16.0, 1.0, 24.0]);
      const envTex = pmremGen.fromScene(envScene, 0.04).texture;
      boxGeo.dispose();
      pmremGen.dispose();
      return envTex;
    }

    scene.environment = createCathedralPMREMEnvironment(renderer);
    if ('environmentIntensity' in scene) {
      scene.environmentIntensity = 0.24;
    }

    const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.22, 65);
    const startPose = getSpectatorPose('w', getPortraitFramingFactor());
    camera.position.copy(startPose.pos);

    // `ultra` spends its frame budget on post-processing, so on desktop it renders at a lower DPR cap.
    // A tier change only lowers the current DPR; the adaptive path raises it back toward the cap when frames are fast.
    function applyDesktopDprCap(tier) {
      if (isCoarseOrMobile) return;
      maxTargetDpr = Math.min(deviceDprCap, tier === 'ultra' ? 1.25 : 1.35);
      if (currentActiveDpr > maxTargetDpr) {
        currentActiveDpr = maxTargetDpr;
        applyRendererSize();
      }
    }

    // The settings event only fires on changes, so the first build reads the tier directly.
    applyDesktopDprCap(qualityTier);
    buildPostComposer(qualityTier);
    window.addEventListener('wizardchess:visual-settings', (e) => {
      if (e.detail.qualityTier === builtTier) return;
      applyDesktopDprCap(e.detail.qualityTier);
      buildPostComposer(e.detail.qualityTier);
    });

    function getPortraitFramingFactor() {
      const w = Math.max(1, window.innerWidth || 1280);
      const h = Math.max(1, window.innerHeight || 800);
      const aspect = w / h;
      if (aspect >= 1.15) return 0;
      return Math.min(1, Math.max(0, (1.15 - aspect) / (1.15 - 0.46)));
    }

    function syncResponsiveCameraFov() {
      const tPortrait = getPortraitFramingFactor();
      const targetFov = Number((40 + tPortrait * 16).toFixed(2));
      if (Math.abs(camera.fov - targetFov) > 0.01) {
        camera.fov = targetFov;
        camera.updateProjectionMatrix();
      }
      return tPortrait;
    }
    syncResponsiveCameraFov();

    const origSetPointerCapture = renderer.domElement.setPointerCapture?.bind(renderer.domElement);
    if (origSetPointerCapture) {
      renderer.domElement.setPointerCapture = (pointerId) => {
        try {
          origSetPointerCapture(pointerId);
        } catch (e) {}
      };
    }
    const origReleasePointerCapture = renderer.domElement.releasePointerCapture?.bind(renderer.domElement);
    if (origReleasePointerCapture) {
      renderer.domElement.releasePointerCapture = (pointerId) => {
        try {
          origReleasePointerCapture(pointerId);
        } catch (e) {}
      };
    }

    let isCameraLocked = true;

    const orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.16;
    orbitControls.rotateSpeed = 0.55;
    orbitControls.zoomSpeed = 0.75;
    orbitControls.maxPolarAngle = Math.PI * 0.46;
    orbitControls.minPolarAngle = 0.12;
    orbitControls.minDistance = 1.45;
    orbitControls.maxDistance = 12.0;
    orbitControls.target.copy(startPose.lookAt);
    orbitControls.update();
    orbitControls.enabled = !isCameraLocked;

    let camPresetButtons = null;
    let camPresetActiveCleared = false;
    function clearCameraPresetActive() {
      if (camPresetActiveCleared) return;
      if (!camPresetButtons) {
        const found = document.querySelectorAll('#btn-cam-spectator, #btn-cam-player, #btn-cam-wide, #btn-cam-top, #btn-cam-side');
        if (found.length === 5) camPresetButtons = found;
      }
      const buttons = camPresetButtons || [];
      for (const b of buttons) b.classList.remove('active');
      if (camPresetButtons) camPresetActiveCleared = true;
    }

    let orbitDragStartPos = null;
    orbitControls.addEventListener('start', () => {
      orbitDragStartPos = camera.position.clone();
    });
    orbitControls.addEventListener('change', () => {
      if (orbitDragStartPos && camera.position.distanceTo(orbitDragStartPos) > 0.08) {
        clearCameraPresetActive();
      }
    });
    orbitControls.addEventListener('end', () => {
      orbitDragStartPos = null;
    });

    // =========================================================================
    // Feature 5: Hold Shift + Mouse Drag (Left=Rotate, Right=Pan) Axis Lock (X or Y)
    // =========================================================================
    let isShiftKeyDown = false;
    const shiftDragState = {
      active: false,
      startX: 0,
      startY: 0,
      lockedAxis: null // 'x' | 'y' | null
    };

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') isShiftKeyDown = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') {
        isShiftKeyDown = false;
        shiftDragState.lockedAxis = null;
      }
    });

    // Capture pointerdown BEFORE OrbitControls so Shift+LeftClick stays ROTATE (instead of OrbitControls' default Shift->PAN swap)
    renderer.domElement.addEventListener(
      'pointerdown',
      (e) => {
        shiftDragState.active = true;
        shiftDragState.startX = e.clientX;
        shiftDragState.startY = e.clientY;
        shiftDragState.lockedAxis = null;
        if (e.shiftKey) {
          isShiftKeyDown = true;
          if (e.button === 0) {
            try {
              Object.defineProperty(e, 'shiftKey', {
                get: () => false,
                configurable: true
              });
            } catch (err) {}
          }
        }
      },
      { capture: true }
    );

    window.addEventListener('pointerup', () => {
      shiftDragState.active = false;
      shiftDragState.lockedAxis = null;
    });

    const origHandleMouseMoveRotate = orbitControls._handleMouseMoveRotate.bind(orbitControls);
    orbitControls._handleMouseMoveRotate = function (event) {
      if (event.shiftKey || isShiftKeyDown) {
        const dx = Math.abs(event.clientX - shiftDragState.startX);
        const dy = Math.abs(event.clientY - shiftDragState.startY);
        if (!shiftDragState.lockedAxis && (dx > 2 || dy > 2)) {
          shiftDragState.lockedAxis = dx >= dy ? 'x' : 'y';
        }
        if (shiftDragState.lockedAxis === 'x') {
          return origHandleMouseMoveRotate({
            clientX: event.clientX,
            clientY: this._rotateStart.y
          });
        } else if (shiftDragState.lockedAxis === 'y') {
          return origHandleMouseMoveRotate({
            clientX: this._rotateStart.x,
            clientY: event.clientY
          });
        }
      } else {
        shiftDragState.lockedAxis = null;
      }
      return origHandleMouseMoveRotate(event);
    };

    const origHandleMouseMovePan = orbitControls._handleMouseMovePan.bind(orbitControls);
    orbitControls._handleMouseMovePan = function (event) {
      if (event.shiftKey || isShiftKeyDown) {
        const dx = Math.abs(event.clientX - shiftDragState.startX);
        const dy = Math.abs(event.clientY - shiftDragState.startY);
        if (!shiftDragState.lockedAxis && (dx > 2 || dy > 2)) {
          shiftDragState.lockedAxis = dx >= dy ? 'x' : 'y';
        }
        if (shiftDragState.lockedAxis === 'x') {
          return origHandleMouseMovePan({
            clientX: event.clientX,
            clientY: this._panStart.y
          });
        } else if (shiftDragState.lockedAxis === 'y') {
          return origHandleMouseMovePan({
            clientX: this._panStart.x,
            clientY: event.clientY
          });
        }
      } else {
        shiftDragState.lockedAxis = null;
      }
      return origHandleMouseMovePan(event);
    };

    // Dramatic Chiaroscuro Cathedral & Board Lighting (restoring original-example 3D stone relief & warm firelight contrast)
    const hemiLight = new THREE.HemisphereLight(0xd8ccb8, 0x261d14, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff0d6, 2.55);
    keyLight.position.set(5.0, 8.5, 1.5);
    keyLight.castShadow = true;
    const shadowMapRes = isCoarseOrMobile ? 1024 : 2048;
    keyLight.shadow.mapSize.width = shadowMapRes;
    keyLight.shadow.mapSize.height = shadowMapRes;
    keyLight.shadow.camera.near = 1.0;
    keyLight.shadow.camera.far = 22.0;
    const d = 2.65;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0004;
    scene.add(keyLight);

    // Subtle directional rim/fill (kept low so opposing directional lights never cancel normal-map mortar shadows)
    const rimLight = new THREE.DirectionalLight(0xd8cbb8, 1.10);
    rimLight.position.set(0.6, 3.2, -8.5);
    scene.add(rimLight);

    const southFillLight = new THREE.DirectionalLight(0xffe4c0, 1.10);
    southFillLight.position.set(4.2, 4.4, 7.5);
    scene.add(southFillLight);

    // Twin Flickering Brazier Point Lights (centered at x = +/-3.65, z = 0.00; flanking column bounce is evaluated in shader)
    const brazierCoords = [
      { pos: [-3.65, 1.08, 0.00], baseIntensity: 4.35, dist: 1.4 },
      { pos: [3.65, 1.08, 0.00], baseIntensity: 4.35, dist: 1.4 }
    ];
    const brazierLights = [];
    for (const cfg of brazierCoords) {
      const pLight = new THREE.PointLight(0xff8e32, cfg.baseIntensity, cfg.dist, 1.40);
      pLight.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      pLight.userData.baseIntensity = cfg.baseIntensity;
      scene.add(pLight);
      brazierLights.push(pLight);
    }

    // Realistic Gaseous GLSL Brazier Flames & Soft Warm Firelight Glow (zero bouncing shapes)
    const brazierFireUniforms = [];
    const brazierGlowSprites = [];

    function createSoftGlowTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createRadialGradient(128, 128, 2, 128, 128, 128);
      grad.addColorStop(0.0, 'rgba(255, 226, 155, 0.88)');
      grad.addColorStop(0.18, 'rgba(255, 154, 52, 0.50)');
      grad.addColorStop(0.45, 'rgba(255, 92, 16, 0.18)');
      grad.addColorStop(0.75, 'rgba(210, 48, 4, 0.04)');
      grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy?.() || 8);
      return tex;
    }

    // Strip the 14 tiny static icosphere spark balls baked above Opt8_Brazier_Flame_Mid (y > 1.26, height < 0.10)
    // while preserving 100% of the sculpted flame tongues (which start at y = 0.59..0.61)
    function stripIcosphereSparksFromFlameGeometry(geometry) {
      if (!geometry || !geometry.attributes || !geometry.attributes.position) return;
      const pos = geometry.attributes.position;
      if (geometry.index) {
        const idx = geometry.index.array;
        for (let i = 0; i < idx.length; i += 3) {
          const i0 = idx[i];
          const i1 = idx[i + 1];
          const i2 = idx[i + 2];
          const y0 = pos.getY(i0);
          const y1 = pos.getY(i1);
          const y2 = pos.getY(i2);
          const minY = Math.min(y0, y1, y2);
          if (minY > 1.25) {
            idx[i] = 0;
            idx[i + 1] = 0;
            idx[i + 2] = 0;
          }
        }
        geometry.index.needsUpdate = true;
      } else {
        for (let i = 0; i < pos.count; i += 3) {
          const y0 = pos.getY(i);
          const y1 = pos.getY(i + 1);
          const y2 = pos.getY(i + 2);
          if (Math.min(y0, y1, y2) > 1.25) {
            pos.setXYZ(i, 0, 0, 0);
            pos.setXYZ(i + 1, 0, 0, 0);
            pos.setXYZ(i + 2, 0, 0, 0);
          }
        }
        pos.needsUpdate = true;
      }
    }

    // =========================================================================
    // Cathedral Room Boundary Clamping (Floor, Ceiling, Side & End Walls)
    // & Solid Cylindrical Column Collision / Circumferential Sliding Solver
    // =========================================================================
    const CATHEDRAL_BOUNDS = {
      minX: -6.65,
      maxX: 6.65,
      minY: 0.34,
      maxY: 8.85,
      minZ: -18.10,
      maxZ: 18.10
    };

    // 12 freestanding columns spread wider across the nave; the 4 columns closest to the chessboard (z = +/-2.20)
    // have been removed to create a grand 13.70m open Atrium around the altar and centered fire braziers
    const CATHEDRAL_COLUMN_ROWS = [
      { z: -16.65, xAbs: 4.25 },
      { z: -11.85, xAbs: 4.25 },
      { z: -6.85,  xAbs: 4.65 },
      { z: 6.85,   xAbs: 4.65 },
      { z: 11.85,  xAbs: 4.25 },
      { z: 16.65,  xAbs: 4.25 }
    ];
    const CATHEDRAL_SOLID_PILLARS = [
      ...CATHEDRAL_COLUMN_ROWS.flatMap(({ z, xAbs }) => [
        { x: -xAbs, z, r: 0.86, maxY: 9.65, isColumn: true },
        { x: xAbs,  z, r: 0.86, maxY: 9.65, isColumn: true }
      ]),
      { x: -3.65, z: 0.00, r: 0.68, maxY: 1.95, isColumn: false },
      { x: 3.65,  z: 0.00, r: 0.68, maxY: 1.95, isColumn: false }
    ];

    function clampPointToCathedralRoom(pt, isTarget = false) {
      const margin = isTarget ? 0.15 : 0.0;
      pt.x = Math.max(CATHEDRAL_BOUNDS.minX - margin, Math.min(CATHEDRAL_BOUNDS.maxX + margin, pt.x));
      pt.z = Math.max(CATHEDRAL_BOUNDS.minZ - margin, Math.min(CATHEDRAL_BOUNDS.maxZ + margin, pt.z));
      // Account for the sloped side-aisle ceiling vault outside x = +/-4.15
      const aisleDrop = Math.max(0, Math.abs(pt.x) - 4.15) * 0.55;
      const localMaxY = Math.min(CATHEDRAL_BOUNDS.maxY, 9.05 - aisleDrop);
      const localMinY = isTarget ? 0.20 : CATHEDRAL_BOUNDS.minY;
      pt.y = Math.max(localMinY, Math.min(localMaxY, pt.y));
    }

    function enforceCathedralBoundsAndSolidColumns(prevPos, curPos, targetPos) {
      clampPointToCathedralRoom(targetPos, true);
      clampPointToCathedralRoom(curPos, false);

      if (isAnimatingMove) {
        if (Math.abs(curPos.x) < 2.58 && Math.abs(curPos.z) < 2.58) {
          curPos.y = Math.max(curPos.y, BOARD_SURFACE_Y + 0.30);
        }
        return;
      }

      const x0 = prevPos ? prevPos.x : curPos.x;
      const z0 = prevPos ? prevPos.z : curPos.z;
      let x1 = curPos.x;
      let z1 = curPos.z;
      const moveDx = x1 - x0;
      const moveDz = z1 - z0;
      const moveLenSq = moveDx * moveDx + moveDz * moveDz;
      const moveLen = Math.sqrt(moveLenSq);
      const isContinuousStep = Boolean(prevPos) && moveLen > 1e-5 && moveLen < 8.0;

      for (const p of CATHEDRAL_SOLID_PILLARS) {
        if (curPos.y > p.maxY) continue;

        let tClosest = 1.0;
        if (isContinuousStep) {
          tClosest = ((p.x - x0) * moveDx + (p.z - z0) * moveDz) / moveLenSq;
          tClosest = Math.max(0.0, Math.min(1.0, tClosest));
        }
        const cxSeg = x0 + moveDx * tClosest;
        const czSeg = z0 + moveDz * tClosest;
        const dSeg = isContinuousStep ? Math.hypot(cxSeg - p.x, czSeg - p.z) : Infinity;
        const dEnd = Math.hypot(x1 - p.x, z1 - p.z);

        if (dSeg < p.r || dEnd < p.r) {
          if (typeof window.__wizardChessTelemetry === 'object' && window.__wizardChessTelemetry && p.isColumn) {
            window.__wizardChessTelemetry.columnDeflections = (window.__wizardChessTelemetry.columnDeflections || 0) + 1;
          }

          if (isContinuousStep) {
            // Smooth tangential circumferential slide around the column
            const startAng = Math.atan2(z0 - p.z, x0 - p.x);
            const endAng = Math.atan2(z1 - p.z, x1 - p.x);
            let deltaAng = endAng - startAng;
            while (deltaAng > Math.PI) deltaAng -= Math.PI * 2;
            while (deltaAng < -Math.PI) deltaAng += Math.PI * 2;

            // Project step onto unit tangent at startAng; if pushing dead-on into column center, bias toward center aisle
            const tanX = -Math.sin(startAng);
            const tanZ = Math.cos(startAng);
            let tangMove = moveDx * tanX + moveDz * tanZ;
            if (Math.abs(tangMove) < moveLen * 0.18) {
              const aisleSign = (p.x >= 0 ? -1 : 1) * Math.sign(moveDz || 1);
              tangMove = (tangMove >= 0 ? 1 : aisleSign || 1) * moveLen * 0.65;
            }
            const arcStep = Math.sign(deltaAng || tangMove || 1) * Math.max(Math.abs(deltaAng), Math.min(Math.PI * 0.35, Math.abs(tangMove) / p.r));
            const newAng = startAng + arcStep;
            x1 = p.x + Math.cos(newAng) * p.r;
            z1 = p.z + Math.sin(newAng) * p.r;
          } else {
            const radX = x1 - p.x;
            const radZ = z1 - p.z;
            const radLen = Math.hypot(radX, radZ);
            if (radLen > 1e-4) {
              x1 = p.x + (radX / radLen) * p.r;
              z1 = p.z + (radZ / radLen) * p.r;
            } else {
              x1 = p.x + (p.x >= 0 ? -p.r : p.r);
              z1 = p.z;
            }
          }
        }
      }

      // Solid Grand Sanctum Battle Dais (4.92m stepped octagonal altar) & Larger 3.52m Chessboard collision
      // Prevents the camera from passing down through either the chessboard OR the surrounding Sanctum Battle Dais
      const ALTAR_TOP_Y = 0.742;
      const ALTAR_HALF_X = 2.58;
      const ALTAR_HALF_Z = 2.58;
      const BOARD_HALF_XZ = 1.96;
      if (Math.abs(targetPos.x) < 2.48 && Math.abs(targetPos.z) < 2.48) {
        const minTargetY =
          Math.abs(targetPos.x) < 1.88 && Math.abs(targetPos.z) < 1.88
            ? BOARD_SURFACE_Y + 0.05
            : ALTAR_TOP_Y + 0.05;
        if (targetPos.y < minTargetY) {
          targetPos.y = minTargetY;
        }
      }
      if (Math.abs(x1) < ALTAR_HALF_X && Math.abs(z1) < ALTAR_HALF_Z) {
        const isOverChessboard = Math.abs(x1) < BOARD_HALF_XZ && Math.abs(z1) < BOARD_HALF_XZ;
        const solidAltarTopY = isOverChessboard ? (BOARD_SURFACE_Y + 0.25) : (ALTAR_TOP_Y + 0.28); // 1.035m on board, 1.002m on black marble altar
        if (curPos.y < solidAltarTopY) {
          const wasInsideAltarFootprint =
            Boolean(prevPos) &&
            Math.abs(x0) < ALTAR_HALF_X - 0.005 &&
            Math.abs(z0) < ALTAR_HALF_Z - 0.005;
          const wasAboveAltarSlab =
            wasInsideAltarFootprint ||
            (Boolean(prevPos) && prevPos.y >= ALTAR_TOP_Y - 0.04) ||
            curPos.y >= ALTAR_TOP_Y - 0.10;
          if (wasAboveAltarSlab) {
            curPos.y = Math.max(curPos.y, solidAltarTopY);
          } else {
            const penX = ALTAR_HALF_X - Math.abs(x1);
            const penZ = ALTAR_HALF_Z - Math.abs(z1);
            if (penX < penZ) {
              x1 = (x1 >= 0 ? 1 : -1) * ALTAR_HALF_X;
            } else {
              z1 = (z1 >= 0 ? 1 : -1) * ALTAR_HALF_Z;
            }
          }
        }
      }

      // Solid Marble & Obsidian Chess Pieces collision during manual camera movement
      // (Bypassed when isAnimatingMove is true so automated duel/attack camera choreography never gets pinned between statues)
      if (
        !isAnimatingMove &&
        curPos.y < BOARD_SURFACE_Y + 0.85 &&
        typeof boardState === 'object' &&
        Array.isArray(boardState)
      ) {
        const pieceRad = 0.185;
        for (let r = 0; r < boardState.length; r++) {
          const row = boardState[r];
          if (!row) continue;
          for (let c = 0; c < row.length; c++) {
            const pc = row[c];
            if (!pc || !pc.mesh || !pc.mesh.parent) continue;
            const px = pc.mesh.position.x;
            const pz = pc.mesh.position.z;
            const pieceH = (typeof PIECE_HEIGHTS === 'object' && PIECE_HEIGHTS[pc.type]) ? PIECE_HEIGHTS[pc.type] : 0.42;
            const pieceTopY = pc.mesh.position.y + pieceH + 0.10;
            if (curPos.y >= pieceTopY) continue;

            let tPiece = 1.0;
            if (isContinuousStep) {
              tPiece = ((px - x0) * moveDx + (pz - z0) * moveDz) / moveLenSq;
              tPiece = Math.max(0.0, Math.min(1.0, tPiece));
            }
            const cxP = x0 + moveDx * tPiece;
            const czP = z0 + moveDz * tPiece;
            const dSegP = isContinuousStep ? Math.hypot(cxP - px, czP - pz) : Infinity;
            const dEndP = Math.hypot(x1 - px, z1 - pz);

            if (dSegP < pieceRad || dEndP < pieceRad) {
              if (
                prevPos &&
                prevPos.y >= pieceTopY - 0.08 &&
                Math.hypot(x0 - px, z0 - pz) < pieceRad * 0.85
              ) {
                curPos.y = Math.max(curPos.y, pieceTopY);
              } else {
                const radX = x1 - px;
                const radZ = z1 - pz;
                const radLen = Math.hypot(radX, radZ);
                if (radLen > 1e-4) {
                  x1 = px + (radX / radLen) * pieceRad;
                  z1 = pz + (radZ / radLen) * pieceRad;
                } else {
                  x1 = px + pieceRad;
                }
              }
            }
          }
        }
      }

      curPos.x = x1;
      curPos.z = z1;
      clampPointToCathedralRoom(curPos, false);

      // Update minimum column clearance telemetry across all 12 freestanding columns
      if (typeof window.__wizardChessTelemetry === 'object' && window.__wizardChessTelemetry) {
        let minClear = Infinity;
        for (const p of CATHEDRAL_SOLID_PILLARS) {
          if (!p.isColumn) continue;
          const d = Math.hypot(curPos.x - p.x, curPos.z - p.z);
          if (d < minClear) minClear = d;
        }
        window.__wizardChessTelemetry.lastColumnClearance = Number(minClear.toFixed(3));
        if (
          window.__wizardChessTelemetry.minColumnClearance === undefined ||
          minClear < window.__wizardChessTelemetry.minColumnClearance
        ) {
          window.__wizardChessTelemetry.minColumnClearance = Number(minClear.toFixed(3));
        }
      }
    }

    function createSculptedFlameTongueShader(cfg) {
      const uniforms = {
        uTime: { value: 0 },
        uZMin: { value: cfg.zMin },
        uZMax: { value: cfg.zMax },
        uLayerSeed: { value: cfg.layerSeed },
        uStrength: { value: cfg.strength },
        uOpacity: { value: cfg.opacity },
        uBaseColor: { value: new THREE.Color(...cfg.baseColor) },
        uMidColor: { value: new THREE.Color(...cfg.midColor) },
        uTipColor: { value: new THREE.Color(...cfg.tipColor) }
      };
      brazierFireUniforms.push(uniforms);

      return new THREE.ShaderMaterial({
        uniforms,
        vertexShader: `
          uniform float uTime;
          uniform float uZMin;
          uniform float uZMax;
          uniform float uLayerSeed;
          varying vec3 vLocalPos;
          varying vec3 vWorldPos;
          varying vec3 vWorldNormal;
          varying float vHeightNorm;

          void main() {
            vec3 pos = position;
            float h = clamp((pos.y - uZMin) / max(0.01, uZMax - uZMin), 0.0, 1.0);
            vHeightNorm = h;

            // Each brazier is centered at X = +/- 3.65, Z = 0.65 in local mesh space (world Z = 0.00)
            vec2 bCenter = vec2(sign(pos.x) * 3.65, 0.65);
            vec2 relXZ = vec2(pos.x, pos.z) - bCenter;

            // Distinct phase per sculpted tongue & fire layer so all 27 tongues dance independently
            float tonguePhase = relXZ.x * 14.0 + relXZ.y * 12.0 + uLayerSeed * 1.9;
            float sway = pow(h, 1.05);

            // Multi-frequency upward-propagating lateral flame wave (pinned at h = 0 in the logs)
            float waveX = sin(pos.y * 4.6 - uTime * 6.4 + tonguePhase) * 0.088
                        + cos(pos.y * 8.2 - uTime * 9.8 + tonguePhase * 1.35) * 0.048;
            float waveZ = cos(pos.y * 4.3 - uTime * 5.9 + tonguePhase * 1.15) * 0.088
                        + sin(pos.y * 7.8 - uTime * 9.1 + tonguePhase * 0.85) * 0.048;

            // Swirling thermal vortex twist + radial breathing around each brazier bowl
            float twistAngle = sin(uTime * 4.2 + pos.y * 4.5 + uLayerSeed) * 0.30 * sway;
            float cA = cos(twistAngle);
            float sA = sin(twistAngle);
            vec2 twistedXZ = vec2(relXZ.x * cA - relXZ.y * sA, relXZ.x * sA + relXZ.y * cA);
            float radialPulse = 1.0 + sin(uTime * 5.2 - h * 4.0 + tonguePhase) * 0.14 * sway;

            pos.x = bCenter.x + twistedXZ.x * radialPulse + waveX * sway;
            pos.z = bCenter.y + twistedXZ.y * radialPulse + waveZ * sway;

            // Active vertical flame-tongue licking (base h = 0 stays strictly anchored at uZMin)
            float lickStretch = 1.0 + (
              sin(uTime * 5.8 + tonguePhase * 1.3) * 0.22 +
              cos(uTime * 9.2 - tonguePhase * 0.9) * 0.12
            ) * smoothstep(0.05, 0.85, h);
            pos.y = uZMin + (pos.y - uZMin) * lickStretch;

            vLocalPos = pos;
            vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
            vWorldPos = worldPosition.xyz;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uZMin;
          uniform float uZMax;
          uniform float uLayerSeed;
          uniform float uStrength;
          uniform float uOpacity;
          uniform vec3 uBaseColor;
          uniform vec3 uMidColor;
          uniform vec3 uTipColor;
          varying vec3 vLocalPos;
          varying vec3 vWorldPos;
          varying vec3 vWorldNormal;
          varying float vHeightNorm;

          float hash3(vec3 p) {
            p = fract(p * vec3(443.897, 441.423, 437.195));
            p += dot(p, p.yzx + 19.19);
            return fract((p.x + p.y) * p.z);
          }

          float noise3(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(
                mix(hash3(i + vec3(0.0, 0.0, 0.0)), hash3(i + vec3(1.0, 0.0, 0.0)), f.x),
                mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x),
                f.y
              ),
              mix(
                mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x),
                mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x),
                f.y
              ),
              f.z
            );
          }

          void main() {
            float h = clamp(vHeightNorm, 0.0, 1.0);
            vec3 V = normalize(cameraPosition - vWorldPos);
            vec3 N = normalize(vWorldNormal);

            // Real-time port of Cycles LayerWeight.Facing^2.4 gaseous feathering
            float facing = clamp(abs(dot(N, V)), 0.0, 1.0);
            float powFacing = pow(facing, 2.25);

            // Fast upward-convecting 3D flame turbulence that actively carves the flame tips
            float n1 = noise3(vec3(vLocalPos.x * 5.4, vLocalPos.y * 4.8 - uTime * 6.8, vLocalPos.z * 5.4 + uLayerSeed));
            ${
              cfg.singleOctave
                ? 'float shimmer = n1;'
                : 'float n2 = noise3(vec3(vLocalPos.x * 10.2 + 1.9, vLocalPos.y * 8.5 - uTime * 10.5, vLocalPos.z * 10.2 - uLayerSeed));\n            float shimmer = mix(n1, n2, 0.45);'
            }

            // Dynamic tip erosion so flame tongues visibly lick up and recede
            float erodedH = clamp(h + (shimmer - 0.48) * 0.42 * smoothstep(0.08, 0.85, h), 0.0, 1.0);

            // Combine eroded height and (1.0 - facing) so grazing edges shift toward fiery orange-crimson
            float heatCoord = clamp(erodedH + (1.0 - facing) * 0.36 + (shimmer - 0.5) * 0.22, 0.0, 1.0);
            vec3 col = mix(uBaseColor, uMidColor, smoothstep(0.0, 0.45, heatCoord));
            col = mix(col, uTipColor, smoothstep(0.45, 0.90, heatCoord));

            float zAlpha = mix(0.96, 0.72, smoothstep(0.0, 0.68, erodedH)) * (1.0 - smoothstep(0.64, 0.98, erodedH));
            float baseSoft = smoothstep(0.0, 0.06, h);
            float flickerPulse = 0.76 + 0.48 * shimmer;
            float alpha = clamp(zAlpha * baseSoft * powFacing * uOpacity * flickerPulse, 0.0, 1.0);
            if (alpha < 0.004) discard;

            gl_FragColor = vec4(col * uStrength, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
    }

    function createCharredEmberLogsShader() {
      const uniforms = {
        uTime: { value: 0 }
      };
      brazierFireUniforms.push(uniforms);

      return new THREE.ShaderMaterial({
        uniforms,
        vertexShader: `
          varying vec3 vLocalPos;
          varying vec3 vWorldNormal;
          void main() {
            vLocalPos = position;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          varying vec3 vLocalPos;
          varying vec3 vWorldNormal;

          float hash3(vec3 p) {
            p = fract(p * vec3(443.897, 441.423, 437.195));
            p += dot(p, p.yzx + 19.19);
            return fract((p.x + p.y) * p.z);
          }

          float noise3(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(
                mix(hash3(i + vec3(0.0, 0.0, 0.0)), hash3(i + vec3(1.0, 0.0, 0.0)), f.x),
                mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x),
                f.y
              ),
              mix(
                mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x),
                mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x),
                f.y
              ),
              f.z
            );
          }

          void main() {
            // Dark charred timber bark (#0B0807) fissured with glowing incandescent 2200K orange cracks & glowing coal bed base
            float nCrack = noise3(vLocalPos * 18.0);
            float nFine = noise3(vLocalPos * 38.0 + vec3(0.0, uTime * 0.25, 0.0));
            float pulse = 0.88 + 0.12 * sin(uTime * 2.3 + vLocalPos.x * 4.0 + vLocalPos.z * 4.0);

            // Lower coal cone (y < 0.59) vs upper charred logs (y >= 0.59)
            float isCoalBed = 1.0 - smoothstep(0.56, 0.61, vLocalPos.y);
            float crackMask = smoothstep(0.68, 0.88, nCrack * 0.7 + nFine * 0.3);
            float underGlow = clamp(-vWorldNormal.y * 0.45 + 0.35, 0.0, 1.0) * smoothstep(0.72, 0.56, vLocalPos.y);

            vec3 charBark = vec3(0.035, 0.025, 0.020);
            vec3 emberOrange = vec3(1.0, 0.36, 0.04) * 1.45 * pulse;
            vec3 hotCoal = vec3(1.0, 0.58, 0.12) * 1.65 * pulse;

            float emberWeight = clamp(isCoalBed * (0.45 + 0.55 * nFine) + crackMask * 0.85 + underGlow * 0.45, 0.0, 1.0);
            vec3 col = mix(charBark, emberOrange, emberWeight);
            col = mix(col, hotCoal, smoothstep(0.72, 0.96, emberWeight));

            gl_FragColor = vec4(col, 1.0);
          }
        `
      });
    }

    function createBrazierWarmGlowHalos() {
      const glowTex = createSoftGlowTexture();
      const brazierCenters = [
        { x: -3.65, y: 0.56, z: 0.00, seed: 1.3 },
        { x: 3.65, y: 0.56, z: 0.00, seed: 5.8 }
      ];

      for (const b of brazierCenters) {
        // Layer 1: Inner warm hearth core glow halo centered in the flame body
        const coreGlowMat = new THREE.SpriteMaterial({
          map: glowTex,
          color: 0xffb866,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });
        const coreSprite = new THREE.Sprite(coreGlowMat);
        coreSprite.position.set(b.x, b.y + 0.28, b.z);
        coreSprite.scale.set(1.15, 1.25, 1.0);
        coreSprite.userData = { baseOpacity: 0.42, seed: b.seed };
        scene.add(coreSprite);
        brazierGlowSprites.push(coreSprite);

        // Layer 2: Wide, soft atmospheric warm glow halo bathing the surrounding air & ironwork
        const haloGlowMat = new THREE.SpriteMaterial({
          map: glowTex,
          color: 0xff8524,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });
        const haloSprite = new THREE.Sprite(haloGlowMat);
        haloSprite.position.set(b.x, b.y + 0.38, b.z);
        haloSprite.scale.set(2.45, 2.30, 1.0);
        haloSprite.userData = { baseOpacity: 0.28, seed: b.seed + 2.1 };
        scene.add(haloSprite);
        brazierGlowSprites.push(haloSprite);
      }
    }

    createBrazierWarmGlowHalos();

    // Window & end-wall grazing illumination is evaluated analytically in applyCathedralStoneRealismShader
    // and PMREM environment map (zero redundant PointLight BRDF loops per fragment).

    // Impact Flash Light (kept visible=true with intensity=0 when idle so Three.js never recompiles shaders mid-attack!)
    const impactFlashLight = new THREE.PointLight(0xffb74d, 0, 6.0, 1.5);
    impactFlashLight.visible = true;
    scene.add(impactFlashLight);

    // =========================================================================
    // Materials & 8 Multi-Style 3D Chess Skin Sets (Asymmetric Side Banks + 3D Kitbashing)
    // =========================================================================
    const whitePieceMat = new THREE.MeshStandardMaterial({
      color: 0xf2ece0,
      roughness: 0.30,
      metalness: 0.06
    });

    const blackPieceMat = new THREE.MeshStandardMaterial({
      color: 0x181c26,
      roughness: 0.24,
      metalness: 0.32,
      emissive: 0x0b0e15,
      emissiveIntensity: 0.22
    });

    const goldTrimMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.24,
      metalness: 0.88,
      emissive: 0xd4af37,
      emissiveIntensity: 0.22
    });

    const forgedSteelMat = new THREE.MeshStandardMaterial({
      color: 0xdce4ee,
      roughness: 0.20,
      metalness: 0.88,
      emissive: 0x222832,
      emissiveIntensity: 0.25
    });

    // Board and altar gold follows the white trim's colour, but never as polished as piece trim:
    // under bloom, a mirror-like rail reflects the cathedral light as a glare across the board edge.
    const BOARD_GOLD_MIN_ROUGHNESS = 0.39;
    const BOARD_GOLD_MAX_METALNESS = 0.3;
    const BOARD_GOLD_VALUE_SHARE = 0.5;
    const BOARD_GOLD_EMISSIVE_SHARE = 0.15;
    const boardGoldTrimMat = goldTrimMat.clone();
    function syncBoardGoldTrim() {
      boardGoldTrimMat.color.copy(goldTrimMat.color).multiplyScalar(BOARD_GOLD_VALUE_SHARE);
      boardGoldTrimMat.metalness = Math.min(goldTrimMat.metalness, BOARD_GOLD_MAX_METALNESS);
      boardGoldTrimMat.roughness = Math.max(goldTrimMat.roughness, BOARD_GOLD_MIN_ROUGHNESS);
      boardGoldTrimMat.emissive.copy(goldTrimMat.emissive);
      boardGoldTrimMat.emissiveIntensity = goldTrimMat.emissiveIntensity * BOARD_GOLD_EMISSIVE_SHARE;
    }
    syncBoardGoldTrim();

    const blackTrimMat = goldTrimMat.clone();
    const blackSteelMat = forgedSteelMat.clone();
    const whiteAccentMat = new THREE.MeshStandardMaterial({
      color: 0xf5d76e,
      roughness: 0.20,
      metalness: 0.90,
      emissive: 0xd4af37,
      emissiveIntensity: 0.38
    });
    const blackAccentMat = new THREE.MeshStandardMaterial({
      color: 0xf5d76e,
      roughness: 0.20,
      metalness: 0.90,
      emissive: 0xd4af37,
      emissiveIntensity: 0.38
    });

    // Distinct Warhorse Coat Materials (White/Red Knight vs Black Knight) & Role-Specific Royal Regalia Accents
    // A steed stays inside its side's value band (pale for White, dark for Black) and differs from the rider
    // by hue only, so a knight never reads as a piece of the other side.
    const whiteSteedMat = new THREE.MeshStandardMaterial({
      color: 0xecd8ba,
      roughness: 0.34,
      metalness: 0.06,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    });
    const blackSteedMat = new THREE.MeshStandardMaterial({
      color: 0x2c3850,
      roughness: 0.40,
      metalness: 0.18,
      emissive: 0x0b1220,
      emissiveIntensity: 0.22
    });
    const whiteQueenAccentMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7,
      roughness: 0.16,
      metalness: 0.68,
      emissive: 0x7e22ce,
      emissiveIntensity: 0.58
    });
    const blackQueenAccentMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      roughness: 0.16,
      metalness: 0.68,
      emissive: 0xbe123c,
      emissiveIntensity: 0.62
    });
    const whiteBishopAccentMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.16,
      metalness: 0.65,
      emissive: 0x0369a1,
      emissiveIntensity: 0.52
    });
    const blackBishopAccentMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.16,
      metalness: 0.65,
      emissive: 0x0284c7,
      emissiveIntensity: 0.52
    });
    const ivoryTuskMat = new THREE.MeshStandardMaterial({
      color: 0xfffbeb,
      roughness: 0.18,
      metalness: 0.12,
      emissive: 0x78350f,
      emissiveIntensity: 0.16
    });

    const sideMats = {
      w: {
        primary: whitePieceMat,
        trim: goldTrimMat,
        steel: forgedSteelMat,
        accent: whiteAccentMat,
        steed: whiteSteedMat,
        queenAccent: whiteQueenAccentMat,
        bishopAccent: whiteBishopAccentMat,
        ivoryTusk: ivoryTuskMat
      },
      b: {
        primary: blackPieceMat,
        trim: blackTrimMat,
        steel: blackSteelMat,
        accent: blackAccentMat,
        steed: blackSteedMat,
        queenAccent: blackQueenAccentMat,
        bishopAccent: blackBishopAccentMat,
        ivoryTusk: ivoryTuskMat
      }
    };

    // Sculpted base pieces carry a baked normal + AO map per piece type. The shared team materials have no
    // textures, so a mesh with maps gets a mirror of its team material that adds them.
    const BASE_PIECE_DETAIL_MAPS = {
      pawn: { normal: './assets/glb/detail/pawn_normal.webp', ao: './assets/glb/detail/pawn_ao.webp' },
      knight: { normal: './assets/glb/detail/knight_normal.webp', ao: './assets/glb/detail/knight_ao.webp' },
      rook: { normal: './assets/glb/detail/rook_normal.webp', ao: './assets/glb/detail/rook_ao.webp' },
      bishop: { normal: './assets/glb/detail/bishop_normal.webp', ao: './assets/glb/detail/bishop_ao.webp' },
      queen: { normal: './assets/glb/detail/queen_normal.webp', ao: './assets/glb/detail/queen_ao.webp' },
      king: { normal: './assets/glb/detail/king_normal.webp', ao: './assets/glb/detail/king_ao.webp' }
    };
    const bodyDetailByGeometry = new WeakMap();
    const bodyDetailMaterials = [];

    // Loads a template's normal + AO maps and registers them for its body (and steed) geometries.
    async function attachBodyDetailMaps(tpl, detailPaths, label) {
      if (!detailPaths) return;
      try {
        const texLoader = new THREE.TextureLoader();
        const [normalMap, aoMap] = await Promise.all([
          texLoader.loadAsync(`${detailPaths.normal}?${ASSET_CACHE_VER}`),
          texLoader.loadAsync(`${detailPaths.ao}?${ASSET_CACHE_VER}`)
        ]);
        for (const tex of [normalMap, aoMap]) {
          tex.flipY = false; // glTF UV convention
          tex.colorSpace = THREE.NoColorSpace;
          tex.anisotropy = 4;
          tex.needsUpdate = true;
        }
        const detail = { normalMap, aoMap, mats: new Map() };
        tpl.scene.traverse((child) => {
          if (!child.isMesh || !child.geometry) return;
          const mName = child.userData?.origMatName || child.material?.name || '';
          if (/Gold|Trim|Bronze|Glow|Steel/i.test(mName) && !child.userData?.isSteedMesh) return;
          bodyDetailByGeometry.set(child.geometry, detail);
        });
      } catch (err) {
        console.warn(`Detail maps for ${label} failed to load:`, err);
      }
    }

    function resolveBodyMaterial(sourceMat, mesh) {
      const detail = mesh && mesh.geometry ? bodyDetailByGeometry.get(mesh.geometry) : null;
      if (!detail) return sourceMat;
      let mat = detail.mats.get(sourceMat);
      if (!mat) {
        mat = sourceMat.clone();
        mat.normalMap = detail.normalMap;
        mat.aoMap = detail.aoMap;
        // The meshes have no tangents and the maps use glTF UVs (flipY = false): same sign fix as GLTFLoader.
        mat.normalScale.set(1, -1);
        mat.needsUpdate = true;
        detail.mats.set(sourceMat, mat);
        bodyDetailMaterials.push({ mat, source: sourceMat });
      }
      return mat;
    }

    function syncBodyDetailMaterials() {
      for (const { mat, source } of bodyDetailMaterials) {
        mat.color.copy(source.color);
        mat.roughness = source.roughness;
        mat.metalness = source.metalness;
        mat.emissive.copy(source.emissive);
        mat.emissiveIntensity = source.emissiveIntensity;
      }
    }

    const PIECE_THEMES = {
      hogwarts: {
        id: 'hogwarts',
        name: 'Thánh Đường Cổ Điển',
        subtitle: 'Cẩm Thạch Trắng & Hắc Diện Thạch Mạ Vàng',
        shatterColor: 0xffb74d,
        altarGlowColor: 0xd4af37,
        lightSqHex: 0xe6decb,
        darkSqHex: 0x232a3a,
        white: { color: 0xf2ece0, roughness: 0.30, metalness: 0.06, emissive: 0x000000, emissiveIntensity: 0.0 },
        // Charcoal rather than pure black, and mostly diffuse, so the light models the form of a black piece.
        black: { color: 0x222734, roughness: 0.42, metalness: 0.15, emissive: 0x0b0e15, emissiveIntensity: 0.22 },
        trim: { color: 0xd4af37, roughness: 0.24, metalness: 0.88, emissive: 0xd4af37, emissiveIntensity: 0.22 },
        steel: { color: 0xdce4ee, roughness: 0.20, metalness: 0.88, emissive: 0x222832, emissiveIntensity: 0.25 }
      },
    };

    const PIECE_THEME_ORDER = ['hogwarts'];
    let currentPieceThemeId = 'hogwarts';
    let pieceMaskViewState = null;
    let activeSkinWhite = 'hogwarts';
    let activeSkinBlack = 'hogwarts';

    // Skin sets that ship their own piece models under assets/glb/sets/<id>/. None ship today; a new skin
    // package registers its id here and adds a PIECE_THEMES entry.
    const SCULPTED_SET_IDS = new Set();
    const skinSetLoadPromises = {};
    const loadedCustomSkinSets = [];

    function disposePieceRuntimeResources(root, mixer) {
      if (mixer) {
        mixer.stopAllAction();
        if (root) {
          try {
            mixer.uncacheRoot(root);
          } catch (e) {}
        }
      }
      if (!root) return;
      const disposedSkeletons = new Set();
      root.traverse((child) => {
        if (child.isSkinnedMesh && child.skeleton && !disposedSkeletons.has(child.skeleton)) {
          disposedSkeletons.add(child.skeleton);
          if (typeof child.skeleton.dispose === 'function') {
            try {
              child.skeleton.dispose();
            } catch (e) {}
          }
        }
      });
    }

    function swapPieceTemplateMesh(pieceObj, targetSetId) {
      if (!pieceObj || !pieceObj.mesh) return false;
      const tpl =
        pieceTemplates[`${targetSetId}__${pieceObj.type}`] ||
        pieceTemplates[`hogwarts__${pieceObj.type}`] ||
        pieceTemplates[`${pieceObj.type}_${pieceObj.color}`];
      if (!tpl || !tpl.scene) return false;

      const oldRoot = pieceObj.mesh;
      const oldMixer = pieceObj.mixer;
      const newRoot = SkeletonUtils.clone(tpl.scene);
      newRoot.position.copy(oldRoot.position);
      applyPieceBaseScale(newRoot, pieceObj.type);
      newRoot.rotation.copy(oldRoot.rotation);

      let sharedPieceSkeleton = null;
      let sharedPieceBindMatrix = null;
      newRoot.traverse((child) => {
        const nm = child.name || '';
        if (nm.includes('Icosphere') || nm.includes('glTF_not_exported')) {
          child.visible = false;
          return;
        }
        child.userData.piece = pieceObj;
        if (child.isMesh) {
          child.raycast = () => {};
          if (child.isSkinnedMesh) {
            if (!child.boundingSphere) {
              const gSphere = child.geometry?.boundingSphere;
              child.boundingSphere = gSphere
                ? new THREE.Sphere(gSphere.center.clone(), Math.max(gSphere.radius * 1.4, 2.5))
                : new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 3.0);
            }
            child.computeBoundingSphere = function () {
              if (!this.boundingSphere) {
                this.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 3.0);
              }
            };
            if (child.skeleton) {
              if (!sharedPieceSkeleton) {
                sharedPieceSkeleton = child.skeleton;
                sharedPieceBindMatrix = child.bindMatrix;
              } else if (
                sharedPieceSkeleton.bones.length === child.skeleton.bones.length &&
                (!sharedPieceBindMatrix || !child.bindMatrix || sharedPieceBindMatrix.equals(child.bindMatrix))
              ) {
                const prevSkel = child.skeleton;
                child.bind(sharedPieceSkeleton, child.bindMatrix);
                if (prevSkel && prevSkel !== sharedPieceSkeleton && typeof prevSkel.dispose === 'function') {
                  prevSkel.dispose();
                }
              }
            }
          }
          const mName = child.userData.origMatName || child.material?.name || '';
          if (!child.userData.origMatName && mName) {
            child.userData.origMatName = mName;
          }
        }
      });

      if (pieceObj.hitbox) {
        newRoot.add(pieceObj.hitbox);
      }
      if (pieceObj.pedestalRing) {
        newRoot.add(pieceObj.pedestalRing);
      }

      if (oldMixer) {
        if (typeof activeCombatMixers !== 'undefined') {
          activeCombatMixers.delete(oldMixer);
        }
        const mIdx = activeMixers.indexOf(oldMixer);
        if (mIdx !== -1) activeMixers.splice(mIdx, 1);
      }
      disposePieceRuntimeResources(oldRoot, oldMixer);

      if (oldRoot.parent) {
        oldRoot.parent.remove(oldRoot);
      }
      scene.add(newRoot);

      const newMixer = new THREE.AnimationMixer(newRoot);
      newMixer.userData = { piece: pieceObj };
      const newActions = {};
      for (const clip of tpl.animations || []) {
        newActions[clip.name] = newMixer.clipAction(clip);
      }
      activeMixers.push(newMixer);

      pieceObj.mesh = newRoot;
      pieceObj.mixer = newMixer;
      pieceObj.actions = newActions;
      pieceObj.currentAction = null;
      pieceObj.loadedSetId = targetSetId;

      playPieceClip(pieceObj, 'Idle', true, 0);
      newMixer.update(0.0001);
      return true;
    }

    // Pre-allocated shared geometries for 3D Role Regalia (King Sovereign Spire & Double Ring, Queen Phoenix Diadem, Elephant Ivory Tusks)
    const ROLE_REGALIA_SHARED_GEOS = (() => {
      const mark = (g) => {
        g.computeBoundingBox();
        g.computeBoundingSphere();
        g.userData = { isSharedPool: true };
        return g;
      };
      const kingOuterRing = new THREE.RingGeometry(0.54, 0.63, 32);
      kingOuterRing.rotateX(-Math.PI / 2);
      kingOuterRing.translate(0, 0.018, 0);

      const kingSpireShaft = new THREE.CylinderGeometry(0.024, 0.042, 0.36, 8);
      const kingCrossBar = new THREE.BoxGeometry(0.24, 0.042, 0.042);
      const kingSunHalo = new THREE.TorusGeometry(0.19, 0.022, 8, 24);
      const kingCrownOrb = new THREE.OctahedronGeometry(0.082, 0);

      const queenDiademRing = new THREE.TorusGeometry(0.20, 0.018, 8, 24);
      queenDiademRing.rotateX(Math.PI / 2);
      const queenWaistSash = new THREE.TorusGeometry(0.23, 0.024, 8, 24);
      queenWaistSash.rotateX(Math.PI / 2);
      const queenPhoenixPearl = new THREE.OctahedronGeometry(0.076, 1);

      const bishopHaloRing = new THREE.TorusGeometry(0.16, 0.016, 8, 24);
      const elephantTusk = new THREE.ConeGeometry(0.038, 0.34, 8);
      const elephantHowdahGem = new THREE.OctahedronGeometry(0.095, 0);

      return {
        kingOuterRing: mark(kingOuterRing),
        kingSpireShaft: mark(kingSpireShaft),
        kingCrossBar: mark(kingCrossBar),
        kingSunHalo: mark(kingSunHalo),
        kingCrownOrb: mark(kingCrownOrb),
        queenDiademRing: mark(queenDiademRing),
        queenWaistSash: mark(queenWaistSash),
        queenPhoenixPearl: mark(queenPhoenixPearl),
        bishopHaloRing: mark(bishopHaloRing),
        elephantTusk: mark(elephantTusk),
        elephantHowdahGem: mark(elephantHowdahGem)
      };
    })();

    function attachPieceRoleRegalia(pieceObj) {
      if (!pieceObj || !pieceObj.mesh) return;
      const root = pieceObj.mesh;
      const bank = sideMats[pieceObj.color] || sideMats.w;
      const existing = root.getObjectByName('PieceRoleRegaliaGroup');
      if (existing && existing.parent) {
        existing.parent.remove(existing);
      }

      const type = pieceObj.type;
      if (type !== 'king' && type !== 'queen' && type !== 'bishop' && type !== 'elephant' && type !== 'advisor') {
        return;
      }
      // The sculpted base statues carry their own crown, coronet and mitre, and the xiangqi figures their own
      // plume, hat, tusks and howdah; floating regalia only hides them.
      const isXiangqiFigure = pieceObj.loadedSetId === 'xiangqi';
      if (isXiangqiFigure && type !== 'king') return;
      if (pieceObj.loadedSetId === 'hogwarts' && (type === 'king' || type === 'queen' || type === 'bishop')) {
        return;
      }

      const grp = new THREE.Group();
      grp.name = 'PieceRoleRegaliaGroup';
      grp.userData = { isRoleRegalia: true, isSharedPool: true, piece: pieceObj };
      const addPart = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        if (rx || ry || rz) m.rotation.set(rx, ry, rz);
        m.castShadow = false;
        m.receiveShadow = false;
        m.raycast = () => {};
        m.userData = { isRoleRegaliaMesh: true, isSharedPool: true, piece: pieceObj };
        m.updateMatrix();
        m.matrixAutoUpdate = false;
        grp.add(m);
        return m;
      };

      if (type === 'king') {
        // Sovereign Double Pedestal Ring + Towering Imperial Sun-Cross Spire (y = 1.60..1.96)
        addPart(ROLE_REGALIA_SHARED_GEOS.kingOuterRing, bank.trim, 0, 0, 0);
        // The xiangqi general keeps only the ground ring, which marks it on the 9x10 board.
        if (!isXiangqiFigure) {
          addPart(ROLE_REGALIA_SHARED_GEOS.kingSpireShaft, bank.trim, 0, 1.72, 0);
          addPart(ROLE_REGALIA_SHARED_GEOS.kingCrossBar, bank.trim, 0, 1.78, 0);
          addPart(ROLE_REGALIA_SHARED_GEOS.kingSunHalo, bank.trim, 0, 1.72, 0);
          addPart(ROLE_REGALIA_SHARED_GEOS.kingCrownOrb, bank.accent, 0, 1.92, 0);
        }
      } else if (type === 'queen') {
        // Empress Phoenix Rose Diadem + Amethyst/Ruby Waist Sash & Floating Crown Pearl
        addPart(ROLE_REGALIA_SHARED_GEOS.queenWaistSash, bank.queenAccent, 0, 0.72, 0);
        addPart(ROLE_REGALIA_SHARED_GEOS.queenDiademRing, bank.queenAccent, 0, 1.54, 0, 0.18, 0, 0);
        addPart(ROLE_REGALIA_SHARED_GEOS.queenPhoenixPearl, bank.queenAccent, 0, 1.70, 0);
      } else if (type === 'elephant') {
        // Xiangqi War-Elephant: Twin Curved Ivory Tusks projecting forward + Jade Howdah Crest
        addPart(ROLE_REGALIA_SHARED_GEOS.elephantTusk, bank.ivoryTusk, -0.17, 0.68, 0.30, Math.PI * 0.34, 0, 0.22);
        addPart(ROLE_REGALIA_SHARED_GEOS.elephantTusk, bank.ivoryTusk, 0.17, 0.68, 0.30, Math.PI * 0.34, 0, -0.22);
        addPart(ROLE_REGALIA_SHARED_GEOS.bishopHaloRing, bank.bishopAccent, 0, 1.38, 0, Math.PI / 2, 0, 0);
        addPart(ROLE_REGALIA_SHARED_GEOS.elephantHowdahGem, bank.bishopAccent, 0, 1.50, 0);
      } else if (type === 'bishop') {
        // Chess Bishop: Sapphire Arcane Halo & Mitre Crystal
        addPart(ROLE_REGALIA_SHARED_GEOS.bishopHaloRing, bank.bishopAccent, 0, 1.48, 0, Math.PI * 0.35, 0, 0);
        addPart(ROLE_REGALIA_SHARED_GEOS.queenPhoenixPearl, bank.bishopAccent, 0, 1.64, 0);
      } else if (type === 'advisor') {
        // Xiangqi Advisor: Slender Palace Guard Silver-Jade Collar Ring
        addPart(ROLE_REGALIA_SHARED_GEOS.bishopHaloRing, bank.steel, 0, 1.06, 0, Math.PI / 2, 0, 0);
      }

      grp.updateMatrix();
      grp.matrixAutoUpdate = false;
      root.add(grp);
    }

    function attachSkinKitbashToPiece(pieceObj) {
      if (!pieceObj || !pieceObj.mesh) return;
      const skinId = pieceObj.color === 'b' ? activeSkinBlack : activeSkinWhite;
      const targetSetId = gameVariant === 'xiangqi' ? 'xiangqi' : (SCULPTED_SET_IDS.has(skinId) ? skinId : 'hogwarts');

      if (gameVariant === 'xiangqi') {
        if (!pieceTemplates[`xiangqi__${pieceObj.type}`]) {
          ensureXiangqiModelsLoaded();
        } else if (
          pieceObj.loadedSetId !== 'xiangqi' &&
          (typeof isAnimatingMove === 'undefined' || !isAnimatingMove)
        ) {
          swapPieceTemplateMesh(pieceObj, 'xiangqi');
        }
      } else {
        if (targetSetId !== 'hogwarts' && !pieceTemplates[`${targetSetId}__${pieceObj.type}`]) {
          ensureSkinSetLoaded(targetSetId);
        } else if (
          pieceObj.loadedSetId !== targetSetId &&
          pieceTemplates[`${targetSetId}__${pieceObj.type}`] &&
          (typeof isAnimatingMove === 'undefined' || !isAnimatingMove)
        ) {
          swapPieceTemplateMesh(pieceObj, targetSetId);
        }
      }

      const root = pieceObj.mesh;
      const bank = sideMats[pieceObj.color] || sideMats.w;
      applyPieceBaseScale(root, pieceObj.type);

      // Bind the PBR material slots + Role-Specific Steed / Queen / Bishop / Elephant / Advisor Accents
      root.traverse((child) => {
        if (
          !child.isMesh ||
          (child.userData &&
            (child.userData.isHitboxProxy || child.userData.isPedestalRing || child.userData.isRoleRegaliaMesh))
        ) {
          return;
        }
        const nm = child.name || '';
        if (nm.includes('Icosphere') || nm.includes('glTF_not_exported')) {
          child.visible = false;
          return;
        }
        child.visible = true;
        const mName = child.userData.origMatName || child.material?.name || '';
        if (!child.userData.origMatName && mName) {
          child.userData.origMatName = mName;
        }
        const isSteed = Boolean(
          child.userData?.isSteedMesh || nm.endsWith('_Steed') || mName.includes('KnightSteedCoat')
        );
        if (isSteed) {
          child.material = resolveBodyMaterial(bank.steed, child);
          child.castShadow = true;
          child.receiveShadow = true;
        } else if (mName.includes('Glow')) {
          if (pieceObj.type === 'queen') {
            child.material = bank.queenAccent;
          } else if (pieceObj.type === 'bishop') {
            child.material = bank.bishopAccent;
          } else {
            child.material = bank.accent;
          }
          child.castShadow = false;
          child.receiveShadow = false;
        } else if (mName.includes('Gold') || mName.includes('Trim') || mName.includes('Bronze')) {
          child.material = bank.trim;
          child.castShadow = false;
          child.receiveShadow = false;
        } else if (mName.includes('Steel')) {
          if (pieceObj.type === 'queen') {
            child.material = bank.queenAccent;
          } else {
            child.material = bank.steel;
          }
          child.castShadow = true;
          child.receiveShadow = false;
        } else {
          child.material = resolveBodyMaterial(bank.primary, child);
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      attachPieceRoleRegalia(pieceObj);

      pieceObj.idleSettleRemaining = Math.max(pieceObj.idleSettleRemaining || 0, 0.12);
      if (pieceObj.mixer) {
        pieceObj.mixer.update(0.001);
      }
      root.updateMatrixWorld(true);
    }

    // Sanctum Arena Altar & Outer Perimeter Amphitheater dynamic materials & floating sentinel crystals
    let sanctumRuneRingMat = null;
    let sanctumMoatGlowMat = null;
    let sanctumLightSqMat = null;
    let sanctumDarkSqMat = null;
    let sanctumOuterStoneMat = null;
    let sanctumOuterTrimMat = null;
    let sanctumOuterGlowMat = null;
    let sanctumPerimeterMotesUniforms = null;
    let currentOuterMonumentArchetype = 'hogwarts';
    const outerMonumentGroupsByTheme = {};
    const sanctumRelicCrystals = [];
    const sanctumOuterFloatingRelics = [];

    const BRAZIER_FLAME_PALETTES = {
      hogwarts: {
        light: 0xff9d3b,
        coreSprite: 0xffb866,
        haloSprite: 0xff8524,
        layers: [
          { base: [1.35, 0.96, 0.42], mid: [1.18, 0.62, 0.14], tip: [0.92, 0.30, 0.05] },
          { base: [1.18, 0.72, 0.22], mid: [1.02, 0.40, 0.07], tip: [0.68, 0.14, 0.02] },
          { base: [0.95, 0.45, 0.09], mid: [0.76, 0.20, 0.03], tip: [0.38, 0.05, 0.01] }
        ]
      },
    };

    // Value ladder for play: black pieces < dark squares < light squares < white pieces. Both square colours sit in
    // the mid-tones so a white piece is clearly lighter and a black piece clearly darker than any square it stands on.
    // A theme keeps its hue; only the luminance (linear, relative) is set here.
    const OUTER_TRIM_VALUE_SHARE = 0.5;
    // Floor lines and arena ornaments away from the table sit lower still, so they frame the board without competing.
    const ARENA_FLOOR_TRIM_VALUE_SHARE = 0.3;
    const ARENA_FLOOR_GLOW_INTENSITY = 0.05;
    // The lips of the table's base sit right under the dark apron, where any mid-value gold reads as a bright bar.
    const TABLE_BASE_LIP_VALUE_SHARE = 0.14;
    const BOARD_LIGHT_SQ_LUMINANCE = 0.152;
    const BOARD_DARK_SQ_LUMINANCE = 0.08;
    // Squares keep only part of the theme hue, so a piece of the same hue still separates from its square.
    const BOARD_LIGHT_SQ_CHROMA = 0.7;
    const BOARD_DARK_SQ_CHROMA = 0.55;
    function setSquareColorAtLuminance(target, hex, luminance, chroma) {
      target.setHex(hex);
      const current = 0.2126 * target.r + 0.7152 * target.g + 0.0722 * target.b;
      if (current < 1e-4) return target.setScalar(luminance);
      const grey = new THREE.Color(luminance, luminance, luminance);
      target.multiplyScalar(luminance / current).lerp(grey, 1 - chroma);
      const peak = Math.max(target.r, target.g, target.b);
      if (peak > 1) target.lerp(grey, 1 - 1 / peak);
      return target;
    }

    function updateSanctumAltarTheme(theme) {
      if (!theme) return;
      const glowHex = theme.altarGlowColor || 0xd4af37;
      const trimHex = theme.trim?.color || 0xd4af37;
      if (sanctumRuneRingMat) {
        sanctumRuneRingMat.emissive.setHex(glowHex);
        sanctumRuneRingMat.color.setHex(trimHex);
        sanctumRuneRingMat.needsUpdate = true;
      }
      if (sanctumMoatGlowMat) {
        sanctumMoatGlowMat.color.setHex(glowHex).multiplyScalar(TABLE_BASE_LIP_VALUE_SHARE);
        sanctumMoatGlowMat.emissive.setHex(glowHex);
        sanctumMoatGlowMat.needsUpdate = true;
      }
      if (sanctumLightSqMat && theme.lightSqHex) {
        setSquareColorAtLuminance(sanctumLightSqMat.color, theme.lightSqHex, theme.boardLightLuminance || BOARD_LIGHT_SQ_LUMINANCE, BOARD_LIGHT_SQ_CHROMA);
        sanctumLightSqMat.needsUpdate = true;
      }
      if (sanctumDarkSqMat && theme.darkSqHex) {
        setSquareColorAtLuminance(sanctumDarkSqMat.color, theme.darkSqHex, theme.boardDarkLuminance || BOARD_DARK_SQ_LUMINANCE, BOARD_DARK_SQ_CHROMA);
        sanctumDarkSqMat.needsUpdate = true;
      }
      for (const cr of sanctumRelicCrystals) {
        if (cr.mesh && cr.mesh.material) {
          cr.mesh.material.color.setHex(glowHex);
          cr.mesh.material.emissive.setHex(glowHex);
        }
      }

      // Sync Outer Perimeter Amphitheater & 8 Theme-Reactive Monument Archetypes (Δgeometries = 0)
      const archetype = 'hogwarts';
      currentOuterMonumentArchetype = archetype;
      for (const [key, grp] of Object.entries(outerMonumentGroupsByTheme)) {
        if (grp) {
          grp.visible = key === archetype;
        }
      }
      if (sanctumOuterStoneMat) {
        sanctumOuterStoneMat.color.setHex(theme.darkSqHex || 0x181e2c);
        sanctumOuterStoneMat.emissive.setHex(theme.black?.emissive || 0x080b12);
        sanctumOuterStoneMat.emissiveIntensity = 0.16;
        sanctumOuterStoneMat.needsUpdate = true;
      }
      if (sanctumOuterTrimMat) {
        sanctumOuterTrimMat.color.setHex(trimHex).multiplyScalar(ARENA_FLOOR_TRIM_VALUE_SHARE);
        sanctumOuterTrimMat.emissive.setHex(theme.trim?.emissive || glowHex);
        sanctumOuterTrimMat.emissiveIntensity = ARENA_FLOOR_GLOW_INTENSITY;
        sanctumOuterTrimMat.needsUpdate = true;
      }
      if (sanctumOuterGlowMat) {
        sanctumOuterGlowMat.color.setHex(glowHex).multiplyScalar(ARENA_FLOOR_TRIM_VALUE_SHARE);
        sanctumOuterGlowMat.emissive.setHex(glowHex);
        sanctumOuterGlowMat.needsUpdate = true;
      }
      if (sanctumPerimeterMotesUniforms && sanctumPerimeterMotesUniforms.uColor) {
        sanctumPerimeterMotesUniforms.uColor.value.setHex(glowHex);
      }

      // Sync Twin Cathedral Braziers ((±3.65, 0, 0)) flame shader & point lights to active theme
      const flamePal = BRAZIER_FLAME_PALETTES[archetype] || BRAZIER_FLAME_PALETTES.hogwarts;
      for (let i = 0; i < brazierFireUniforms.length; i++) {
        const u = brazierFireUniforms[i];
        const layerCfg = flamePal.layers[Math.min(i, flamePal.layers.length - 1)];
        if (u && u.uBaseColor && u.uMidColor && u.uTipColor && layerCfg) {
          u.uBaseColor.value.setRGB(...layerCfg.base);
          u.uMidColor.value.setRGB(...layerCfg.mid);
          u.uTipColor.value.setRGB(...layerCfg.tip);
        }
      }
      for (let i = 0; i < brazierGlowSprites.length; i++) {
        const sp = brazierGlowSprites[i];
        if (sp && sp.material) {
          sp.material.color.setHex(i % 2 === 0 ? flamePal.coreSprite : flamePal.haloSprite);
        }
      }
      for (let i = 0; i < brazierLights.length; i++) {
        if (brazierLights[i]) {
          brazierLights[i].color.setHex(flamePal.light);
        }
      }
    }

    // Each side stays in one colour family: cinnabar lacquer against black lacquer, both with bronze trim, dark iron and jade.
    const XIANGQI_DEFAULT_FACTION_MATERIALS = {
      redPrimary: { color: 0xa3241c, roughness: 0.42, metalness: 0.08, emissive: 0x3a0906, emissiveIntensity: 0.18 },
      redTrim: { color: 0xc79a4a, roughness: 0.39, metalness: 0.6, emissive: 0x5a3a0c, emissiveIntensity: 0.12 },
      redSteel: { color: 0x4a4744, roughness: 0.45, metalness: 0.7, emissive: 0x000000, emissiveIntensity: 0.0 },
      redAccent: { color: 0x2fbf8f, roughness: 0.2, metalness: 0.3, emissive: 0x0f8f66, emissiveIntensity: 0.55 },
      redSteed: { color: 0x8a2018, roughness: 0.45, metalness: 0.08, emissive: 0x2e0704, emissiveIntensity: 0.16 },
      redQueenAccent: { color: 0xb8432f, roughness: 0.4, metalness: 0.1, emissive: 0x3a0906, emissiveIntensity: 0.16 },
      redBishopAccent: { color: 0x93261f, roughness: 0.42, metalness: 0.1, emissive: 0x2e0704, emissiveIntensity: 0.16 },
      blackPrimary: { color: 0x16171c, roughness: 0.4, metalness: 0.2, emissive: 0x05060a, emissiveIntensity: 0.2 },
      blackTrim: { color: 0xb08a45, roughness: 0.39, metalness: 0.6, emissive: 0x4a300a, emissiveIntensity: 0.1 },
      blackSteel: { color: 0x5a6068, roughness: 0.42, metalness: 0.75, emissive: 0x000000, emissiveIntensity: 0.0 },
      blackAccent: { color: 0x49c7b0, roughness: 0.2, metalness: 0.3, emissive: 0x128a78, emissiveIntensity: 0.55 },
      blackSteed: { color: 0x1f2229, roughness: 0.42, metalness: 0.2, emissive: 0x05060a, emissiveIntensity: 0.2 },
      blackQueenAccent: { color: 0x23252d, roughness: 0.4, metalness: 0.2, emissive: 0x05060a, emissiveIntensity: 0.2 },
      blackBishopAccent: { color: 0x1b1d24, roughness: 0.4, metalness: 0.2, emissive: 0x05060a, emissiveIntensity: 0.2 }
    };

    const CHESS_DEFAULT_ROLE_MATERIALS = {
      whiteSteed: { color: 0xecd8ba, roughness: 0.34, metalness: 0.06, emissive: 0x000000, emissiveIntensity: 0.0 },
      blackSteed: { color: 0x2c3850, roughness: 0.40, metalness: 0.18, emissive: 0x0b1220, emissiveIntensity: 0.22 },
      whiteQueenAccent: { color: 0xa855f7, roughness: 0.16, metalness: 0.68, emissive: 0x7e22ce, emissiveIntensity: 0.58 },
      blackQueenAccent: { color: 0xf43f5e, roughness: 0.16, metalness: 0.68, emissive: 0xbe123c, emissiveIntensity: 0.62 },
      whiteBishopAccent: { color: 0x0284c7, roughness: 0.16, metalness: 0.65, emissive: 0x0369a1, emissiveIntensity: 0.52 },
      blackBishopAccent: { color: 0x38bdf8, roughness: 0.16, metalness: 0.65, emissive: 0x0284c7, emissiveIntensity: 0.52 }
    };

    function applyPieceTheme(themeId, sideOption = 'both') {
      endKillCam(true);
      const theme = PIECE_THEMES[themeId] || PIECE_THEMES.hogwarts;
      currentPieceThemeId = theme.id;
      const applyMat = (mat, cfg) => {
        mat.color.setHex(cfg.color);
        mat.roughness = cfg.roughness;
        mat.metalness = cfg.metalness;
        mat.emissive.setHex(cfg.emissive);
        mat.emissiveIntensity = cfg.emissiveIntensity;
        mat.needsUpdate = true;
      };

      const useXiangqiCrimsonObsidian =
        typeof gameVariant !== 'undefined' && gameVariant === 'xiangqi' && theme.id === 'hogwarts';

      const accentCfg = {
        color: theme.altarGlowColor || theme.trim.color,
        roughness: 0.12,
        metalness: 0.55,
        emissive: theme.altarGlowColor || theme.trim.emissive,
        emissiveIntensity: 0.92
      };

      if (sideOption === 'both' || sideOption === 'w') {
        activeSkinWhite = theme.id;
        if (useXiangqiCrimsonObsidian) {
          applyMat(whitePieceMat, XIANGQI_DEFAULT_FACTION_MATERIALS.redPrimary);
          applyMat(goldTrimMat, XIANGQI_DEFAULT_FACTION_MATERIALS.redTrim);
          applyMat(forgedSteelMat, XIANGQI_DEFAULT_FACTION_MATERIALS.redSteel);
          applyMat(whiteAccentMat, XIANGQI_DEFAULT_FACTION_MATERIALS.redAccent);
          applyMat(whiteSteedMat, XIANGQI_DEFAULT_FACTION_MATERIALS.redSteed);
          applyMat(whiteQueenAccentMat, XIANGQI_DEFAULT_FACTION_MATERIALS.redQueenAccent);
          applyMat(whiteBishopAccentMat, XIANGQI_DEFAULT_FACTION_MATERIALS.redBishopAccent);
        } else {
          applyMat(whitePieceMat, theme.white);
          applyMat(goldTrimMat, theme.trim);
          applyMat(forgedSteelMat, theme.steel);
          applyMat(whiteAccentMat, accentCfg);
          applyMat(whiteSteedMat, CHESS_DEFAULT_ROLE_MATERIALS.whiteSteed);
          applyMat(whiteQueenAccentMat, CHESS_DEFAULT_ROLE_MATERIALS.whiteQueenAccent);
          applyMat(whiteBishopAccentMat, CHESS_DEFAULT_ROLE_MATERIALS.whiteBishopAccent);
        }
      }
      syncBoardGoldTrim();
      if (sideOption === 'both' || sideOption === 'b') {
        activeSkinBlack = theme.id;
        if (useXiangqiCrimsonObsidian) {
          applyMat(blackPieceMat, XIANGQI_DEFAULT_FACTION_MATERIALS.blackPrimary);
          applyMat(blackTrimMat, XIANGQI_DEFAULT_FACTION_MATERIALS.blackTrim);
          applyMat(blackSteelMat, XIANGQI_DEFAULT_FACTION_MATERIALS.blackSteel);
          applyMat(blackAccentMat, XIANGQI_DEFAULT_FACTION_MATERIALS.blackAccent);
          applyMat(blackSteedMat, XIANGQI_DEFAULT_FACTION_MATERIALS.blackSteed);
          applyMat(blackQueenAccentMat, XIANGQI_DEFAULT_FACTION_MATERIALS.blackQueenAccent);
          applyMat(blackBishopAccentMat, XIANGQI_DEFAULT_FACTION_MATERIALS.blackBishopAccent);
        } else {
          applyMat(blackPieceMat, theme.black);
          applyMat(blackTrimMat, theme.trim);
          applyMat(blackSteelMat, theme.steel);
          applyMat(blackAccentMat, accentCfg);
          applyMat(blackSteedMat, CHESS_DEFAULT_ROLE_MATERIALS.blackSteed);
          applyMat(blackQueenAccentMat, CHESS_DEFAULT_ROLE_MATERIALS.blackQueenAccent);
          applyMat(blackBishopAccentMat, CHESS_DEFAULT_ROLE_MATERIALS.blackBishopAccent);
        }
      }

      if (typeof sharedWhitePedestalRingMat !== 'undefined' && sharedWhitePedestalRingMat) {
        sharedWhitePedestalRingMat.color.setHex(
          typeof gameVariant !== 'undefined' && gameVariant === 'xiangqi' ? 0xd9382e : 0xf4efe4
        );
      }
      if (typeof sharedBlackPedestalRingMat !== 'undefined' && sharedBlackPedestalRingMat) {
        sharedBlackPedestalRingMat.color.setHex(
          typeof gameVariant !== 'undefined' && gameVariant === 'xiangqi' ? 0x49c7b0 : 0x0b0d12
        );
      }

      syncBodyDetailMaterials();
      updateSanctumAltarTheme(theme);

      // Refresh 3D bone-socketed kitbash accessories on all active pieces on the board
      if (typeof boardState !== 'undefined' && Array.isArray(boardState)) {
        for (let r = 0; r < boardState.length; r++) {
          const row = boardState[r];
          if (!row) continue;
          for (let c = 0; c < row.length; c++) {
            const p = row[c];
            if (p) {
              attachSkinKitbashToPiece(p);
            }
          }
        }
      }

      if (typeof renderer !== 'undefined' && renderer.shadowMap) {
        renderer.shadowMap.needsUpdate = true;
      }

      return currentPieceThemeId;
    }

    // Shared Faction Pedestal Ring Geometry & Materials for instant White vs Black readability on all 64 squares (Δgeometries = 0)
    const sharedPiecePedestalRingGeo = (() => {
      const g = new THREE.RingGeometry(0.43, 0.50, 28);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.015, 0);
      g.userData = { isSharedPool: true };
      return g;
    })();
    const sharedWhitePedestalRingMat = new THREE.MeshBasicMaterial({
      color: 0xfff8e1,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      userData: { isSharedPool: true }
    });
    const sharedBlackPedestalRingMat = new THREE.MeshBasicMaterial({
      color: 0x0b0d12,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      userData: { isSharedPool: true }
    });

    // Shared invisible CylinderGeometry hitbox proxies for O(1) piece raycasting (< 0.1ms vs 1.73M SkinnedMesh tris)
    const pieceHitboxMat = new THREE.MeshBasicMaterial({ visible: false });
    const pieceHitboxGeos = {};
    const PIECE_HITBOX_HEIGHTS = {
      pawn: 0.25,
      cannon: 0.26,
      advisor: 0.27,
      rook: 0.28,
      elephant: 0.29,
      knight: 0.29,
      bishop: 0.30,
      queen: 0.32,
      king: 0.34
    };
    function getPieceHitboxGeometry(type) {
      const key = `${gameVariant}__${PIECE_HITBOX_HEIGHTS[type] ? type : 'default'}`;
      if (!pieceHitboxGeos[key]) {
        const scale = getPieceWorldScale(type);
        const worldH = PIECE_HITBOX_HEIGHTS[type] || 0.26;
        const localH = worldH / scale;
        const localTopR = (gameVariant === 'xiangqi' ? 0.082 : 0.092) / scale;
        const localBotR = (gameVariant === 'xiangqi' ? 0.132 : 0.152) / scale;
        const geo = new THREE.CylinderGeometry(localTopR, localBotR, localH, 12);
        geo.translate(0, localH * 0.5, 0);
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        pieceHitboxGeos[key] = geo;
      }
      return pieceHitboxGeos[key];
    }

    // =========================================================================
    // Asset Loading (Cathedral GLB + 12 Rigged Piece GLBs)
    // =========================================================================
    const gltfLoader = new GLTFLoader();
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    // Relative path, like the model URLs, so the game also works from a sub-path.
    gltfLoader.setKTX2Loader(new KTX2Loader().setTranscoderPath('./assets/basis/').detectSupport(renderer));
    const pieceTemplates = {};
    const activeMixers = [];
    const shatterDebris = [];
    const combatVfxList = [];
    let pieceEffects = null;
    // One-shot reactions to a check: the king recoils and the braziers flare.
    let checkFlinch = null;
    let brazierFlare = 0;
    const clock = new THREE.Clock();

    function clearCombatVfx() {
      for (const vfx of combatVfxList) {
        if (vfx.mesh) scene.remove(vfx.mesh);
        if (vfx.mat && typeof vfx.mat.dispose === 'function') {
          vfx.mat.dispose();
        }
      }
      combatVfxList.length = 0;
      pieceEffects?.clear();
      checkFlinch = null;
    }

    const boardGroup = new THREE.Group();
    scene.add(boardGroup);
    const sanctumAltarGroup = new THREE.Group();
    boardGroup.add(sanctumAltarGroup);
    const squareHighlightsGroup = new THREE.Group();
    scene.add(squareHighlightsGroup);
    const tacticalMarkersGroup = new THREE.Group();
    scene.add(tacticalMarkersGroup);
    const boardSquareMeshes = [];

    function createSanctumCoordinateTexture() {
      const canvas = document.createElement('canvas');
      const texRes = isCoarseOrMobile ? 1024 : 2048;
      const scaleFactor = texRes / 1024;
      canvas.width = texRes;
      canvas.height = texRes;
      const ctx = canvas.getContext('2d');
      if (scaleFactor !== 1) {
        ctx.scale(scaleFactor, scaleFactor);
      }
      ctx.fillStyle = '#0c0f17';
      ctx.fillRect(0, 0, 1024, 1024);

      // Outer & inner golden sacred geometry rings
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.85)';
      ctx.lineWidth = 5;
      ctx.strokeRect(18, 18, 988, 988);
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.42)';
      ctx.lineWidth = 2;
      ctx.strokeRect(36, 36, 952, 952);

      // Subtle decorative arcane corner rosettes
      const corners = [
        [52, 52],
        [972, 52],
        [52, 972],
        [972, 972]
      ];
      ctx.fillStyle = '#f5d76e';
      ctx.font = 'bold 34px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const [cx, cy] of corners) {
        ctx.fillText('✦', cx, cy);
      }

      // Algebraic Coordinates A-H (South & North borders) and 1-8 (West & East borders)
      const files = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
      const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
      const margin = 94;
      const span = 1024 - margin * 2;
      const step = span / 8;

      ctx.font = 'bold 30px Georgia, serif';
      ctx.fillStyle = '#f5d76e';
      for (let i = 0; i < 8; i++) {
        const center = margin + (i + 0.5) * step;
        // Bottom (White side, +Z)
        ctx.fillText(files[i], center, 976);
        // Top (Black side, -Z)
        ctx.save();
        ctx.translate(center, 48);
        ctx.rotate(Math.PI);
        ctx.fillText(files[i], 0, 0);
        ctx.restore();
        // Left (West, -X)
        ctx.fillText(ranks[i], 48, center);
        // Right (East, +X)
        ctx.fillText(ranks[i], 976, center);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy?.() || 8);
      return tex;
    }

    const TABLE_APRON_HALF = 2.5;
    const TABLE_PYLON_OFFSET = 2.34;
    // Shatter chunks are copies of the struck piece seen through per-material clipping planes.
    renderer.localClippingEnabled = true;
    pieceEffects = createPieceEffects({
      scene,
      boardY: BOARD_SURFACE_Y,
      tableHalf: TABLE_APRON_HALF,
      getMotionLevel: () => motionLevel,
      getQualityTier: () => qualityTier
    });
    function buildSanctumArenaAltar() {
      const addStaticAltarMesh = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, recvShadow = true) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        if (rx || ry || rz) m.rotation.set(rx, ry, rz);
        m.receiveShadow = recvShadow;
        m.castShadow = false;
        m.raycast = () => {};
        m.updateMatrix();
        m.matrixAutoUpdate = false;
        sanctumAltarGroup.add(m);
        return m;
      };

      // The table and its steps are matte dark stone: nothing next to the squares may mirror a light into the bloom.
      const darkObsidianPlinthMat = new THREE.MeshStandardMaterial({
        color: 0x10131c,
        roughness: 0.78,
        metalness: 0.04,
        envMapIntensity: 0.2
      });
      const carvedAshlarStepMat = new THREE.MeshStandardMaterial({
        color: 0x191e2b,
        roughness: 0.82,
        metalness: 0.04,
        envMapIntensity: 0.2
      });
      sanctumMoatGlowMat = new THREE.MeshStandardMaterial({
        color: 0x1e1808,
        roughness: 0.7,
        metalness: 0.4,
        emissive: 0xd4af37,
        emissiveIntensity: 0.03
      });

      const coordTex = createSanctumCoordinateTexture();
      sanctumRuneRingMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        map: coordTex,
        emissive: 0xd4af37,
        emissiveMap: coordTex,
        emissiveIntensity: 0.28,
        roughness: 0.8,
        metalness: 0.0,
        envMapIntensity: 0.2
      });

      // 1. Stepped Beveled Octagonal Grand Sanctum Dais (3 architectural tiers encasing the central altar)
      const tier1Geo = new THREE.CylinderGeometry(2.62, 2.74, 0.24, 8);
      tier1Geo.rotateY(Math.PI / 8);
      addStaticAltarMesh(tier1Geo, carvedAshlarStepMat, 0, 0.12, 0);

      const tier1GoldLipGeo = new THREE.CylinderGeometry(2.63, 2.63, 0.026, 8);
      tier1GoldLipGeo.rotateY(Math.PI / 8);
      addStaticAltarMesh(tier1GoldLipGeo, sanctumMoatGlowMat, 0, 0.245, 0, 0, 0, 0, false);

      const tier2Geo = new THREE.CylinderGeometry(2.44, 2.54, 0.26, 8);
      tier2Geo.rotateY(Math.PI / 8);
      addStaticAltarMesh(tier2Geo, darkObsidianPlinthMat, 0, 0.38, 0);

      const tier2GoldLipGeo = new THREE.CylinderGeometry(2.45, 2.45, 0.026, 8);
      tier2GoldLipGeo.rotateY(Math.PI / 8);
      addStaticAltarMesh(tier2GoldLipGeo, sanctumMoatGlowMat, 0, 0.515, 0, 0, 0, 0, false);

      // 2. Upper Sanctum Battle Table Deck (4.24m x 4.24m square deck at y = 0.742, cleanly above baked Obsidian_Altar 0.722)
      const upperDeckGeo = new THREE.BoxGeometry(4.24, 0.23, 4.24);
      addStaticAltarMesh(upperDeckGeo, darkObsidianPlinthMat, 0, 0.625, 0);

      // Plain dark apron around the deck: edge-file pieces stand against a calm surface, not against floor ornaments.
      const apronMat = new THREE.MeshStandardMaterial({
        color: 0x0c0e15,
        roughness: 0.92,
        metalness: 0.02,
        envMapIntensity: 0.15
      });
      const apronGeo = new THREE.BoxGeometry(TABLE_APRON_HALF * 2, 0.11, TABLE_APRON_HALF * 2);
      addStaticAltarMesh(apronGeo, apronMat, 0, 0.681, 0);

      // 3. Coordinate & Arcane Inlay Top Plate (4.08m x 4.08m at y = 0.743, framing the 3.52m 8x8 chessboard)
      const coordDeckGeo = new THREE.BoxGeometry(4.08, 0.012, 4.08);
      addStaticAltarMesh(coordDeckGeo, sanctumRuneRingMat, 0, 0.741, 0);

      // 4. Outer Sacred Octagonal Halo Ring & Corner Sentinel Relic Pylons
      const outerCurbW = 0.03;
      const outerCurbH = 0.03;
      const halfDeck = 2.09;
      const hCurbGeo = new THREE.BoxGeometry(halfDeck * 2 + outerCurbW * 2, outerCurbH, outerCurbW);
      const vCurbGeo = new THREE.BoxGeometry(outerCurbW, outerCurbH, halfDeck * 2);
      for (const s of [-1, 1]) {
        addStaticAltarMesh(hCurbGeo, boardGoldTrimMat, 0, 0.752, s * halfDeck);
        addStaticAltarMesh(vCurbGeo, boardGoldTrimMat, s * halfDeck, 0.752, 0);
      }

      // 4 Corner Sentinel Relic Pylons with floating Arcane Crystals on the apron corners
      const pylonBaseGeo = new THREE.CylinderGeometry(0.11, 0.14, 0.14, 8);
      const crystalGeo = new THREE.OctahedronGeometry(0.075, 0);
      crystalGeo.scale(0.85, 1.45, 0.85);
      const orbitRingGeo = new THREE.TorusGeometry(0.115, 0.012, 8, 24);

      const cornerCoords = [
        [-TABLE_PYLON_OFFSET, -TABLE_PYLON_OFFSET],
        [TABLE_PYLON_OFFSET, -TABLE_PYLON_OFFSET],
        [-TABLE_PYLON_OFFSET, TABLE_PYLON_OFFSET],
        [TABLE_PYLON_OFFSET, TABLE_PYLON_OFFSET]
      ];
      cornerCoords.forEach(([cx, cz], idx) => {
        addStaticAltarMesh(pylonBaseGeo, darkObsidianPlinthMat, cx, 0.81, cz);
        const capRing = new THREE.CylinderGeometry(0.12, 0.12, 0.024, 8);
        addStaticAltarMesh(capRing, boardGoldTrimMat, cx, 0.885, cz);

        const crystalMat = sanctumMoatGlowMat.clone();
        crystalMat.roughness = 0.5;
        crystalMat.metalness = 0.55;
        crystalMat.emissiveIntensity = 0.12;
        const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
        crystalMesh.position.set(cx, 1.04, cz);
        crystalMesh.raycast = () => {};
        sanctumAltarGroup.add(crystalMesh);

        const ringMesh = new THREE.Mesh(orbitRingGeo, boardGoldTrimMat);
        ringMesh.position.set(cx, 1.04, cz);
        ringMesh.rotation.x = Math.PI * 0.35;
        ringMesh.raycast = () => {};
        sanctumAltarGroup.add(ringMesh);

        sanctumRelicCrystals.push({
          mesh: crystalMesh,
          ring: ringMesh,
          baseY: 1.04,
          phase: idx * 1.57
        });
      });

      buildSanctumOuterArena(addStaticAltarMesh, darkObsidianPlinthMat, carvedAshlarStepMat);
    }

    function buildSanctumOuterArena(addStaticAltarMesh, darkObsidianPlinthMat, carvedAshlarStepMat) {
      sanctumOuterStoneMat = new THREE.MeshStandardMaterial({
        color: 0x1b2232,
        roughness: 0.74,
        metalness: 0.06,
        emissive: 0x080b12,
        emissiveIntensity: 0.16
      });
      // The arena around the table stays below the board in value: aged trim, a faint glow, no polished gold.
      sanctumOuterTrimMat = new THREE.MeshStandardMaterial({
        color: 0x40350f,
        roughness: 0.7,
        metalness: 0.4,
        emissive: 0xd4af37,
        emissiveIntensity: ARENA_FLOOR_GLOW_INTENSITY
      });
      sanctumOuterGlowMat = new THREE.MeshStandardMaterial({
        color: 0x40350f,
        roughness: 0.7,
        metalness: 0.4,
        emissive: 0xd4af37,
        emissiveIntensity: ARENA_FLOOR_GLOW_INTENSITY
      });
      // Matte: a polished floor mirrors the key light as a white patch beside the board.
      const darkMoatBasinMat = new THREE.MeshStandardMaterial({
        color: 0x070a10,
        roughness: 0.88,
        metalness: 0.04,
        envMapIntensity: 0.2
      });

      const tmpMat4 = new THREE.Matrix4();
      const tmpPos = new THREE.Vector3();
      const tmpEuler = new THREE.Euler();
      const tmpQuat = new THREE.Quaternion();
      const tmpScale = new THREE.Vector3();

      const pushPart = (bucket, baseGeo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
        const g = baseGeo.index ? baseGeo.toNonIndexed() : baseGeo.clone();
        if (g.attributes.uv) g.deleteAttribute('uv');
        if (g.attributes.uv1) g.deleteAttribute('uv1');
        tmpPos.set(x, y, z);
        tmpEuler.set(rx, ry, rz, 'XYZ');
        tmpQuat.setFromEuler(tmpEuler);
        tmpScale.set(sx, sy, sz);
        tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
        g.applyMatrix4(tmpMat4);
        bucket.push(g);
      };

      const pushLocalPart = (
        bucket,
        baseGeo,
        originX,
        originZ,
        yaw,
        lx,
        ly,
        lz,
        rx = 0,
        ry = 0,
        rz = 0,
        sx = 1,
        sy = 1,
        sz = 1
      ) => {
        const cosY = Math.cos(yaw);
        const sinY = Math.sin(yaw);
        const wx = originX + lx * cosY + lz * sinY;
        const wz = originZ - lx * sinY + lz * cosY;
        pushPart(bucket, baseGeo, wx, ly, wz, rx, yaw + ry, rz, sx, sy, sz);
      };

      const buildMergedStaticMesh = (bucket, mat, parentGroup, recvShadow = true) => {
        if (!bucket.length) return null;
        const merged = mergeGeometries(bucket, false);
        for (const g of bucket) g.dispose();
        bucket.length = 0;
        if (!merged) return null;
        merged.computeBoundingSphere();
        const m = new THREE.Mesh(merged, mat);
        m.castShadow = false;
        m.receiveShadow = recvShadow;
        m.raycast = () => {};
        m.updateMatrix();
        m.matrixAutoUpdate = false;
        parentGroup.add(m);
        return m;
      };

      // =======================================================================
      // ZONE A (r = 2.65m .. 6.25m): Dark Mirror-Obsidian Moat Trench,
      // Outer Sanctum Terrace, Ley-Lines, Octagonal Rim & 4 Causeway Bridges
      // =======================================================================
      const moatBasinGeo = new THREE.RingGeometry(2.65, 4.48, 32);
      moatBasinGeo.rotateX(-Math.PI / 2);
      addStaticAltarMesh(moatBasinGeo, darkMoatBasinMat, 0, 0.015, 0, 0, 0, 0, true);

      const outerTerraceMat = new THREE.MeshStandardMaterial({
        color: 0x0b0f18,
        roughness: 0.88,
        metalness: 0.04,
        envMapIntensity: 0.2
      });
      const outerTerraceGeo = new THREE.RingGeometry(4.46, 6.28, 32);
      outerTerraceGeo.rotateX(-Math.PI / 2);
      addStaticAltarMesh(outerTerraceGeo, outerTerraceMat, 0, 0.018, 0, 0, 0, 0, true);

      const zoneAStone = [];
      const zoneATrim = [];
      const zoneAGlow = [];

      const boxGeo = new THREE.BoxGeometry(1, 1, 1);
      const cyl8Geo = new THREE.CylinderGeometry(1, 1, 1, 8);
      const cyl12Geo = new THREE.CylinderGeometry(1, 1, 1, 12);
      const cone4Geo = new THREE.ConeGeometry(1, 1, 4);
      const cone8Geo = new THREE.ConeGeometry(1, 1, 8);
      const octGeo = new THREE.OctahedronGeometry(1, 0);
      const torusGeo = new THREE.TorusGeometry(1, 0.08, 8, 24);

      // Concentric Arcane Ley-Line Rings in the sunken moat & outer sanctum terrace
      for (const rRing of [3.08, 3.68, 4.28, 5.25, 6.08]) {
        const rg = new THREE.RingGeometry(rRing - 0.022, rRing + 0.022, 32);
        rg.rotateX(-Math.PI / 2);
        pushPart(zoneAGlow, rg, 0, 0.024, 0);
        rg.dispose();
      }
      // 8 Radial Ley-Line Conduits & Octagonal Amphitheater Rim Segments (r = 4.52m & outer curb r = 6.18m)
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        const midR = 3.54;
        pushPart(
          zoneAGlow,
          boxGeo,
          Math.sin(ang) * midR,
          0.023,
          Math.cos(ang) * midR,
          0,
          ang,
          0,
          0.045,
          0.008,
          1.62
        );

        const wallAng = ang + Math.PI / 8;
        const wallR = 4.52;
        const segLen = 2 * wallR * Math.tan(Math.PI / 8) * 1.02;
        pushPart(
          zoneAStone,
          boxGeo,
          Math.sin(wallAng) * wallR,
          0.12,
          Math.cos(wallAng) * wallR,
          0,
          wallAng,
          0,
          segLen,
          0.24,
          0.28
        );
        pushPart(
          zoneATrim,
          boxGeo,
          Math.sin(wallAng) * (wallR - 0.08),
          0.248,
          Math.cos(wallAng) * (wallR - 0.08),
          0,
          wallAng,
          0,
          segLen * 0.98,
          0.026,
          0.065
        );

        const outerR = 6.16;
        const outerSegLen = 2 * outerR * Math.tan(Math.PI / 8) * 1.02;
        pushPart(
          zoneAStone,
          boxGeo,
          Math.sin(wallAng) * outerR,
          0.08,
          Math.cos(wallAng) * outerR,
          0,
          wallAng,
          0,
          outerSegLen,
          0.16,
          0.24
        );
        pushPart(
          zoneATrim,
          boxGeo,
          Math.sin(wallAng) * (outerR - 0.06),
          0.168,
          Math.cos(wallAng) * (outerR - 0.06),
          0,
          wallAng,
          0,
          outerSegLen * 0.98,
          0.022,
          0.055
        );
      }

      // 4 Cardinal Ceremonial Causeway Bridges (North z=-3.56, South z=+3.56, East x=+3.56, West x=-3.56)
      for (let i = 0; i < 4; i++) {
        const yaw = (i * Math.PI) / 2;
        const bx = Math.sin(yaw) * 3.56;
        const bz = Math.cos(yaw) * 3.56;
        pushLocalPart(zoneAStone, boxGeo, bx, bz, yaw, 0, 0.11, 0, 0, 0, 0, 1.24, 0.22, 1.78);
        pushLocalPart(zoneAStone, boxGeo, bx, bz, yaw, 0, 0.23, 0, 0, 0, 0, 1.06, 0.04, 1.74);
        for (const s of [-1, 1]) {
          pushLocalPart(zoneAStone, boxGeo, bx, bz, yaw, s * 0.56, 0.26, 0, 0, 0, 0, 0.10, 0.10, 1.76);
          pushLocalPart(zoneATrim, boxGeo, bx, bz, yaw, s * 0.56, 0.318, 0, 0, 0, 0, 0.065, 0.022, 1.76);
          pushLocalPart(zoneAGlow, boxGeo, bx, bz, yaw, s * 0.44, 0.254, 0, 0, 0, 0, 0.028, 0.012, 1.68);
        }
      }

      // 8 Perimeter Sentinel Pedestals on the Octagonal Rim (r = 4.52m) with floating arcane orbs
      const sentinelCrystalGeo = new THREE.OctahedronGeometry(0.095, 0);
      sentinelCrystalGeo.scale(0.88, 1.55, 0.88);
      const sentinelOrbitGeo = new THREE.TorusGeometry(0.15, 0.014, 8, 24);

      for (let i = 0; i < 8; i++) {
        const ang = (i + 0.5) * (Math.PI / 4);
        const px = Math.sin(ang) * 4.52;
        const pz = Math.cos(ang) * 4.52;
        pushPart(zoneAStone, cyl8Geo, px, 0.32, pz, 0, ang, 0, 0.22, 0.22, 0.22);
        pushPart(zoneATrim, cyl8Geo, px, 0.44, pz, 0, ang, 0, 0.24, 0.032, 0.24);

        const orbMesh = new THREE.Mesh(sentinelCrystalGeo, sanctumOuterGlowMat);
        orbMesh.position.set(px, 0.68, pz);
        orbMesh.raycast = () => {};
        sanctumAltarGroup.add(orbMesh);

        const ringMesh = new THREE.Mesh(sentinelOrbitGeo, sanctumOuterTrimMat);
        ringMesh.position.set(px, 0.68, pz);
        ringMesh.rotation.x = Math.PI * 0.32;
        ringMesh.raycast = () => {};
        sanctumAltarGroup.add(ringMesh);

        sanctumOuterFloatingRelics.push({
          mesh: orbMesh,
          ring: ringMesh,
          baseY: 0.68,
          phase: i * 0.785
        });
      }

      buildMergedStaticMesh(zoneAStone, sanctumOuterStoneMat, sanctumAltarGroup, true);
      buildMergedStaticMesh(zoneATrim, sanctumOuterTrimMat, sanctumAltarGroup, false);
      buildMergedStaticMesh(zoneAGlow, sanctumOuterGlowMat, sanctumAltarGroup, false);

      // =======================================================================
      // ZONE B (r = 4.55m .. 5.65m): 8 Pre-Merged Theme-Reactive Colossal
      // Guardian Monument & Sanctum Portal Archetypes (Δgeometries = 0)
      // Calibrated so the full Portal Crown (y = 1.35m..2.12m) sits 100% inside
      // the visible upper viewport below the top HUD bar in Mobile Portrait & 3D Cam!
      // =======================================================================
      const portalEnds = [
        { z: -4.88, yaw: 0 },
        { z: 4.88, yaw: Math.PI }
      ];
      const guardianFlanks = [
        { x: -2.18, z: -4.55, yaw: Math.atan2(2.18, 4.55) },
        { x: 2.18, z: -4.55, yaw: Math.atan2(-2.18, 4.55) },
        { x: -2.18, z: 4.55, yaw: Math.atan2(2.18, -4.55) },
        { x: 2.18, z: 4.55, yaw: Math.atan2(-2.18, -4.55) }
      ];
      const outerPylons = [
        { x: -3.58, z: -3.25, yaw: Math.atan2(3.58, 3.25) },
        { x: 3.58, z: -3.25, yaw: Math.atan2(-3.58, 3.25) },
        { x: -3.58, z: 3.25, yaw: Math.atan2(3.58, -3.25) },
        { x: 3.58, z: 3.25, yaw: Math.atan2(-3.58, -3.25) }
      ];

      const ARCHETYPES = ['hogwarts'];

      for (const themeKey of ARCHETYPES) {
        const tGroup = new THREE.Group();
        tGroup.name = `OuterMonuments_${themeKey}`;
        tGroup.visible = themeKey === currentOuterMonumentArchetype;
        sanctumAltarGroup.add(tGroup);
        outerMonumentGroupsByTheme[themeKey] = tGroup;

        const mStone = [];
        const mTrim = [];
        const mGlow = [];

        // 1. North & South Grand Sanctum Portals (x = 0, z = ±4.88m)
        // Piers stand at x = ±1.34m; lintel & emblem crown sit at y = 1.32m..2.08m
        for (const p of portalEnds) {
          for (const s of [-1, 1]) {
            pushLocalPart(mStone, boxGeo, 0, p.z, p.yaw, s * 1.34, 0.18, 0, 0, 0, 0, 0.48, 0.34, 0.48);
            pushLocalPart(mTrim, boxGeo, 0, p.z, p.yaw, s * 1.34, 0.36, 0, 0, 0, 0, 0.52, 0.04, 0.52);
            pushLocalPart(mStone, boxGeo, 0, p.z, p.yaw, s * 1.34, 0.84, 0, 0, 0, 0, 0.32, 0.92, 0.32);
            pushLocalPart(mTrim, boxGeo, 0, p.z, p.yaw, s * 1.34, 1.32, 0, 0, 0, 0, 0.44, 0.06, 0.44);
            pushLocalPart(mGlow, boxGeo, 0, p.z, p.yaw, s * 1.34, 0.84, 0.165, 0, 0, 0, 0.055, 0.80, 0.02);
          }

          // Pointed Gothic Triforium Arch & Rose Tracery Wheel + Spire Finials
          pushLocalPart(mStone, boxGeo, 0, p.z, p.yaw, 0, 1.38, 0, 0, 0, 0, 3.12, 0.16, 0.32);
          pushLocalPart(mTrim, boxGeo, 0, p.z, p.yaw, 0, 1.48, 0, 0, 0, 0, 3.24, 0.045, 0.36);
          for (const s of [-1, 1]) {
            pushLocalPart(mStone, boxGeo, 0, p.z, p.yaw, s * 0.62, 1.72, 0, 0, 0, -s * 0.42, 1.36, 0.12, 0.24);
            pushLocalPart(mTrim, cone8Geo, 0, p.z, p.yaw, s * 1.34, 1.76, 0, 0, 0, 0, 0.18, 0.65, 0.18);
          }
          pushLocalPart(mTrim, torusGeo, 0, p.z, p.yaw, 0, 1.72, 0, 0, 0, 0, 0.34, 0.34, 0.34);
          pushLocalPart(mGlow, octGeo, 0, p.z, p.yaw, 0, 1.72, 0, 0, 0, 0, 0.16, 0.26, 0.16);
          pushLocalPart(mTrim, cone8Geo, 0, p.z, p.yaw, 0, 2.12, 0, 0, 0, 0, 0.14, 0.42, 0.14);
        }

        // 2. 4 Flanking Colossal Guardian Monuments (x = ±2.18m, z = ±4.55m)
        for (const g of guardianFlanks) {
          pushLocalPart(mStone, cyl8Geo, g.x, g.z, g.yaw, 0, 0.16, 0, 0, 0, 0, 0.40, 0.32, 0.40);
          pushLocalPart(mTrim, cyl8Geo, g.x, g.z, g.yaw, 0, 0.34, 0, 0, 0, 0, 0.42, 0.036, 0.42);
          pushLocalPart(mStone, cyl8Geo, g.x, g.z, g.yaw, 0, 0.62, 0, 0, 0, 0, 0.30, 0.52, 0.30);

          pushLocalPart(mStone, boxGeo, g.x, g.z, g.yaw, 0, 1.18, 0, 0, 0, 0, 0.42, 0.64, 0.30);
          pushLocalPart(mTrim, boxGeo, g.x, g.z, g.yaw, 0, 1.42, 0, 0, 0, 0, 0.58, 0.14, 0.34);
          pushLocalPart(mStone, cyl8Geo, g.x, g.z, g.yaw, 0, 1.66, 0, 0, 0, 0, 0.16, 0.28, 0.16);
          pushLocalPart(mTrim, cone4Geo, g.x, g.z, g.yaw, 0, 1.90, 0, 0, Math.PI / 4, 0, 0.18, 0.28, 0.18);
          pushLocalPart(mTrim, boxGeo, g.x, g.z, g.yaw, 0, 1.16, 0.24, 0, 0, 0, 0.32, 0.05, 0.07);
          pushLocalPart(mGlow, boxGeo, g.x, g.z, g.yaw, 0, 0.78, 0.24, 0, 0, 0, 0.05, 0.76, 0.03);
        }

        // 3. 4 Outer Sanctum Pylons (x = ±3.58m, z = ±3.25m) framing wide 16:9 & diagonal views
        for (const op of outerPylons) {
          pushLocalPart(mStone, cyl8Geo, op.x, op.z, op.yaw, 0, 0.16, 0, 0, 0, 0, 0.32, 0.32, 0.32);
          pushLocalPart(mStone, cyl8Geo, op.x, op.z, op.yaw, 0, 0.78, 0, 0, 0, 0, 0.20, 0.96, 0.20);
          pushLocalPart(mTrim, cyl8Geo, op.x, op.z, op.yaw, 0, 1.30, 0, 0, 0, 0, 0.26, 0.05, 0.26);
          pushLocalPart(mGlow, octGeo, op.x, op.z, op.yaw, 0, 1.56, 0, 0, 0, 0, 0.14, 0.24, 0.14);
        }

        buildMergedStaticMesh(mStone, sanctumOuterStoneMat, tGroup, true);
        buildMergedStaticMesh(mTrim, sanctumOuterTrimMat, tGroup, false);
        buildMergedStaticMesh(mGlow, sanctumOuterGlowMat, tGroup, false);
      }

      boxGeo.dispose();
      cyl8Geo.dispose();
      cyl12Geo.dispose();
      cone4Geo.dispose();
      cone8Geo.dispose();
      octGeo.dispose();
      torusGeo.dispose();

      // =======================================================================
      // ZONE C (r = 2.95m .. 6.65m): 1-Draw-Call GPU Atmospheric Perimeter Motes
      // =======================================================================
      const moteCount = 96;
      const motePositions = new Float32Array(moteCount * 3);
      const motePhases = new Float32Array(moteCount);
      const moteScales = new Float32Array(moteCount);

      for (let i = 0; i < moteCount; i++) {
        const ang = (i / moteCount) * Math.PI * 2 + (i % 7) * 0.23;
        const r = 2.98 + ((i * 37) % 100) * 0.036;
        motePositions[i * 3] = Math.sin(ang) * r;
        motePositions[i * 3 + 1] = 0.22 + ((i * 53) % 100) * 0.032;
        motePositions[i * 3 + 2] = Math.cos(ang) * r;
        motePhases[i] = (i * 1.37) % (Math.PI * 2);
        moteScales[i] = 0.65 + ((i * 29) % 10) * 0.08;
      }

      const moteGeo = new THREE.BufferGeometry();
      moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
      moteGeo.setAttribute('aPhase', new THREE.BufferAttribute(motePhases, 1));
      moteGeo.setAttribute('aScale', new THREE.BufferAttribute(moteScales, 1));

      sanctumPerimeterMotesUniforms = {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xd4af37) },
        uPixelRatio: { value: currentActiveDpr }
      };

      const moteMat = new THREE.ShaderMaterial({
        uniforms: sanctumPerimeterMotesUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
          attribute float aPhase;
          attribute float aScale;
          uniform float uTime;
          uniform float uPixelRatio;
          varying float vAlpha;
          void main() {
            vec3 pos = position;
            float cycle = fract(aPhase * 0.15915 + uTime * (0.08 + aScale * 0.025));
            pos.y = 0.18 + cycle * 3.25;
            pos.x += sin(uTime * 1.1 + aPhase) * 0.14;
            pos.z += cos(uTime * 0.95 + aPhase * 1.3) * 0.14;
            vAlpha = sin(cycle * 3.14159265) * 0.78;
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = clamp((16.0 * aScale * uPixelRatio) / max(1.0, -mvPosition.z), 2.0, 22.0);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying float vAlpha;
          void main() {
            vec2 uv = gl_PointCoord - vec2(0.5);
            float d = length(uv);
            if (d > 0.5) discard;
            float glow = smoothstep(0.5, 0.05, d);
            gl_FragColor = vec4(uColor * (1.15 + glow * 0.65), glow * vAlpha);
          }
        `
      });

      const motesPoints = new THREE.Points(moteGeo, moteMat);
      motesPoints.raycast = () => {};
      motesPoints.frustumCulled = false;
      motesPoints.matrixAutoUpdate = false;
      sanctumAltarGroup.add(motesPoints);
    }

    const chessBoardDeckGroup = new THREE.Group();
    const xiangqiBoardDeckGroup = new THREE.Group();
    const xiangqiSquareMeshes = [];
    function getActiveBoardSquareMeshes() {
      return gameVariant === 'xiangqi' ? xiangqiSquareMeshes : boardSquareMeshes;
    }

    const XIANGQI_FRAME_WOOD_TINT = 0x6a3626;
    const XIANGQI_LINE_HEX = 0x2a160c;

    // Planks of honey-coloured wood with a straight grain, drawn once. The sequence is seeded so the board looks the same on every load.
    function makeXiangqiWoodTexture() {
      const size = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      let seed = 7919;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      if (ctx) {
        const planks = 6;
        const plankW = size / planks;
        for (let i = 0; i < planks; i++) {
          const shade = 0.93 + rand() * 0.14;
          ctx.fillStyle = `rgb(${Math.round(126 * shade)}, ${Math.round(90 * shade)}, ${Math.round(50 * shade)})`;
          ctx.fillRect(i * plankW, 0, plankW + 1, size);
          for (let g = 0; g < 70; g++) {
            const x = i * plankW + rand() * plankW;
            const drift = (rand() - 0.5) * 14;
            ctx.strokeStyle = rand() < 0.6 ? `rgba(70, 40, 16, ${0.05 + rand() * 0.13})` : `rgba(214, 170, 108, ${0.04 + rand() * 0.1})`;
            ctx.lineWidth = 0.6 + rand() * 1.8;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.bezierCurveTo(x + drift, size * 0.33, x - drift, size * 0.66, x + drift * 0.5, size);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(48, 26, 10, 0.5)';
          ctx.fillRect(i * plankW - 1, 0, 2, size);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    }

    function buildXiangqiBoardGrid() {
      const boardW = 8 * XIANGQI_SQ_SIZE; // 3.04m across 9 files (c=0..8)
      const boardD = 9 * XIANGQI_SQ_SIZE; // 3.42m across 10 ranks (r=0..9)
      const slabPad = 0.24;
      const slabH = 0.036;

      // 1. Honey-wood playing surface, a dark rosewood frame, and lines burnt into the wood
      const woodTex = makeXiangqiWoodTexture();
      const xiangqiWoodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.66, metalness: 0 });
      const xiangqiFrameMat = new THREE.MeshStandardMaterial({
        map: woodTex,
        color: XIANGQI_FRAME_WOOD_TINT,
        roughness: 0.58,
        metalness: 0
      });
      const xiangqiLineMat = new THREE.MeshStandardMaterial({ color: XIANGQI_LINE_HEX, roughness: 0.85, metalness: 0 });
      const slabGeo = new THREE.BoxGeometry(boardW + slabPad * 2, slabH, boardD + slabPad * 2);
      slabGeo.computeBoundingBox();
      slabGeo.computeBoundingSphere();
      const slabMesh = new THREE.Mesh(slabGeo, xiangqiWoodMat);
      slabMesh.position.set(0, BOARD_SURFACE_Y - slabH * 0.5, 0);
      slabMesh.receiveShadow = true;
      slabMesh.raycast = () => {};
      slabMesh.updateMatrix();
      slabMesh.matrixAutoUpdate = false;
      xiangqiBoardDeckGroup.add(slabMesh);

      // Rosewood frame around the 9x10 surface, with a thin bronze inlay on its inner edge
      const halfW = boardW * 0.5 + slabPad;
      const halfD = boardD * 0.5 + slabPad;
      const frameW = 0.13;
      const frameH = 0.07;
      const rimW = 0.03;
      const rimH = 0.044;
      const hFrameGeo = new THREE.BoxGeometry(halfW * 2 + frameW * 2, frameH, frameW);
      const vFrameGeo = new THREE.BoxGeometry(frameW, frameH, halfD * 2);
      const outerW = halfW + frameW;
      const outerD = halfD + frameW;
      const hRimGeo = new THREE.BoxGeometry(outerW * 2 + rimW * 2, rimH, rimW);
      const vRimGeo = new THREE.BoxGeometry(rimW, rimH, outerD * 2);
      const inlayW = 0.012;
      const hInlayGeo = new THREE.BoxGeometry(halfW * 2 - inlayW * 2, 0.004, inlayW);
      const vInlayGeo = new THREE.BoxGeometry(inlayW, 0.004, halfD * 2 - inlayW * 2);
      for (const s of [-1, 1]) {
        const hFrame = new THREE.Mesh(hFrameGeo, xiangqiFrameMat);
        hFrame.position.set(0, BOARD_SURFACE_Y - frameH * 0.42, s * (halfD + frameW * 0.5));
        const vFrame = new THREE.Mesh(vFrameGeo, xiangqiFrameMat);
        vFrame.position.set(s * (halfW + frameW * 0.5), BOARD_SURFACE_Y - frameH * 0.42, 0);
        const hBar = new THREE.Mesh(hRimGeo, boardGoldTrimMat);
        hBar.position.set(0, BOARD_SURFACE_Y - rimH * 0.5, s * (outerD + rimW * 0.5));
        const vBar = new THREE.Mesh(vRimGeo, boardGoldTrimMat);
        vBar.position.set(s * (outerW + rimW * 0.5), BOARD_SURFACE_Y - rimH * 0.5, 0);
        for (const bar of [hFrame, vFrame, hBar, vBar]) {
          bar.receiveShadow = true;
          bar.raycast = () => {};
          bar.updateMatrix();
          bar.matrixAutoUpdate = false;
          xiangqiBoardDeckGroup.add(bar);
        }

        const hInlay = new THREE.Mesh(hInlayGeo, boardGoldTrimMat);
        hInlay.position.set(0, BOARD_SURFACE_Y + 0.002, s * (halfD - inlayW));
        const vInlay = new THREE.Mesh(vInlayGeo, boardGoldTrimMat);
        vInlay.position.set(s * (halfW - inlayW), BOARD_SURFACE_Y + 0.002, 0);
        for (const inlay of [hInlay, vInlay]) {
          inlay.raycast = () => {};
          inlay.updateMatrix();
          inlay.matrixAutoUpdate = false;
          xiangqiBoardDeckGroup.add(inlay);
        }
      }

      // 2. Chu River — Han Border (楚河 — 漢界 / SỞ HÀ — HÁN GIỚI) between r=4 and r=5
      const riverCanv = document.createElement('canvas');
      riverCanv.width = 1024;
      riverCanv.height = 192;
      const rCtx = riverCanv.getContext('2d');
      if (rCtx) {
        const grad = rCtx.createLinearGradient(0, 0, 0, 192);
        // A walnut stain over the same wood, so the river is part of the board and not a banner on it.
        grad.addColorStop(0, 'rgba(46, 24, 12, 0.62)');
        grad.addColorStop(0.5, 'rgba(38, 19, 9, 0.74)');
        grad.addColorStop(1, 'rgba(46, 24, 12, 0.62)');
        rCtx.fillStyle = grad;
        rCtx.fillRect(0, 0, 1024, 192);

        rCtx.strokeStyle = 'rgba(198, 152, 84, 0.5)';
        rCtx.lineWidth = 3;
        rCtx.strokeRect(6, 6, 1012, 180);

        rCtx.fillStyle = 'rgba(226, 186, 112, 0.95)';
        rCtx.font = 'bold 74px "Noto Serif SC", "PingFang SC", "Georgia", serif';
        rCtx.textAlign = 'center';
        rCtx.textBaseline = 'middle';
        rCtx.fillText('楚   河', 256, 86);
        rCtx.fillText('漢   界', 768, 86);

        rCtx.fillStyle = 'rgba(206, 164, 96, 0.8)';
        rCtx.font = '600 20px "Cinzel", "Georgia", serif';
        rCtx.fillText('✦   SỞ HÀ  —  HÁN GIỚI   ✦', 512, 152);
      }
      const riverTex = new THREE.CanvasTexture(riverCanv);
      riverTex.colorSpace = THREE.SRGBColorSpace;
      riverTex.needsUpdate = true;
      const riverMat = new THREE.MeshBasicMaterial({
        map: riverTex,
        transparent: true,
        opacity: 1,
        depthWrite: false
      });
      const riverGeo = new THREE.PlaneGeometry(boardW - 0.012, XIANGQI_SQ_SIZE - 0.012);
      riverGeo.rotateX(-Math.PI / 2);
      const riverMesh = new THREE.Mesh(riverGeo, riverMat);
      riverMesh.position.set(0, BOARD_SURFACE_Y + 0.0018, 0);
      riverMesh.raycast = () => {};
      riverMesh.updateMatrix();
      riverMesh.matrixAutoUpdate = false;
      xiangqiBoardDeckGroup.add(riverMesh);

      // 3. 10 Horizontal Rank Lines (r=0..9) & 9 Vertical File Lines (c=0..8)
      const lineThick = 0.011;
      const lineH = 0.005;
      const inlayThick = 0.0035;
      // Every line is a burnt groove with a thin bronze inlay along its centre.
      const addGroove = (inlayMesh, grooveGeo) => {
        const groove = new THREE.Mesh(grooveGeo, xiangqiLineMat);
        groove.position.copy(inlayMesh.position);
        groove.position.y -= 0.0006;
        groove.rotation.copy(inlayMesh.rotation);
        groove.raycast = () => {};
        groove.updateMatrix();
        groove.matrixAutoUpdate = false;
        xiangqiBoardDeckGroup.add(groove);
      };
      const rankGrooveGeo = new THREE.BoxGeometry(boardW + lineThick, lineH, lineThick);
      const rankLineGeo = new THREE.BoxGeometry(boardW + lineThick, lineH, inlayThick);
      for (let r = 0; r < 10; r++) {
        const z = (r - 4.5) * XIANGQI_SQ_SIZE;
        const rLine = new THREE.Mesh(rankLineGeo, boardGoldTrimMat);
        rLine.position.set(0, BOARD_SURFACE_Y + 0.0028, z);
        rLine.raycast = () => {};
        rLine.updateMatrix();
        rLine.matrixAutoUpdate = false;
        xiangqiBoardDeckGroup.add(rLine);
        addGroove(rLine, rankGrooveGeo);
      }

      const fullFileGrooveGeo = new THREE.BoxGeometry(lineThick, lineH, boardD + lineThick);
      const halfFileGrooveGeo = new THREE.BoxGeometry(lineThick, lineH, 4 * XIANGQI_SQ_SIZE + lineThick);
      const fullFileGeo = new THREE.BoxGeometry(inlayThick, lineH, boardD + lineThick);
      const halfFileGeo = new THREE.BoxGeometry(inlayThick, lineH, 4 * XIANGQI_SQ_SIZE + lineThick);
      for (let c = 0; c < 9; c++) {
        const x = (c - 4.0) * XIANGQI_SQ_SIZE;
        if (c === 0 || c === 8) {
          const fLine = new THREE.Mesh(fullFileGeo, boardGoldTrimMat);
          fLine.position.set(x, BOARD_SURFACE_Y + 0.0028, 0);
          fLine.raycast = () => {};
          fLine.updateMatrix();
          fLine.matrixAutoUpdate = false;
          xiangqiBoardDeckGroup.add(fLine);
          addGroove(fLine, fullFileGrooveGeo);
        } else {
          for (const bankSign of [-1, 1]) {
            const hLine = new THREE.Mesh(halfFileGeo, boardGoldTrimMat);
            hLine.position.set(x, BOARD_SURFACE_Y + 0.0028, bankSign * 2.5 * XIANGQI_SQ_SIZE);
            hLine.raycast = () => {};
            hLine.updateMatrix();
            hLine.matrixAutoUpdate = false;
            xiangqiBoardDeckGroup.add(hLine);
            addGroove(hLine, halfFileGrooveGeo);
          }
        }
      }

      // 4. Two 3x3 Nine Palaces (Cửu Cung: c=3..5, r=0..2 & r=7..9) X-Diagonals
      const diagLen = 2 * Math.SQRT2 * XIANGQI_SQ_SIZE;
      const diagGrooveGeo = new THREE.BoxGeometry(lineThick * 0.9, lineH, diagLen);
      const diagGeo = new THREE.BoxGeometry(inlayThick, lineH, diagLen);
      for (const palaceZ of [-3.5 * XIANGQI_SQ_SIZE, 3.5 * XIANGQI_SQ_SIZE]) {
        for (const rotSign of [-1, 1]) {
          const dMesh = new THREE.Mesh(diagGeo, boardGoldTrimMat);
          dMesh.position.set(0, BOARD_SURFACE_Y + 0.003, palaceZ);
          dMesh.rotation.y = rotSign * (Math.PI / 4);
          dMesh.raycast = () => {};
          dMesh.updateMatrix();
          dMesh.matrixAutoUpdate = false;
          xiangqiBoardDeckGroup.add(dMesh);
          addGroove(dMesh, diagGrooveGeo);
        }
      }

      // 5. 14 Fiducial Star/Cross Medallions at Cannon (r=2,7; c=1,7) & Soldier (r=3,6; c=0,2,4,6,8) Intersections
      const fiducialCoords = [
        [2, 1], [2, 7], [7, 1], [7, 7],
        [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
        [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]
      ];
      const fidGeo = new THREE.RingGeometry(0.032, 0.050, 8);
      fidGeo.rotateX(-Math.PI / 2);
      for (const [fr, fc] of fiducialCoords) {
        const fx = (fc - 4.0) * XIANGQI_SQ_SIZE;
        const fz = (fr - 4.5) * XIANGQI_SQ_SIZE;
        const fMesh = new THREE.Mesh(fidGeo, boardGoldTrimMat);
        fMesh.position.set(fx, BOARD_SURFACE_Y + 0.0034, fz);
        fMesh.raycast = () => {};
        fMesh.updateMatrix();
        fMesh.matrixAutoUpdate = false;
        xiangqiBoardDeckGroup.add(fMesh);
      }

      // 6. 90 Intersection Hitboxes (xiangqiSquareMeshes) & Carved Brass Intersection Studs
      const hitPadGeo = new THREE.CylinderGeometry(XIANGQI_SQ_SIZE * 0.44, XIANGQI_SQ_SIZE * 0.44, 0.016, 16);
      hitPadGeo.computeBoundingBox();
      hitPadGeo.computeBoundingSphere();
      const hitPadMat = new THREE.MeshBasicMaterial({ visible: false });
      const nodeStudGeo = new THREE.CylinderGeometry(0.022, 0.026, 0.006, 8);

      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const ix = (c - 4.0) * XIANGQI_SQ_SIZE;
          const iz = (r - 4.5) * XIANGQI_SQ_SIZE;

          const padMesh = new THREE.Mesh(hitPadGeo, hitPadMat);
          padMesh.position.set(ix, BOARD_SURFACE_Y - 0.004, iz);
          padMesh.userData = { r, c, isSquare: true };
          padMesh.updateMatrix();
          padMesh.matrixAutoUpdate = false;
          xiangqiBoardDeckGroup.add(padMesh);
          xiangqiSquareMeshes.push(padMesh);

          const studMesh = new THREE.Mesh(nodeStudGeo, xiangqiLineMat);
          studMesh.position.set(ix, BOARD_SURFACE_Y + 0.0025, iz);
          studMesh.raycast = () => {};
          studMesh.updateMatrix();
          studMesh.matrixAutoUpdate = false;
          xiangqiBoardDeckGroup.add(studMesh);
        }
      }

      xiangqiBoardDeckGroup.visible = gameVariant === 'xiangqi';
      boardGroup.add(xiangqiBoardDeckGroup);
    }

    function buildChessBoardGrid() {
      buildSanctumArenaAltar();

      const tileH = 0.036;
      const sqGeo = new THREE.BoxGeometry(BOARD_SQ_SIZE * 0.955, tileH, BOARD_SQ_SIZE * 0.955);
      sqGeo.computeBoundingBox();
      sqGeo.computeBoundingSphere();
      sanctumLightSqMat = new THREE.MeshStandardMaterial({
        color: 0xa89e8a,
        roughness: 0.86,
        metalness: 0.0,
        envMapIntensity: 0.15
      });
      sanctumDarkSqMat = new THREE.MeshStandardMaterial({
        color: 0x5a6370,
        roughness: 0.82,
        metalness: 0.0,
        envMapIntensity: 0.15
      });

      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const isLight = (r + c) % 2 === 0;
          const sqMesh = new THREE.Mesh(sqGeo, isLight ? sanctumLightSqMat : sanctumDarkSqMat);
          const pos = new THREE.Vector3((c - 3.5) * BOARD_SQ_SIZE, BOARD_SURFACE_Y, (r - 3.5) * BOARD_SQ_SIZE);
          sqMesh.position.set(pos.x, BOARD_SURFACE_Y - tileH * 0.5, pos.z);
          sqMesh.receiveShadow = true;
          sqMesh.userData = { r, c, isSquare: true };
          sqMesh.updateMatrix();
          sqMesh.matrixAutoUpdate = false;
          chessBoardDeckGroup.add(sqMesh);
          boardSquareMeshes.push(sqMesh);
        }
      }

      // Sculpted Golden Inner Border Frame around the 3.52m 8x8 tiles on top of the Sanctum Battle Dais
      const halfB = 4.0 * BOARD_SQ_SIZE;
      const rimW = 0.03;
      const rimH = 0.044;
      const horizGeo = new THREE.BoxGeometry(halfB * 2 + rimW * 2, rimH, rimW);
      const vertGeo = new THREE.BoxGeometry(rimW, rimH, halfB * 2);
      for (const s of [-1, 1]) {
        const hBar = new THREE.Mesh(horizGeo, boardGoldTrimMat);
        hBar.position.set(0, BOARD_SURFACE_Y - rimH * 0.42, s * (halfB + rimW * 0.5));
        hBar.receiveShadow = true;
        hBar.raycast = () => {};
        hBar.updateMatrix();
        hBar.matrixAutoUpdate = false;
        chessBoardDeckGroup.add(hBar);

        const vBar = new THREE.Mesh(vertGeo, boardGoldTrimMat);
        vBar.position.set(s * (halfB + rimW * 0.5), BOARD_SURFACE_Y - rimH * 0.42, 0);
        vBar.receiveShadow = true;
        vBar.raycast = () => {};
        vBar.updateMatrix();
        vBar.matrixAutoUpdate = false;
        chessBoardDeckGroup.add(vBar);
      }

      chessBoardDeckGroup.visible = gameVariant === 'chess';
      boardGroup.add(chessBoardDeckGroup);
      buildXiangqiBoardGrid();

      boardGroup.updateMatrix();
      boardGroup.updateMatrixWorld(true);
      boardGroup.matrixAutoUpdate = false;
    }

    buildChessBoardGrid();

    // =========================================================================
    // Native Baked Wall/Column Stone (Original Ashlar) & Floor Stone (Abbey Flagstone)
    // =========================================================================
    // The hall is a backdrop: its stone keeps the baked texture at a reduced value so the board stays the brightest surface.
    const HALL_BACKDROP_VALUE = 0.55;
    const WALL_STONE_LOOKS = [
      {
        name: 'Original Ashlar',
        fullName: 'Original Ashlar',
        useOriginalBaked: true,
        roughness: 0.78,
        normalScale: 1.18,
        colNormalScale: 1.06
      }
    ];

    const FLOOR_STONE_LOOKS = [
      {
        name: 'Abbey Flagstone',
        fullName: 'Abbey Flagstone',
        useOriginalBaked: true,
        roughness: 0.80,
        metalness: 0.02,
        normalScale: 1.18
      }
    ];

    let currentWallStoneLookIdx = 0;
    let currentFloorStoneLookIdx = 0;
    const cathedralWallMats = [];
    const cathedralColumnMats = [];
    const cathedralFloorMats = [];

    // Precomputed 128x128 tileable micro-chisel grain DataTexture (replaces 32 per-pixel 3D hashes every frame)
    const stoneMicroGrainTex = (() => {
      const size = 128;
      const data = new Uint8Array(size * size * 4);
      const fract = (v) => v - Math.floor(v);
      const hash2 = (x, y, s) => fract(Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453);
      const smoothNoise = (u, v, period, seed) => {
        const gx = u * period;
        const gy = v * period;
        const x0 = Math.floor(gx) % period;
        const y0 = Math.floor(gy) % period;
        const x1 = (x0 + 1) % period;
        const y1 = (y0 + 1) % period;
        const fx = gx - Math.floor(gx);
        const fy = gy - Math.floor(gy);
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const n00 = hash2(x0, y0, seed);
        const n10 = hash2(x1, y0, seed);
        const n01 = hash2(x0, y1, seed);
        const n11 = hash2(x1, y1, seed);
        return (n00 + (n10 - n00) * sx) * (1 - sy) + (n01 + (n11 - n01) * sx) * sy;
      };
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const mG1 = smoothNoise(u, v, 24, 1.7);
          const mG2 = smoothNoise(u, v, 64, 7.3);
          const idx = (y * size + x) * 4;
          data[idx] = Math.max(0, Math.min(255, Math.round(mG1 * 255)));
          data[idx + 1] = Math.max(0, Math.min(255, Math.round(mG2 * 255)));
          data[idx + 2] = Math.max(0, Math.min(255, Math.round((0.5 + (mG1 - mG2) * 0.7) * 255)));
          data[idx + 3] = 255;
        }
      }
      const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy?.() || 8);
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      return tex;
    })();

    // =========================================================================
    // Realism Stone Shader Enhancement (inspired by 0beqz/realism-effects HBAO/HBIL
    // & gkjohnson/three-gpu-pathtracer Cavity Micro-Occlusion + Specular Occlusion)
    // =========================================================================
    function applyCathedralStoneRealismShader(mat, isFloor = false) {
      if (!mat || mat.userData.hasRealismStoneShader) return;
      mat.userData.hasRealismStoneShader = true;
      mat.customProgramCacheKey = () => (isFloor ? 'cathedral-floor-realism-v3' : 'cathedral-stone-realism-v3');

      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uCavityStrength = { value: isFloor ? 0.58 : 0.72 };
        shader.uniforms.uMicroDetailStrength = { value: isFloor ? 0.14 : 0.18 };
        shader.uniforms.uFireBounceStrength = { value: isFloor ? 0.16 : 0.24 };
        shader.uniforms.uMicroGrainMap = { value: stoneMicroGrainTex };

        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          `#include <common>
          varying vec3 vStoneWorldPos;`
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vStoneWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          `#include <common>
          varying vec3 vStoneWorldPos;
          uniform float uCavityStrength;
          uniform float uMicroDetailStrength;
          uniform float uFireBounceStrength;
          uniform sampler2D uMicroGrainMap;`
        );

        // Extract normal-map slope magnitude for Mortar/Crevice Cavity AO & Specular Micro-Occlusion,
        // plus precomputed tileable micro-chisel grain lookup (zero per-pixel 3D hash loops!).
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <normal_fragment_maps>',
          `float stoneCavityAO = 1.0;
          #include <normal_fragment_maps>
          #ifdef USE_NORMALMAP_TANGENTSPACE
            vec2 rawNrmXY = texture2D(normalMap, vNormalMapUv).xy * 2.0 - 1.0;
            float slopeSq = dot(rawNrmXY, rawNrmXY);
            stoneCavityAO = clamp(1.0 - slopeSq * uCavityStrength, 0.36, 1.0);
          #endif
          vec2 microUv = (vStoneWorldPos.xz + vStoneWorldPos.xy * 0.618) * 0.85;
          vec3 mgSample = texture2D(uMicroGrainMap, microUv).rgb - 0.5;
          float mG1 = mgSample.r;
          float mG2 = mgSample.g;
          vec3 microPerturb = vec3(mG1, mG2, mgSample.b) * uMicroDetailStrength;
          normal = normalize(normal + microPerturb * 0.22);
          diffuseColor.rgb *= mix(0.92, 1.07, clamp(0.5 + (mG1 * 0.65 + mG2 * 0.35), 0.0, 1.0));
          diffuseColor.rgb *= mix(1.0, stoneCavityAO, 0.68);
          roughnessFactor = clamp(roughnessFactor + (1.0 - stoneCavityAO) * 0.34 - mG1 * 0.06, 0.14, 0.99);`
        );

        // Add Horizon-Based Indirect Bounce (HBIL) from the twin fire cauldrons & upper lancet windows,
        // and apply Specular Micro-Occlusion in mortar crevices so grooves never have plastic shine.
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          reflectedLight.directDiffuse *= mix(1.0, stoneCavityAO, 0.45);
          reflectedLight.indirectDiffuse *= stoneCavityAO;
          reflectedLight.directSpecular *= stoneCavityAO * stoneCavityAO;
          reflectedLight.indirectSpecular *= stoneCavityAO * stoneCavityAO;

          // Physical multi-bounce warm firelight GI from the twin atrium braziers & flanking columns
          vec3 toBrazierL = vec3(-3.65, 1.35, 0.0) - vStoneWorldPos;
          vec3 toBrazierR = vec3(3.65, 1.35, 0.0) - vStoneWorldPos;
          float distSqL = dot(toBrazierL, toBrazierL) + 2.6;
          float distSqR = dot(toBrazierR, toBrazierR) + 2.6;
          vec3 wNormal = inverseTransformDirection(normal, viewMatrix);
          float bounceL = max(0.0, dot(wNormal, normalize(toBrazierL)) * 0.65 + 0.35) / distSqL;
          float bounceR = max(0.0, dot(wNormal, normalize(toBrazierR)) * 0.65 + 0.35) / distSqR;
          vec3 fireBounceGI = vec3(1.0, 0.54, 0.20) * (bounceL + bounceR) * 5.2 * uFireBounceStrength * stoneCavityAO;

          // Analytic raking window-sill & end-wall grazing light (replaces 14 static PointLights at zero BRDF cost)
          vec3 toSideWin = vec3(sign(vStoneWorldPos.x) * 6.8, 3.8, vStoneWorldPos.z) - vStoneWorldPos;
          float sideWinDistSq = dot(toSideWin, toSideWin) + 3.2;
          float sideWinGraze = max(0.0, dot(wNormal, normalize(toSideWin)) * 0.75 + 0.25) / sideWinDistSq;
          vec3 windowGrazeGI = vec3(0.84, 0.89, 0.96) * sideWinGraze * 0.95 * stoneCavityAO;
          reflectedLight.indirectDiffuse += (fireBounceGI + windowGrazeGI) * diffuseColor.rgb;`
        );
      };
      mat.needsUpdate = true;
    }

    function setWallStoneLook() {
      currentWallStoneLookIdx = 0;
      const cfg = WALL_STONE_LOOKS[0];

      for (const mat of cathedralWallMats) {
        mat.map = mat.userData.origMap || mat.map;
        mat.normalMap = mat.userData.origNormalMap || mat.normalMap;
        mat.roughnessMap = mat.userData.origRoughnessMap || mat.roughnessMap;
        mat.emissiveMap = mat.userData.origEmissiveMap || null;
        mat.emissiveIntensity = 0.08;
        mat.roughness = cfg.roughness;
        mat.metalness = 0.02;
        if ('envMapIntensity' in mat) mat.envMapIntensity = 0.45;
        if (mat.color) mat.color.setScalar(HALL_BACKDROP_VALUE);
        if (mat.normalScale) mat.normalScale.set(cfg.normalScale, cfg.normalScale);
        mat.needsUpdate = true;
      }

      for (const mat of cathedralColumnMats) {
        mat.map = mat.userData.origMap || mat.map;
        mat.normalMap = mat.userData.origNormalMap || mat.normalMap;
        mat.roughnessMap = mat.userData.origRoughnessMap || mat.roughnessMap;
        mat.emissiveMap = mat.userData.origEmissiveMap || null;
        mat.emissiveIntensity = 0.08;
        mat.roughness = cfg.roughness;
        mat.metalness = 0.02;
        if ('envMapIntensity' in mat) mat.envMapIntensity = 0.48;
        if (mat.color) mat.color.setScalar(HALL_BACKDROP_VALUE);
        if (mat.normalScale) mat.normalScale.set(cfg.colNormalScale, cfg.colNormalScale);
        mat.needsUpdate = true;
      }

      return { index: 0, name: cfg.name, fullName: cfg.fullName };
    }

    function setFloorStoneLook() {
      currentFloorStoneLookIdx = 0;
      const cfg = FLOOR_STONE_LOOKS[0];

      for (const mat of cathedralFloorMats) {
        mat.map = mat.userData.origMap || mat.map;
        mat.normalMap = mat.userData.origNormalMap || mat.normalMap;
        mat.roughnessMap = mat.userData.origRoughnessMap || mat.roughnessMap;
        mat.emissiveMap = mat.userData.origEmissiveMap || null;
        mat.emissiveIntensity = 0.06;
        mat.roughness = cfg.roughness;
        mat.metalness = cfg.metalness;
        if (mat.color) mat.color.setScalar(HALL_BACKDROP_VALUE);
        if ('envMapIntensity' in mat) mat.envMapIntensity = 0.36;
        if (mat.normalScale) mat.normalScale.set(cfg.normalScale, cfg.normalScale);
        mat.needsUpdate = true;
      }

      return { index: 0, name: cfg.name, fullName: cfg.fullName };
    }

    function nextWallStoneLook() {
      return setWallStoneLook(0);
    }
    function prevWallStoneLook() {
      return setWallStoneLook(0);
    }
    function nextFloorStoneLook() {
      return setFloorStoneLook(0);
    }
    function prevFloorStoneLook() {
      return setFloorStoneLook(0);
    }

    const ASSET_CACHE_VER = 'v=statue_pilot_v6';

    // Cloudflare does not compress .glb, so models ship as .glb.gz and are inflated here.
    async function fetchGlbModel(baseName) {
      const res = await fetch(`./assets/glb/${baseName}.glb.gz?${ASSET_CACHE_VER}`);
      // Unknown paths fall back to index.html, so an HTML answer is a missing model.
      if (!res.ok || (res.headers.get('content-type') || '').includes('text/html')) {
        throw new Error(`Failed to fetch ${baseName}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      // A server that adds Content-Encoding: gzip hands over bytes the browser already inflated.
      if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.buffer;
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).arrayBuffer();
    }

    async function loadGltfModel(baseName) {
      const arrayBuffer = await fetchGlbModel(baseName);
      return new Promise((resolve, reject) => {
        gltfLoader.parse(arrayBuffer, './assets/glb/', (gltf) => resolve(gltf), (err) => reject(err));
      });
    }

    function preparePieceTemplateFromGltf(gltf) {
      const toRemove = [];
      const goldSubMeshes = [];
      gltf.scene.traverse((child) => {
        const nm = child.name || '';
        if (nm.includes('Icosphere') || nm.includes('glTF_not_exported')) {
          child.visible = false;
          toRemove.push(child);
          return;
        }
        if (child.isMesh) {
          child.raycast = () => {};
          const mName = child.material?.name || '';
          if (
            (mName.includes('HogwartsTrim_AntiqueGold') ||
              mName.includes('Trim') ||
              mName.includes('Bronze')) &&
            !mName.includes('Glow') &&
            child.geometry
          ) {
            goldSubMeshes.push(child);
          }
        }
      });

      // Safely consolidate compatible Trim sub-meshes sharing goldTrimMat and Skeleton/bindMatrix
      if (goldSubMeshes.length >= 2) {
        const primaryGold = goldSubMeshes[0];
        const mergeableGold = [primaryGold];
        for (let i = 1; i < goldSubMeshes.length; i++) {
          const candidate = goldSubMeshes[i];
          const sameParent = candidate.parent === primaryGold.parent;
          const sameSkeleton =
            (!primaryGold.skeleton && !candidate.skeleton) ||
            (primaryGold.skeleton &&
              candidate.skeleton &&
              primaryGold.skeleton.bones.length === candidate.skeleton.bones.length &&
              (!primaryGold.bindMatrix ||
                !candidate.bindMatrix ||
                primaryGold.bindMatrix.equals(candidate.bindMatrix)));
          if (sameParent && sameSkeleton) {
            mergeableGold.push(candidate);
          }
        }
        if (mergeableGold.length >= 2) {
          try {
            const oldPrimaryGeo = primaryGold.geometry;
            const mergedGeo = mergeGeometries(
              mergeableGold.map((m) => m.geometry),
              false
            );
            if (mergedGeo) {
              primaryGold.geometry = mergedGeo;
              if (oldPrimaryGeo && oldPrimaryGeo !== mergedGeo) {
                oldPrimaryGeo.dispose();
              }
              for (let i = 1; i < mergeableGold.length; i++) {
                toRemove.push(mergeableGold[i]);
              }
            }
          } catch (e) {}
        }
      }

      for (const rem of toRemove) {
        if (rem.geometry) {
          try {
            rem.geometry.dispose();
          } catch (e) {}
        }
        if (rem.material && rem.material !== goldTrimMat && rem.material !== forgedSteelMat && rem.material !== whitePieceMat && rem.material !== blackPieceMat) {
          try {
            if (Array.isArray(rem.material)) {
              rem.material.forEach((m) => m?.dispose?.());
            } else {
              rem.material.dispose?.();
            }
          } catch (e) {}
        }
        if (rem.parent) rem.parent.remove(rem);
      }

      // Split Knight's Warhorse triangles (Horse_*, BackLeg*, FrontLeg*, FrontHoof*) into a sibling SkinnedMesh
      // so the Rider & Base keep bank.primary while the Warhorse receives a contrasting bank.steed coat!
      splitKnightSteedSubMesh(gltf.scene);

      // Pre-populate local boundingBox & boundingSphere on all template SkinnedMeshes so
      // Three.js Frustum.intersectsObject never triggers 1.15M-vertex CPU applyBoneTransform stalls.
      gltf.scene.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;
        if (!child.geometry.boundingBox) {
          child.geometry.computeBoundingBox();
        }
        if (!child.geometry.boundingSphere) {
          child.geometry.computeBoundingSphere();
        }
        if (child.isSkinnedMesh) {
          const gSphere = child.geometry.boundingSphere;
          if (gSphere) {
            child.boundingSphere = gSphere.clone();
            child.boundingSphere.radius = Math.max(child.boundingSphere.radius * 1.4, 2.5);
          } else {
            child.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 3.0);
          }
          if (child.geometry.boundingBox) {
            child.boundingBox = child.geometry.boundingBox.clone().expandByScalar(0.5);
          }
        }
      });

      return {
        scene: gltf.scene,
        animations: gltf.animations || []
      };
    }

    function splitKnightSteedSubMesh(sceneRoot) {
      if (!sceneRoot) return;
      const bones = [];
      sceneRoot.traverse((c) => {
        if (c.isBone) bones.push(c.name || '');
      });
      const hasHorseBones = bones.some((b) => /Horse_Head|Horse_Chest|Horse_Rear/i.test(b));
      if (!hasHorseBones) return;

      const meshesToSplit = [];
      sceneRoot.traverse((child) => {
        if (!child.isMesh || !child.geometry || child.userData?.isSteedMesh) return;
        const mName = child.material?.name || '';
        if (/Gold|Trim|Bronze|Glow|Steel/i.test(mName)) return;
        if (child.geometry.attributes?.skinIndex && child.geometry.attributes?.skinWeight) {
          meshesToSplit.push(child);
        }
      });

      for (const child of meshesToSplit) {
        const skelBones = child.skeleton?.bones || [];
        const horseBoneIdx = new Set();
        skelBones.forEach((b, idx) => {
          if (/Horse_|BackLeg|FrontLeg|FrontHoof/i.test(b.name || '')) {
            horseBoneIdx.add(idx);
          }
        });
        if (horseBoneIdx.size === 0) {
          bones.forEach((bName, idx) => {
            if (/Horse_|BackLeg|FrontLeg|FrontHoof/i.test(bName)) {
              horseBoneIdx.add(idx);
            }
          });
        }
        if (horseBoneIdx.size === 0) continue;

        const geo = child.geometry;
        const si = geo.attributes.skinIndex;
        const sw = geo.attributes.skinWeight;
        const idxAttr = geo.index;
        const isHorseVert = (v) => {
          let bestB = si.getX(v);
          let bestW = sw.getX(v);
          if (sw.getY(v) > bestW) {
            bestB = si.getY(v);
            bestW = sw.getY(v);
          }
          if (sw.getZ(v) > bestW) {
            bestB = si.getZ(v);
            bestW = sw.getZ(v);
          }
          if (sw.getW(v) > bestW) {
            bestB = si.getW(v);
            bestW = sw.getW(v);
          }
          return horseBoneIdx.has(bestB);
        };

        const riderIndices = [];
        const steedIndices = [];
        const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(si.count / 3);
        for (let t = 0; t < triCount; t++) {
          const a = idxAttr ? idxAttr.getX(t * 3) : t * 3;
          const b = idxAttr ? idxAttr.getX(t * 3 + 1) : t * 3 + 1;
          const d = idxAttr ? idxAttr.getX(t * 3 + 2) : t * 3 + 2;
          const hCount = (isHorseVert(a) ? 1 : 0) + (isHorseVert(b) ? 1 : 0) + (isHorseVert(d) ? 1 : 0);
          if (hCount >= 2) {
            steedIndices.push(a, b, d);
          } else {
            riderIndices.push(a, b, d);
          }
        }

        if (steedIndices.length > 0 && riderIndices.length > 0 && child.parent) {
          const steedGeo = geo.clone();
          steedGeo.setIndex(steedIndices);
          geo.setIndex(riderIndices);

          const steedMesh = child.isSkinnedMesh
            ? new THREE.SkinnedMesh(steedGeo, child.material)
            : new THREE.Mesh(steedGeo, child.material);
          steedMesh.name = `${child.name || 'Knight'}_Steed`;
          steedMesh.castShadow = true;
          steedMesh.receiveShadow = true;
          steedMesh.raycast = () => {};
          steedMesh.userData = {
            ...(child.userData || {}),
            origMatName: 'KnightSteedCoat',
            isSteedMesh: true
          };
          if (child.isSkinnedMesh && child.skeleton) {
            steedMesh.bind(child.skeleton, child.bindMatrix);
          }
          child.parent.add(steedMesh);
        }
      }
    }

    function evictUnusedMobileSkinSets(protectedSetId) {
      if (!isCoarseOrMobile) return;
      const maxCachedSets = 2;
      while (loadedCustomSkinSets.length > maxCachedSets) {
        const candidateIdx = loadedCustomSkinSets.findIndex(
          (id) =>
            id !== 'hogwarts' &&
            id !== protectedSetId &&
            id !== activeSkinWhite &&
            id !== activeSkinBlack
        );
        if (candidateIdx === -1) break;
        const [evictedSetId] = loadedCustomSkinSets.splice(candidateIdx, 1);
        for (const type of PIECE_TYPES) {
          const key = `${evictedSetId}__${type}`;
          const tpl = pieceTemplates[key];
          if (tpl && tpl.scene) {
            tpl.scene.traverse((child) => {
              if (child.isMesh && child.geometry) {
                try {
                  child.geometry.dispose();
                } catch (e) {}
              }
              if (child.isSkinnedMesh && child.skeleton && typeof child.skeleton.dispose === 'function') {
                try {
                  child.skeleton.dispose();
                } catch (e) {}
              }
            });
          }
          delete pieceTemplates[key];
        }
        delete skinSetLoadPromises[evictedSetId];
      }
    }

    let xiangqiModelsLoadPromise = null;
    // After a failed load, every piece missing a template would retry at once; wait before refetching.
    let xiangqiLoadRetryAt = 0;
    function ensureXiangqiModelsLoaded() {
      if (xiangqiModelsLoadPromise) return xiangqiModelsLoadPromise;
      if (Date.now() < xiangqiLoadRetryAt) return Promise.resolve();
      xiangqiModelsLoadPromise = (async () => {
        try {
          await Promise.all(
            XIANGQI_PIECE_TYPES.map(async (type) => {
              if (pieceTemplates[`xiangqi__${type}`]) return;
              const gltf = await loadGltfModel(`xiangqi/${type}_white`);
              const tpl = preparePieceTemplateFromGltf(gltf);
              await attachBodyDetailMaps(
                tpl,
                {
                  normal: `./assets/glb/detail/xiangqi/${type}_normal.webp`,
                  ao: `./assets/glb/detail/xiangqi/${type}_ao.webp`
                },
                `xiangqi ${type}`
              );
              pieceTemplates[`xiangqi__${type}`] = tpl;
            })
          );
          if (gameVariant === 'xiangqi' && typeof boardState !== 'undefined' && Array.isArray(boardState)) {
            for (let r = 0; r < boardState.length; r++) {
              const row = boardState[r];
              if (!row) continue;
              for (let c = 0; c < row.length; c++) {
                const p = row[c];
                if (p) {
                  attachSkinKitbashToPiece(p);
                }
              }
            }
            if (typeof renderer !== 'undefined' && renderer.shadowMap) {
              renderer.shadowMap.needsUpdate = true;
            }
          }
        } catch (err) {
          console.warn('Xiangqi sculpted models load warning:', err);
          xiangqiModelsLoadPromise = null;
          xiangqiLoadRetryAt = Date.now() + 5000;
        }
      })();
      return xiangqiModelsLoadPromise;
    }

    function ensureSkinSetLoaded(setId) {
      if (!SCULPTED_SET_IDS.has(setId)) return Promise.resolve();
      if (skinSetLoadPromises[setId]) return skinSetLoadPromises[setId];

      skinSetLoadPromises[setId] = (async () => {
        try {
          await Promise.all(
            PIECE_TYPES.map(async (type) => {
              if (pieceTemplates[`${setId}__${type}`]) return;
              const gltf = await loadGltfModel(`sets/${setId}/${type}_white`);
              pieceTemplates[`${setId}__${type}`] = preparePieceTemplateFromGltf(gltf);
            })
          );
          if (setId !== 'hogwarts') {
            const existingIdx = loadedCustomSkinSets.indexOf(setId);
            if (existingIdx !== -1) loadedCustomSkinSets.splice(existingIdx, 1);
            loadedCustomSkinSets.push(setId);
            evictUnusedMobileSkinSets(setId);
          }
          if (typeof boardState !== 'undefined' && Array.isArray(boardState)) {
            for (let r = 0; r < boardState.length; r++) {
              const row = boardState[r];
              if (!row) continue;
              for (let c = 0; c < row.length; c++) {
                const p = row[c];
                if (p) {
                  attachSkinKitbashToPiece(p);
                }
              }
            }
          }
          if (typeof renderer !== 'undefined' && renderer.shadowMap) {
            renderer.shadowMap.needsUpdate = true;
          }
        } catch (err) {
          console.warn(`Sculpted set lazy-load warning (${setId}):`, err);
          delete skinSetLoadPromises[setId];
        }
      })();
      return skinSetLoadPromises[setId];
    }

    async function loadAllAssets() {
      const loaderBar = document.getElementById('loader-bar');
      const loaderText = document.getElementById('loader-text');
      const totalItems = PIECE_TYPES.length + 1;
      if (loaderBar) loaderBar.style.width = '8%';
      let loadedCount = 0;

      function bumpProgress(label) {
        loadedCount++;
        const pct = Math.min(100, Math.round((loadedCount / totalItems) * 100));
        if (loaderBar) loaderBar.style.width = `${pct}%`;
        if (loaderText) loaderText.textContent = label;
      }

      // Instantiate custom GLSL shaders for the 3 sculpted brazier flame layers & charred ember logs
      const flameCoreShader = createSculptedFlameTongueShader({
        baseColor: [1.0, 0.96, 0.72],
        midColor: [1.0, 0.64, 0.12],
        tipColor: [1.0, 0.36, 0.03],
        strength: 1.85,
        opacity: 0.92,
        zMin: 0.60,
        zMax: 1.64,
        layerSeed: 0.0
      });
      const flameMidShader = createSculptedFlameTongueShader({
        baseColor: [1.0, 0.78, 0.25],
        midColor: [1.0, 0.40, 0.04],
        tipColor: [0.92, 0.16, 0.01],
        strength: 1.35,
        opacity: 0.82,
        zMin: 0.60,
        zMax: 1.52,
        layerSeed: 2.1
      });
      const flameOuterShader = createSculptedFlameTongueShader({
        baseColor: [1.0, 0.45, 0.06],
        midColor: [0.88, 0.18, 0.015],
        tipColor: [0.45, 0.03, 0.002],
        strength: 0.95,
        opacity: 0.68,
        zMin: 0.60,
        zMax: 1.36,
        layerSeed: 4.4,
        singleOctave: true
      });
      const charredEmberLogsShader = createCharredEmberLogsShader();

      // 1. Load Native Full-Height Cathedral Environment (shifted by z = -0.65 so the Obsidian Altar is centered at 0, 0.7215, 0)
      const maxAniso = renderer.capabilities.getMaxAnisotropy() || 8;
      const cathedralTask = (async () => {
        try {
          const gltf = await loadGltfModel('option8_cathedral');
          const cathedralRoot = gltf.scene;
          cathedralRoot.position.set(0, 0, -0.65);

          cathedralRoot.traverse((child) => {
            child.updateMatrix();
            child.matrixAutoUpdate = false;
            if (!child.isMesh) return;
            child.receiveShadow = true;
            const meshName = child.name || '';
            const mNameFirst = (Array.isArray(child.material) ? child.material[0]?.name : child.material?.name) || '';

            if (meshName.includes('Brazier_Flame_Core') || mNameFirst.includes('Flame_Core')) {
              child.material = flameCoreShader;
              child.castShadow = false;
              child.receiveShadow = false;
              child.renderOrder = 12;
              return;
            }
            if (meshName.includes('Brazier_Flame_Mid') || mNameFirst.includes('Flame_Mid')) {
              stripIcosphereSparksFromFlameGeometry(child.geometry);
              child.material = flameMidShader;
              child.castShadow = false;
              child.receiveShadow = false;
              child.renderOrder = 11;
              return;
            }
            if (meshName.includes('Brazier_Flame_Outer') || mNameFirst.includes('Flame_Outer')) {
              child.material = flameOuterShader;
              child.castShadow = false;
              child.receiveShadow = false;
              child.renderOrder = 10;
              return;
            }
            if (meshName.includes('Embers_Logs') || mNameFirst.includes('Ember')) {
              child.material = charredEmberLogsShader;
              child.castShadow = false;
              child.receiveShadow = false;
              return;
            }
            if (meshName.includes('Altar_Golden_Runes')) {
              child.visible = false;
              child.castShadow = false;
              child.receiveShadow = false;
              return;
            }

            // Only the central Obsidian Altar casts real-time directional shadows;
            // cathedral columns/walls/ceiling and twin braziers use baked 3D Chiaroscuro & BVH ray-traced AO
            // so they never project clipped or directional shadows across the floor.
            const isShadowCasterProp =
              meshName.includes('Obsidian_Altar') ||
              meshName.includes('Altar_Golden_Runes');

            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of mats) {
              if (!mat) continue;
              const mName = mat.name || '';
              const isAmberGlass =
                mName.includes('Amber') ||
                mName.includes('Narthex_Amber') ||
                meshName.includes('Narthex_Amber');
              const isGlass =
                isAmberGlass ||
                mName.includes('Glass') ||
                mName.includes('Lancet') ||
                mName.includes('Rose') ||
                meshName.includes('Glass') ||
                meshName.includes('Window');
              const isRay = mName.includes('GodRay') || meshName.includes('GodRay');

              for (const texKey of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
                if (mat[texKey]) {
                  mat[texKey].anisotropy = maxAniso;
                  mat[texKey].needsUpdate = true;
                }
              }

              // Preserve native 1024x1024 GLB-baked textures before any look switching
              if (!mat.userData.origCaptured) {
                mat.userData.origCaptured = true;
                mat.userData.origMap = mat.map || null;
                mat.userData.origNormalMap = mat.normalMap || null;
                mat.userData.origRoughnessMap = mat.roughnessMap || null;
                mat.userData.origEmissiveMap = mat.emissiveMap || null;
              }

              if (mat.normalMap && mat.normalScale) {
                const isDoorMat = mName.includes('Oak') || mName.includes('Door') || meshName.includes('Door');
                const nScale = isDoorMat ? 1.05 : 1.15;
                mat.normalScale.set(nScale, nScale);
              }

              if (isAmberGlass) {
                mat.vertexColors = false;
                mat.color = new THREE.Color(0xffe6b8);
                mat.emissive = new THREE.Color(0xffa033);
                mat.emissiveIntensity = 2.45;
                mat.roughness = 0.15;
                mat.metalness = 0.0;
                mat.side = THREE.DoubleSide;
                child.castShadow = false;
              } else if (isGlass) {
                mat.vertexColors = false;
                mat.color = new THREE.Color(0xdbeeff);
                mat.emissive = new THREE.Color(0x68a8ff);
                mat.emissiveIntensity = 2.65;
                mat.roughness = 0.15;
                mat.metalness = 0.0;
                mat.side = THREE.DoubleSide;
                child.castShadow = false;
              } else if (isRay) {
                child.visible = false;
                child.castShadow = false;
                child.receiveShadow = false;
              } else {
                if (mat.map) {
                  mat.vertexColors = true;
                }
                child.castShadow = isShadowCasterProp;

                // Register Wall, Column/Arch/Plinth, and Floor stone materials for live 6-look switching & Realism Shader
                if (mName.includes('Floor') || mName.includes('Flagstone') || meshName.includes('Floor')) {
                  applyCathedralStoneRealismShader(mat, true);
                  if (!cathedralFloorMats.includes(mat)) cathedralFloorMats.push(mat);
                } else if (
                  mName.includes('Column_Stone') ||
                  mName.includes('Tracery') ||
                  meshName.includes('Plinth') ||
                  meshName.includes('Tracery')
                ) {
                  applyCathedralStoneRealismShader(mat, false);
                  if (!cathedralColumnMats.includes(mat)) cathedralColumnMats.push(mat);
                } else if (
                  mName.includes('Gothic_Ashlar') ||
                  mName.includes('Ashlar') ||
                  mName.includes('Vault') ||
                  meshName.includes('Cathedral_Stone')
                ) {
                  applyCathedralStoneRealismShader(mat, false);
                  if (!cathedralWallMats.includes(mat)) cathedralWallMats.push(mat);
                }
              }
              mat.needsUpdate = true;
            }
          });

          // Initialize default Look 1/6 (Original Ashlar & Abbey Flagstone) on Wall/Column Stone and Floor Stone
          setWallStoneLook(0);
          setFloorStoneLook(0);
          scene.add(cathedralRoot);
          cathedralRoot.updateMatrix();
          cathedralRoot.updateMatrixWorld(true);
          cathedralRoot.matrixAutoUpdate = false;

          bumpProgress('Cathedral Architecture Loaded...');
        } catch (err) {
          console.warn('Cathedral GLB load warning:', err);
          bumpProgress('Cathedral Loaded');
        }
      })();

      // 2. Load 6 Sculpted & Rigged Chess Piece Models + 7 Sculpted Xiangqi Piece Models concurrently
      const pieceTasks = PIECE_TYPES.map(async (type) => {
        try {
          const gltf = await loadGltfModel(`${type}_white`);
          const tpl = preparePieceTemplateFromGltf(gltf);
          await attachBodyDetailMaps(tpl, BASE_PIECE_DETAIL_MAPS[type], type);
          pieceTemplates[`hogwarts__${type}`] = tpl;
          pieceTemplates[`${type}_w`] = tpl;
          pieceTemplates[`${type}_b`] = tpl;
          bumpProgress(`Summoned ${type.toUpperCase()} Statue...`);
        } catch (err) {
          console.warn(`Piece load warning (${type}):`, err);
          bumpProgress(`Loaded ${type}`);
        }
      });

      const xiangqiTask = ensureXiangqiModelsLoaded();

      await Promise.all([cathedralTask, ...pieceTasks]);
      await xiangqiTask;
    }

    // =========================================================================
    // Chess & Xiangqi Game State, Complete Move Rules, and AI Engine
    // =========================================================================
    let boardState = Array.from({ length: 10 }, () => Array(9).fill(null));
    let currentTurn = 'w';
    let selectedSquare = null;
    let validMoves = [];
    let isAnimatingMove = false;
    let gameOver = false;
    let capturedByWhite = 0;
    let capturedByBlack = 0;

    // Mode & Player Configuration
    let gameMode = 'single'; // 'single' | 'multi'
    let playerColor = 'w';   // 'w' | 'b' | 'spectator'
    let isPassAndPlay = false;
    let autoFlipCamera2P = true;
    let aiAutoPlay = true;
    let aiTimer = null;
    let aiJobId = 0;
    let aiSearchInFlight = false;

    function cancelPendingAISearch() {
      aiJobId += 1;
      aiSearchInFlight = false;
      if (aiTimer) {
        clearTimeout(aiTimer);
        aiTimer = null;
      }
    }

    // Multiplayer State
    function readStoredPlayerToken() {
      try {
        if (typeof sessionStorage !== 'undefined') {
          return sessionStorage.getItem('wizard_chess_token') || '';
        }
      } catch (e) {}
      try {
        return localStorage.getItem('wizard_chess_token') || '';
      } catch (e) {
        return '';
      }
    }

    function saveStoredPlayerToken(tok) {
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('wizard_chess_token', tok);
          return;
        }
      } catch (e) {}
      try {
        localStorage.setItem('wizard_chess_token', tok);
      } catch (e) {}
    }

    let roomCode = null;
    let playerToken = readStoredPlayerToken();
    let roomEventSource = null;
    let roomPollTimer = null;
    let appliedMoveSeq = 0;
    let remoteSyncSession = 0; // bump to cancel any in-flight remote drain
    let latestRemoteRoom = null; // newest room snapshot from any sync source
    let remoteDrainActive = false; // only one drain loop at a time
    let multiPlyCount = 0; // plies on the board since the last reset; unlike moveHistory, never capped
    let lastResyncAt = 0;
    let variantSwitchPending = false;
    let tweenErrorPending = false;
    // Only flags the failure: runTweens is still iterating activeMoveTweens when this runs.
    const reportTweenError = (err) => {
      tweenErrorPending = true;
      console.error('Move tween failed; dropped', err);
    };
    let appliedResetCount = 0;
    let roomBothReady = false;
    let roomInviteCopied = false;

    // Camera Animation & Telemetry State
    const cameraTelemetry = {
      lastAttackSamples: [],
      attackCount: 0,
      maxStepDelta: 0,
      columnDeflections: 0,
      minColumnClearance: Infinity,
      lastColumnClearance: Infinity
    };
    window.__wizardChessTelemetry = cameraTelemetry;

    let activeCamTransition = null; // { startPos, endPos, startTarget, endTarget, elapsed, duration }

    function flushOrbitControlsDamping() {
      const wasDamping = orbitControls.enableDamping;
      const wasEnabled = orbitControls.enabled;
      orbitControls.enableDamping = false;
      orbitControls.enabled = true;
      orbitControls.update();
      enforceCathedralBoundsAndSolidColumns(null, camera.position, orbitControls.target);
      camera.lookAt(orbitControls.target);
      orbitControls.enableDamping = wasDamping;
      orbitControls.enabled = wasEnabled;
    }

    function smoothCameraTo(targetPos, targetLookAt, duration = 0.75) {
      flushOrbitControlsDamping();
      const clampedPos = targetPos.clone();
      const clampedLook = targetLookAt.clone();
      enforceCathedralBoundsAndSolidColumns(clampedPos, clampedPos, clampedLook);
      if (motionLevel === 'off') {
        activeCamTransition = null;
        camera.position.copy(clampedPos);
        orbitControls.target.copy(clampedLook);
        flushOrbitControlsDamping();
        return;
      }
      activeCamTransition = {
        startPos: camera.position.clone(),
        endPos: clampedPos,
        startTarget: orbitControls.target.clone(),
        endTarget: clampedLook,
        elapsed: 0,
        duration: Math.max(0.05, duration)
      };
    }

    /** 3/4 view from one side's corner. Pure: called before most state exists to set the start-up camera. */
    function getSpectatorPose(side, tPortrait) {
      const s = side === 'b' ? -1 : 1;
      return {
        pos: new THREE.Vector3(s * 0.6 * (1 - tPortrait), 5.0 + tPortrait * 2.2, s * (4.1 + tPortrait * 2.75)),
        lookAt: new THREE.Vector3(0, 0.62, s * (0.12 - tPortrait * 0.17))
      };
    }

    function setCameraForSide(color, immediate = false) {
      // Elevated 3/4 Tactical Seat (~48 deg pitch down): clear view of all 64 squares on the spacious 3.52m board & Sanctum Dais
      const zSign = color === 'b' ? -1 : 1;
      const desiredPos = new THREE.Vector3(0, 3.82, zSign * 3.58);
      const desiredTarget = new THREE.Vector3(0, 0.78, zSign * -0.06);
      const tPortrait = syncResponsiveCameraFov();
      const isShortLandscape = tPortrait === 0 && (window.innerHeight || 800) <= 520;
      if (tPortrait > 0) {
        desiredPos.y = Number((3.82 + tPortrait * 3.03).toFixed(3));
        desiredPos.z = Number((zSign * (3.58 + tPortrait * 2.10)).toFixed(3));
        desiredTarget.y = Number((0.78 - tPortrait * 0.14).toFixed(3));
        desiredTarget.z = Number((zSign * (-0.06 + tPortrait * 0.48)).toFixed(3));
      } else if (isShortLandscape) {
        desiredPos.y = 4.26;
        desiredPos.z = Number((zSign * 4.02).toFixed(3));
        desiredTarget.z = Number((zSign * 0.18).toFixed(3));
      }
      if (immediate) {
        activeCamTransition = null;
        camera.position.copy(desiredPos);
        orbitControls.target.copy(desiredTarget);
        flushOrbitControlsDamping();
      } else {
        smoothCameraTo(desiredPos, desiredTarget, 0.8);
      }
    }

    function setOverheadCameraForSide(color, immediate = false) {
      // High Top-Down Overhead Seat: commanding bird's-eye view of the entire board by default
      const zSign = color === 'b' ? -1 : 1;
      const tPortrait = syncResponsiveCameraFov();
      const desiredPos = new THREE.Vector3(
        0,
        Number((7.35 + tPortrait * 1.45).toFixed(3)),
        Number((zSign * (3.95 + tPortrait * 0.45)).toFixed(3))
      );
      const desiredTarget = new THREE.Vector3(
        0,
        0.78,
        Number((zSign * (-tPortrait * 0.28)).toFixed(3))
      );
      if (immediate) {
        activeCamTransition = null;
        camera.position.copy(desiredPos);
        orbitControls.target.copy(desiredTarget);
        flushOrbitControlsDamping();
      } else {
        smoothCameraTo(desiredPos, desiredTarget, 0.75);
      }
    }

    function instantiatePiece(type, color, r, c) {
      const skinId = color === 'b' ? activeSkinBlack : activeSkinWhite;
      const targetSetId = gameVariant === 'xiangqi' ? 'xiangqi' : (SCULPTED_SET_IDS.has(skinId) ? skinId : 'hogwarts');
      const customTpl = pieceTemplates[`${targetSetId}__${type}`];
      const tpl = customTpl || pieceTemplates[`hogwarts__${type}`] || pieceTemplates[`${type}_${color}`];
      const loadedSetId = customTpl ? targetSetId : 'hogwarts';
      let root;
      let mixer = null;
      const actions = {};

      if (tpl && tpl.scene) {
        root = SkeletonUtils.clone(tpl.scene);
        const primaryMat = color === 'w' ? whitePieceMat : blackPieceMat;
        let sharedPieceSkeleton = null;
        let sharedPieceBindMatrix = null;
        root.traverse((child) => {
          const nm = child.name || '';
          if (nm.includes('Icosphere') || nm.includes('glTF_not_exported')) {
            child.visible = false;
            return;
          }
          if (child.isMesh) {
            // Disable expensive CPU SkinnedMesh raycasting on all visual sub-meshes
            child.raycast = () => {};
            if (child.isSkinnedMesh) {
              if (!child.boundingSphere) {
                const gSphere = child.geometry?.boundingSphere;
                child.boundingSphere = gSphere
                  ? new THREE.Sphere(gSphere.center.clone(), Math.max(gSphere.radius * 1.4, 2.5))
                  : new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 3.0);
              }
              child.computeBoundingSphere = function () {
                if (!this.boundingSphere) {
                  this.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 3.0);
                }
              };
              if (child.skeleton) {
                if (!sharedPieceSkeleton) {
                  sharedPieceSkeleton = child.skeleton;
                  sharedPieceBindMatrix = child.bindMatrix;
                } else if (
                  sharedPieceSkeleton.bones.length === child.skeleton.bones.length &&
                  (!sharedPieceBindMatrix || !child.bindMatrix || sharedPieceBindMatrix.equals(child.bindMatrix))
                ) {
                  const prevSkel = child.skeleton;
                  child.bind(sharedPieceSkeleton, child.bindMatrix);
                  if (prevSkel && prevSkel !== sharedPieceSkeleton && typeof prevSkel.dispose === 'function') {
                    prevSkel.dispose();
                  }
                }
              }
            }
            const mName = child.userData.origMatName || child.material?.name || '';
            if (!child.userData.origMatName && mName) {
              child.userData.origMatName = mName;
            }
            if (mName.includes('Gold') || mName.includes('Trim') || mName.includes('Bronze') || mName.includes('Glow')) {
              child.material = goldTrimMat;
              child.castShadow = false;
              child.receiveShadow = false;
            } else if (mName.includes('Steel')) {
              child.material = forgedSteelMat;
              child.castShadow = true;
              child.receiveShadow = false;
            } else {
              child.material = resolveBodyMaterial(primaryMat, child);
              child.castShadow = true;
              child.receiveShadow = true;
            }
          }
        });
        mixer = new THREE.AnimationMixer(root);
        for (const clip of tpl.animations) {
          actions[clip.name] = mixer.clipAction(clip);
        }
        activeMixers.push(mixer);
      } else {
        root = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.14, 0.42, 16),
          color === 'w' ? whitePieceMat : blackPieceMat
        );
        root.raycast = () => {};
      }

      const worldPos = boardToWorld(r, c);
      root.position.copy(worldPos);
      applyPieceBaseScale(root, type);
      // White (at +Z, r=6,7) faces -Z (Math.PI); Black (at -Z, r=0,1) faces +Z (0)
      root.rotation.y = color === 'w' ? Math.PI : 0;
      scene.add(root);

      const hitboxProxy = new THREE.Mesh(getPieceHitboxGeometry(type), pieceHitboxMat);
      hitboxProxy.name = 'PieceHitboxProxy';
      hitboxProxy.visible = false;
      hitboxProxy.castShadow = false;
      hitboxProxy.receiveShadow = false;
      root.add(hitboxProxy);

      const pedestalRing = new THREE.Mesh(
        sharedPiecePedestalRingGeo,
        color === 'w' ? sharedWhitePedestalRingMat : sharedBlackPedestalRingMat
      );
      pedestalRing.name = 'PiecePedestalRing';
      pedestalRing.castShadow = false;
      pedestalRing.receiveShadow = false;
      pedestalRing.raycast = () => {};
      root.add(pedestalRing);

      const pieceObj = {
        type,
        color,
        r,
        c,
        mesh: root,
        hitbox: hitboxProxy,
        pedestalRing,
        mixer,
        actions,
        currentAction: null,
        isIdleClip: true,
        idleSettleRemaining: 0,
        hasMoved: false,
        loadedSetId
      };

      hitboxProxy.userData = { piece: pieceObj, isHitboxProxy: true };
      pedestalRing.userData = { piece: pieceObj, isPedestalRing: true };
      if (mixer) {
        mixer.userData = { piece: pieceObj };
      }

      root.traverse((child) => {
        child.userData.piece = pieceObj;
      });

      playPieceClip(pieceObj, 'Idle', true, 0);
      if (mixer) {
        mixer.update(0.0001);
      }
      attachSkinKitbashToPiece(pieceObj);
      return pieceObj;
    }

    // Shortest-arc angular interpolation in radians (eliminates 1-frame yaw snapping on move start, defense turn, and settle)
    function lerpAngleShortest(fromRad, toRad, t) {
      const twoPi = Math.PI * 2;
      let delta = ((toRad - fromRad) % twoPi + twoPi * 1.5) % twoPi - Math.PI;
      return fromRad + delta * Math.max(0, Math.min(1, t));
    }

    // Piece-Specific Locomotion Gait Physics (smooth stride cadence, hover lift, pitch lean, and roll sway)
    // Shares of a move's duration spent on the crouch before it and the squash at its end.
    const MOVE_TRACE_WHITE_HEX = 0xfff1cc;
    const MOVE_TRACE_BLACK_HEX = 0x86a4ff;
    const MOVE_ANTICIPATION_SPAN = 0.16;
    const MOVE_SETTLE_SPAN = 0.16;
    const LOCOMOTION_GAIT_PROFILES = {
      pawn:     { moveTimeScale: 0.96, stepFreqPerSq: 2.0, stepLift: 0.018, hoverLift: 0.000, pitchLean: 0.075, rollSway: 0.032 },
      advisor:  { moveTimeScale: 0.94, stepFreqPerSq: 1.6, stepLift: 0.014, hoverLift: 0.010, pitchLean: 0.068, rollSway: 0.030 },
      elephant: { moveTimeScale: 0.80, stepFreqPerSq: 1.2, stepLift: 0.022, hoverLift: 0.000, pitchLean: 0.060, rollSway: 0.038 },
      cannon:   { moveTimeScale: 0.88, stepFreqPerSq: 1.4, stepLift: 0.006, hoverLift: 0.000, pitchLean: 0.045, rollSway: 0.015 },
      rook:     { moveTimeScale: 0.84, stepFreqPerSq: 1.5, stepLift: 0.008, hoverLift: 0.000, pitchLean: 0.055, rollSway: 0.018 },
      knight:   { moveTimeScale: 1.04, stepFreqPerSq: 1.0, stepLift: 0.000, hoverLift: 0.075, pitchLean: 0.180, rollSway: 0.025 },
      bishop:   { moveTimeScale: 0.90, stepFreqPerSq: 1.0, stepLift: 0.006, hoverLift: 0.064, pitchLean: 0.068, rollSway: 0.028 },
      queen:    { moveTimeScale: 0.94, stepFreqPerSq: 1.2, stepLift: 0.008, hoverLift: 0.042, pitchLean: 0.062, rollSway: 0.045 },
      king:     { moveTimeScale: 0.82, stepFreqPerSq: 1.6, stepLift: 0.014, hoverLift: 0.000, pitchLean: 0.048, rollSway: 0.036 }
    };

    // Character Signature Attack Profiles (Chess + Xiangqi War-Gods)
    const ATTACK_SYNC_PROFILES = {
      pawn: {
        signatureId: 'pawn_phalanx_spear',
        signatureName: 'Phalanx Shield-Breaker & Spear Thrust',
        standoff: 0.34,
        timeScale: 1.14,
        swingStartClip: 0.24,
        contactClip: 0.38,
        secondContactClip: 0.62,
        blowClip: 0.78,
        maxLunge: 0.145,
        hitStopDuration: 0.03
      },
      advisor: {
        signatureId: 'advisor_imperial_twin_blades',
        signatureName: 'Imperial Palace Guard Twin-Jian Cross Slash',
        standoff: 0.34,
        timeScale: 1.12,
        swingStartClip: 0.20,
        contactClip: 0.38,
        secondContactClip: 0.58,
        blowClip: 0.76,
        maxLunge: 0.135,
        hitStopDuration: 0.03
      },
      elephant: {
        signatureId: 'elephant_war_tusk_quake',
        signatureName: 'Armored War Elephant Tusk Gore & Seismic Stomp',
        standoff: 0.40,
        timeScale: 0.98,
        swingStartClip: 0.30,
        contactClip: 0.52,
        secondContactClip: 0,
        blowClip: 0.76,
        maxLunge: 0.120,
        hitStopDuration: 0.048
      },
      cannon: {
        signatureId: 'cannon_dragon_mortar_barrage',
        signatureName: 'Dragon-Mouth Siege Cannon Mortar Arc Barrage',
        standoff: 0.72, // Ranged Siege Artillery!
        timeScale: 1.04,
        swingStartClip: 0.20,
        contactClip: 0.46,
        secondContactClip: 0,
        blowClip: 0.78,
        maxLunge: 0.020,
        hitStopDuration: 0.045
      },
      rook: {
        signatureId: 'rook_titan_earthshaker',
        signatureName: 'Colossal Titan Earthshaker Slam',
        standoff: 0.40,
        timeScale: 0.98,
        swingStartClip: 0.34,
        contactClip: 0.54,
        secondContactClip: 0,
        blowClip: 0.76,
        maxLunge: 0.095,
        hitStopDuration: 0.045
      },
      knight: {
        signatureId: 'knight_sky_lancer_dive',
        signatureName: 'Sky-Lancer Pegasus Dive & Trample',
        standoff: 0.44,
        timeScale: 1.08,
        swingStartClip: 0.28,
        contactClip: 0.54,
        secondContactClip: 0,
        blowClip: 0.75,
        maxLunge: 0.220,
        hitStopDuration: 0.04
      },
      bishop: {
        signatureId: 'bishop_celestial_judgment',
        signatureName: 'Celestial Judgment Pillar & Sacred Rune Implosion',
        standoff: 0.68, // True Ranged Spellcaster standoff!
        timeScale: 1.04,
        swingStartClip: 0.22,
        contactClip: 0.46,
        secondContactClip: 0,
        blowClip: 0.78,
        maxLunge: 0.025,
        hitStopDuration: 0.035
      },
      queen: {
        signatureId: 'queen_valkyrie_whirlwind_nova',
        signatureName: 'Empress Valkyrie Whirlwind Blitz & Royal Nova',
        standoff: 0.38,
        timeScale: 1.12,
        swingStartClip: 0.20,
        contactClip: 0.36,
        secondContactClip: 0.56,
        blowClip: 0.77,
        maxLunge: 0.150,
        hitStopDuration: 0.035
      },
      king: {
        signatureId: 'king_sovereign_lightning_cleave',
        signatureName: 'Sovereign Execution: Heaven-Cleaver & Lightning Smite',
        standoff: 0.38,
        timeScale: 1.02,
        swingStartClip: 0.32,
        contactClip: 0.54,
        secondContactClip: 0,
        blowClip: 0.78,
        maxLunge: 0.115,
        hitStopDuration: 0.065
      }
    };

    function playPieceClip(piece, clipKeyword, loop = true, fadeSeconds = 0.18) {
      if (!piece || !piece.actions) return;
      const lowerKw = clipKeyword.toLowerCase();
      const key = Object.keys(piece.actions).find((k) =>
        k.toLowerCase().includes(lowerKw)
      );
      if (!key) return;
      const nextAction = piece.actions[key];
      const isIdle = lowerKw.includes('idle');
      const isAttack = lowerKw.includes('attack');
      const isMove = lowerKw.includes('move');
      piece.isIdleClip = isIdle;
      piece.idleSettleRemaining = isIdle ? (fadeSeconds && fadeSeconds > 0.01 ? fadeSeconds + 0.14 : 0) : Infinity;
      if (piece.currentAction && piece.currentAction !== nextAction) {
        piece.currentAction.fadeOut(fadeSeconds);
      }
      nextAction.reset();
      nextAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      nextAction.clampWhenFinished = !loop;
      if (isAttack) {
        const prof = ATTACK_SYNC_PROFILES[piece.type] || ATTACK_SYNC_PROFILES.queen;
        nextAction.timeScale = prof.timeScale;
      } else if (isMove) {
        const gait = LOCOMOTION_GAIT_PROFILES[piece.type] || LOCOMOTION_GAIT_PROFILES.queen;
        nextAction.timeScale = gait.moveTimeScale;
      } else {
        // Deliberate, weighty stone stride and idle breathing
        nextAction.timeScale = 0.84;
      }
      if (isIdle && (!fadeSeconds || fadeSeconds <= 0.01)) {
        // Stagger initial idle phase per board square so the 32 pieces stand in organic sculpted poses
        nextAction.time = ((piece.r * 5 + piece.c * 3) % 16) * 0.11;
      }
      nextAction.fadeIn(fadeSeconds).play();
      piece.currentAction = nextAction;
      if (piece.mixer) {
        piece.mixer.update(0.016);
      }
      renderer.shadowMap.needsUpdate = true;
    }

    const activeCombatMixers = new Set();

    function removePieceFromScene(pieceObj) {
      if (!pieceObj) return;
      if (pieceObj.mesh && pieceObj.mesh.parent) {
        scene.remove(pieceObj.mesh);
      }
      if (pieceObj.mixer) {
        activeCombatMixers.delete(pieceObj.mixer);
        const idx = activeMixers.indexOf(pieceObj.mixer);
        if (idx !== -1) {
          activeMixers.splice(idx, 1);
        }
      }
      disposePieceRuntimeResources(pieceObj.mesh, pieceObj.mixer);
    }

    function clearAllPieces() {
      for (let r = 0; r < boardState.length; r++) {
        const row = boardState[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (row[c]) {
            removePieceFromScene(row[c]);
          }
          row[c] = null;
        }
      }
      activeMixers.length = 0;
      activeCombatMixers.clear();
    }

    // Scripted Chess Notation & Step-Through Choreography State (Features 3a, 3b, 3c)
    let scriptedGameActive = false;
    let scriptDeviated = false;
    let scriptMoves = [];
    let scriptCursor = 0;
    let moveHistory = [];
    let preMoveHighlightTask = null;
    let activeDuelSavedCam = null;

    // FIDE Rules, Tactical Markers, Promotion & AI Difficulty State
    let enPassantTarget = null;
    let halfMoveClock = 0;
    let positionHistory = [];
    let lastMoveSquares = null; // { fromR, fromC, toR, toC } | null
    let aiDifficulty = 'tactical'; // 'novice' | 'tactical' | 'grandmaster'
    let drawReason = null;
    let pendingPromotion = null; // { fromR, fromC, toR, toC, color } | null
    let activeCheckRingMesh = null;
    // Steady 3D Combat Camera (disabled zoom-in/out by default to eliminate motion sickness & lag feel)
    let combatCameraZoomEnabled = false;
    // 3-Layer Piece Identification & Readability System ('smart' | 'all' | 'tap')
    let pieceLabelMode = 'tap';
    let inspectedSquare = null; // { r, c } | null
    // Piece under a real mouse pointer; the raycast runs at most once per frame, after the pointer moved.
    let hoveredSquare = null; // { r, c } | null
    let hoverPending = null; // { x, y } | null
    const hoverCapable = window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches === true;
    const overheadBadgeSlots = [];
    const _overheadProjVec = new THREE.Vector3();

    function initPieceOverheadLayer() {
      const layer = document.getElementById('piece-overhead-layer');
      if (!layer || overheadBadgeSlots.length === 32) return;
      layer.innerHTML = '';
      for (let i = 0; i < 32; i++) {
        const el = document.createElement('div');
        el.className = 'piece-overhead-badge faction-w';
        el.style.opacity = '0';
        el.style.transform = 'translate3d(-9999px, -9999px, 0)';
        const glyphEl = document.createElement('span');
        glyphEl.className = 'piece-overhead-glyph';
        const nameEl = document.createElement('span');
        nameEl.className = 'piece-overhead-name';
        el.appendChild(glyphEl);
        el.appendChild(nameEl);
        layer.appendChild(el);
        overheadBadgeSlots.push({
          el,
          glyphEl,
          nameEl,
          lastGlyph: '',
          lastName: '',
          lastClass: 'piece-overhead-badge faction-w',
          visible: false
        });
      }
    }

    function updatePieceLabelUI() {
      const modeNames = {
        smart: 'Thông Minh',
        all: 'Tất Cả (32)',
        tap: 'Khi Chọn'
      };
      const shortNames = {
        smart: 'Bật',
        all: 'Tất Cả',
        tap: 'Chọn'
      };
      const btnLabels = document.getElementById('btn-piece-labels');
      if (btnLabels) {
        btnLabels.textContent = `🏷️ Tên Quân: ${modeNames[pieceLabelMode] || 'Thông Minh'}`;
        btnLabels.classList.toggle('active', pieceLabelMode !== 'tap');
      }
      const btnQuickLabels = document.getElementById('btn-quick-labels');
      if (btnQuickLabels) {
        btnQuickLabels.textContent = `🏷️ Tên: ${shortNames[pieceLabelMode] || 'Bật'}`;
        btnQuickLabels.classList.toggle('active', pieceLabelMode !== 'tap');
      }
    }

    function setPieceLabelMode(nextMode) {
      if (nextMode === 'smart' || nextMode === 'all' || nextMode === 'tap') {
        pieceLabelMode = nextMode;
        updatePieceLabelUI();
        updatePieceOverheadOverlay();
      }
      return pieceLabelMode;
    }

    function cyclePieceLabelMode() {
      const order = ['tap', 'smart', 'all'];
      const idx = order.indexOf(pieceLabelMode);
      const nextMode = order[(idx + 1) % order.length];
      return setPieceLabelMode(nextMode);
    }

    function updatePieceOverheadOverlay() {
      if (overheadBadgeSlots.length < 32) {
        initPieceOverheadLayer();
      }
      const layer = document.getElementById('piece-overhead-layer');
      const inspectCard = document.getElementById('piece-inspect-card');
      const uiHidden = document.body.classList.contains('cinematic-ui-hidden');
      if (layer) {
        layer.classList.toggle('combat-dim', Boolean(isAnimatingMove));
      }
      if (uiHidden || overheadBadgeSlots.length === 0) {
        if (inspectCard) inspectCard.classList.remove('visible');
        return;
      }

      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;
      let slotIdx = 0;

      for (let r = 0; r < getBoardRows(); r++) {
        for (let c = 0; c < getBoardCols(); c++) {
          const p = boardState[r]?.[c];
          if (!p || !p.mesh) continue;
          const isSelected = Boolean(selectedSquare && selectedSquare.r === r && selectedSquare.c === c);
          const isInspected = Boolean(inspectedSquare && inspectedSquare.r === r && inspectedSquare.c === c);
          const isCaptureTarget = Boolean(
            selectedSquare &&
              validMoves.some(
                (m) =>
                  m.capture &&
                  ((m.r === r && m.c === c) || (m.enPassant && m.captureR === r && m.captureC === c))
              )
          );

          const isHovered = Boolean(hoveredSquare && hoveredSquare.r === r && hoveredSquare.c === c);

          let shouldShow = false;
          if (isSelected || isInspected || isCaptureTarget || isHovered) {
            shouldShow = true;
          } else if (pieceLabelMode === 'all') {
            shouldShow = true;
          } else if (pieceLabelMode === 'smart') {
            shouldShow = gameVariant === 'xiangqi' ? true : p.type !== 'pawn';
          }

          if (!shouldShow || slotIdx >= 32) continue;

          const meta = getRoleMetadata(p.type);
          const roleScale = ROLE_SCALE_MULTIPLIERS[p.type] || 1.0;
          const worldHeadY =
            p.mesh.position.y + (PIECE_HEIGHTS[p.type] || 0.38) * roleScale + (p.type === 'pawn' ? 0.065 : 0.095);
          _overheadProjVec.set(p.mesh.position.x, worldHeadY, p.mesh.position.z);
          _overheadProjVec.project(camera);

          if (_overheadProjVec.z > 1.0 || _overheadProjVec.z < -1.0) continue;

          const sx = (_overheadProjVec.x * 0.5 + 0.5) * vw;
          const sy = (-_overheadProjVec.y * 0.5 + 0.5) * vh;
          if (sx < 16 || sx > vw - 16 || sy < 44 || sy > vh - 44) continue;

          const slot = overheadBadgeSlots[slotIdx++];
          const glyphStr = isCaptureTarget
            ? '⚔️'
            : p.color === 'w'
              ? meta.glyphW
              : meta.glyphB;
          const pieceShortVi =
            p.color === 'w'
              ? meta.shortViW || meta.shortVi
              : meta.shortViB || meta.shortVi;
          const nameStr = isCaptureTarget
            ? `${p.color === 'w' ? meta.glyphW : meta.glyphB} ${pieceShortVi}`
            : pieceShortVi;
          const cls = `piece-overhead-badge faction-${p.color}${
            p.type === 'pawn' && !isSelected && !isInspected && !isCaptureTarget && !isHovered ? ' is-pawn-compact' : ''
          }${
            isCaptureTarget
              ? ' is-capture-target'
              : isSelected
                ? ' is-selected'
                : isInspected
                  ? ' is-inspected'
                  : isHovered
                    ? ' is-hovered'
                    : ''
          }`;

          if (slot.lastGlyph !== glyphStr) {
            slot.glyphEl.textContent = glyphStr;
            slot.lastGlyph = glyphStr;
          }
          if (slot.lastName !== nameStr) {
            slot.nameEl.textContent = nameStr;
            slot.lastName = nameStr;
          }
          if (slot.lastClass !== cls) {
            slot.el.className = cls;
            slot.lastClass = cls;
          }
          let staggerY = 0;
          if (gameVariant === 'xiangqi' && !isSelected && !isInspected && !isCaptureTarget) {
            if (p.type === 'king') staggerY = -12;
            else if (p.type === 'advisor') staggerY = 6;
            else if (p.type === 'elephant') staggerY = -11;
            else if (p.type === 'knight') staggerY = 5;
            else if (p.type === 'rook') staggerY = -9;
            else if (p.type === 'cannon') staggerY = 6;
            else if (p.type === 'pawn') staggerY = -6;
          }
          slot.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${(sy + staggerY).toFixed(1)}px, 0) translate(-50%, -100%)`;
          if (!slot.visible) {
            slot.el.style.opacity = '1';
            slot.visible = true;
          }
        }
      }

      for (let i = slotIdx; i < 32; i++) {
        const slot = overheadBadgeSlots[i];
        if (slot.visible) {
          slot.el.style.opacity = '0';
          slot.el.style.transform = 'translate3d(-9999px, -9999px, 0)';
          slot.visible = false;
        }
      }

      // Update Instant Floating Callout Card (#piece-inspect-card) on Click/Tap for both Friendly & Enemy Pieces
      if (inspectCard) {
        const activeSq = inspectedSquare || selectedSquare;
        const inspectedPiece =
          activeSq && !isAnimatingMove && !gameOver ? boardState[activeSq.r]?.[activeSq.c] : null;
        if (inspectedPiece && inspectedPiece.mesh) {
          const meta = getRoleMetadata(inspectedPiece.type);
          const isFriendly = inspectedPiece.color === currentTurn;
          const glyph = inspectedPiece.color === 'w' ? meta.glyphW : meta.glyphB;
          const pieceTitleVi =
            inspectedPiece.color === 'w'
              ? meta.viNameW || meta.viName
              : meta.viNameB || meta.viName;
          const colorVi =
            gameVariant === 'xiangqi'
              ? inspectedPiece.color === 'w'
                ? 'PHE ĐỎ (HỒNG)'
                : 'PHE ĐEN (HẮC)'
              : inspectedPiece.color === 'w'
                ? 'TRẮNG'
                : 'ĐEN';
          const tagText = isFriendly ? 'Quân Ta' : 'Quân Địch';
          const files = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
          const sqCoord =
            gameVariant === 'xiangqi'
              ? inspectedPiece.color === 'w'
                ? `Lộ ${9 - activeSq.c} (Đỏ) • Tuyến ${10 - activeSq.r}`
                : `Lộ ${activeSq.c + 1} (Đen) • Tuyến ${activeSq.r + 1}`
              : `${files[activeSq.c] || 'A'}${8 - activeSq.r}`;
          const nextHtml = `<div class="piece-inspect-header"><span class="piece-inspect-glyph">${glyph}</span><span>${pieceTitleVi.toUpperCase()} • ${colorVi} (${meta.enName}) • ${sqCoord}</span><span class="piece-inspect-tag">${tagText}</span></div><div class="piece-inspect-sub">${meta.moveHint}</div>`;
          if (inspectCard.dataset.lastHtml !== nextHtml) {
            inspectCard.innerHTML = nextHtml;
            inspectCard.dataset.lastHtml = nextHtml;
          }
          inspectCard.classList.toggle('enemy-card', !isFriendly);
          inspectCard.classList.add('visible');
        } else {
          inspectCard.classList.remove('visible');
        }
      }
    }

    // Kill-cam: a skippable look at the falling king. It never sets isAnimatingMove, so moves are never blocked.
    let cinematicActive = false;
    let cinematicRestore = null;
    let cinematicTimer = 0;
    const KILL_CAM_HOLD_S = 3.2; // plus the 0.8 s return keeps the whole kill-cam within 4 s

    function startKillCam(kingWorldPos, fallDir, forwardDirZ) {
      if (motionLevel !== 'full' || heldCameraKeys.size > 0) return;
      if (cinematicActive) endKillCam(true);
      // Return to where a pending preset tween was heading (e.g. the pass-and-play side flip), not where it was.
      cinematicRestore = {
        pos: (activeCamTransition?.endPos ?? camera.position).clone(),
        target: (activeCamTransition?.endTarget ?? orbitControls.target).clone()
      };
      cinematicActive = true;
      cinematicTimer = 0;
      orbitControls.enabled = false;
      const camPos = new THREE.Vector3(
        kingWorldPos.x + (kingWorldPos.x >= 0 ? -1.35 : 1.35),
        BOARD_SURFACE_Y + 1.15,
        kingWorldPos.z + forwardDirZ * 1.45
      );
      smoothCameraTo(
        camPos,
        new THREE.Vector3(kingWorldPos.x + fallDir.x * 0.22, BOARD_SURFACE_Y + 0.18, kingWorldPos.z + fallDir.z * 0.22),
        0.95
      );
      if (postPasses.bokeh) {
        postPasses.bokeh.uniforms.focus.value = (activeCamTransition?.endPos ?? camera.position).distanceTo(kingWorldPos);
        postPasses.bokeh.enabled = true;
      }
    }

    function endKillCam(immediate) {
      if (!cinematicActive) return;
      if (postPasses.bokeh) postPasses.bokeh.enabled = false;
      if (immediate) {
        activeCamTransition = null;
        camera.position.copy(cinematicRestore.pos);
        orbitControls.target.copy(cinematicRestore.target);
        flushOrbitControlsDamping();
      } else {
        smoothCameraTo(cinematicRestore.pos, cinematicRestore.target, 0.8);
      }
      orbitControls.enabled = !isCameraLocked;
      cinematicActive = false;
      cinematicRestore = null;
    }
    // Any click, tap or key skips the kill-cam; the event still reaches its normal handlers.
    const skipKillCam = () => {
      if (cinematicActive) endKillCam(true);
    };
    document.addEventListener('pointerdown', skipKillCam, { capture: true, passive: true });
    document.addEventListener('keydown', skipKillCam, { capture: true, passive: true });

    let checkmateState = {
      active: false,
      bannerVisible: false,
      defeatedColor: null,
      winnerColor: null,
      kingFallAngleDeg: 0,
      phase: 'none'
    };

    function hidePromotionModal() {
      const hadPending = Boolean(pendingPromotion);
      pendingPromotion = null;
      const promoOverlay = document.getElementById('promotion-overlay');
      if (promoOverlay) promoOverlay.classList.remove('visible');
      if (hadPending && typeof updateTurnUI === 'function') {
        updateTurnUI();
      }
    }

    function openPromotionModal(fromR, fromC, toR, toC, color) {
      pendingPromotion = { fromR, fromC, toR, toC, color };
      const promoOverlay = document.getElementById('promotion-overlay');
      if (promoOverlay) {
        promoOverlay.classList.add('visible');
        updateTurnUI();
      } else {
        pendingPromotion = null;
        executeChessMove(fromR, fromC, toR, toC, { promotion: 'queen' });
      }
    }

    function clearCheckmateSequence() {
      checkmateState.active = false;
      checkmateState.bannerVisible = false;
      checkmateState.defeatedColor = null;
      checkmateState.winnerColor = null;
      checkmateState.kingFallAngleDeg = 0;
      checkmateState.phase = 'none';
      const overlay = document.getElementById('checkmate-overlay');
      if (overlay) {
        overlay.classList.remove('visible');
      }
    }

    function captureBoardSnapshot() {
      return {
        gameVariant,
        currentTurn,
        gameOver,
        capturedByWhite,
        capturedByBlack,
        scriptCursor,
        scriptedGameActive,
        scriptDeviated,
        enPassantTarget: enPassantTarget ? { ...enPassantTarget } : null,
        halfMoveClock,
        positionHistory: [...positionHistory],
        lastMoveSquares: lastMoveSquares ? { ...lastMoveSquares } : null,
        drawReason,
        cells: boardState.map((row) =>
          row.map((p) => (p ? { type: p.type, color: p.color, hasMoved: Boolean(p.hasMoved) } : null))
        )
      };
    }

    function restoreBoardSnapshot(snap) {
      if (!snap) return false;
      cancelPendingAISearch();
      hidePromotionModal();
      preMoveHighlightTask = null;
      activeMoveTweens.length = 0;
      clearCheckmateSequence();
      for (const d of shatterDebris) {
        if (d.mesh) scene.remove(d.mesh);
      }
      shatterDebris.length = 0;
      clearCombatVfx();
      impactFlashLight.intensity = 0;
      impactFlashLight.visible = true;
      if (activeDuelSavedCam) {
        camera.position.copy(activeDuelSavedCam.pos);
        orbitControls.target.copy(activeDuelSavedCam.target);
        activeDuelSavedCam = null;
      }
      orbitControls.enabled = !isCameraLocked;
      flushOrbitControlsDamping();

      clearAllPieces();
      clearSquareHighlights();
      selectedSquare = null;
      inspectedSquare = null;
      hoveredSquare = null;
      validMoves = [];
      isAnimatingMove = false;
      if (snap.gameVariant === 'xiangqi' || snap.gameVariant === 'chess') {
        gameVariant = snap.gameVariant;
        chessBoardDeckGroup.visible = gameVariant === 'chess';
        xiangqiBoardDeckGroup.visible = gameVariant === 'xiangqi';
      }
      currentTurn = snap.currentTurn;
      gameOver = snap.gameOver;
      capturedByWhite = snap.capturedByWhite;
      capturedByBlack = snap.capturedByBlack;
      enPassantTarget = snap.enPassantTarget ? { ...snap.enPassantTarget } : null;
      halfMoveClock = typeof snap.halfMoveClock === 'number' ? snap.halfMoveClock : 0;
      positionHistory = Array.isArray(snap.positionHistory) ? [...snap.positionHistory] : [];
      lastMoveSquares = snap.lastMoveSquares ? { ...snap.lastMoveSquares } : null;
      drawReason = snap.drawReason || null;
      if (typeof snap.scriptCursor === 'number') {
        scriptCursor = snap.scriptCursor;
      }
      if (typeof snap.scriptedGameActive === 'boolean') {
        scriptedGameActive = snap.scriptedGameActive;
      }
      if (typeof snap.scriptDeviated === 'boolean') {
        scriptDeviated = snap.scriptDeviated;
      }

      boardState = Array.from({ length: getBoardRows() }, () => Array(getBoardCols()).fill(null));
      for (let r = 0; r < snap.cells.length; r++) {
        const row = snap.cells[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          const cell = row[c];
          if (cell && r < boardState.length && c < boardState[r].length) {
            const inst = instantiatePiece(cell.type, cell.color, r, c);
            inst.hasMoved = Boolean(cell.hasMoved);
            boardState[r][c] = inst;
          }
        }
      }

      renderer.shadowMap.needsUpdate = true;
      updateTurnUI();
      if (typeof updateScriptBarUI === 'function') updateScriptBarUI();
      return true;
    }

    // A dropped move tween never reaches finishMove, so roll back the half-applied ply.
    function recoverFromDroppedMoveTween() {
      if (!isAnimatingMove) return;
      const entry = moveHistory.pop();
      if (entry) multiPlyCount = Math.max(0, multiPlyCount - 1);
      if (!entry || !entry.snapshot || !restoreBoardSnapshot(entry.snapshot)) {
        activeMoveTweens.length = 0;
        isAnimatingMove = false;
      }
      syncActionButtonsUI();
      if (gameMode !== 'multi') {
        maybeScheduleAIMove();
        return;
      }
      if (latestRemoteRoom && performance.now() - lastResyncAt > 2000) {
        resyncFromRoomMoves(latestRemoteRoom);
      } else {
        // Let the next room update replay the rolled-back ply from the server list.
        appliedMoveSeq = Math.min(appliedMoveSeq, multiPlyCount);
      }
    }

    function undoLastMove() {
      endKillCam(true);
      if (pendingPromotion) {
        hidePromotionModal();
        return true;
      }
      if (gameMode === 'multi' || isAnimatingMove || aiSearchInFlight || moveHistory.length === 0) return false;
      cancelPendingAISearch();
      hidePromotionModal();
      const aiColor = playerColor === 'w' ? 'b' : 'w';
      // In single-player vs-AI mode when it is the human player's turn and at least 2 plies exist,
      // pop back 2 plies (AI reply + player's last move) so the human gets their turn back.
      // In 2-Player Pass & Play mode (isPassAndPlay || !aiAutoPlay), always pop exactly 1 ply.
      let targetEntry = moveHistory.pop();
      if (targetEntry) multiPlyCount = Math.max(0, multiPlyCount - 1);
      if (
        gameMode === 'single' &&
        !isPassAndPlay &&
        aiAutoPlay &&
        !scriptedGameActive &&
        targetEntry &&
        targetEntry.move.color === aiColor &&
        moveHistory.length > 0
      ) {
        targetEntry = moveHistory.pop();
        if (targetEntry) multiPlyCount = Math.max(0, multiPlyCount - 1);
      }
      if (!targetEntry || !targetEntry.snapshot) return false;
      const ok = restoreBoardSnapshot(targetEntry.snapshot);
      if (ok) {
        if (gameMode === 'single' && isPassAndPlay) {
          playerColor = currentTurn;
          if (autoFlipCamera2P && document.getElementById('btn-cam-player')?.classList.contains('active')) {
            playerCamSide = currentTurn;
            setCameraForSide(currentTurn, false);
          }
          updateTurnUI();
        }
        maybeScheduleAIMove();
      }
      return ok;
    }

    function resetChessBoard(orientCamera = true, preserveScript = false) {
      endKillCam(true);
      cancelPendingAISearch();
      hidePromotionModal();
      preMoveHighlightTask = null;
      activeMoveTweens.length = 0;
      clearCheckmateSequence();
      for (const d of shatterDebris) {
        if (d.mesh) scene.remove(d.mesh);
      }
      shatterDebris.length = 0;
      clearCombatVfx();
      impactFlashLight.intensity = 0;
      impactFlashLight.visible = true;
      if (activeDuelSavedCam) {
        camera.position.copy(activeDuelSavedCam.pos);
        orbitControls.target.copy(activeDuelSavedCam.target);
        activeDuelSavedCam = null;
      }
      orbitControls.enabled = !isCameraLocked;
      clearAllPieces();
      clearSquareHighlights();
      selectedSquare = null;
      inspectedSquare = null;
      hoveredSquare = null;
      validMoves = [];
      currentTurn = 'w';
      if (gameMode === 'single' && isPassAndPlay) {
        playerColor = 'w';
      }
      isAnimatingMove = false;
      gameOver = false;
      capturedByWhite = 0;
      capturedByBlack = 0;
      moveHistory = [];
      multiPlyCount = 0;
      enPassantTarget = null;
      halfMoveClock = 0;
      lastMoveSquares = null;
      drawReason = null;
      scriptDeviated = false;
      if (!preserveScript) {
        scriptCursor = 0;
      }

      chessBoardDeckGroup.visible = gameVariant === 'chess';
      xiangqiBoardDeckGroup.visible = gameVariant === 'xiangqi';
      boardState = Array.from({ length: getBoardRows() }, () => Array(getBoardCols()).fill(null));

      if (gameVariant === 'xiangqi') {
        const initX = createInitialXiangqiBoard();
        for (let r = 0; r < 10; r++) {
          for (let c = 0; c < 9; c++) {
            const cell = initX[r][c];
            if (cell) {
              boardState[r][c] = instantiatePiece(cell.type, cell.color, r, c);
            }
          }
        }
        positionHistory = [computeXiangqiPositionHash(extractPureXiangqiBoard(boardState), currentTurn)];
      } else {
        const backRow = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
        for (let c = 0; c < 8; c++) {
          boardState[7][c] = instantiatePiece(backRow[c], 'w', 7, c);
          boardState[6][c] = instantiatePiece('pawn', 'w', 6, c);
          boardState[1][c] = instantiatePiece('pawn', 'b', 1, c);
          boardState[0][c] = instantiatePiece(backRow[c], 'b', 0, c);
        }
        positionHistory = [computePositionHash(extractPureBoard(boardState), currentTurn, enPassantTarget)];
      }

      if (orientCamera) {
        const viewSide = playerColor === 'b' ? 'b' : 'w';
        playerCamSide = viewSide;
        overheadCamSide = viewSide;
        const anyCamActive = camButtons.some((id) => document.getElementById(id)?.classList.contains('active'));
        if (document.getElementById('btn-cam-player')?.classList.contains('active')) {
          setActiveCamButton('btn-cam-player');
          setCameraForSide(viewSide, false);
        } else if (document.getElementById('btn-cam-spectator')?.classList.contains('active') || !anyCamActive) {
          spectatorCamSide = viewSide;
          setActiveCamButton('btn-cam-spectator');
          const pose = getSpectatorPose(viewSide, getPortraitFramingFactor());
          activeCamTransition = null;
          camera.position.copy(pose.pos);
          orbitControls.target.copy(pose.lookAt);
          flushOrbitControlsDamping();
        } else {
          setActiveCamButton('btn-cam-top');
          setOverheadCameraForSide(viewSide, false);
        }
      }

      renderer.shadowMap.needsUpdate = true;
      updateTurnUI();
      if (typeof updateScriptBarUI === 'function') updateScriptBarUI();
      maybeScheduleAIMove();
    }

    // =========================================================================
    // Legal Chess & Xiangqi Move Generation
    // =========================================================================
    function getPseudoMovesForPiece(r, c, board = boardState) {
      if (gameVariant === 'xiangqi') {
        return getXiangqiLegalMovesForPiece(extractPureXiangqiBoard(board), r, c);
      }
      const piece = board[r][c];
      if (!piece) return [];
      const moves = [];
      const { type, color } = piece;
      const dir = color === 'w' ? -1 : 1;

      const inBounds = (nr, nc) => nr >= 0 && nr < 8 && nc >= 0 && nc < 8;
      const addMove = (nr, nc) => {
        if (!inBounds(nr, nc)) return false;
        const target = board[nr][nc];
        if (!target) {
          moves.push({ r: nr, c: nc, capture: false });
          return true;
        } else if (target.color !== color) {
          moves.push({ r: nr, c: nc, capture: true, captureR: nr, captureC: nc });
          return false;
        }
        return false;
      };

      if (type === 'pawn') {
        if (inBounds(r + dir, c) && !board[r + dir][c]) {
          moves.push({ r: r + dir, c, capture: false });
          const startRow = color === 'w' ? 6 : 1;
          if (r === startRow && inBounds(r + dir * 2, c) && !board[r + dir * 2][c]) {
            moves.push({ r: r + dir * 2, c, capture: false });
          }
        }
        for (const dc of [-1, 1]) {
          if (inBounds(r + dir, c + dc)) {
            const target = board[r + dir][c + dc];
            if (target && target.color !== color) {
              moves.push({ r: r + dir, c: c + dc, capture: true, captureR: r + dir, captureC: c + dc });
            } else if (
              !target &&
              enPassantTarget &&
              enPassantTarget.color !== color &&
              enPassantTarget.r === r + dir &&
              enPassantTarget.c === c + dc &&
              enPassantTarget.pawnR === r &&
              enPassantTarget.pawnC === c + dc
            ) {
              const epPawn = board[enPassantTarget.pawnR]?.[enPassantTarget.pawnC];
              if (epPawn && epPawn.type === 'pawn' && epPawn.color !== color) {
                moves.push({
                  r: r + dir,
                  c: c + dc,
                  capture: true,
                  enPassant: true,
                  captureR: enPassantTarget.pawnR,
                  captureC: enPassantTarget.pawnC
                });
              }
            }
          }
        }
      } else if (type === 'knight') {
        const jumps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        for (const [dr, dc] of jumps) addMove(r + dr, c + dc);
      } else if (type === 'king') {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr !== 0 || dc !== 0) addMove(r + dr, c + dc);
          }
        }
      } else {
        const dirs = [];
        if (type === 'rook' || type === 'queen') dirs.push([-1,0],[1,0],[0,-1],[0,1]);
        if (type === 'bishop' || type === 'queen') dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
        for (const [dr, dc] of dirs) {
          for (let step = 1; step < 8; step++) {
            if (!addMove(r + dr * step, c + dc * step)) break;
          }
        }
      }
      return moves;
    }

    function isKingInCheck(color, board = boardState) {
      if (gameVariant === 'xiangqi') {
        return isXiangqiGeneralInCheck(extractPureXiangqiBoard(board), color);
      }
      let kingR = -1;
      let kingC = -1;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = board[r][c];
          if (p && p.color === color && p.type === 'king') {
            kingR = r;
            kingC = c;
            break;
          }
        }
      }
      if (kingR === -1) return true;
      const oppColor = color === 'w' ? 'b' : 'w';
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = board[r][c];
          if (p && p.color === oppColor) {
            const oppMoves = getPseudoMovesForPiece(r, c, board);
            if (oppMoves.some((m) => m.r === kingR && m.c === kingC)) {
              return true;
            }
          }
        }
      }
      return false;
    }

    function getLegalMovesForPiece(r, c) {
      if (gameVariant === 'xiangqi') {
        return getXiangqiLegalMovesForPiece(extractPureXiangqiBoard(boardState), r, c);
      }
      return getPureLegalMovesForPiece(extractPureBoard(boardState), r, c, enPassantTarget);
    }

    function getAllLegalMoves(color) {
      if (gameVariant === 'xiangqi') {
        return getAllXiangqiLegalMoves(extractPureXiangqiBoard(boardState), color);
      }
      return getAllPureLegalMoves(extractPureBoard(boardState), color, enPassantTarget);
    }

    // =========================================================================
    // Square Highlights & Persistent 3D Tactical Markers (Zero-Allocation Shared Pool)
    // =========================================================================
    function markSharedPoolAsset(asset) {
      if (asset) {
        asset.userData = asset.userData || {};
        asset.userData.isSharedPool = true;
      }
      return asset;
    }

    const sharedLastMoveFrameGeo = markSharedPoolAsset((() => {
      const g = new THREE.RingGeometry(BOARD_SQ_SIZE * 0.41, BOARD_SQ_SIZE * 0.49, 4);
      g.rotateZ(Math.PI / 4);
      g.rotateX(-Math.PI / 2);
      return g;
    })());
    const sharedLastMoveOriginMat = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0xd4af37,
      transparent: true,
      opacity: 0.44,
      side: THREE.DoubleSide,
      depthWrite: false
    }));
    const sharedLastMoveDestMat = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0xd4af37,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false
    }));

    const sharedCheckRingGeo = markSharedPoolAsset((() => {
      const g = new THREE.RingGeometry(BOARD_SQ_SIZE * 0.30, BOARD_SQ_SIZE * 0.46, 36);
      g.rotateX(-Math.PI / 2);
      return g;
    })());
    const sharedCheckRingMat = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0xff2a38,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false
    }));

    // The line of a check: drawn on the board from each checking piece to the king.
    const sharedCheckLineGeo = markSharedPoolAsset(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const sharedCheckLineMat = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0xff2a38,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    }));
    const CHECK_LINE_WIDTH = 0.06;
    const CHECK_FLINCH_DURATION = 0.42;

    const sharedSelRingGeoDesktop = markSharedPoolAsset((() => {
      const g = new THREE.RingGeometry(BOARD_SQ_SIZE * 0.32, BOARD_SQ_SIZE * 0.43, 32);
      g.rotateX(-Math.PI / 2);
      return g;
    })());
    const sharedSelRingGeoMobile = markSharedPoolAsset((() => {
      const g = new THREE.RingGeometry(BOARD_SQ_SIZE * 0.30, BOARD_SQ_SIZE * 0.45, 32);
      g.rotateX(-Math.PI / 2);
      return g;
    })());
    const sharedSelRingMat = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0xf5d76e,
      side: THREE.DoubleSide
    }));
    const sharedEnemyInspectRingMat = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide
    }));

    const sharedCapRingGeoDesktop = markSharedPoolAsset((() => {
      const g = new THREE.RingGeometry(BOARD_SQ_SIZE * 0.33, BOARD_SQ_SIZE * 0.45, 32);
      g.rotateX(-Math.PI / 2);
      return g;
    })());
    const sharedCapRingGeoMobile = markSharedPoolAsset((() => {
      const g = new THREE.RingGeometry(BOARD_SQ_SIZE * 0.33, BOARD_SQ_SIZE * 0.48, 32);
      g.rotateX(-Math.PI / 2);
      return g;
    })());
    const sharedCapRingMat = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0xe63946,
      side: THREE.DoubleSide
    }));

    const sharedMoveDotGeoDesktop = markSharedPoolAsset((() => {
      const g = new THREE.CircleGeometry(BOARD_SQ_SIZE * 0.16, 24);
      g.rotateX(-Math.PI / 2);
      return g;
    })());
    const sharedMoveDotGeoMobile = markSharedPoolAsset((() => {
      const g = new THREE.CircleGeometry(BOARD_SQ_SIZE * 0.21, 24);
      g.rotateX(-Math.PI / 2);
      return g;
    })());
    const sharedMoveDotMatDesktop = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0x4ea8de,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    }));
    const sharedMoveDotMatMobile = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0x4ea8de,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide
    }));

    const sharedCheckmateOuterGeo = markSharedPoolAsset((() => {
      const g = new THREE.RingGeometry(0.135, 0.175, 36);
      g.rotateX(-Math.PI / 2);
      return g;
    })());
    const sharedCheckmateOuterMat = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0xe63946,
      side: THREE.DoubleSide
    }));
    const sharedCheckmateInnerGeo = markSharedPoolAsset((() => {
      const g = new THREE.RingGeometry(0.10, 0.125, 36);
      g.rotateX(-Math.PI / 2);
      return g;
    })());
    const sharedCheckmateInnerMat = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0xf5d76e,
      side: THREE.DoubleSide
    }));

    const sharedBlockedPointRingGeo = markSharedPoolAsset((() => {
      const g = new THREE.RingGeometry(XIANGQI_SQ_SIZE * 0.22, XIANGQI_SQ_SIZE * 0.34, 6);
      g.rotateX(-Math.PI / 2);
      return g;
    })());
    const sharedBlockedPointRingMat = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0xff5a1f,
      transparent: true,
      opacity: 0.84,
      side: THREE.DoubleSide
    }));
    const sharedCannonScreenRingMat = markSharedPoolAsset(new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide
    }));
    let activeCannonScreenWorldPos = null;

    function clearGroupWithPoolSafety(group) {
      while (group.children.length > 0) {
        const ch = group.children[0];
        group.remove(ch);
        if (ch.geometry && !ch.geometry.userData?.isSharedPool) {
          ch.geometry.dispose();
        }
        if (ch.material && !ch.material.userData?.isSharedPool) {
          if (Array.isArray(ch.material)) {
            ch.material.forEach((m) => {
              if (m && !m.userData?.isSharedPool) m.dispose();
            });
          } else {
            ch.material.dispose();
          }
        }
      }
    }

    function updateTacticalBoardMarkers() {
      clearGroupWithPoolSafety(tacticalMarkersGroup);
      activeCheckRingMesh = null;

      // 1. Last Move Origin & Destination 3D Square Frames
      if (lastMoveSquares) {
        const squares = [
          { r: lastMoveSquares.fromR, c: lastMoveSquares.fromC, mat: sharedLastMoveOriginMat },
          { r: lastMoveSquares.toR, c: lastMoveSquares.toC, mat: sharedLastMoveDestMat }
        ];
        for (const sq of squares) {
          const pos = boardToWorld(sq.r, sq.c);
          const frameMesh = new THREE.Mesh(sharedLastMoveFrameGeo, sq.mat);
          frameMesh.raycast = () => {};
          frameMesh.position.set(pos.x, BOARD_SURFACE_Y + 0.006, pos.z);
          tacticalMarkersGroup.add(frameMesh);
        }
      }

      // 2. King / General in Check Pulsing Crimson Warning Halo
      if (!gameOver && isKingInCheck(currentTurn, boardState)) {
        for (let r = 0; r < getBoardRows(); r++) {
          for (let c = 0; c < getBoardCols(); c++) {
            const p = boardState[r]?.[c];
            if (p && p.color === currentTurn && p.type === 'king') {
              const kPos = boardToWorld(r, c);
              sharedCheckRingMat.opacity = 0.88;
              const chkMesh = new THREE.Mesh(sharedCheckRingGeo, sharedCheckRingMat);
              chkMesh.raycast = () => {};
              chkMesh.position.set(kPos.x, BOARD_SURFACE_Y + 0.014, kPos.z);
              tacticalMarkersGroup.add(chkMesh);
              activeCheckRingMesh = chkMesh;
              addCheckLines(r, c, kPos);
              break;
            }
          }
        }
      }
    }

    function addCheckLines(kingR, kingC, kingPos) {
      for (let r = 0; r < getBoardRows(); r++) {
        for (let c = 0; c < getBoardCols(); c++) {
          const p = boardState[r]?.[c];
          if (!p || p.color === currentTurn) continue;
          if (!getPseudoMovesForPiece(r, c).some((m) => m.r === kingR && m.c === kingC)) continue;
          const from = boardToWorld(r, c);
          const dx = kingPos.x - from.x;
          const dz = kingPos.z - from.z;
          const line = new THREE.Mesh(sharedCheckLineGeo, sharedCheckLineMat);
          line.raycast = () => {};
          line.position.set(from.x + dx * 0.5, BOARD_SURFACE_Y + 0.012, from.z + dz * 0.5);
          line.rotation.y = Math.atan2(dx, dz);
          line.scale.set(CHECK_LINE_WIDTH, 1, Math.hypot(dx, dz));
          tacticalMarkersGroup.add(line);
        }
      }
    }

    // The moment a check lands: the king recoils, the braziers flare and the screen edge pulses red.
    function triggerCheckAlarm() {
      if (motionLevel === 'off') return;
      for (const row of boardState) {
        for (const p of row) {
          if (p && p.color === currentTurn && p.type === 'king' && p.mesh) checkFlinch = { piece: p, t: 0 };
        }
      }
      brazierFlare = 1;
      const vignette = document.getElementById('check-vignette');
      if (vignette) {
        vignette.classList.remove('active');
        void vignette.offsetWidth;
        vignette.classList.add('active');
      }
    }

    function clearSquareHighlights() {
      clearGroupWithPoolSafety(squareHighlightsGroup);
    }

    function showEnemyInspectHighlight(r, c) {
      clearSquareHighlights();
      const isTouchOrCompact = Boolean(
        window.innerWidth <= 768 || coarsePointerQuery?.matches
      );
      const selGeo = isTouchOrCompact ? sharedSelRingGeoMobile : sharedSelRingGeoDesktop;
      const inspectMesh = new THREE.Mesh(selGeo, sharedEnemyInspectRingMat);
      inspectMesh.raycast = () => {};
      const pos = boardToWorld(r, c);
      inspectMesh.position.set(pos.x, BOARD_SURFACE_Y + 0.011, pos.z);
      squareHighlightsGroup.add(inspectMesh);
    }

    function showSquareHighlights(r, c, moves) {
      clearSquareHighlights();
      const isTouchOrCompact = Boolean(
        window.innerWidth <= 768 || coarsePointerQuery?.matches
      );
      const selGeo = isTouchOrCompact ? sharedSelRingGeoMobile : sharedSelRingGeoDesktop;
      const selMesh = new THREE.Mesh(selGeo, sharedSelRingMat);
      selMesh.raycast = () => {};
      const selPos = boardToWorld(r, c);
      selMesh.position.set(selPos.x, BOARD_SURFACE_Y + 0.01, selPos.z);
      squareHighlightsGroup.add(selMesh);

      const capGeo = isTouchOrCompact ? sharedCapRingGeoMobile : sharedCapRingGeoDesktop;
      const dotGeo = isTouchOrCompact ? sharedMoveDotGeoMobile : sharedMoveDotGeoDesktop;
      const dotMat = isTouchOrCompact ? sharedMoveDotMatMobile : sharedMoveDotMatDesktop;

      const shownScreens = new Set();
      for (const m of moves) {
        const pos = boardToWorld(m.r, m.c);
        if (m.capture) {
          const capMesh = new THREE.Mesh(capGeo, sharedCapRingMat);
          capMesh.raycast = () => {};
          capMesh.position.set(pos.x, BOARD_SURFACE_Y + 0.012, pos.z);
          squareHighlightsGroup.add(capMesh);
          if (typeof m.screenR === 'number' && typeof m.screenC === 'number') {
            const scKey = `${m.screenR},${m.screenC}`;
            if (!shownScreens.has(scKey)) {
              shownScreens.add(scKey);
              const scPos = boardToWorld(m.screenR, m.screenC);
              const scRing = new THREE.Mesh(sharedBlockedPointRingGeo, sharedCannonScreenRingMat);
              scRing.raycast = () => {};
              scRing.position.set(scPos.x, BOARD_SURFACE_Y + 0.013, scPos.z);
              squareHighlightsGroup.add(scRing);
            }
          }
        } else {
          const dotMesh = new THREE.Mesh(dotGeo, dotMat);
          dotMesh.raycast = () => {};
          dotMesh.position.set(pos.x, BOARD_SURFACE_Y + 0.01, pos.z);
          squareHighlightsGroup.add(dotMesh);
        }
      }

      // In Xiangqi mode, highlight blocked Horse legs (Cản Mã) & blocked Elephant eyes (Chặn Mắt Tượng)
      if (gameVariant === 'xiangqi') {
        const blockedPts = getXiangqiBlockedPointsForPiece(extractPureXiangqiBoard(boardState), r, c);
        for (const bp of blockedPts) {
          const bPos = boardToWorld(bp.r, bp.c);
          const bMesh = new THREE.Mesh(sharedBlockedPointRingGeo, sharedBlockedPointRingMat);
          bMesh.raycast = () => {};
          bMesh.position.set(bPos.x, BOARD_SURFACE_Y + 0.014, bPos.z);
          squareHighlightsGroup.add(bMesh);
        }
      }
    }

    // =========================================================================
    // Stone Shatter Debris & Shared Signature Combat VFX Pool (Zero mid-attack VBO allocation)
    // =========================================================================
    const sharedShardGeo = new THREE.DodecahedronGeometry(1, 0);
    const vfxFlatRingGeo = (() => {
      const g = new THREE.RingGeometry(0.16, 0.28, 32);
      g.rotateX(-Math.PI / 2);
      return g;
    })();
    const vfxHexRuneGeo = (() => {
      const g = new THREE.RingGeometry(0.11, 0.22, 6);
      g.rotateX(-Math.PI / 2);
      return g;
    })();
    const vfxVertRingGeo = new THREE.RingGeometry(0.06, 0.22, 24);
    const vfxSpikeConeGeo = (() => {
      const g = new THREE.ConeGeometry(0.052, 0.28, 6);
      g.translate(0, 0.14, 0);
      return g;
    })();
    const vfxPillarGeo = (() => {
      const g = new THREE.CylinderGeometry(0.13, 0.17, 1.85, 20, 1, true);
      g.translate(0, 0.925, 0);
      return g;
    })();
    const vfxBeamGeo = (() => {
      const g = new THREE.CylinderGeometry(0.022, 0.036, 1.0, 12);
      g.rotateX(Math.PI / 2);
      return g;
    })();
    const vfxBladeArcGeo = new THREE.TorusGeometry(0.27, 0.022, 8, 28, Math.PI * 1.35);
    const vfxNovaSphereGeo = new THREE.SphereGeometry(0.22, 18, 14);
    const vfxFissureBoxGeo = new THREE.BoxGeometry(0.048, 0.020, 0.76);

    function addCombatVfxMesh(geo, colorHex, opacity, pos, rot, life, updateFn) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      if (rot) mesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.raycast = () => {};
      scene.add(mesh);
      combatVfxList.push({
        mesh,
        mat,
        life,
        maxLife: life,
        baseOpacity: opacity,
        updateFn
      });
      return mesh;
    }

    function spawnSignatureCombatVFX(pieceType, stage, attackerPos, targetPos, dirX, dirZ, attackerColor) {
      const skinId = attackerColor === 'b' ? activeSkinBlack : activeSkinWhite;
      const theme = PIECE_THEMES[skinId] || PIECE_THEMES.hogwarts;
      const primaryVfxHex = theme.shatterColor || 0xf5d76e;
      const accentVfxHex = theme.altarGlowColor || 0xd4af37;
      const heading = Math.atan2(dirX, dirZ);

      if (pieceType === 'pawn') {
        if (stage === 'contact1') {
          // Vertical Bronze Phalanx Shield Shockwave Ring between Pawn shield & Defender
          const impactPt = new THREE.Vector3(
            targetPos.x - dirX * 0.14,
            BOARD_SURFACE_Y + 0.22,
            targetPos.z - dirZ * 0.14
          );
          addCombatVfxMesh(
            vfxVertRingGeo,
            primaryVfxHex,
            0.92,
            impactPt,
            { x: 0, y: heading, z: 0 },
            0.34,
            (vfx, u) => {
              vfx.mesh.scale.setScalar(0.55 + u * 1.85);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
        } else if (stage === 'finisher') {
          // Piercing Gladius/Spear Lance Vortex Cone punching forward through target
          const lancePt = new THREE.Vector3(
            targetPos.x - dirX * 0.08,
            BOARD_SURFACE_Y + 0.24,
            targetPos.z - dirZ * 0.08
          );
          const coneMesh = addCombatVfxMesh(
            vfxSpikeConeGeo,
            accentVfxHex,
            0.88,
            lancePt,
            { x: Math.PI / 2, y: heading, z: 0 },
            0.42,
            (vfx, u) => {
              vfx.mesh.scale.set(1.0 + u * 0.8, 1.4 + u * 2.4, 1.0 + u * 0.8);
              vfx.mesh.position.x = lancePt.x + dirX * u * 0.26;
              vfx.mesh.position.z = lancePt.z + dirZ * u * 0.26;
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
          coneMesh.rotation.order = 'YXZ';
        }
        return;
      }

      if (pieceType === 'rook') {
        if (stage === 'contact1' || stage === 'finisher') {
          // Dual Expanding Seismic Shockwave Rings + 8 Erupting Stone Pillar Spikes around target
          const groundPt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y + 0.014, targetPos.z);
          addCombatVfxMesh(
            vfxFlatRingGeo,
            primaryVfxHex,
            0.94,
            groundPt,
            { x: 0, y: 0, z: 0 },
            0.55,
            (vfx, u) => {
              vfx.mesh.scale.setScalar(0.6 + u * 2.6);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
          if (stage === 'finisher') {
            for (let i = 0; i < 8; i++) {
              const ang = (i / 8) * Math.PI * 2;
              const rad = 0.18 + (i % 2) * 0.07;
              const spkPos = new THREE.Vector3(
                targetPos.x + Math.cos(ang) * rad,
                BOARD_SURFACE_Y,
                targetPos.z + Math.sin(ang) * rad
              );
              addCombatVfxMesh(
                vfxSpikeConeGeo,
                i % 2 === 0 ? primaryVfxHex : accentVfxHex,
                0.90,
                spkPos,
                { x: (Math.random() - 0.5) * 0.28, y: ang, z: (Math.random() - 0.5) * 0.28 },
                0.58,
                (vfx, u) => {
                  const pop = u < 0.28 ? u / 0.28 : 1.0 - (u - 0.28) / 0.72;
                  vfx.mesh.scale.set(0.85, Math.max(0.05, pop * 1.45), 0.85);
                  vfx.mat.opacity = vfx.baseOpacity * Math.max(0, 1 - u * 1.05);
                }
              );
            }
          }
        }
        return;
      }

      if (pieceType === 'knight') {
        if (stage === 'windup') {
          // Spiraling Sky-Lancer Wind Ring around leaping warhorse
          const leapPt = new THREE.Vector3(
            attackerPos.x + dirX * 0.12,
            BOARD_SURFACE_Y + 0.24,
            attackerPos.z + dirZ * 0.12
          );
          addCombatVfxMesh(
            vfxVertRingGeo,
            primaryVfxHex,
            0.82,
            leapPt,
            { x: 0.45, y: heading, z: 0 },
            0.40,
            (vfx, u) => {
              vfx.mesh.scale.setScalar(0.7 + u * 1.6);
              vfx.mesh.rotation.z = u * Math.PI * 3;
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
        } else if (stage === 'contact1' || stage === 'finisher') {
          // Twin Pegasus Hoof-Impact Shockwave Rings + Diagonal Sky-Lance Dive Beam
          const hoofPt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y + 0.016, targetPos.z);
          addCombatVfxMesh(
            vfxFlatRingGeo,
            primaryVfxHex,
            0.95,
            hoofPt,
            { x: 0, y: 0, z: 0 },
            0.48,
            (vfx, u) => {
              vfx.mesh.scale.setScalar(0.45 + u * 2.35);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
          const diveBeamPt = new THREE.Vector3(
            targetPos.x - dirX * 0.12,
            BOARD_SURFACE_Y + 0.34,
            targetPos.z - dirZ * 0.12
          );
          addCombatVfxMesh(
            vfxBeamGeo,
            accentVfxHex,
            0.88,
            diveBeamPt,
            { x: 0.58, y: heading, z: 0 },
            0.38,
            (vfx, u) => {
              vfx.mesh.scale.set(1.2 - u * 0.7, 1.2 - u * 0.7, 0.65);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
        }
        return;
      }

      if (pieceType === 'bishop') {
        if (stage === 'windup' || stage === 'contact1') {
          // Dual Concentric Spinning Sacred Geometry Rune Circle beneath target + Arcane Crozier Beam
          const runePt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y + 0.015, targetPos.z);
          addCombatVfxMesh(
            vfxHexRuneGeo,
            primaryVfxHex,
            0.92,
            runePt,
            { x: 0, y: 0, z: 0 },
            0.72,
            (vfx, u) => {
              vfx.mesh.rotation.y = u * Math.PI * 3.5;
              vfx.mesh.scale.setScalar(0.85 + Math.sin(u * Math.PI) * 0.55);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u * 0.85);
            }
          );
          addCombatVfxMesh(
            vfxFlatRingGeo,
            accentVfxHex,
            0.84,
            runePt,
            { x: 0, y: 0, z: 0 },
            0.72,
            (vfx, u) => {
              vfx.mesh.rotation.y = -u * Math.PI * 2.5;
              vfx.mesh.scale.setScalar(1.05 + u * 0.75);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
          // Ranged Arcane Tether Ray from Bishop's Crozier to Levitating Defender
          const midRay = new THREE.Vector3(
            (attackerPos.x + targetPos.x) * 0.5,
            BOARD_SURFACE_Y + 0.34,
            (attackerPos.z + targetPos.z) * 0.5
          );
          const spanDist = Math.max(0.25, Math.hypot(targetPos.x - attackerPos.x, targetPos.z - attackerPos.z));
          addCombatVfxMesh(
            vfxBeamGeo,
            primaryVfxHex,
            0.86,
            midRay,
            { x: 0, y: heading, z: 0 },
            0.46,
            (vfx, u) => {
              vfx.mesh.scale.set(0.8 + Math.sin(u * Math.PI * 4) * 0.35, 0.8, spanDist);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
        } else if (stage === 'finisher') {
          // Towering Celestial Pillar of Light striking down from the heavens + Arcane Implosion Core
          const pillarPt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y, targetPos.z);
          addCombatVfxMesh(
            vfxPillarGeo,
            primaryVfxHex,
            0.92,
            pillarPt,
            { x: 0, y: 0, z: 0 },
            0.56,
            (vfx, u) => {
              const wScale = u < 0.25 ? 0.5 + (u / 0.25) * 0.9 : Math.max(0.08, 1.4 * (1 - (u - 0.25) / 0.75));
              vfx.mesh.scale.set(wScale, 1.0, wScale);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
          const corePt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y + 0.28, targetPos.z);
          addCombatVfxMesh(
            vfxNovaSphereGeo,
            accentVfxHex,
            0.88,
            corePt,
            { x: 0, y: 0, z: 0 },
            0.45,
            (vfx, u) => {
              vfx.mesh.scale.setScalar(0.5 + u * 1.9);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
        }
        return;
      }

      if (pieceType === 'queen') {
        if (stage === 'contact1' || stage === 'contact2') {
          // Valkyrie Whirlwind Blitz: Twin Crossing Crescent Energy Blade Arcs sweeping around Queen & Target
          const tiltSign = stage === 'contact1' ? 1 : -1;
          const arcPt = new THREE.Vector3(
            (attackerPos.x + targetPos.x) * 0.5,
            BOARD_SURFACE_Y + 0.26,
            (attackerPos.z + targetPos.z) * 0.5
          );
          addCombatVfxMesh(
            vfxBladeArcGeo,
            stage === 'contact1' ? primaryVfxHex : accentVfxHex,
            0.94,
            arcPt,
            { x: Math.PI / 2 + tiltSign * 0.52, y: heading, z: 0 },
            0.34,
            (vfx, u) => {
              vfx.mesh.rotation.z = u * Math.PI * 2.8 * tiltSign;
              vfx.mesh.scale.setScalar(0.85 + u * 0.95);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
        } else if (stage === 'finisher') {
          // Royal Scepter Nova Finisher: Expanding Spherical Starburst Dome + Ground Halo
          const novaPt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y + 0.24, targetPos.z);
          addCombatVfxMesh(
            vfxNovaSphereGeo,
            primaryVfxHex,
            0.90,
            novaPt,
            { x: 0, y: 0, z: 0 },
            0.52,
            (vfx, u) => {
              vfx.mesh.scale.setScalar(0.4 + u * 2.45);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
          const ringPt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y + 0.016, targetPos.z);
          addCombatVfxMesh(
            vfxFlatRingGeo,
            accentVfxHex,
            0.92,
            ringPt,
            { x: 0, y: 0, z: 0 },
            0.52,
            (vfx, u) => {
              vfx.mesh.scale.setScalar(0.5 + u * 2.6);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
        }
        return;
      }

      if (pieceType === 'cannon') {
        // XIANGQI CANNON (Pháo Thần Công): Parabolic Mortar Arc over Screen Piece + Artillery Fire Pillar
        if (stage === 'windup') {
          const muzzlePt = new THREE.Vector3(
            attackerPos.x + dirX * 0.14,
            BOARD_SURFACE_Y + 0.24,
            attackerPos.z + dirZ * 0.14
          );
          addCombatVfxMesh(
            vfxVertRingGeo,
            primaryVfxHex,
            0.95,
            muzzlePt,
            { x: 0.35, y: heading, z: 0 },
            0.38,
            (vfx, u) => {
              vfx.mesh.scale.setScalar(0.45 + u * 1.9);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
          // Golden launch-pad rune circle beneath the Screen Piece (Ngòi Pháo)
          const screenPt = activeCannonScreenWorldPos
            ? new THREE.Vector3(activeCannonScreenWorldPos.x, BOARD_SURFACE_Y + 0.018, activeCannonScreenWorldPos.z)
            : new THREE.Vector3((attackerPos.x + targetPos.x) * 0.5, BOARD_SURFACE_Y + 0.018, (attackerPos.z + targetPos.z) * 0.5);
          addCombatVfxMesh(
            vfxHexRuneGeo,
            0xff9100,
            0.94,
            screenPt,
            { x: 0, y: 0, z: 0 },
            0.66,
            (vfx, u) => {
              vfx.mesh.rotation.y = u * Math.PI * 3.2;
              vfx.mesh.scale.setScalar(0.85 + Math.sin(u * Math.PI) * 0.65);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u * 0.85);
            }
          );
          // Parabolic Mortar Shell Arc soaring high (H_arc = 0.85m) from Cannon to Target
          const shellStart = muzzlePt.clone();
          const shellEnd = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y + 0.18, targetPos.z);
          addCombatVfxMesh(
            vfxNovaSphereGeo,
            primaryVfxHex,
            0.98,
            shellStart,
            { x: 0, y: 0, z: 0 },
            0.52,
            (vfx, u) => {
              const arcY = 4 * 0.85 * u * (1 - u);
              vfx.mesh.position.set(
                shellStart.x + (shellEnd.x - shellStart.x) * u,
                shellStart.y + (shellEnd.y - shellStart.y) * u + arcY,
                shellStart.z + (shellEnd.z - shellStart.z) * u
              );
              vfx.mesh.scale.setScalar(0.32 + Math.sin(u * Math.PI) * 0.16);
              vfx.mat.opacity = vfx.baseOpacity * (1 - Math.max(0, (u - 0.85) / 0.15));
            }
          );
        } else if (stage === 'contact1' || stage === 'finisher') {
          const groundPt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y + 0.016, targetPos.z);
          addCombatVfxMesh(
            vfxFlatRingGeo,
            primaryVfxHex,
            0.96,
            groundPt,
            { x: 0, y: 0, z: 0 },
            0.54,
            (vfx, u) => {
              vfx.mesh.scale.setScalar(0.55 + u * 2.85);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
          if (stage === 'finisher') {
            const pillarPt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y, targetPos.z);
            addCombatVfxMesh(
              vfxPillarGeo,
              accentVfxHex,
              0.94,
              pillarPt,
              { x: 0, y: 0, z: 0 },
              0.52,
              (vfx, u) => {
                const wScale = u < 0.25 ? 0.6 + (u / 0.25) * 0.95 : Math.max(0.08, 1.55 * (1 - (u - 0.25) / 0.75));
                vfx.mesh.scale.set(wScale, 1.1, wScale);
                vfx.mat.opacity = vfx.baseOpacity * (1 - u);
              }
            );
            const domePt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y + 0.22, targetPos.z);
            addCombatVfxMesh(
              vfxNovaSphereGeo,
              primaryVfxHex,
              0.92,
              domePt,
              { x: 0, y: 0, z: 0 },
              0.48,
              (vfx, u) => {
                vfx.mesh.scale.setScalar(0.55 + u * 2.35);
                vfx.mat.opacity = vfx.baseOpacity * (1 - u);
              }
            );
          }
        }
        return;
      }

      if (pieceType === 'elephant') {
        // XIANGQI ELEPHANT (Tượng Chiến): Twin-Tusk Seismic Stomp & Stone Spikes
        if (stage === 'contact1' || stage === 'finisher') {
          const groundPt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y + 0.015, targetPos.z);
          addCombatVfxMesh(
            vfxFlatRingGeo,
            primaryVfxHex,
            0.94,
            groundPt,
            { x: 0, y: 0, z: 0 },
            0.54,
            (vfx, u) => {
              vfx.mesh.scale.setScalar(0.55 + u * 2.5);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
          if (stage === 'finisher') {
            for (let i = 0; i < 6; i++) {
              const ang = (i / 6) * Math.PI * 2;
              const rad = 0.16 + (i % 2) * 0.06;
              const spkPos = new THREE.Vector3(
                targetPos.x + Math.cos(ang) * rad,
                BOARD_SURFACE_Y,
                targetPos.z + Math.sin(ang) * rad
              );
              addCombatVfxMesh(
                vfxSpikeConeGeo,
                i % 2 === 0 ? primaryVfxHex : accentVfxHex,
                0.90,
                spkPos,
                { x: (Math.random() - 0.5) * 0.24, y: ang, z: (Math.random() - 0.5) * 0.24 },
                0.54,
                (vfx, u) => {
                  const pop = u < 0.28 ? u / 0.28 : 1.0 - (u - 0.28) / 0.72;
                  vfx.mesh.scale.set(0.82, Math.max(0.05, pop * 1.35), 0.82);
                  vfx.mat.opacity = vfx.baseOpacity * Math.max(0, 1 - u * 1.05);
                }
              );
            }
          }
        }
        return;
      }

      if (pieceType === 'advisor') {
        // XIANGQI ADVISOR (Sĩ Cận Vệ): Twin-Crescent Imperial Guard Slash & Lotus Halo
        if (stage === 'contact1' || stage === 'contact2') {
          const tiltSign = stage === 'contact1' ? 1 : -1;
          const arcPt = new THREE.Vector3(
            (attackerPos.x + targetPos.x) * 0.5,
            BOARD_SURFACE_Y + 0.24,
            (attackerPos.z + targetPos.z) * 0.5
          );
          addCombatVfxMesh(
            vfxBladeArcGeo,
            stage === 'contact1' ? primaryVfxHex : accentVfxHex,
            0.94,
            arcPt,
            { x: Math.PI / 2 + tiltSign * 0.48, y: heading, z: 0 },
            0.34,
            (vfx, u) => {
              vfx.mesh.rotation.z = u * Math.PI * 2.6 * tiltSign;
              vfx.mesh.scale.setScalar(0.80 + u * 0.90);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
        } else if (stage === 'finisher') {
          const haloPt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y + 0.016, targetPos.z);
          addCombatVfxMesh(
            vfxHexRuneGeo,
            primaryVfxHex,
            0.92,
            haloPt,
            { x: 0, y: 0, z: 0 },
            0.50,
            (vfx, u) => {
              vfx.mesh.rotation.y = u * Math.PI * 2.2;
              vfx.mesh.scale.setScalar(0.55 + u * 2.2);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
        }
        return;
      }

      // Default / King: Sovereign Execution — Heaven-Cleaver Greatsword, Sky Lightning Smite & Ground Fissure
      if (stage === 'contact1' || stage === 'finisher') {
        const fissurePt = new THREE.Vector3(
          (attackerPos.x + targetPos.x) * 0.5 + dirX * 0.08,
          BOARD_SURFACE_Y + 0.012,
          (attackerPos.z + targetPos.z) * 0.5 + dirZ * 0.08
        );
        addCombatVfxMesh(
          vfxFissureBoxGeo,
          primaryVfxHex,
          0.95,
          fissurePt,
          { x: 0, y: heading, z: 0 },
          0.68,
          (vfx, u) => {
            vfx.mesh.scale.set(1.0 + u * 0.8, 1.0, 0.4 + Math.min(1, u * 2.5) * 0.9);
            vfx.mat.opacity = vfx.baseOpacity * (1 - u);
          }
        );
        if (stage === 'finisher') {
          const smitePt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y, targetPos.z);
          addCombatVfxMesh(
            vfxPillarGeo,
            accentVfxHex,
            0.96,
            smitePt,
            { x: 0, y: 0, z: 0 },
            0.48,
            (vfx, u) => {
              const boltW = Math.max(0.06, (1 - u) * 0.95);
              vfx.mesh.scale.set(boltW, 1.1, boltW);
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
          const crownHaloPt = new THREE.Vector3(targetPos.x, BOARD_SURFACE_Y + 0.018, targetPos.z);
          addCombatVfxMesh(
            vfxHexRuneGeo,
            primaryVfxHex,
            0.94,
            crownHaloPt,
            { x: 0, y: 0, z: 0 },
            0.56,
            (vfx, u) => {
              vfx.mesh.scale.setScalar(0.6 + u * 2.8);
              vfx.mesh.rotation.y = u * Math.PI * 1.5;
              vfx.mat.opacity = vfx.baseOpacity * (1 - u);
            }
          );
        }
      }
    }

    function spawnStoneShatter(worldPos, color, attackerType = 'queen', dirX = 0, dirZ = 1) {
      const skinId = color === 'b' ? activeSkinBlack : activeSkinWhite;
      const theme = PIECE_THEMES[skinId] || PIECE_THEMES.hogwarts;
      const bank = sideMats[color] || sideMats.w;
      const shardCount =
        attackerType === 'rook' || attackerType === 'king' || attackerType === 'cannon' || attackerType === 'elephant'
          ? 14
          : 12;
      for (let i = 0; i < shardCount; i++) {
        const sz = 0.026 + Math.random() * 0.054;
        const fragMat = i % 3 === 0 ? bank.trim : bank.primary;
        const frag = new THREE.Mesh(sharedShardGeo, fragMat);
        frag.scale.setScalar(sz);
        frag.position.set(
          worldPos.x + (Math.random() - 0.5) * 0.18,
          worldPos.y + 0.10 + Math.random() * 0.28,
          worldPos.z + (Math.random() - 0.5) * 0.18
        );
        frag.castShadow = false;
        frag.receiveShadow = false;
        frag.raycast = () => {};
        scene.add(frag);

        // Piece-specific directional/vortex debris physics
        let vx = (Math.random() - 0.5) * 2.35;
        let vy = 1.25 + Math.random() * 2.1;
        let vz = (Math.random() - 0.5) * 2.35;
        if (attackerType === 'pawn') {
          // Piercing forward spear cone blast
          vx = dirX * (1.4 + Math.random() * 1.6) + (Math.random() - 0.5) * 1.2;
          vz = dirZ * (1.4 + Math.random() * 1.6) + (Math.random() - 0.5) * 1.2;
        } else if (attackerType === 'rook' || attackerType === 'elephant') {
          // High volcanic earthshaker eruption
          vy = 1.85 + Math.random() * 2.45;
        } else if (attackerType === 'cannon') {
          // High-explosive bronze artillery mortar blast
          vy = 2.10 + Math.random() * 2.55;
        } else if (attackerType === 'bishop') {
          // Levitating arcane implosion-then-burst
          vy = 1.55 + Math.random() * 1.95;
        } else if (attackerType === 'queen' || attackerType === 'advisor') {
          // Spiraling whirlwind tangential burst
          const ang = (i / shardCount) * Math.PI * 2;
          vx = Math.cos(ang) * 2.15;
          vz = Math.sin(ang) * 2.15;
        }

        shatterDebris.push({
          mesh: frag,
          baseScale: sz,
          vel: new THREE.Vector3(vx, vy, vz),
          rotVel: new THREE.Vector3(
            Math.random() * 9,
            Math.random() * 9,
            Math.random() * 9
          ),
          life: 2.0
        });
      }
      impactFlashLight.color.setHex(theme.shatterColor || 0xffb74d);
      impactFlashLight.position.set(worldPos.x, worldPos.y + 0.4, worldPos.z);
      impactFlashLight.intensity =
        attackerType === 'king' || attackerType === 'bishop' || attackerType === 'cannon' ? 10.5 : 8.2;
    }

    // =========================================================================
    // Smooth Attack Camera, Piece-Specific Gait & 6 Signature Attack Choreographies
    // =========================================================================
    function executeChessMove(fromR, fromC, toR, toC, options = {}) {
      const piece = boardState[fromR]?.[fromC];
      if (!piece || isAnimatingMove || gameOver) return false;
      if (piece.color !== currentTurn) return false;

      const targetOnDest = boardState[toR]?.[toC];
      // Strictly forbid friendly fire (a piece can never move onto or attack a piece of the same color)
      if (targetOnDest && targetOnDest.color === piece.color) {
        return false;
      }

      let matchedLegal = null;
      const legalForPiece = getLegalMovesForPiece(fromR, fromC);
      matchedLegal = legalForPiece.find((m) => m.r === toR && m.c === toC) || null;
      if (!options.fromRemote && !matchedLegal) {
        return false;
      }

      cancelPendingAISearch();
      hidePromotionModal();
      if (preMoveHighlightTask) {
        preMoveHighlightTask = null;
      }

      const isEnPassant =
        gameVariant !== 'xiangqi' &&
        Boolean(
          matchedLegal?.enPassant ||
            (piece.type === 'pawn' &&
              fromC !== toC &&
              !targetOnDest &&
              boardState[fromR]?.[toC]?.color &&
              boardState[fromR]?.[toC]?.color !== piece.color)
        );
      const epCapR = isEnPassant ? (matchedLegal?.captureR ?? fromR) : toR;
      const epCapC = isEnPassant ? (matchedLegal?.captureC ?? toC) : toC;
      const captured = isEnPassant ? boardState[epCapR]?.[epCapC] : targetOnDest;
      const isCapture = Boolean(captured);
      const chosenPromotion = options.promotion || matchedLegal?.promotion || 'queen';

      if (gameVariant === 'xiangqi' && piece.type === 'cannon' && isCapture && matchedLegal?.screenR !== undefined) {
        activeCannonScreenWorldPos = boardToWorld(matchedLegal.screenR, matchedLegal.screenC);
      } else {
        activeCannonScreenWorldPos = null;
      }
      const horseLegWorldPos =
        gameVariant === 'xiangqi' && piece.type === 'knight' && matchedLegal?.legR !== undefined
          ? boardToWorld(matchedLegal.legR, matchedLegal.legC)
          : null;

      // The desktop hint pill fades out after the first move, leaving the top dock as the only HUD bar.
      document.getElementById('controls-hint')?.classList.add('is-collapsed');
      // Save board state snapshot (including pre-move scriptCursor & scriptDeviated) so Undo / Left Arrow can step backward
      if (moveHistory.length === 0) setTimeout(maybeShowCameraGuide, 1800);
      moveHistory.push({
        snapshot: captureBoardSnapshot(),
        move: {
          color: piece.color,
          pieceType: piece.type,
          fromR,
          fromC,
          toR,
          toC,
          capture: isCapture,
          enPassant: isEnPassant,
          promotion: chosenPromotion
        }
      });
      multiPlyCount += 1;
      if (moveHistory.length > 60) {
        moveHistory.shift();
      }

      // Advance scriptCursor if executing a scripted move or a manual move matching the script;
      // otherwise mark scriptDeviated = true and exit scriptedGameActive so the user takes over cleanly
      if (options.fromScript) {
        scriptCursor = Math.min(scriptMoves.length, scriptCursor + 1);
      } else if (!scriptDeviated && scriptCursor < scriptMoves.length) {
        const expected = scriptMoves[scriptCursor];
        if (
          expected &&
          expected.fromR === fromR &&
          expected.fromC === fromC &&
          expected.toR === toR &&
          expected.toC === toC
        ) {
          scriptCursor = Math.min(scriptMoves.length, scriptCursor + 1);
        } else {
          scriptDeviated = true;
          scriptedGameActive = false;
        }
      } else if (scriptMoves.length > 0) {
        scriptDeviated = true;
        scriptedGameActive = false;
      }
      if (typeof updateScriptBarUI === 'function') updateScriptBarUI();

      isAnimatingMove = true;
      activeCamTransition = null;
      clearSquareHighlights();
      selectedSquare = null;
      inspectedSquare = null;
      validMoves = [];
      syncActionButtonsUI();
      updatePieceOverheadOverlay();

      // Broadcast to multiplayer room (cloud API + static BroadcastChannel/localStorage fallback)
      if (gameMode === 'multi' && roomCode && !options.fromRemote) {
        appliedMoveSeq += 1;
        sendMultiplayerMove({
          playerToken,
          color: piece.color,
          from: { r: fromR, c: fromC },
          to: { r: toR, c: toC },
          promotion: chosenPromotion
        });
      }

      const startPos = boardToWorld(fromR, fromC);
      const endPos = boardToWorld(toR, toC);
      const dx = endPos.x - startPos.x;
      const dz = endPos.z - startPos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const dirX = dx / dist;
      const dirZ = dz / dist;
      const moveHeading = Math.atan2(dx, dz);
      const homeRotY = piece.color === 'w' ? Math.PI : 0;
      const startRotY = piece.mesh ? piece.mesh.rotation.y : homeRotY;
      const basePieceScale = getPieceWorldScale(piece.type);
      const defenderBaseScale = captured ? getPieceWorldScale(captured.type) : basePieceScale;
      const gaitProfile = LOCOMOTION_GAIT_PROFILES[piece.type] || LOCOMOTION_GAIT_PROFILES.queen;
      const atkProfile = ATTACK_SYNC_PROFILES[piece.type] || ATTACK_SYNC_PROFILES.queen;
      const effectWeight = PIECE_EFFECT_WEIGHTS[piece.type] || 0.8;

      playPieceClip(piece, 'Move', true, 0.14);

      // Detect Castling (King moves 2 files horizontally: e1->g1/c1 or e8->g8/c8) and animate the Rook simultaneously
      const isCastling =
        gameVariant !== 'xiangqi' &&
        piece.type === 'king' &&
        fromR === toR &&
        Math.abs(toC - fromC) === 2;
      const castleRookFromC = isCastling ? (toC > fromC ? 7 : 0) : -1;
      const castleRookToC = isCastling ? (toC > fromC ? 5 : 3) : -1;
      const castleRook = isCastling ? boardState[fromR][castleRookFromC] : null;
      const castleRookStartPos = castleRook ? boardToWorld(fromR, castleRookFromC) : null;
      const castleRookEndPos = castleRook ? boardToWorld(fromR, castleRookToC) : null;
      const castleRookStartRotY = castleRook && castleRook.mesh ? castleRook.mesh.rotation.y : homeRotY;
      const castleRookMoveHeading =
        castleRook && castleRookStartPos && castleRookEndPos
          ? Math.atan2(castleRookEndPos.x - castleRookStartPos.x, castleRookEndPos.z - castleRookStartPos.z)
          : homeRotY;
      if (castleRook && castleRook.mesh) {
        playPieceClip(castleRook, 'Move', true, 0.14);
      }

      // Defending enemy statue smoothly turns to face the incoming attacker during approach (no 1-frame snap!)
      const capturedStartRotY =
        isCapture && captured && captured.mesh
          ? captured.mesh.rotation.y
          : piece.color === 'w'
            ? 0
            : Math.PI;
      const capturedTargetRotY = Math.atan2(-dx, -dz);

      // Per-Piece Signature Standoff Distance (e.g. 0.68m ranged spellcast for Bishop, 0.44m aerial dive launch for Knight, 0.34m shield-bash for Pawn)
      const desiredStandoff = atkProfile.standoff || MELEE_STANDOFF;
      const stopOffset = isCapture ? Math.min(desiredStandoff, dist * 0.78) : 0;
      const strikePos = new THREE.Vector3(
        endPos.x - dirX * stopOffset,
        BOARD_SURFACE_Y,
        endPos.z - dirZ * stopOffset
      );

      // Collect all bystander pieces (both friendly and enemy) on the board for concrete collision avoidance
      const bystanders = [];
      const rows = getBoardRows();
      const cols = getBoardCols();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const other = boardState[r]?.[c];
          if (other && other !== piece && other !== captured && other.mesh) {
            bystanders.push({
              piece: other,
              homePos: boardToWorld(r, c),
              height: PIECE_HEIGHTS[other.type] || 0.45
            });
          }
        }
      }

      // Pre-analyze Knight path vs bystanders so Knights cleanly skirt single blockers or vault high over walls
      const segDx = (isCapture ? strikePos.x : endPos.x) - startPos.x;
      const segDz = (isCapture ? strikePos.z : endPos.z) - startPos.z;
      const segLen = Math.hypot(segDx, segDz) || 0.001;
      const segUx = segDx / segLen;
      const segUz = segDz / segLen;
      const segPerpX = -segUz;
      const segPerpZ = segUx;

      let knightLateralSign = 0;
      let knightVaultPeak = 0;
      if (piece.type === 'knight' && !horseLegWorldPos) {
        let blockedPosSide = false;
        let blockedNegSide = false;
        let maxBlockerHeight = 0;
        for (const b of bystanders) {
          const relX = b.homePos.x - startPos.x;
          const relZ = b.homePos.z - startPos.z;
          const proj = relX * segUx + relZ * segUz;
          if (proj > 0.04 && proj < segLen - 0.04) {
            const signedPerp = relX * segPerpX + relZ * segPerpZ;
            if (Math.abs(signedPerp) < MIN_PIECE_SEP) {
              if (signedPerp >= 0) blockedPosSide = true;
              if (signedPerp <= 0) blockedNegSide = true;
              if (b.height > maxBlockerHeight) maxBlockerHeight = b.height;
            }
          }
        }
        if (blockedPosSide && !blockedNegSide) {
          knightLateralSign = -1; // Skirt cleanly around the open -perp channel
        } else if (blockedNegSide && !blockedPosSide) {
          knightLateralSign = 1;  // Skirt cleanly around the open +perp channel
        } else if (blockedPosSide && blockedNegSide) {
          // Solid wall of pieces across both L-channels: vault high above the tallest blocker's crown/helmet
          knightVaultPeak = maxBlockerHeight + 0.09;
        }
      }

      function resetBystandersToHome() {
        for (const b of bystanders) {
          b.piece.mesh.position.copy(b.homePos);
        }
      }

      // Concrete 3D Trajectory Solver + Smooth Yaw Turn & Piece-Specific Locomotion Gait Physics
      const isDiagonalSlide =
        Math.abs(toR - fromR) === Math.abs(toC - fromC) &&
        Math.abs(toR - fromR) >= 1 &&
        piece.type !== 'knight';
      const squaresMoved = Math.max(1, Math.hypot(toR - fromR, toC - fromC));

      function applyConcreteTrajectory(u, fromVec, toVec, settleToHomeAtEnd = false) {
        const ease = isCapture ? (0.28 * u + 0.72 * easeInOutCubic(u)) : easeInOutCubic(u);
        let bx = fromVec.x + (toVec.x - fromVec.x) * ease;
        let bz = fromVec.z + (toVec.z - fromVec.z) * ease;
        let by = BOARD_SURFACE_Y;

        const archSin = Math.sin(u * Math.PI);
        const totalSteps = Math.max(2, Math.round(squaresMoved * gaitProfile.stepFreqPerSq));
        const cadenceSin = Math.sin(u * Math.PI * totalSteps);
        const stepBounce = Math.abs(cadenceSin) * gaitProfile.stepLift * archSin;
        const hoverOffset = gaitProfile.hoverLift * archSin;

        if (piece.type === 'knight') {
          if (horseLegWorldPos) {
            // Xiangqi Horse (Mã): authentic 2-stage curve through the unblocked orthogonal Horse's Leg intersection before banking diagonally
            const inv = 1 - ease;
            bx = inv * inv * fromVec.x + 2 * inv * ease * horseLegWorldPos.x + ease * ease * toVec.x;
            bz = inv * inv * fromVec.z + 2 * inv * ease * horseLegWorldPos.z + ease * ease * toVec.z;
            by = BOARD_SURFACE_Y + archSin * 0.095;
          } else if (knightLateralSign !== 0) {
            // Curve horizontally through the open L-corridor
            bx += segPerpX * knightLateralSign * 0.165 * archSin;
            bz += segPerpZ * knightLateralSign * 0.165 * archSin;
            by = BOARD_SURFACE_Y + archSin * 0.085;
          } else if (knightVaultPeak > 0) {
            // Broad, high stone-steed vault that clears the full height of blocking pieces
            by = BOARD_SURFACE_Y + Math.pow(archSin, 0.65) * knightVaultPeak;
          } else {
            by = BOARD_SURFACE_Y + archSin * 0.085;
          }
        } else if (piece.type === 'cannon' && isCapture && activeCannonScreenWorldPos) {
          // Xiangqi Cannon vaults cleanly over the screen piece when gliding into firing stance
          by = BOARD_SURFACE_Y + Math.pow(archSin, 0.65) * 0.42;
        } else {
          by = BOARD_SURFACE_Y + hoverOffset + stepBounce;
        }

        // Smooth shortest-arc yaw rotation (turn into moveHeading over u ∈ [0, 0.22], and settle back to homeRotY over u ∈ [0.78, 1.0] if non-capture)
        let currentYaw = moveHeading;
        if (u < 0.22) {
          currentYaw = lerpAngleShortest(startRotY, moveHeading, easeInOutCubic(u / 0.22));
        } else if (settleToHomeAtEnd && u > 0.78) {
          currentYaw = lerpAngleShortest(moveHeading, homeRotY, easeInOutCubic((u - 0.78) / 0.22));
        }

        // Smooth locomotion pitch (lean forward during acceleration, rear/brake during deceleration) & subtle gait roll sway
        let pitchX = 0;
        if (piece.type === 'knight') {
          // Warhorse rears back at launch (u < 0.25) and pitches forward into landing (u > 0.55)
          pitchX = Math.sin(u * Math.PI * 2 - Math.PI * 0.5) * gaitProfile.pitchLean * archSin;
        } else {
          pitchX = Math.sin(u * Math.PI * 2) * gaitProfile.pitchLean * archSin;
        }
        const rollZ = cadenceSin * gaitProfile.rollSway * archSin;
        // Anticipation and settle: a short crouch and lean back before the piece sets off, and a squash as it
        // lands. Both sit inside the move's own duration, so a move takes no longer than before.
        if (motionLevel !== 'off') {
          let squash = 0;
          if (u < MOVE_ANTICIPATION_SPAN) {
            const a = Math.sin((u / MOVE_ANTICIPATION_SPAN) * Math.PI);
            squash = a * 0.07 * effectWeight;
            pitchX -= a * 0.06 * effectWeight;
          } else if (settleToHomeAtEnd && u > 1 - MOVE_SETTLE_SPAN) {
            squash = Math.sin(((u - (1 - MOVE_SETTLE_SPAN)) / MOVE_SETTLE_SPAN) * Math.PI) * 0.09 * effectWeight;
          }
          applyPieceBaseScale(piece.mesh, piece.type, 1 + squash * 0.5, 1 - squash);
        }
        piece.mesh.rotation.set(pitchX, currentYaw, rollZ);

        // Smoothly turn defending piece toward incoming attacker during first 45% of approach
        if (isCapture && captured && captured.mesh) {
          const defTurnU = easeInOutCubic(Math.min(1, u / 0.45));
          captured.mesh.rotation.y = lerpAngleShortest(capturedStartRotY, capturedTargetRotY, defTurnU);
        }

        // Check every bystander (friendly or enemy) for concrete 3D non-penetration
        const effectiveMinSep = isDiagonalSlide ? 0.262 : MIN_PIECE_SEP;
        for (const b of bystanders) {
          const hx = b.homePos.x;
          const hz = b.homePos.z;
          const dHomeX = bx - hx;
          const dHomeZ = bz - hz;
          const dHome = Math.hypot(dHomeX, dHomeZ);

          // If the moving piece is already vertically above this bystander's top + 2.5cm margin, no horizontal push needed
          if (by >= BOARD_SURFACE_Y + b.height + 0.025) {
            b.piece.mesh.position.copy(b.homePos);
            continue;
          }

          // When squeezing diagonally between adjacent pieces, bystanders subtly yield outward within their square
          if (dHome < 0.36 && dHome > 0.001 && knightVaultPeak === 0) {
            const yieldProx = Math.max(0, (0.36 - dHome) / 0.36) * archSin;
            const yieldDist = Math.min(0.068, yieldProx * 0.082);
            b.piece.mesh.position.set(
              hx - (dHomeX / dHome) * yieldDist,
              BOARD_SURFACE_Y,
              hz - (dHomeZ / dHome) * yieldDist
            );
          } else {
            b.piece.mesh.position.copy(b.homePos);
          }

          // Hard concrete cylinder separation against bystander's instantaneous position
          const curBx = b.piece.mesh.position.x;
          const curBz = b.piece.mesh.position.z;
          const sepX = bx - curBx;
          const sepZ = bz - curBz;
          const sepDist = Math.hypot(sepX, sepZ);

          if (sepDist < effectiveMinSep) {
            if (piece.type === 'knight' && knightVaultPeak > 0) {
              // Ensure Knight pedestal bottom clears the blocker's crown/helmet
              by = Math.max(by, BOARD_SURFACE_Y + b.height + 0.03);
            } else if (sepDist > 0.0001) {
              const push = effectiveMinSep - sepDist;
              bx += (sepX / sepDist) * push;
              bz += (sepZ / sepDist) * push;
            } else {
              bx += segPerpX * effectiveMinSep;
              bz += segPerpZ * effectiveMinSep;
            }
          }
        }

        piece.mesh.position.set(bx, by, bz);
      }

      // Save Player Camera State for Smooth Eased Entry & Return (or 2P Auto-Flip to Next Player Side)
      const savedCamPos = camera.position.clone();
      const savedTarget = orbitControls.target.clone();
      const nextTurnColor = piece.color === 'w' ? 'b' : 'w';
      const isPlayerCamPresetActive = Boolean(
        document.getElementById('btn-cam-player')?.classList.contains('active')
      );
      const shouldAutoFlip2P =
        !isCameraLocked &&
        gameMode === 'single' &&
        isPassAndPlay &&
        autoFlipCamera2P &&
        !scriptedGameActive &&
        isPlayerCamPresetActive;
      const useDuelCamSwoop = !isCameraLocked;
      const activeDuelCamSwoop = useDuelCamSwoop && combatCameraZoomEnabled;
      const nextZSign = nextTurnColor === 'b' ? -1 : 1;
      const returnCamPos = shouldAutoFlip2P
        ? new THREE.Vector3(0, 3.82, nextZSign * 3.58)
        : savedCamPos;
      const returnTarget = shouldAutoFlip2P
        ? new THREE.Vector3(0, 0.78, nextZSign * -0.06)
        : savedTarget;
      const duelPortraitFactor = getPortraitFramingFactor();
      if (shouldAutoFlip2P && duelPortraitFactor > 0) {
        returnCamPos.y = Number((3.82 + duelPortraitFactor * 3.03).toFixed(3));
        returnCamPos.z = Number((nextZSign * (3.58 + duelPortraitFactor * 2.10)).toFixed(3));
        returnTarget.y = Number((0.78 - duelPortraitFactor * 0.14).toFixed(3));
        returnTarget.z = Number((nextZSign * (-0.06 + duelPortraitFactor * 0.48)).toFixed(3));
      }

      // Calculate Optimal Unobstructed 3/4 Duel Camera Angle
      const midPoint = new THREE.Vector3(
        (strikePos.x + endPos.x) * 0.5,
        BOARD_SURFACE_Y + 0.32,
        (strikePos.z + endPos.z) * 0.5
      );

      // Score both perpendicular sides for foreground bystander occlusion across both mid and close camera poses
      const perpA = new THREE.Vector3(-dirZ, 0, dirX);
      const perpB = new THREE.Vector3(dirZ, 0, -dirX);
      const camFromMid = new THREE.Vector3().subVectors(savedCamPos, midPoint);
      const prefPerp = camFromMid.dot(perpA) >= 0 ? perpA : perpB;
      const altPerp = prefPerp === perpA ? perpB : perpA;

      function scoreDuelPerpOcclusion(perpVec) {
        let penalty = 0;
        const probes = [
          { perpMul: 1.24, dirMul: -0.34 },
          { perpMul: 0.92, dirMul: 0.14 }
        ];
        for (const pr of probes) {
          const camX = midPoint.x + perpVec.x * pr.perpMul + dirX * pr.dirMul;
          const camZ = midPoint.z + perpVec.z * pr.perpMul + dirZ * pr.dirMul;
          const rayX = midPoint.x - camX;
          const rayZ = midPoint.z - camZ;
          const rayLenSq = Math.max(0.0001, rayX * rayX + rayZ * rayZ);
          for (const b of bystanders) {
            const bPos = b.piece && b.piece.mesh ? b.piece.mesh.position : b.homePos;
            if (!bPos) continue;
            const px = bPos.x - camX;
            const pz = bPos.z - camZ;
            const t = (px * rayX + pz * rayZ) / rayLenSq;
            if (t > 0.10 && t < 0.98) {
              const cx = camX + rayX * t;
              const cz = camZ + rayZ * t;
              const distB = Math.hypot(bPos.x - cx, bPos.z - cz);
              if (distB < 0.44) {
                penalty += (0.44 - distB) * 12.0;
              }
            }
          }
        }
        return penalty;
      }

      const chosenPerp =
        scoreDuelPerpOcclusion(prefPerp) > scoreDuelPerpOcclusion(altPerp) + 0.25 ? altPerp : prefPerp;

      // Continuous Quadratic Bezier 3/4 orbit-and-dolly arc (savedCamPos -> duelCamMid -> duelCamClose)
      // so the attack camera glides in a single unbroken C-infinity sweep across approach + strike without ever stalling at tApproach
      const duelPerpScale = 1 + duelPortraitFactor * 0.28;
      const duelCamMid = new THREE.Vector3(
        midPoint.x + chosenPerp.x * (1.34 * duelPerpScale) - dirX * 0.44,
        BOARD_SURFACE_Y + 0.96 + duelPortraitFactor * 0.22,
        midPoint.z + chosenPerp.z * (1.34 * duelPerpScale) - dirZ * 0.44
      );
      const duelCamClose = new THREE.Vector3(
        midPoint.x + chosenPerp.x * (0.92 * duelPerpScale) + dirX * 0.18,
        BOARD_SURFACE_Y + 0.74 + duelPortraitFactor * 0.18,
        midPoint.z + chosenPerp.z * (0.92 * duelPerpScale) + dirZ * 0.18
      );
      const duelTargetStart = new THREE.Vector3(
        strikePos.x + dirX * 0.10,
        BOARD_SURFACE_Y + 0.34,
        strikePos.z + dirZ * 0.10
      );
      const duelTargetEnd = new THREE.Vector3(
        endPos.x - dirX * 0.05,
        BOARD_SURFACE_Y + 0.30,
        endPos.z - dirZ * 0.05
      );

      function evalQuadraticBezier(outVec, p0, p1, p2, t) {
        const inv = 1 - t;
        const c0 = inv * inv;
        const c1 = 2 * inv * t;
        const c2 = t * t;
        outVec.set(
          c0 * p0.x + c1 * p1.x + c2 * p2.x,
          c0 * p0.y + c1 * p1.y + c2 * p2.y,
          c0 * p0.z + c1 * p1.z + c2 * p2.z
        );
      }

      if (isCapture) {
        activeDuelSavedCam = {
          pos: savedCamPos.clone(),
          target: savedTarget.clone()
        };
        orbitControls.enabled = false;
        cameraTelemetry.lastAttackSamples = [];
        cameraTelemetry.attackCount += 1;
        cameraTelemetry.maxStepDelta = 0;
        cameraTelemetry.minCombatSeparation = Infinity;
      } else {
        cameraTelemetry.lastSpaceMoveSamples = [];
      }

      // Distance-scaled piece movement duration (unhurried, weighty glide):
      const stdMoveDuration = Number((0.64 + Math.max(0, squaresMoved - 1) * 0.14).toFixed(3));
      const SWING_START_CLIP_TIME = atkProfile.swingStartClip;
      const CONTACT_CLIP_TIME = atkProfile.contactClip; // Primary physical/spell contact
      const SECOND_CONTACT_CLIP_TIME = atkProfile.secondContactClip || 0; // Multi-hit combo contact (Pawn / Queen)
      const BLOW_CLIP_TIME = atkProfile.blowClip;       // Signature finisher detonation
      const tApproach = isCapture
        ? Number((0.66 + Math.max(0, squaresMoved - 1) * 0.125).toFixed(3))
        : stdMoveDuration;
      const tContact = isCapture ? (tApproach + CONTACT_CLIP_TIME / atkProfile.timeScale) : stdMoveDuration;
      const tImpact = isCapture ? (tApproach + BLOW_CLIP_TIME / atkProfile.timeScale) : stdMoveDuration;
      const tStrikeDone = isCapture ? (tImpact + 0.48) : stdMoveDuration;
      const camReturnDist = returnCamPos.distanceTo(duelCamClose);
      const returnDuration = isCapture
        ? activeDuelCamSwoop
          ? Number((1.18 + Math.min(0.42, camReturnDist * 0.10)).toFixed(3))
          : shouldAutoFlip2P
            ? 0.72
            : 0.36
        : 0;
      const totalDuration = isCapture ? (tStrikeDone + returnDuration) : stdMoveDuration;
      wizardAudio.playMoveSlide(stdMoveDuration);
      const pathTraceHex = piece.color === 'w' ? MOVE_TRACE_WHITE_HEX : MOVE_TRACE_BLACK_HEX;
      pieceEffects.spawnPathRibbon(startPos, isCapture ? strikePos : endPos, pathTraceHex, isCapture ? tApproach : stdMoveDuration);
      if (castleRookStartPos) {
        pieceEffects.spawnPathRibbon(castleRookStartPos, castleRookEndPos, pathTraceHex, stdMoveDuration);
      }

      if (!isCapture) {
        cameraTelemetry.lastSpaceMoveDuration = stdMoveDuration;
        cameraTelemetry.lastSquaresMoved = Number(squaresMoved.toFixed(3));
      } else {
        cameraTelemetry.lastCaptureTiming = {
          pieceType: piece.type,
          signatureId: atkProfile.signatureId,
          signatureName: atkProfile.signatureName,
          standoff: Number(stopOffset.toFixed(3)),
          squaresMoved: Number(squaresMoved.toFixed(3)),
          tApproach: Number(tApproach.toFixed(3)),
          tContact: Number(tContact.toFixed(3)),
          tImpact: Number(tImpact.toFixed(3)),
          tStrikeDone: Number(tStrikeDone.toFixed(3)),
          returnDuration: Number(returnDuration.toFixed(3)),
          totalDuration: Number(totalDuration.toFixed(3))
        };
      }

      let elapsed = 0;
      let attackAnimStarted = false;
      let windupVfxTriggered = false;
      let defenderFlinchTriggered = false;
      let secondHitTriggered = false;
      let shatterTriggered = false;
      let hitStopRemaining = 0;
      let impactActualTime = tImpact;
      const postShatterPiecePos = strikePos.clone();
      const postStrikePiecePos = strikePos.clone();
      let prevCamPos = camera.position.clone();
      let prevPiecePos = piece.mesh.position.clone();

      activeCombatMixers.clear();
      if (piece && piece.mixer) activeCombatMixers.add(piece.mixer);
      if (captured && captured.mixer) activeCombatMixers.add(captured.mixer);
      if (castleRook && castleRook.mixer) activeCombatMixers.add(castleRook.mixer);

      function finishMove() {
        resetBystandersToHome();
        activeCombatMixers.clear();
        activeCannonScreenWorldPos = null;
        boardState[fromR][fromC] = null;
        if (isEnPassant) {
          if (captured) {
            removePieceFromScene(captured);
          }
          boardState[epCapR][epCapC] = null;
        }
        boardState[toR][toC] = piece;
        piece.r = toR;
        piece.c = toC;
        piece.hasMoved = true;

        if (isCastling && castleRook) {
          boardState[fromR][castleRookFromC] = null;
          boardState[fromR][castleRookToC] = castleRook;
          castleRook.r = fromR;
          castleRook.c = castleRookToC;
          castleRook.hasMoved = true;
          if (castleRook.mesh) {
            castleRook.mesh.position.copy(castleRookEndPos);
            castleRook.mesh.rotation.set(0, castleRook.color === 'w' ? Math.PI : 0, 0);
            applyPieceBaseScale(castleRook.mesh, 'rook');
          }
          playPieceClip(castleRook, 'Idle', true, 0.24);
        }

        // Pawn Promotion to chosen piece (Queen, Rook, Bishop, or Knight) — Chess only
        if (gameVariant !== 'xiangqi' && piece.type === 'pawn' && (toR === 0 || toR === 7)) {
          removePieceFromScene(piece);
          const promoted = instantiatePiece(chosenPromotion, piece.color, toR, toC);
          promoted.hasMoved = true;
          boardState[toR][toC] = promoted;
          wizardAudio.playPromotionChime();
        } else {
          piece.mesh.position.copy(endPos);
          piece.mesh.rotation.set(0, piece.color === 'w' ? Math.PI : 0, 0);
          applyPieceBaseScale(piece.mesh, piece.type);
          playPieceClip(piece, 'Idle', true, 0.24);
        }

        // Update En Passant target square
        if (gameVariant !== 'xiangqi' && piece.type === 'pawn' && Math.abs(toR - fromR) === 2) {
          enPassantTarget = {
            r: (fromR + toR) / 2,
            c: fromC,
            pawnR: toR,
            pawnC: toC,
            color: piece.color
          };
        } else {
          enPassantTarget = null;
        }

        // Update 50-move half-move clock
        if (piece.type === 'pawn' || isCapture) {
          halfMoveClock = 0;
        } else {
          halfMoveClock += 1;
        }

        lastMoveSquares = { fromR, fromC, toR, toC };
        pieceEffects.spawnLanding(endPos, piece.type);
        if (isCastling && castleRook) pieceEffects.spawnLanding(castleRookEndPos, 'rook');

        if (isCapture) {
          if (piece.color === 'w') capturedByWhite += 1;
          else capturedByBlack += 1;
          activeDuelSavedCam = null;
          camera.position.copy(returnCamPos);
          orbitControls.target.copy(returnTarget);
          if (shouldAutoFlip2P) {
            playerCamSide = nextTurnColor;
          }
          orbitControls.enabled = !isCameraLocked;
          flushOrbitControlsDamping();
        }

        currentTurn = currentTurn === 'w' ? 'b' : 'w';
        if (gameMode === 'single' && isPassAndPlay) {
          playerColor = currentTurn;
          if (!isCapture && shouldAutoFlip2P) {
            playerCamSide = currentTurn;
            setCameraForSide(currentTurn, false);
          }
        }
        positionHistory.push(
          gameVariant === 'xiangqi'
            ? computeXiangqiPositionHash(extractPureXiangqiBoard(boardState), currentTurn)
            : computePositionHash(extractPureBoard(boardState), currentTurn, enPassantTarget)
        );
        isAnimatingMove = false;
        updateTurnUI();
        maybeScheduleAIMove();
      }

      function stepMove(dt) {
        if (hitStopRemaining > 0) {
          hitStopRemaining = Math.max(0, hitStopRemaining - dt);
          dt *= 0.12; // Dramatic sovereign impact hit-stop compression
        }
        elapsed += dt;

        if (!isCapture) {
          const u = Math.min(1, elapsed / totalDuration);
          applyConcreteTrajectory(u, startPos, endPos, true);
          if (isCastling && castleRook && castleRook.mesh) {
            const rEase = easeInOutCubic(u);
            castleRook.mesh.position.set(
              castleRookStartPos.x + (castleRookEndPos.x - castleRookStartPos.x) * rEase,
              BOARD_SURFACE_Y + Math.sin(u * Math.PI) * 0.05,
              castleRookStartPos.z + (castleRookEndPos.z - castleRookStartPos.z) * rEase
            );
            let rYaw = castleRookMoveHeading;
            if (u < 0.22) {
              rYaw = lerpAngleShortest(castleRookStartRotY, castleRookMoveHeading, easeInOutCubic(u / 0.22));
            } else if (u > 0.78) {
              rYaw = lerpAngleShortest(castleRookMoveHeading, homeRotY, easeInOutCubic((u - 0.78) / 0.22));
            }
            castleRook.mesh.rotation.set(0, rYaw, 0);
          }
          const pDelta = piece.mesh.position.distanceTo(prevPiecePos);
          prevPiecePos.copy(piece.mesh.position);
          cameraTelemetry.lastSpaceMoveSamples.push({
            t: Number(elapsed.toFixed(3)),
            u: Number(u.toFixed(3)),
            piecePos: [
              Number(piece.mesh.position.x.toFixed(3)),
              Number(piece.mesh.position.y.toFixed(3)),
              Number(piece.mesh.position.z.toFixed(3))
            ],
            pieceStep: Number(pDelta.toFixed(4))
          });
          if (u >= 1) {
            finishMove();
            return true;
          }
          return false;
        }

        // Capture Sequence with Steady Fixed View by default (no nauseating zoom-in/out!) or Optional C-infinity Bezier Swoop
        let phaseName = 'approach';
        if (elapsed <= tStrikeDone) {
          if (activeDuelCamSwoop) {
            // Single unbroken C-infinity camera arc across both approach and strike (never stops at tApproach!)
            const uActive = Math.min(1, elapsed / tStrikeDone);
            const sActive = 0.38 * uActive + 0.62 * easeInOutCubic(uActive);
            evalQuadraticBezier(camera.position, savedCamPos, duelCamMid, duelCamClose, sActive);
            evalQuadraticBezier(orbitControls.target, savedTarget, duelTargetStart, duelTargetEnd, sActive);
          }

          if (elapsed <= tApproach) {
            // Phase 1: Smooth Glide-In to Concrete Signature Standoff Position
            phaseName = 'approach';
            const u = Math.min(1, elapsed / tApproach);
            applyConcreteTrajectory(u, startPos, strikePos, false);
          } else {
            // Phase 2: 6 Unique Character Signature Attack Choreographies
            phaseName = 'strike';
            if (!attackAnimStarted) {
              attackAnimStarted = true;
              piece.mesh.rotation.set(0, moveHeading, 0);
              playPieceClip(piece, 'Attack', false, 0.10);
            }

            // Smoothly keep any bystanders immediately adjacent to strikePos yielded slightly outward during the weapon swing
            const yieldBlend = 1 - Math.exp(-Math.max(0.001, dt) * 14);
            for (const b of bystanders) {
              const dxB = strikePos.x - b.homePos.x;
              const dzB = strikePos.z - b.homePos.z;
              const dB = Math.hypot(dxB, dzB);
              if (dB < 0.42 && dB > 0.001) {
                const yieldDist = ((0.42 - dB) / 0.42) * 0.068;
                const tx = b.homePos.x - (dxB / dB) * yieldDist;
                const tz = b.homePos.z - (dzB / dB) * yieldDist;
                b.piece.mesh.position.x += (tx - b.piece.mesh.position.x) * yieldBlend;
                b.piece.mesh.position.y = BOARD_SURFACE_Y;
                b.piece.mesh.position.z += (tz - b.piece.mesh.position.z) * yieldBlend;
              } else {
                b.piece.mesh.position.lerp(b.homePos, yieldBlend);
              }
            }

            const atkClipTime = (elapsed - tApproach) * atkProfile.timeScale;

            // Trigger early windup signature VFX & audio for Ranged Caster (Bishop), Cannon, Elephant, Sky-Lancer (Knight), and Sovereign (King)
            if (!windupVfxTriggered && atkClipTime >= SWING_START_CLIP_TIME * 0.65) {
              windupVfxTriggered = true;
              if (
                piece.type === 'bishop' ||
                piece.type === 'knight' ||
                piece.type === 'king' ||
                piece.type === 'cannon' ||
                piece.type === 'elephant' ||
                piece.type === 'advisor'
              ) {
                wizardAudio.playSignatureAttack(piece.type, 'windup', {
                  x: piece.mesh.position.x,
                  y: BOARD_SURFACE_Y,
                  z: piece.mesh.position.z
                });
                spawnSignatureCombatVFX(piece.type, 'windup', piece.mesh.position, endPos, dirX, dirZ, piece.color);
              }
            }

            // Per-Piece Signature Root & Target Choreography prior to Final Shatter
            if (!shatterTriggered && captured && captured.mesh) {
              let lungeOffset = 0;
              let attackerLiftY = 0;
              let attackerPitchX = 0;
              let attackerYaw = moveHeading;
              let attackerRollZ = 0;

              let defShoveDist = 0;
              let defLiftY = 0;
              let defPitchX = 0;
              let defYaw = capturedTargetRotY;
              let defRollZ = 0;
              let defScaleY = 1.0;
              let defScaleXZ = 1.0;

              const uTotalStrike = Math.min(1, atkClipTime / Math.max(0.1, BLOW_CLIP_TIME));

              if (piece.type === 'pawn') {
                // 1. PAWN: Phalanx Shield-Breaker (0..0.38s) -> Recoil -> Lethal Spear Thrust (0.52..0.78s)
                if (atkClipTime < CONTACT_CLIP_TIME) {
                  const p = Math.min(1, atkClipTime / CONTACT_CLIP_TIME);
                  lungeOffset = easeInOutCubic(p) * 0.11;
                  attackerPitchX = Math.sin(p * Math.PI) * 0.20;
                } else if (atkClipTime < 0.52) {
                  const p = (atkClipTime - CONTACT_CLIP_TIME) / (0.52 - CONTACT_CLIP_TIME);
                  lungeOffset = 0.11 - Math.sin(p * Math.PI * 0.5) * 0.065;
                  attackerPitchX = -0.06 * p;
                  defShoveDist = easeInOutCubic(p) * 0.075;
                  defPitchX = -0.22 * Math.sin(p * Math.PI * 0.8);
                } else {
                  const p = Math.min(1, (atkClipTime - 0.52) / Math.max(0.05, BLOW_CLIP_TIME - 0.52));
                  lungeOffset = 0.045 + easeInOutCubic(p) * (atkProfile.maxLunge - 0.045);
                  attackerPitchX = 0.24 * Math.sin(p * Math.PI * 0.85);
                  defShoveDist = 0.075 + p * 0.045;
                  defPitchX = -0.18 - p * 0.12;
                }
              } else if (piece.type === 'rook' || piece.type === 'elephant') {
                // 2. ROOK / XIANGQI ELEPHANT: Colossal Titan Earthshaker Leap & Vertical Crush Slam
                if (atkClipTime < CONTACT_CLIP_TIME) {
                  const p = Math.min(1, atkClipTime / CONTACT_CLIP_TIME);
                  attackerLiftY = Math.sin(p * Math.PI) * 0.165;
                  attackerPitchX = p < 0.65 ? -0.22 * (p / 0.65) : 0.26 * ((p - 0.65) / 0.35);
                  lungeOffset = easeInOutCubic(p) * 0.065;
                } else {
                  const p = Math.min(1, (atkClipTime - CONTACT_CLIP_TIME) / Math.max(0.05, BLOW_CLIP_TIME - CONTACT_CLIP_TIME));
                  attackerPitchX = 0.22 * (1 - p * 0.5);
                  lungeOffset = 0.065 + p * 0.030;
                  // Vertically crush defender into the board before seismic eruption!
                  defScaleY = 1.0 - easeInOutCubic(p) * 0.42;
                  defScaleXZ = 1.0 + easeInOutCubic(p) * 0.20;
                  defShoveDist = p * 0.035;
                }
              } else if (piece.type === 'cannon') {
                // XIANGQI CANNON (Pháo): Barrel Elevate -> Muzzle Blast Recoil -> Mortar Detonation
                if (atkClipTime < SWING_START_CLIP_TIME) {
                  const p = Math.min(1, atkClipTime / SWING_START_CLIP_TIME);
                  attackerPitchX = -0.32 * easeInOutCubic(p);
                } else if (atkClipTime < CONTACT_CLIP_TIME) {
                  const p = (atkClipTime - SWING_START_CLIP_TIME) / Math.max(0.05, CONTACT_CLIP_TIME - SWING_START_CLIP_TIME);
                  attackerPitchX = -0.32 + Math.sin(p * Math.PI) * 0.18;
                  lungeOffset = -Math.sin(p * Math.PI) * 0.085; // Heavy cannon carriage recoil!
                } else {
                  const cp = Math.min(1, (atkClipTime - CONTACT_CLIP_TIME) / Math.max(0.04, BLOW_CLIP_TIME - CONTACT_CLIP_TIME));
                  attackerPitchX = -0.14 * (1 - cp);
                  defLiftY = Math.sin(cp * Math.PI) * 0.14;
                  defShoveDist = cp * 0.085;
                  defPitchX = -cp * 0.28;
                }
              } else if (piece.type === 'knight') {
                // 3. KNIGHT: Sky-Lancer Pegasus Ballistic Vault & Diving Lance Impale
                if (atkClipTime < SWING_START_CLIP_TIME) {
                  const p = Math.min(1, atkClipTime / SWING_START_CLIP_TIME);
                  attackerPitchX = -0.38 * Math.sin(p * Math.PI * 0.5); // Rear up on hind legs
                  attackerLiftY = p * 0.05;
                } else {
                  const p = Math.min(1, (atkClipTime - SWING_START_CLIP_TIME) / Math.max(0.05, BLOW_CLIP_TIME - SWING_START_CLIP_TIME));
                  // High aerial vault peaking at +0.27m above the board then diving into defender
                  attackerLiftY = Math.sin(p * Math.PI) * 0.27;
                  attackerPitchX = -0.38 * (1 - p) + 0.34 * p;
                  lungeOffset = easeInOutCubic(p) * atkProfile.maxLunge;
                  if (atkClipTime >= CONTACT_CLIP_TIME) {
                    const cp = Math.min(1, (atkClipTime - CONTACT_CLIP_TIME) / Math.max(0.04, BLOW_CLIP_TIME - CONTACT_CLIP_TIME));
                    defShoveDist = cp * 0.085;
                    defPitchX = -cp * 0.28;
                  }
                }
              } else if (piece.type === 'bishop') {
                // 4. BISHOP: Ranged Celestial Judgment Spellcast & Telekinetic Target Levitation
                attackerLiftY = Math.sin(uTotalStrike * Math.PI) * 0.105;
                attackerPitchX = -0.10 * Math.sin(uTotalStrike * Math.PI);
                lungeOffset = Math.sin(uTotalStrike * Math.PI * 0.5) * atkProfile.maxLunge;
                if (atkClipTime >= SWING_START_CLIP_TIME) {
                  const levP = Math.min(1, (atkClipTime - SWING_START_CLIP_TIME) / Math.max(0.05, BLOW_CLIP_TIME - SWING_START_CLIP_TIME));
                  // Telekinetically lift defender into the air and spin it inside the Sacred Rune Circle!
                  defLiftY = easeInOutCubic(levP) * 0.155;
                  defYaw = capturedTargetRotY + levP * Math.PI * 2.4;
                  defRollZ = Math.sin(levP * Math.PI * 6) * 0.18;
                  defPitchX = -0.16 * levP;
                }
              } else if (piece.type === 'queen' || piece.type === 'advisor') {
                // 5. QUEEN / XIANGQI ADVISOR: Whirlwind Blitz & Dual Blade Slash Combo
                const spinStart = 0.14;
                const spinSpan = Math.max(0.1, BLOW_CLIP_TIME - spinStart);
                const spinP = Math.max(0, Math.min(1, (atkClipTime - spinStart) / spinSpan));
                attackerYaw = moveHeading + easeInOutCubic(spinP) * Math.PI * 2;
                attackerLiftY = Math.sin(spinP * Math.PI) * 0.065;
                attackerRollZ = Math.sin(spinP * Math.PI * 2) * 0.14;
                lungeOffset = easeInOutCubic(uTotalStrike) * atkProfile.maxLunge;
                if (atkClipTime >= CONTACT_CLIP_TIME && atkClipTime < SECOND_CONTACT_CLIP_TIME) {
                  // Hit 1 whips defender left
                  defRollZ = 0.22;
                  defShoveDist = 0.035;
                } else if (atkClipTime >= SECOND_CONTACT_CLIP_TIME) {
                  // Hit 2 whips defender right before Royal Nova
                  defRollZ = -0.24;
                  defShoveDist = 0.075;
                  defPitchX = -0.18;
                }
              } else {
                // 6. KING: Sovereign Execution — Two-Handed Heaven-Cleaver Overhead Smite
                if (atkClipTime < SWING_START_CLIP_TIME) {
                  const p = Math.min(1, atkClipTime / SWING_START_CLIP_TIME);
                  attackerPitchX = -0.20 * easeInOutCubic(p); // Raise Greatsword high to summon sky lightning
                  lungeOffset = p * 0.032;
                } else {
                  const p = Math.min(1, (atkClipTime - SWING_START_CLIP_TIME) / Math.max(0.05, BLOW_CLIP_TIME - SWING_START_CLIP_TIME));
                  attackerPitchX = -0.20 * (1 - p) + 0.25 * Math.sin(p * Math.PI * 0.9);
                  lungeOffset = 0.032 + easeInOutCubic(p) * (atkProfile.maxLunge - 0.032);
                  if (atkClipTime >= CONTACT_CLIP_TIME) {
                    const cp = Math.min(1, (atkClipTime - CONTACT_CLIP_TIME) / Math.max(0.04, BLOW_CLIP_TIME - CONTACT_CLIP_TIME));
                    defShoveDist = cp * 0.065;
                    defPitchX = -cp * 0.24;
                    defScaleY = 1.0 - cp * 0.18;
                  }
                }
              }

              piece.mesh.position.set(
                strikePos.x + dirX * lungeOffset,
                BOARD_SURFACE_Y + attackerLiftY,
                strikePos.z + dirZ * lungeOffset
              );
              piece.mesh.rotation.set(attackerPitchX, attackerYaw, attackerRollZ);

              captured.mesh.position.set(
                endPos.x + dirX * defShoveDist,
                BOARD_SURFACE_Y + defLiftY,
                endPos.z + dirZ * defShoveDist
              );
              captured.mesh.rotation.set(defPitchX, defYaw, defRollZ);
              applyPieceBaseScale(captured.mesh, captured.type, defScaleXZ, defScaleY);

              const curSep = piece.mesh.position.distanceTo(captured.mesh.position);
              if (curSep < (cameraTelemetry.minCombatSeparation ?? Infinity)) {
                cameraTelemetry.minCombatSeparation = Number(curSep.toFixed(3));
              }
            }

            // Primary Contact: weapon/spell physically strikes defender
            if (
              !defenderFlinchTriggered &&
              (atkClipTime >= CONTACT_CLIP_TIME || elapsed >= tContact + 0.06)
            ) {
              defenderFlinchTriggered = true;
              const hitAt = { x: endPos.x, y: BOARD_SURFACE_Y, z: endPos.z };
              wizardAudio.playWeaponClash(hitAt);
              wizardAudio.playSignatureAttack(piece.type, 'contact1', hitAt);
              spawnSignatureCombatVFX(piece.type, 'contact1', piece.mesh.position, endPos, dirX, dirZ, piece.color);
              if (atkProfile.hitStopDuration > 0) {
                hitStopRemaining = atkProfile.hitStopDuration;
              }
              if (captured) {
                playPieceClip(captured, 'Shatter', false, 0.04);
                impactFlashLight.position.set(
                  endPos.x - dirX * 0.08,
                  BOARD_SURFACE_Y + 0.28,
                  endPos.z - dirZ * 0.08
                );
                impactFlashLight.intensity = piece.type === 'king' || piece.type === 'rook' || piece.type === 'cannon' ? 7.2 : 4.8;
              }
            }

            // Secondary Multi-Hit Combo Contact (Pawn Spear-Setup & Queen Second Whirlwind Slash)
            if (
              SECOND_CONTACT_CLIP_TIME > 0 &&
              !secondHitTriggered &&
              atkClipTime >= SECOND_CONTACT_CLIP_TIME
            ) {
              secondHitTriggered = true;
              wizardAudio.playSignatureAttack(piece.type, 'contact2', { x: endPos.x, y: BOARD_SURFACE_Y, z: endPos.z });
              spawnSignatureCombatVFX(piece.type, 'contact2', piece.mesh.position, endPos, dirX, dirZ, piece.color);
              impactFlashLight.intensity = 6.2;
            }

            // Signature Finisher Burst: defender explodes with piece-specific VFX & directional/vortex debris!
            if (!shatterTriggered && (atkClipTime >= BLOW_CLIP_TIME || elapsed >= tImpact + 0.06)) {
              shatterTriggered = true;
              const finisherAt = { x: endPos.x, y: BOARD_SURFACE_Y, z: endPos.z };
              wizardAudio.playStoneShatter(finisherAt);
              wizardAudio.playSignatureAttack(piece.type, 'finisher', finisherAt);
              impactActualTime = elapsed;
              postShatterPiecePos.copy(piece.mesh.position);
              spawnSignatureCombatVFX(piece.type, 'finisher', piece.mesh.position, endPos, dirX, dirZ, piece.color);
              if (captured && captured.mesh) {
                const shatterOrigin = captured.mesh.position.clone();
                pieceEffects.spawnShatterChunks(captured.mesh, {
                  height: (PIECE_HEIGHTS[captured.type] || 0.4) * (ROLE_SCALE_MULTIPLIERS[captured.type] || 1),
                  type: captured.type,
                  dirX,
                  dirZ
                });
                removePieceFromScene(captured);
                spawnStoneShatter(shatterOrigin, captured.color, piece.type, dirX, dirZ);
              }
            }

            // Immediately after shattering defender, attacker smoothly settles height/pitch and advances toward endPos
            if (shatterTriggered) {
              const postStrikeSpan = Math.max(0.08, tStrikeDone - impactActualTime);
              const uFollow = Math.min(1, Math.max(0, (elapsed - impactActualTime) / postStrikeSpan));
              piece.mesh.position.lerpVectors(postShatterPiecePos, endPos, uFollow * 0.38);
              piece.mesh.position.y = THREE.MathUtils.lerp(postShatterPiecePos.y, BOARD_SURFACE_Y, easeInOutCubic(uFollow));
              piece.mesh.rotation.x = THREE.MathUtils.lerp(piece.mesh.rotation.x, 0, uFollow);
              piece.mesh.rotation.z = THREE.MathUtils.lerp(piece.mesh.rotation.z, 0, uFollow);
              postStrikePiecePos.copy(piece.mesh.position);
            }

            // Piece-scaled impact camera tremor right when the blow shatters the defender (only when combatCameraZoomEnabled is explicitly opted in)
            const shakeSpan = piece.type === 'rook' || piece.type === 'king' || piece.type === 'cannon' ? 0.34 : 0.26;
            if (activeDuelCamSwoop && motionLevel !== 'off' && shatterTriggered && elapsed >= impactActualTime && elapsed <= impactActualTime + shakeSpan) {
              const shakeProgress = (elapsed - impactActualTime) / shakeSpan;
              const decay = (1 - shakeProgress) * (1 - shakeProgress);
              const baseAmp = piece.type === 'rook' || piece.type === 'cannon' ? 0.046 : piece.type === 'king' ? 0.042 : 0.026;
              const amp = baseAmp * decay;
              camera.position.y += Math.sin(shakeProgress * Math.PI * 10) * amp;
            }
          }
        } else {
          // Phase 3: Complete Advance onto Captured Square, Smooth Turn to Army Stance & Camera Ease-Back
          phaseName = 'return';
          const uReturn = Math.min(1, (elapsed - tStrikeDone) / Math.max(0.1, totalDuration - tStrikeDone));
          const easeRet = easeInOutCubic(uReturn);
          const pieceAdvanceBlend = 0.35 * uReturn + 0.65 * easeRet;

          piece.mesh.position.lerpVectors(postStrikePiecePos, endPos, pieceAdvanceBlend);
          piece.mesh.position.y = BOARD_SURFACE_Y;
          const settleTurnU = easeInOutCubic(Math.min(1, Math.max(0, (uReturn - 0.15) / 0.75)));
          piece.mesh.rotation.set(
            0,
            lerpAngleShortest(moveHeading, homeRotY, settleTurnU),
            0
          );
          if (activeDuelCamSwoop) {
            camera.position.lerpVectors(duelCamClose, returnCamPos, easeRet);
            orbitControls.target.lerpVectors(duelTargetEnd, returnTarget, easeRet);
          } else if (shouldAutoFlip2P) {
            camera.position.lerpVectors(savedCamPos, returnCamPos, easeRet);
            orbitControls.target.lerpVectors(savedTarget, returnTarget, easeRet);
          }
        }

        camera.lookAt(orbitControls.target);

        const stepDelta = camera.position.distanceTo(prevCamPos);
        const pieceStepDelta = piece.mesh.position.distanceTo(prevPiecePos);
        if (stepDelta > cameraTelemetry.maxStepDelta) {
          cameraTelemetry.maxStepDelta = stepDelta;
        }
        prevCamPos.copy(camera.position);
        prevPiecePos.copy(piece.mesh.position);

        cameraTelemetry.lastAttackSamples.push({
          t: Number(elapsed.toFixed(3)),
          phase: phaseName,
          camStep: Number(stepDelta.toFixed(4)),
          pieceStep: Number(pieceStepDelta.toFixed(4)),
          pos: [
            Number(camera.position.x.toFixed(3)),
            Number(camera.position.y.toFixed(3)),
            Number(camera.position.z.toFixed(3))
          ],
          target: [
            Number(orbitControls.target.x.toFixed(3)),
            Number(orbitControls.target.y.toFixed(3)),
            Number(orbitControls.target.z.toFixed(3))
          ],
          piecePos: [
            Number(piece.mesh.position.x.toFixed(3)),
            Number(piece.mesh.position.y.toFixed(3)),
            Number(piece.mesh.position.z.toFixed(3))
          ]
        });

        if (elapsed >= totalDuration) {
          finishMove();
          return true;
        }
        return false;
      }

      activeMoveTweens.push(stepMove);
      return true;
    }

    const activeMoveTweens = [];

    // =========================================================================
    // Single-Player Multi-Tier Minimax AI (Novice / Tactical / Grandmaster)
    // =========================================================================
    function chooseSmartAIMove(color) {
      if (gameVariant === 'xiangqi') {
        return chooseBestXiangqiMove(extractPureXiangqiBoard(boardState), color, aiDifficulty);
      }
      return chooseBestAIMove(extractPureBoard(boardState), color, aiDifficulty, enPassantTarget);
    }

    function triggerAIMoveNow() {
      if (isAnimatingMove || gameOver || aiSearchInFlight) return false;
      if (gameMode === 'multi' && currentTurn !== playerColor) return false;
      cancelPendingAISearch();
      hidePromotionModal();
      const chosen = chooseSmartAIMove(currentTurn);
      if (!chosen) return false;
      return executeChessMove(chosen.fromR, chosen.fromC, chosen.toR, chosen.toC, {
        promotion: chosen.promotion || 'queen'
      });
    }

    async function triggerAIMoveAsync() {
      if (isAnimatingMove || gameOver || aiSearchInFlight) return false;
      if (gameMode === 'multi' && currentTurn !== playerColor) return false;
      cancelPendingAISearch();
      hidePromotionModal();
      const targetTurn = currentTurn;
      const scheduledJobId = aiJobId;
      aiSearchInFlight = true;
      syncActionButtonsUI();
      try {
        const epSnap = enPassantTarget ? { ...enPassantTarget } : null;
        const cancelOpts = {
          timeSliceMs: 4,
          shouldCancel: () =>
            scheduledJobId !== aiJobId ||
            currentTurn !== targetTurn ||
            isAnimatingMove ||
            gameOver
        };
        const chosen =
          gameVariant === 'xiangqi'
            ? await chooseBestXiangqiMoveAsync(
                extractPureXiangqiBoard(boardState),
                targetTurn,
                aiDifficulty,
                cancelOpts
              )
            : await chooseBestAIMoveAsync(
                extractPureBoard(boardState),
                targetTurn,
                aiDifficulty,
                epSnap,
                cancelOpts
              );
        if (
          !chosen ||
          scheduledJobId !== aiJobId ||
          currentTurn !== targetTurn ||
          isAnimatingMove ||
          gameOver
        ) {
          return false;
        }
        aiSearchInFlight = false;
        return executeChessMove(chosen.fromR, chosen.fromC, chosen.toR, chosen.toC, {
          promotion: chosen.promotion || 'queen'
        });
      } finally {
        if (scheduledJobId === aiJobId && aiSearchInFlight) {
          aiSearchInFlight = false;
          updateTurnUI();
        }
      }
    }

    function maybeScheduleAIMove() {
      cancelPendingAISearch();
      if (gameOver || isAnimatingMove || preMoveHighlightTask) return;
      if (scriptedGameActive) return;
      if (gameMode !== 'single' || isPassAndPlay || !aiAutoPlay) return;

      const aiColor = playerColor === 'w' ? 'b' : 'w';
      if (currentTurn === aiColor) {
        const scheduledJobId = aiJobId;
        aiTimer = setTimeout(async () => {
          aiTimer = null;
          if (
            scheduledJobId !== aiJobId ||
            scriptedGameActive ||
            gameMode !== 'single' ||
            isPassAndPlay ||
            !aiAutoPlay ||
            currentTurn !== aiColor ||
            isAnimatingMove ||
            gameOver
          ) {
            return;
          }
          aiSearchInFlight = true;
          syncActionButtonsUI();
          try {
            const epSnap = enPassantTarget ? { ...enPassantTarget } : null;
            const cancelOpts = {
              timeSliceMs: 4,
              shouldCancel: () =>
                scheduledJobId !== aiJobId ||
                scriptedGameActive ||
                gameMode !== 'single' ||
                isPassAndPlay ||
                !aiAutoPlay ||
                currentTurn !== aiColor ||
                isAnimatingMove ||
                gameOver
            };
            const chosen =
              gameVariant === 'xiangqi'
                ? await chooseBestXiangqiMoveAsync(
                    extractPureXiangqiBoard(boardState),
                    aiColor,
                    aiDifficulty,
                    cancelOpts
                  )
                : await chooseBestAIMoveAsync(
                    extractPureBoard(boardState),
                    aiColor,
                    aiDifficulty,
                    epSnap,
                    cancelOpts
                  );
            if (
              !chosen ||
              scheduledJobId !== aiJobId ||
              scriptedGameActive ||
              gameMode !== 'single' ||
              isPassAndPlay ||
              !aiAutoPlay ||
              currentTurn !== aiColor ||
              isAnimatingMove ||
              gameOver
            ) {
              return;
            }
            aiSearchInFlight = false;
            executeChessMove(chosen.fromR, chosen.fromC, chosen.toR, chosen.toC, {
              promotion: chosen.promotion || 'queen'
            });
          } finally {
            if (scheduledJobId === aiJobId && aiSearchInFlight) {
              aiSearchInFlight = false;
              updateTurnUI();
            }
          }
        }, 540);
      }
    }

    // =========================================================================
    // Feature 3 (3a, 3b, 3c): Chess Notation Parser & Step-Through Choreography
    // =========================================================================
    function createInitialVirtualBoard() {
      const b = Array.from({ length: 8 }, () => Array(8).fill(null));
      const backRow = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
      for (let c = 0; c < 8; c++) {
        b[7][c] = { type: backRow[c], color: 'w', hasMoved: false };
        b[6][c] = { type: 'pawn', color: 'w', hasMoved: false };
        b[1][c] = { type: 'pawn', color: 'b', hasMoved: false };
        b[0][c] = { type: backRow[c], color: 'b', hasMoved: false };
      }
      return b;
    }

    function getVirtualLegalMovesForSquare(r, c, vBoard) {
      const piece = vBoard[r][c];
      if (!piece) return [];
      const pseudo = getPseudoMovesForPiece(r, c, vBoard);
      const legal = [];
      for (const m of pseudo) {
        const savedTarget = vBoard[m.r][m.c];
        vBoard[m.r][m.c] = piece;
        vBoard[r][c] = null;
        const inCheck = isKingInCheck(piece.color, vBoard);
        vBoard[r][c] = piece;
        vBoard[m.r][m.c] = savedTarget;
        if (!inCheck) legal.push(m);
      }
      return legal;
    }

    function parseNotationToMoves(notationText) {
      const cleaned = String(notationText || '')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/;[^\n]*/g, ' ')
        .replace(/\([^)]*\)/g, ' ');

      const rawTokens = cleaned
        .split(/\s+/)
        .map((t) => t.replace(/^\d+\.+/g, '').trim())
        .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*|\d+\.?)$/.test(t));

      const vBoard = createInitialVirtualBoard();
      let turn = 'w';
      const parsedMoves = [];
      const promoMap = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
      const sanPieceMap = { N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king', P: 'pawn' };

      for (const rawTok of rawTokens) {
        let tok = rawTok.replace(/[+#!?]+$/g, '');
        if (!tok) continue;

        let matched = null;

        // 1. Castling (O-O / 0-0 / O-O-O / 0-0-0)
        if (/^(O-O-O|0-0-0|O-O|0-0)$/i.test(tok)) {
          const isQueenside = tok.length >= 5;
          const kr = turn === 'w' ? 7 : 0;
          const fromC = 4;
          const toC = isQueenside ? 2 : 6;
          if (vBoard[kr][fromC] && vBoard[kr][fromC].type === 'king') {
            matched = {
              fromR: kr,
              fromC,
              toR: kr,
              toC,
              pieceType: 'king',
              capture: false,
              promotion: null,
              castling: isQueenside ? 'q' : 'k'
            };
          }
        }

        // 2. Coordinate / UCI notation (e.g. e2e4, e2-e4, e4xd5, g1f3, e7e8q)
        if (!matched) {
          const uciMatch = tok.match(/^([a-h])([1-8])[-x]?([a-h])([1-8])(?:=?([qrbnQRBN]))?$/);
          if (uciMatch) {
            const fromC = uciMatch[1].charCodeAt(0) - 97;
            const fromR = 8 - parseInt(uciMatch[2], 10);
            const toC = uciMatch[3].charCodeAt(0) - 97;
            const toR = 8 - parseInt(uciMatch[4], 10);
            const promoChar = uciMatch[5] ? uciMatch[5].toLowerCase() : null;
            const p = vBoard[fromR]?.[fromC];
            if (p && p.color === turn) {
              matched = {
                fromR,
                fromC,
                toR,
                toC,
                pieceType: p.type,
                capture: Boolean(vBoard[toR]?.[toC]),
                promotion: promoChar ? promoMap[promoChar] : null
              };
            }
          }
        }

        // 3. Standard Algebraic Notation (SAN: e4, exd5, Nf3, Nc6, Bc4, Qxd5, Nbd7, R1e2, e8=Q)
        if (!matched) {
          let promotion = null;
          const promoEq = tok.match(/=([QRBNqrbn])$/);
          if (promoEq) {
            promotion = promoMap[promoEq[1].toLowerCase()] || 'queen';
            tok = tok.slice(0, -2);
          }

          let pieceType = 'pawn';
          let rest = tok;
          if (/^[NBRQK]/.test(rest)) {
            pieceType = sanPieceMap[rest[0]];
            rest = rest.slice(1);
          } else if (/^P/.test(rest)) {
            pieceType = 'pawn';
            rest = rest.slice(1);
          }

          const destMatch = rest.match(/([a-h])([1-8])$/);
          if (destMatch) {
            const toC = destMatch[1].charCodeAt(0) - 97;
            const toR = 8 - parseInt(destMatch[2], 10);
            const prefix = rest.slice(0, rest.length - 2).replace(/x/g, '');

            let disambigC = null;
            let disambigR = null;
            for (const ch of prefix) {
              if (ch >= 'a' && ch <= 'h') disambigC = ch.charCodeAt(0) - 97;
              else if (ch >= '1' && ch <= '8') disambigR = 8 - parseInt(ch, 10);
            }

            const candidates = [];
            for (let r = 0; r < 8; r++) {
              for (let c = 0; c < 8; c++) {
                const p = vBoard[r][c];
                if (!p || p.color !== turn || p.type !== pieceType) continue;
                if (disambigC !== null && c !== disambigC) continue;
                if (disambigR !== null && r !== disambigR) continue;
                const legals = getVirtualLegalMovesForSquare(r, c, vBoard);
                const hit = legals.find((m) => m.r === toR && m.c === toC);
                if (hit) {
                  candidates.push({
                    fromR: r,
                    fromC: c,
                    toR,
                    toC,
                    pieceType,
                    capture: Boolean(hit.capture || vBoard[toR][toC]),
                    promotion
                  });
                }
              }
            }
            if (candidates.length > 0) {
              matched = candidates[0];
            }
          }
        }

        if (!matched) {
          console.warn('Could not parse notation token:', rawTok);
          break;
        }

        const movingPiece = vBoard[matched.fromR][matched.fromC];
        vBoard[matched.fromR][matched.fromC] = null;
        if (matched.castling) {
          const kr = matched.fromR;
          if (matched.castling === 'k') {
            vBoard[kr][5] = vBoard[kr][7];
            vBoard[kr][7] = null;
          } else {
            vBoard[kr][3] = vBoard[kr][0];
            vBoard[kr][0] = null;
          }
        }
        const finalType =
          matched.promotion ||
          (movingPiece.type === 'pawn' && (matched.toR === 0 || matched.toR === 7)
            ? 'queen'
            : movingPiece.type);
        vBoard[matched.toR][matched.toC] = {
          type: finalType,
          color: turn,
          hasMoved: true
        };

        parsedMoves.push({
          index: parsedMoves.length,
          ply: parsedMoves.length + 1,
          moveNumber: Math.floor(parsedMoves.length / 2) + 1,
          color: turn,
          san: rawTok,
          fromR: matched.fromR,
          fromC: matched.fromC,
          toR: matched.toR,
          toC: matched.toC,
          pieceType: matched.pieceType,
          capture: matched.capture,
          promotion: matched.promotion || 'queen'
        });

        turn = turn === 'w' ? 'b' : 'w';
      }

      return parsedMoves;
    }

    function updateScriptBarUI() {
      const label = document.getElementById('script-step-label');
      const statusMsg = document.getElementById('script-status-msg');
      const prevBtn = document.getElementById('btn-script-prev');
      const nextBtn = document.getElementById('btn-script-next');

      const total = scriptMoves.length;
      if (label) {
        if (total === 0) {
          label.textContent = `Move ${moveHistory.length}`;
        } else if (scriptDeviated) {
          label.textContent = `Move ${moveHistory.length} • Custom Takeover`;
        } else if (scriptCursor < total) {
          const nextSan = scriptMoves[scriptCursor].san;
          label.textContent = `Step ${scriptCursor}/${total} • Next: ${nextSan}`;
        } else {
          label.textContent = `Step ${total}/${total} (Done)`;
        }
      }
      if (prevBtn) {
        prevBtn.disabled =
          aiSearchInFlight || (moveHistory.length === 0 && !preMoveHighlightTask && !isAnimatingMove);
      }
      if (nextBtn) {
        nextBtn.disabled =
          gameOver ||
          aiSearchInFlight ||
          (!scriptDeviated && total > 0 && scriptCursor >= total && !preMoveHighlightTask);
      }
      if (statusMsg && total > 0) {
        if (scriptDeviated) {
          statusMsg.textContent = `Custom takeover active at Move ${moveHistory.length} (Use [ to step back or ] for AI move).`;
        } else {
          statusMsg.textContent = `Loaded ${total} half-moves. Step ${scriptCursor}/${total} ready (Use [ and ] to step, Arrow keys to rotate cam).`;
        }
      }
    }

    const DEFAULT_DIRECTOR_NOTATION =
      '1. e4 d5 2. exd5 Qxd5 3. Nc3 Qd8 4. d4 c6 5. Bc4 h6 6. Nf3 Bg4 7. Bxf7+ Kxf7 8. Ne5+ Ke8 9. Qxg4 Nf6 10. Qg6#';

    function loadNotationScript(notationStr, options = {}) {
      const parsed = parseNotationToMoves(notationStr);
      scriptMoves = parsed;
      scriptCursor = 0;
      scriptDeviated = false;
      scriptedGameActive = parsed.length > 0;
      const inputEl = document.getElementById('input-notation');
      if (inputEl && notationStr) {
        inputEl.value = notationStr;
      }
      resetChessBoard(Boolean(options.orientCamera), true);
      updateScriptBarUI();
      return {
        ok: parsed.length > 0,
        count: parsed.length,
        moves: parsed
      };
    }

    function completeCurrentMoveImmediately() {
      if (preMoveHighlightTask) {
        const mv = preMoveHighlightTask.move;
        const fromScriptFlag = Boolean(preMoveHighlightTask.fromScript);
        preMoveHighlightTask = null;
        executeChessMove(mv.fromR, mv.fromC, mv.toR, mv.toC, { fromScript: fromScriptFlag });
      }
      let safety = 0;
      while (activeMoveTweens.length > 0 && safety < 200) {
        safety++;
        runTweens(activeMoveTweens, 0.05, reportTweenError);
      }
    }

    function isScriptMoveLegalOnCurrentBoard(mv) {
      if (!mv) return false;
      const piece = boardState[mv.fromR]?.[mv.fromC];
      if (!piece || piece.color !== currentTurn) return false;
      const destPiece = boardState[mv.toR]?.[mv.toC];
      if (destPiece && destPiece.color === piece.color) return false;
      const legals = getLegalMovesForPiece(mv.fromR, mv.fromC);
      return legals.some((m) => m.r === mv.toR && m.c === mv.toC);
    }

    function stepScriptForward() {
      if (gameOver) return false;

      // If a move animation or pre-move highlight is currently running, finish it cleanly before advancing
      if (isAnimatingMove || preMoveHighlightTask) {
        completeCurrentMoveImmediately();
        if (gameOver) return false;
        if (!scriptDeviated && scriptMoves.length > 0 && scriptCursor >= scriptMoves.length) return false;
      }

      // If no notation script has been loaded yet and no moves have been played, parse the default script in #input-notation
      if (scriptMoves.length === 0 && moveHistory.length === 0) {
        const defaultPgn =
          document.getElementById('input-notation')?.value || DEFAULT_DIRECTOR_NOTATION;
        loadNotationScript(defaultPgn, { orientCamera: false });
      }

      cancelPendingAISearch();

      // Determine whether the next scripted move is still valid on the current board
      let nextMove = null;
      let isFromScript = false;
      if (!scriptDeviated && scriptCursor < scriptMoves.length) {
        const candidate = scriptMoves[scriptCursor];
        if (isScriptMoveLegalOnCurrentBoard(candidate)) {
          nextMove = candidate;
          isFromScript = true;
          scriptedGameActive = true;
        } else {
          scriptDeviated = true;
          scriptedGameActive = false;
        }
      }

      // If the user took over and deviated from the script, Next ] cleanly executes a smart legal move for currentTurn
      if (!nextMove) {
        if (!scriptDeviated && scriptMoves.length > 0 && scriptCursor >= scriptMoves.length) {
          return false;
        }
        const aiFallback = chooseSmartAIMove(currentTurn);
        if (!aiFallback) return false;
        nextMove = {
          fromR: aiFallback.fromR,
          fromC: aiFallback.fromC,
          toR: aiFallback.toR,
          toC: aiFallback.toC,
          color: currentTurn
        };
        isFromScript = false;
      }

      const chkHighlight = document.getElementById('chk-premove-highlight');
      const chkBoth = document.getElementById('chk-premove-both');
      const showPreHighlight = chkHighlight ? chkHighlight.checked : true;
      const highlightBothSides = chkBoth ? chkBoth.checked : false;

      // Feature 3c: When triggering moves for the player's side (or both sides if toggled),
      // first show selecting the piece and its legal destination squares before executing the move!
      if (showPreHighlight && (nextMove.color === playerColor || highlightBothSides)) {
        selectedSquare = { r: nextMove.fromR, c: nextMove.fromC };
        validMoves = getLegalMovesForPiece(nextMove.fromR, nextMove.fromC);
        showSquareHighlights(nextMove.fromR, nextMove.fromC, validMoves);
        preMoveHighlightTask = {
          move: nextMove,
          fromScript: isFromScript,
          elapsedSim: 0,
          startWallMs: performance.now(),
          duration: 0.62
        };
        updateScriptBarUI();
        return true;
      }

      return executeChessMove(nextMove.fromR, nextMove.fromC, nextMove.toR, nextMove.toC, {
        fromScript: isFromScript
      });
    }

    function stepScriptBackward() {
      if (preMoveHighlightTask) {
        preMoveHighlightTask = null;
        clearSquareHighlights();
        selectedSquare = null;
        validMoves = [];
        updateScriptBarUI();
        return true;
      }

      if (moveHistory.length === 0) {
        return false;
      }

      const lastEntry = moveHistory.pop();
      if (lastEntry) multiPlyCount = Math.max(0, multiPlyCount - 1);
      restoreBoardSnapshot(lastEntry.snapshot);
      return true;
    }

    // =========================================================================
    // Feature 1: Toggle All On-Screen UI Off/On for Clean Cinematic Recording
    // =========================================================================
    function toggleUI(forceHidden) {
      const shouldHide =
        typeof forceHidden === 'boolean'
          ? forceHidden
          : !document.body.classList.contains('cinematic-ui-hidden');
      document.body.classList.toggle('cinematic-ui-hidden', shouldHide);
      const btnHide = document.getElementById('btn-hide-ui');
      if (btnHide) {
        btnHide.textContent = shouldHide ? 'Show UI [H]' : 'Hide UI [H]';
      }
      return shouldHide;
    }

    // =========================================================================
    // Feature 4: Video-Game Style WASD + R/F Translation & Arrow-Key Rotation
    // with Configurable Speed (Default 10%) & Smooth Ease-In / Ease-Out
    // =========================================================================
    const heldCameraKeys = new Set();
    const CAM_MOVE_KEY_CODES = new Set([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'KeyR',
      'KeyF',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight'
    ]);
    let cameraKeySpeedPct = 35;
    let cameraRotSpeedPct = 35;
    const keyMoveVelocity = new THREE.Vector3(0, 0, 0);
    const keyRotVelocity = { yaw: 0, pitch: 0 };

    function setCameraKeySpeedPercent(pct) {
      const clamped = Math.max(1, Math.min(200, Math.round(Number(pct) || 10)));
      cameraKeySpeedPct = clamped;
      const sliderEl = document.getElementById('input-cam-speed');
      const valEl = document.getElementById('cam-speed-val');
      if (sliderEl && Number(sliderEl.value) !== clamped) {
        sliderEl.value = String(clamped);
      }
      if (valEl) {
        valEl.textContent = `${clamped}%`;
      }
      return cameraKeySpeedPct;
    }

    function setCameraRotSpeedPercent(pct) {
      const clamped = Math.max(1, Math.min(200, Math.round(Number(pct) || 10)));
      cameraRotSpeedPct = clamped;
      const sliderEl = document.getElementById('input-rot-speed');
      const valEl = document.getElementById('rot-speed-val');
      if (sliderEl && Number(sliderEl.value) !== clamped) {
        sliderEl.value = String(clamped);
      }
      if (valEl) {
        valEl.textContent = `${clamped}%`;
      }
      return cameraRotSpeedPct;
    }

    const camSpeedSliderEl = document.getElementById('input-cam-speed');
    if (camSpeedSliderEl) {
      camSpeedSliderEl.addEventListener('input', (e) => {
        setCameraKeySpeedPercent(e.target.value);
      });
      camSpeedSliderEl.addEventListener('change', (e) => {
        setCameraKeySpeedPercent(e.target.value);
      });
    }

    const rotSpeedSliderEl = document.getElementById('input-rot-speed');
    if (rotSpeedSliderEl) {
      rotSpeedSliderEl.addEventListener('input', (e) => {
        setCameraRotSpeedPercent(e.target.value);
      });
      rotSpeedSliderEl.addEventListener('change', (e) => {
        setCameraRotSpeedPercent(e.target.value);
      });
    }

    function isTypingInInput(el) {
      if (!el) return false;
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || el.isContentEditable) return true;
      if (tag === 'INPUT') {
        const type = (el.type || '').toLowerCase();
        return type !== 'range' && type !== 'checkbox' && type !== 'button';
      }
      return false;
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.code === 'Escape') {
        if (pendingPromotion) {
          e.preventDefault();
          hidePromotionModal();
          return;
        }
        if (
          lobbyModal?.classList.contains('open') ||
          document.getElementById('duel-room-overlay')?.classList.contains('visible')
        ) {
          e.preventDefault();
          closeLobbyModal();
          return;
        }
        if (document.getElementById('game-selector-overlay')?.classList.contains('visible')) {
          e.preventDefault();
          closeGameSelectorModal();
          return;
        }
      }
      if (isTypingInInput(document.activeElement)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (CAM_MOVE_KEY_CODES.has(e.code)) {
        if (isCameraLocked) return;
        e.preventDefault();
        heldCameraKeys.add(e.code);
        return;
      }

      if (e.code === 'KeyH' || e.code === 'KeyU') {
        e.preventDefault();
        toggleUI();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (CAM_MOVE_KEY_CODES.has(e.code)) {
        heldCameraKeys.delete(e.code);
      }
    });

    window.addEventListener('blur', () => {
      heldCameraKeys.clear();
    });

    // =========================================================================
    // Feature 7: Checkmate Rigged King Fall-Over Animation & Cathedral Overlay
    // =========================================================================
    function spawnKingFallImpact(worldPos, color) {
      const mat = color === 'w' ? whitePieceMat : blackPieceMat;
      for (let i = 0; i < 18; i++) {
        const sz = 0.015 + Math.random() * 0.028;
        const frag = new THREE.Mesh(sharedShardGeo, mat);
        frag.scale.setScalar(sz);
        frag.position.set(
          worldPos.x + (Math.random() - 0.5) * 0.14,
          BOARD_SURFACE_Y + 0.04 + Math.random() * 0.10,
          worldPos.z + (Math.random() - 0.5) * 0.14
        );
        frag.castShadow = false;
        frag.receiveShadow = false;
        scene.add(frag);
        shatterDebris.push({
          mesh: frag,
          baseScale: sz,
          vel: new THREE.Vector3(
            (Math.random() - 0.5) * 1.45,
            0.65 + Math.random() * 1.25,
            (Math.random() - 0.5) * 1.45
          ),
          rotVel: new THREE.Vector3(
            Math.random() * 8,
            Math.random() * 8,
            Math.random() * 8
          ),
          life: 1.65
        });
      }
      impactFlashLight.position.set(worldPos.x, BOARD_SURFACE_Y + 0.35, worldPos.z);
      impactFlashLight.intensity = 6.2;
    }

    function showCheckmateBanner(winnerColor, defeatedColor) {
      const overlay = document.getElementById('checkmate-overlay');
      const crownEl = document.getElementById('checkmate-crown');
      const titleEl = document.getElementById('checkmate-title');
      const subEl = document.getElementById('checkmate-subtitle');

      if (gameVariant === 'xiangqi') {
        const winnerNameXq = winnerColor === 'w' ? 'Phe Đỏ (Hồng)' : 'Phe Đen (Hắc)';
        const defeatedGeneralXq = defeatedColor === 'w' ? 'Nguyên Soái Đỏ (帥)' : 'Chủ Tướng Đen (將)';
        if (crownEl) crownEl.textContent = winnerColor === 'w' ? '帥' : '將';
        if (titleEl) titleEl.textContent = 'Tuyệt Sát (Chiếu Bí)';
        if (subEl) {
          subEl.textContent = `${winnerNameXq} Toàn Thắng • ${defeatedGeneralXq} Đã Thất Thủ`;
        }
      } else {
        const winnerName = winnerColor === 'w' ? 'White' : 'Black';
        const defeatedName = defeatedColor === 'w' ? 'White' : 'Black';
        if (crownEl) crownEl.textContent = winnerColor === 'w' ? '♔' : '♚';
        if (titleEl) titleEl.textContent = 'Checkmate';
        if (subEl) {
          subEl.textContent = `${winnerName} Triumphs • The ${defeatedName} King Has Fallen`;
        }
      }
      if (overlay) {
        overlay.classList.add('visible');
      }
      checkmateState.bannerVisible = true;
    }

    function triggerCheckmateSequence(defeatedColor = currentTurn, winnerColor = null) {
      const actualWinner = winnerColor || (defeatedColor === 'w' ? 'b' : 'w');
      const rows = getBoardRows();
      const cols = getBoardCols();
      const sqSize = getActiveSqSize();
      const halfC = (cols - 1) * 0.5;
      const halfR = (rows - 1) * 0.5;

      // Find the defeated King on the board
      let kingPiece = null;
      let kingR = -1;
      let kingC = -1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const p = boardState[r]?.[c];
          if (p && p.type === 'king' && p.color === defeatedColor) {
            kingPiece = p;
            kingR = r;
            kingC = c;
            break;
          }
        }
      }

      checkmateState.active = true;
      checkmateState.defeatedColor = defeatedColor;
      checkmateState.winnerColor = actualWinner;
      checkmateState.kingFallAngleDeg = 0;
      checkmateState.phase = 'stagger';

      if (!kingPiece || !kingPiece.mesh) {
        showCheckmateBanner(actualWinner, defeatedColor);
        return false;
      }

      // Find the checkmating attacker piece so the King falls away from the blow or into the clearest open square
      let attackerPos = null;
      if (moveHistory.length > 0) {
        const lastMv = moveHistory[moveHistory.length - 1].move;
        if (lastMv) {
          attackerPos = boardToWorld(lastMv.toR, lastMv.toC);
        }
      }
      if (!attackerPos) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const p = boardState[r]?.[c];
            if (p && p.color === actualWinner) {
              const moves = getPseudoMovesForPiece(r, c, boardState);
              if (moves.some((m) => m.r === kingR && m.c === kingC)) {
                attackerPos = boardToWorld(r, c);
                break;
              }
            }
          }
        }
      }

      const homePos = boardToWorld(kingR, kingC);
      const forwardDirZ = defeatedColor === 'b' ? 1 : -1;

      // Evaluate 16 candidate fall directions around the King to pick the clearest open path on the board
      let bestDirX = 0.24;
      let bestDirZ = forwardDirZ * 0.97;
      let bestScore = -Infinity;

      const awayFromAttacker = attackerPos
        ? new THREE.Vector2(homePos.x - attackerPos.x, homePos.z - attackerPos.z).normalize()
        : new THREE.Vector2(0.25, forwardDirZ).normalize();

      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2;
        const dx = Math.cos(ang);
        const dz = Math.sin(ang);

        // Check where the King's crown (0.50m from base) lands in board coordinates
        const tipWorldX = homePos.x + dx * 0.44;
        const tipWorldZ = homePos.z + dz * 0.44;
        const tipC = Math.round(tipWorldX / sqSize + halfC);
        const tipR = Math.round(tipWorldZ / sqSize + halfR);

        let score = 0;
        // Prefer staying inside the board surface
        if (tipR >= 0 && tipR < rows && tipC >= 0 && tipC < cols) {
          score += 40;
          const occ = boardState[tipR]?.[tipC];
          if (!occ) {
            score += 65; // Open square for the fallen King's body & crown!
          } else if (occ !== kingPiece) {
            score -= 50;
          }
        } else {
          score -= 35;
        }

        // Prefer falling away from the attacker's blow or forward-diagonally toward the center
        score += (dx * awayFromAttacker.x + dz * awayFromAttacker.y) * 18;
        score += dz * forwardDirZ * 14;

        if (score > bestScore) {
          bestScore = score;
          bestDirX = dx;
          bestDirZ = dz;
        }
      }

      const fallLen = Math.hypot(bestDirX, bestDirZ) || 1;
      const fallDirX = bestDirX / fallLen;
      const fallDirZ = bestDirZ / fallLen;

      // Highlight the defeated King's square with a crimson-and-gold Checkmate ring
      clearSquareHighlights();
      const outerRing = new THREE.Mesh(sharedCheckmateOuterGeo, sharedCheckmateOuterMat);
      outerRing.raycast = () => {};
      outerRing.position.set(homePos.x, BOARD_SURFACE_Y + 0.012, homePos.z);
      squareHighlightsGroup.add(outerRing);

      const innerRing = new THREE.Mesh(sharedCheckmateInnerGeo, sharedCheckmateInnerMat);
      innerRing.raycast = () => {};
      innerRing.position.set(homePos.x, BOARD_SURFACE_Y + 0.014, homePos.z);
      squareHighlightsGroup.add(innerRing);

      // Pause the King's idle mixer so its stone statue mesh pivots cleanly as a rigid monument
      if (kingPiece.currentAction) {
        kingPiece.currentAction.paused = true;
      }

      // Face the King toward the checkmating attacker (or forward) before toppling
      const baseYaw = attackerPos
        ? Math.atan2(attackerPos.x - homePos.x, attackerPos.z - homePos.z)
        : (defeatedColor === 'w' ? Math.PI : 0);
      const qBaseFacing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), baseYaw);
      // Right-handed horizontal axis perpendicular to fallDir so +angle pitches the King's crown toward (fallDirX, 0, fallDirZ)
      const tiltAxis = new THREE.Vector3(fallDirZ, 0, -fallDirX).normalize();
      const qTilt = new THREE.Quaternion();

      // Smoothly frame the checkmate on the board only when Free 3D Cam is unlocked AND combatCameraZoomEnabled is opted in
      if (!isCameraLocked && combatCameraZoomEnabled && heldCameraKeys.size === 0) {
        const camSideX = homePos.x >= 0 ? -1.35 : 1.35;
        const camSideZ = homePos.z + forwardDirZ * 1.45;
        smoothCameraTo(
          new THREE.Vector3(homePos.x + camSideX, BOARD_SURFACE_Y + 1.15, camSideZ),
          new THREE.Vector3(
            homePos.x + fallDirX * 0.22,
            BOARD_SURFACE_Y + 0.18,
            homePos.z + fallDirZ * 0.22
          ),
          0.95
        );
      } else {
        startKillCam(homePos, { x: fallDirX, z: fallDirZ }, forwardDirZ);
      }

      const RIM_RADIUS = 0.135;    // Pedestal bottom rim radius so the lower edge stays grounded on the board
      const MAX_FALL_RAD = 1.50;   // 86 degrees: King lies fallen on its side across the board tiles
      const tStagger = 0.36;
      const tImpact = 1.12;
      const tTotal = 1.82;

      let elapsed = 0;
      let impactTriggered = false;
      let bannerShown = false;

      function applyKingTopplePose(thetaRad, shudderRoll = 0) {
        const clampedTheta = Math.max(-0.15, Math.min(1.55, thetaRad));
        checkmateState.kingFallAngleDeg = Number(((clampedTheta * 180) / Math.PI).toFixed(1));

        const px = homePos.x + fallDirX * RIM_RADIUS * (1 - Math.cos(clampedTheta));
        const py = BOARD_SURFACE_Y + RIM_RADIUS * Math.sin(Math.max(0, clampedTheta));
        const pz = homePos.z + fallDirZ * RIM_RADIUS * (1 - Math.cos(clampedTheta));
        kingPiece.mesh.position.set(px, py, pz);

        qTilt.setFromAxisAngle(tiltAxis, clampedTheta);
        if (Math.abs(shudderRoll) > 1e-4) {
          const qShudder = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(fallDirX, 0, fallDirZ),
            shudderRoll
          );
          qTilt.multiply(qShudder);
        }
        kingPiece.mesh.quaternion.copy(qTilt).multiply(qBaseFacing);
      }

      function stepKingFall(dt) {
        if (!checkmateState.active || !kingPiece.mesh) return true;
        elapsed += dt;

        if (!bannerShown && elapsed >= 0.48) {
          bannerShown = true;
          showCheckmateBanner(actualWinner, defeatedColor);
        }

        if (elapsed <= tStagger) {
          // Phase 1: Royal Stagger & Tremor as the checkmate blow echoes through the King statue
          checkmateState.phase = 'stagger';
          const u = elapsed / tStagger;
          const shudder = Math.sin(u * Math.PI * 6) * 0.065 * (1 - u * 0.3);
          const initialLean = u * u * 0.12;
          applyKingTopplePose(initialLean, shudder);
        } else if (elapsed <= tImpact) {
          // Phase 2: Accelerating Gravity Topple around the stone pedestal rim (0.12 rad -> 1.50 rad = 86 deg)
          checkmateState.phase = 'topple';
          const u = Math.min(1, (elapsed - tStagger) / (tImpact - tStagger));
          const gravCurve = Math.pow(u, 2.25);
          const theta = 0.12 + (MAX_FALL_RAD - 0.12) * gravCurve;
          applyKingTopplePose(theta, 0);
        } else {
          // Phase 3: Heavy Stone Impact, Crown Shard Burst & Damped Restitution Bounce
          checkmateState.phase = 'impact';
          if (!impactTriggered) {
            impactTriggered = true;
            const crownImpactPos = new THREE.Vector3(
              homePos.x + fallDirX * 0.45,
              BOARD_SURFACE_Y,
              homePos.z + fallDirZ * 0.45
            );
            spawnKingFallImpact(crownImpactPos, defeatedColor);
          }

          const uBounce = Math.min(1, (elapsed - tImpact) / (tTotal - tImpact));
          const bounceAmp = 0.13 * Math.pow(1 - uBounce, 1.85);
          const theta = MAX_FALL_RAD - Math.abs(Math.sin(uBounce * Math.PI * 2.0)) * bounceAmp;
          applyKingTopplePose(theta, 0);

          // Subtle damped camera tremor when the heavy stone King crashes onto the altar board (only when combatCameraZoomEnabled is opted in)
          if (combatCameraZoomEnabled && motionLevel !== 'off' && elapsed <= tImpact + 0.28) {
            const sProg = (elapsed - tImpact) / 0.28;
            const decay = (1 - sProg) * (1 - sProg);
            camera.position.y += Math.cos(sProg * Math.PI * 8) * 0.022 * decay;
          }
        }

        if (elapsed >= tTotal) {
          applyKingTopplePose(MAX_FALL_RAD, 0);
          checkmateState.phase = 'fallen';
          if (!bannerShown) {
            showCheckmateBanner(actualWinner, defeatedColor);
          }
          return true;
        }
        return false;
      }

      for (let i = activeMoveTweens.length - 1; i >= 0; i--) {
        if (activeMoveTweens[i]._isKingFallTween) {
          activeMoveTweens.splice(i, 1);
        }
      }
      stepKingFall._isKingFallTween = true;
      activeMoveTweens.push(stepKingFall);
      return true;
    }

    // =========================================================================
    // UI & Turn Status Updates
    // =========================================================================
    function syncActionButtonsUI() {
      const btnAiMove = document.getElementById('btn-ai-move');
      const btnUndo = document.getElementById('btn-undo');
      const btnQuickUndo = document.getElementById('btn-quick-undo');
      const turnText = document.getElementById('turn-text');
      if (btnAiMove) {
        const aiBusy =
          isAnimatingMove ||
          aiSearchInFlight ||
          gameOver ||
          (gameMode === 'multi' && currentTurn !== playerColor);
        btnAiMove.disabled = aiBusy;
        btnAiMove.style.opacity = aiBusy ? '0.5' : '1';
      }
      const canUndo =
        Boolean(pendingPromotion) ||
        (gameMode !== 'multi' && moveHistory.length > 0 && !isAnimatingMove && !aiSearchInFlight);
      if (btnUndo) {
        btnUndo.disabled = !canUndo;
        btnUndo.style.opacity = canUndo ? '1' : '0.5';
      }
      if (btnQuickUndo && 'disabled' in btnQuickUndo) {
        btnQuickUndo.disabled = !canUndo;
        btnQuickUndo.style.opacity = canUndo ? '1' : '0.45';
      }
      if (turnText && !gameOver && aiSearchInFlight) {
        const turnLabel =
          gameVariant === 'xiangqi'
            ? currentTurn === 'w'
              ? 'Lượt Phe Đỏ (Hồng)'
              : 'Lượt Phe Đen (Hắc)'
            : currentTurn === 'w'
              ? 'White to Move'
              : 'Black to Move';
        turnText.textContent = `${turnLabel} (AI)...`;
      }
      if (typeof updateScriptBarUI === 'function') updateScriptBarUI();
    }

    function updateTurnUI() {
      if (typeof document !== 'undefined' && document.body) {
        document.body.dataset.gameVariant = gameVariant;
      }
      const turnDot = document.getElementById('turn-dot');
      const turnText = document.getElementById('turn-text');
      const modeBadge = document.getElementById('mode-badge');
      const btnAiMove = document.getElementById('btn-ai-move');
      const btnAiDiff = document.getElementById('btn-ai-difficulty');
      const btnAudio = document.getElementById('btn-audio-toggle');
      const btnSideToggle = document.getElementById('btn-side-toggle');
      const btnGameVariant = document.getElementById('btn-game-variant');
      const btnQuickVariant = document.getElementById('btn-quick-variant');
      const roomPill = document.getElementById('room-pill');
      const capturedTray = document.getElementById('captured-tray');

      if (btnGameVariant) {
        btnGameVariant.textContent = gameVariant === 'xiangqi' ? '🀄 Cờ Tướng 3D' : '♟️ Cờ Vua 3D';
        btnGameVariant.classList.toggle('active', gameVariant === 'xiangqi');
      }
      if (btnQuickVariant) {
        btnQuickVariant.textContent = gameVariant === 'xiangqi' ? '🀄 Tướng' : '♟️ Vua';
        btnQuickVariant.classList.toggle('active', gameVariant === 'xiangqi');
      }

      if (turnDot) {
        turnDot.className = 'turn-dot' + (currentTurn === 'b' ? ' black' : '');
      }

      updateTacticalBoardMarkers();

      const legalMoves = getAllLegalMoves(currentTurn);
      const inCheck = isKingInCheck(currentTurn, boardState);
      const drawEval =
        gameVariant === 'xiangqi'
          ? evaluateXiangqiDrawState(
              extractPureXiangqiBoard(boardState),
              currentTurn,
              halfMoveClock,
              positionHistory
            )
          : evaluateDrawState(
              extractPureBoard(boardState),
              currentTurn,
              halfMoveClock,
              positionHistory,
              enPassantTarget
            );

      if (legalMoves.length === 0) {
        gameOver = true;
        // In Xiangqi, Stalemate (Hết nước đi) is a LOSS for the stalemated player!
        if (inCheck || gameVariant === 'xiangqi') {
          drawReason = '';
          if (gameVariant === 'xiangqi') {
            const winnerXq = currentTurn === 'w' ? 'Phe Đen (Hắc)' : 'Phe Đỏ (Hồng)';
            if (turnText) turnText.textContent = `Tuyệt Sát — ${winnerXq} Thắng`;
          } else {
            const winner = currentTurn === 'w' ? 'Black' : 'White';
            if (turnText) turnText.textContent = `Checkmate — ${winner} Wins`;
          }
          if (!checkmateState.active) {
            wizardAudio.playCheckmateFanfare();
            triggerCheckmateSequence(currentTurn, currentTurn === 'w' ? 'b' : 'w');
          }
        } else {
          drawReason = 'Stalemate';
          if (turnText) turnText.textContent = 'Stalemate — Draw';
        }
      } else if (drawEval.isDraw) {
        gameOver = true;
        drawReason = drawEval.reason;
        if (turnText) {
          turnText.textContent =
            gameVariant === 'xiangqi' ? `Hòa Cờ — ${drawEval.reason}` : `Draw — ${drawEval.reason}`;
        }
      } else {
        drawReason = '';
        const turnLabel =
          gameVariant === 'xiangqi'
            ? currentTurn === 'w'
              ? 'Lượt Phe Đỏ (Hồng)'
              : 'Lượt Phe Đen (Hắc)'
            : currentTurn === 'w'
              ? 'White to Move'
              : 'Black to Move';
        const aiColor = playerColor === 'w' ? 'b' : 'w';
        const isAiTurn =
          aiSearchInFlight ||
          (!scriptedGameActive && gameMode === 'single' && !isPassAndPlay && aiAutoPlay && currentTurn === aiColor);
        if (inCheck) {
          wizardAudio.playCheckWarning();
          triggerCheckAlarm();
          if (turnText) {
            turnText.textContent =
              gameVariant === 'xiangqi' ? `${turnLabel} (Chiếu Tướng!)` : `${turnLabel} (Check!)`;
          }
        } else if (isAiTurn) {
          if (turnText) turnText.textContent = `${turnLabel} (AI)...`;
        } else {
          if (turnText) turnText.textContent = turnLabel;
        }
      }

      if (modeBadge) {
        if (gameMode === 'multi' && roomCode) {
          const sideLabel =
            gameVariant === 'xiangqi'
              ? playerColor === 'w'
                ? 'Phe Đỏ'
                : 'Phe Đen'
              : playerColor === 'w'
                ? 'White'
                : 'Black';
          const statusSuffix = roomBothReady
            ? '2/2'
            : roomInviteCopied
              ? 'Link Copied!'
              : 'Waiting';
          modeBadge.textContent = `Room ${roomCode} • ${sideLabel} (${statusSuffix})`;
        } else if (isPassAndPlay) {
          modeBadge.textContent =
            gameVariant === 'xiangqi'
              ? `2 Người • ${currentTurn === 'w' ? 'Phe Đỏ' : 'Phe Đen'}`
              : `2 Players • ${currentTurn === 'w' ? 'White' : 'Black'}`;
        } else {
          modeBadge.textContent =
            gameVariant === 'xiangqi'
              ? `Đang cầm: ${playerColor === 'w' ? 'Phe Đỏ (Hồng)' : 'Phe Đen (Hắc)'}`
              : `Playing as ${playerColor === 'w' ? 'White' : 'Black'}`;
        }
      }
      if (btnAiMove) {
        btnAiMove.style.display = 'inline-flex';
      }
      const is1PAiActive = gameMode !== 'multi' && !isPassAndPlay;
      const diffShortLabel =
        aiDifficulty === 'novice'
          ? 'Dễ'
          : aiDifficulty === 'grandmaster'
            ? 'Khó'
            : 'Vừa';
      if (btnAiDiff) {
        btnAiDiff.textContent = `🤖 Độ khó: ${diffShortLabel}`;
        btnAiDiff.classList.toggle('active', is1PAiActive);
      }
      document.querySelectorAll('[data-ai-diff]').forEach((el) => {
        const tier = el.getAttribute('data-ai-diff');
        el.classList.toggle('active', is1PAiActive && tier === aiDifficulty);
      });
      const btnDuelRoom = document.getElementById('btn-duel-room');
      const btnQuickDuel = document.getElementById('btn-quick-duel');
      const btnMenu2pPass = document.getElementById('btn-menu-2p-pass');
      const btnMenu2pOnline = document.getElementById('btn-menu-2p-online');
      if (btnDuelRoom) {
        if (gameMode === 'multi' && roomCode) {
          btnDuelRoom.textContent = `🌐 Phòng: ${roomCode}`;
          btnDuelRoom.classList.add('active');
        } else if (isPassAndPlay) {
          btnDuelRoom.textContent = '⚔️ 2 Người: Cùng Máy';
          btnDuelRoom.classList.add('active');
        } else {
          btnDuelRoom.textContent = '⚔️ Chơi 2 Người';
          btnDuelRoom.classList.remove('active');
        }
      }
      if (btnQuickDuel) {
        btnQuickDuel.classList.toggle('active', isPassAndPlay || (gameMode === 'multi' && Boolean(roomCode)));
      }
      if (btnMenu2pPass) {
        btnMenu2pPass.classList.toggle('active', isPassAndPlay && gameMode !== 'multi');
      }
      if (btnMenu2pOnline) {
        btnMenu2pOnline.classList.toggle('active', gameMode === 'multi' && Boolean(roomCode));
      }
      if (btnAudio) {
        btnAudio.textContent = wizardAudio.isMuted() ? '🔇 Âm Thanh: Tắt' : '🔊 Âm Thanh: Bật';
      }
      if (btnSideToggle) {
        btnSideToggle.style.display = 'inline-flex';
        if (gameMode === 'multi' && roomCode) {
          btnSideToggle.textContent = '🚪 Rời Phòng Online';
        } else if (isPassAndPlay) {
          btnSideToggle.textContent = autoFlipCamera2P ? 'Auto-Flip: On' : 'Auto-Flip: Off';
        } else if (gameVariant === 'xiangqi') {
          btnSideToggle.textContent = playerColor === 'w' ? 'Đổi Quân: Cầm Đen' : 'Đổi Quân: Cầm Đỏ';
        } else {
          btnSideToggle.textContent = playerColor === 'w' ? 'Đổi Quân: Cầm Đen' : 'Đổi Quân: Cầm Trắng';
        }
      }
      if (roomPill) {
        roomPill.style.display = 'none';
      }

      document.querySelectorAll('[data-set-variant]').forEach((el) => {
        const v = el.getAttribute('data-set-variant');
        el.classList.toggle('active', v === gameVariant);
      });

      if (capturedTray) {
        if (capturedByWhite > 0 || capturedByBlack > 0) {
          const matAdv = computeMaterialAdvantage();
          const wAdvStr = matAdv > 0 ? ` (+${Number.isInteger(matAdv) ? matAdv : matAdv.toFixed(1)})` : '';
          const bAdvStr = matAdv < 0 ? ` (+${Number.isInteger(-matAdv) ? -matAdv : (-matAdv).toFixed(1)})` : '';
          capturedTray.textContent =
            gameVariant === 'xiangqi'
              ? `Quân Đã Ăn — Đỏ: ${capturedByWhite}${wAdvStr} | Đen: ${capturedByBlack}${bAdvStr}`
              : `Captured — White: ${capturedByWhite}${wAdvStr} | Black: ${capturedByBlack}${bAdvStr}`;
        } else {
          capturedTray.textContent = '';
        }
      }
      updatePieceLabelUI();
      syncActionButtonsUI();
      updatePieceOverheadOverlay();
    }

    function computeMaterialAdvantage() {
      const chessVal = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
      const xiangqiVal = { pawn: 1, advisor: 2, elephant: 2, knight: 4, cannon: 4.5, rook: 9, king: 0 };
      let wScore = 0;
      let bScore = 0;
      for (let r = 0; r < getBoardRows(); r++) {
        for (let c = 0; c < getBoardCols(); c++) {
          const p = boardState[r]?.[c];
          if (!p) continue;
          let val = 0;
          if (gameVariant === 'xiangqi') {
            val = xiangqiVal[p.type] || 0;
            if (p.type === 'pawn') {
              const crossed = p.color === 'w' ? r <= 4 : r >= 5;
              if (crossed) val = 2;
            }
          } else {
            val = chessVal[p.type] || 0;
          }
          if (p.color === 'w') wScore += val;
          else bScore += val;
        }
      }
      return Number((wScore - bScore).toFixed(1));
    }

    // =========================================================================
    // Raycasting & Board Interaction (with Anti-Occlusion Ray Piercing & Touch Magnetic Assist)
    // =========================================================================
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const magneticProjVec = new THREE.Vector3();
    let pointerDownPos = { x: 0, y: 0, pointerType: 'mouse' };

    function triggerTouchHaptic(pattern) {
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(pattern);
        }
      } catch (e) {}
    }

    function extractBoardCoordsFromHit(hitObj) {
      let obj = hitObj;
      while (obj) {
        if (obj.userData && obj.userData.piece) {
          return {
            r: obj.userData.piece.r,
            c: obj.userData.piece.c,
            isPiece: true,
            isSquare: false
          };
        }
        if (obj.userData && obj.userData.isSquare) {
          return {
            r: obj.userData.r,
            c: obj.userData.c,
            isPiece: false,
            isSquare: true
          };
        }
        obj = obj.parent;
      }
      return null;
    }

    function projectBoardSquareToScreen(r, c, rect) {
      const worldPos = boardToWorld(r, c);
      magneticProjVec.set(worldPos.x, BOARD_SURFACE_Y + 0.04, worldPos.z).project(camera);
      return {
        x: rect.left + (magneticProjVec.x + 1) * 0.5 * rect.width,
        y: rect.top + (-magneticProjVec.y + 1) * 0.5 * rect.height
      };
    }

    function isLegalDestinationSquare(r, c) {
      if (!selectedSquare || !validMoves || validMoves.length === 0) return false;
      return validMoves.some(
        (m) => (m.r === r && m.c === c) || (m.castle && m.r === r && m.rookFromC === c)
      );
    }

    // The first gesture anywhere (HUD buttons included) starts audio, so the first move does not stall on context start-up.
    const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'];
    const unlockAudioOnGesture = () => {
      if (!wizardAudio.unlock()) return;
      if (wizardAudio.getState().contextState !== 'running') return;
      for (const type of AUDIO_UNLOCK_EVENTS) {
        document.removeEventListener(type, unlockAudioOnGesture, { capture: true });
      }
    };
    for (const type of AUDIO_UNLOCK_EVENTS) {
      document.addEventListener(type, unlockAudioOnGesture, { capture: true, passive: true });
    }

    renderer.domElement.addEventListener('pointerdown', (e) => {
      wizardAudio.unlock();
      pointerDownPos = {
        x: e.clientX,
        y: e.clientY,
        pointerType: e.pointerType || 'mouse'
      };
    });

    const hoverRayTargets = [];

    function processPendingHover() {
      // While a move or the kill-cam plays, keep the last pointer position so it is picked once the scene settles.
      if (!hoverPending || isAnimatingMove || cinematicActive) return;
      const { x, y } = hoverPending;
      hoverPending = null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((x - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((y - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      // Piece hitboxes are cheap cylinder proxies (never the skinned meshes), so hovering a piece's body picks that piece.
      hoverRayTargets.length = 0;
      for (let r = 0; r < getBoardRows(); r++) {
        for (let c = 0; c < getBoardCols(); c++) {
          const p = boardState[r]?.[c];
          if (p && p.hitbox) hoverRayTargets.push(p.hitbox);
        }
      }
      for (const sq of getActiveBoardSquareMeshes()) hoverRayTargets.push(sq);
      const hits = raycaster.intersectObjects(hoverRayTargets, false);
      const coords = hits.length > 0 ? extractBoardCoordsFromHit(hits[0].object) : null;
      const next = coords && boardState[coords.r]?.[coords.c] ? { r: coords.r, c: coords.c } : null;
      if (next?.r !== hoveredSquare?.r || next?.c !== hoveredSquare?.c) {
        hoveredSquare = next;
        updatePieceOverheadOverlay();
      }
    }

    if (hoverCapable) {
      renderer.domElement.addEventListener(
        'pointermove',
        (e) => {
          if (e.pointerType === 'touch') return;
          hoverPending = { x: e.clientX, y: e.clientY };
        },
        { passive: true }
      );
      renderer.domElement.addEventListener('pointerleave', () => {
        hoverPending = null;
        if (hoveredSquare) {
          hoveredSquare = null;
          updatePieceOverheadOverlay();
        }
      });
    }

    renderer.domElement.addEventListener('pointerup', (e) => {
      const moveDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      const maxClickDrift = isCameraLocked ? 22 : 6;
      const isTouchEvent =
        e.pointerType === 'touch' ||
        pointerDownPos.pointerType === 'touch' ||
        Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
      const effectiveClickDrift = isTouchEvent ? (isCameraLocked ? 32 : 18) : maxClickDrift;
      if (moveDist > effectiveClickDrift) return;
      if (isAnimatingMove || aiSearchInFlight || gameOver || pendingPromotion) return;

      // Enforce turn ownership in Multiplayer, and in Single Player only block while AI auto-move timer or async search is actively pending
      if (gameMode === 'multi' && currentTurn !== playerColor) return;
      if (
        !scriptedGameActive &&
        gameMode === 'single' &&
        currentTurn !== playerColor &&
        (aiTimer !== null || aiSearchInFlight)
      ) {
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);

      const pieceHitboxProxies = [];
      const rows = getBoardRows();
      const cols = getBoardCols();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const p = boardState[r]?.[c];
          if (p && p.hitbox) {
            if (p.mesh) p.mesh.updateMatrixWorld(true);
            pieceHitboxProxies.push(p.hitbox);
          }
        }
      }

      const hits =
        gameVariant === 'xiangqi'
          ? raycaster.intersectObjects([...pieceHitboxProxies, ...getActiveBoardSquareMeshes()], false)
          : raycaster.intersectObjects([...pieceHitboxProxies, ...boardSquareMeshes], false);

      let clickedR = -1;
      let clickedC = -1;
      if (hits.length > 0) {
        const primary = extractBoardCoordsFromHit(hits[0].object);
        if (primary) {
          clickedR = primary.r;
          clickedC = primary.c;
        }

        // Stage 1: Anti-Occlusion Ray Piercing when a piece is already selected and a foreground statue occludes a valid destination square behind it
        if (selectedSquare && !isLegalDestinationSquare(clickedR, clickedC) && hits.length > 1) {
          for (let i = 1; i < hits.length; i++) {
            const cand = extractBoardCoordsFromHit(hits[i].object);
            if (cand && isLegalDestinationSquare(cand.r, cand.c)) {
              const fgPiece = clickedR >= 0 && clickedC >= 0 ? boardState[clickedR]?.[clickedC] : null;
              let preferForegroundFriendly = false;
              if (
                fgPiece &&
                fgPiece.color === currentTurn &&
                !(clickedR === selectedSquare.r && clickedC === selectedSquare.c)
              ) {
                const fgScreen = projectBoardSquareToScreen(clickedR, clickedC, rect);
                const legalScreen = projectBoardSquareToScreen(cand.r, cand.c, rect);
                const dFg = Math.hypot(e.clientX - fgScreen.x, e.clientY - fgScreen.y);
                const dLegal = Math.hypot(e.clientX - legalScreen.x, e.clientY - legalScreen.y);
                if (dFg < dLegal * 0.85) {
                  preferForegroundFriendly = true;
                }
              }
              if (!preferForegroundFriendly) {
                clickedR = cand.r;
                clickedC = cand.c;
              }
              break;
            }
          }
        }
      }

      // Stage 2: Screen-Space Magnetic Legal-Move Assist on Touch (28px tolerance around valid destination centers)
      if (selectedSquare && !isLegalDestinationSquare(clickedR, clickedC) && isTouchEvent) {
        let bestMove = null;
        let bestDistPx = 28;
        for (const m of validMoves) {
          const sc = projectBoardSquareToScreen(m.r, m.c, rect);
          const dPx = Math.hypot(e.clientX - sc.x, e.clientY - sc.y);
          if (dPx <= bestDistPx) {
            bestDistPx = dPx;
            bestMove = m;
          }
        }
        if (bestMove) {
          const hitPiece = clickedR >= 0 && clickedC >= 0 ? boardState[clickedR]?.[clickedC] : null;
          let keepFriendlySwitch = false;
          if (
            hitPiece &&
            hitPiece.color === currentTurn &&
            !(clickedR === selectedSquare.r && clickedC === selectedSquare.c)
          ) {
            const fgSc = projectBoardSquareToScreen(clickedR, clickedC, rect);
            const dFg = Math.hypot(e.clientX - fgSc.x, e.clientY - fgSc.y);
            if (dFg < bestDistPx) {
              keepFriendlySwitch = true;
            }
          }
          if (!keepFriendlySwitch) {
            clickedR = bestMove.r;
            clickedC = bestMove.c;
          }
        }
      }

      // Stage 3: Touch Piece Selection & Enemy-Inspect Magnetic Assist (24px tolerance when tapping slightly beside any piece)
      if (!selectedSquare && clickedR === -1 && isTouchEvent) {
        let bestPieceR = -1;
        let bestPieceC = -1;
        let bestPieceDistPx = 24;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const p = boardState[r]?.[c];
            if (p) {
              const sc = projectBoardSquareToScreen(r, c, rect);
              const rawDist = Math.hypot(e.clientX - sc.x, e.clientY - sc.y);
              const dPx = p.color === currentTurn ? Math.max(0, rawDist - 3) : rawDist;
              if (rawDist <= 24 && dPx <= bestPieceDistPx) {
                bestPieceDistPx = dPx;
                bestPieceR = r;
                bestPieceC = c;
              }
            }
          }
        }
        if (bestPieceR !== -1) {
          clickedR = bestPieceR;
          clickedC = bestPieceC;
        }
      }

      if (clickedR === -1) {
        if (preMoveHighlightTask) preMoveHighlightTask = null;
        clearSquareHighlights();
        selectedSquare = null;
        inspectedSquare = null;
        validMoves = [];
        updatePieceOverheadOverlay();
        return;
      }

      // Cancel any pending scripted pre-move highlight timer when the user manually interacts with the board
      if (preMoveHighlightTask) {
        preMoveHighlightTask = null;
      }

      if (selectedSquare) {
        const move = validMoves.find(
          (m) =>
            (m.r === clickedR && m.c === clickedC) ||
            (m.castle && m.r === clickedR && m.rookFromC === clickedC)
        );
        if (move) {
          if (isTouchEvent) {
            triggerTouchHaptic(move.capture ? [16, 24, 20] : 12);
          }
          const movingPiece = boardState[selectedSquare.r]?.[selectedSquare.c];
          if (
            gameVariant !== 'xiangqi' &&
            movingPiece &&
            movingPiece.type === 'pawn' &&
            (move.r === 0 || move.r === 7)
          ) {
            const promoOverlay = document.getElementById('promotion-overlay');
            if (promoOverlay) {
              openPromotionModal(selectedSquare.r, selectedSquare.c, move.r, move.c, currentTurn);
              return;
            }
          }
          executeChessMove(selectedSquare.r, selectedSquare.c, move.r, move.c);
          return;
        }
      }

      const clickedPiece = boardState[clickedR][clickedC];
      if (clickedPiece && clickedPiece.color === currentTurn) {
        if (isTouchEvent) {
          triggerTouchHaptic(8);
        }
        selectedSquare = { r: clickedR, c: clickedC };
        inspectedSquare = { r: clickedR, c: clickedC };
        validMoves = getLegalMovesForPiece(clickedR, clickedC);
        showSquareHighlights(clickedR, clickedC, validMoves);
        updatePieceOverheadOverlay();
      } else if (clickedPiece) {
        // Clicked an enemy piece (not a legal capture target for current selectedSquare):
        // Inspect this enemy piece so new players immediately see its name, role, and move hint!
        if (isTouchEvent) {
          triggerTouchHaptic(6);
        }
        clearSquareHighlights();
        selectedSquare = null;
        validMoves = [];
        inspectedSquare = { r: clickedR, c: clickedC };
        showEnemyInspectHighlight(clickedR, clickedC);
        updatePieceOverheadOverlay();
      } else {
        clearSquareHighlights();
        selectedSquare = null;
        inspectedSquare = null;
        validMoves = [];
        updatePieceOverheadOverlay();
      }
    });

    // =========================================================================
    // Multiplayer Room Synchronization (Same-Origin API + Static Site Fallback)
    // =========================================================================
    const CLOUD_MP_API_BASE = '';
    const isStaticHost =
      window.location.hostname.includes('zipline') ||
      window.location.hostname.includes('github.io') ||
      window.location.protocol === 'file:';

    let staticBroadcastChannel = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        staticBroadcastChannel = new BroadcastChannel('wizard_chess_mp_channel');
        staticBroadcastChannel.onmessage = (ev) => {
          const msg = ev.data;
          if (msg && msg.type === 'room_state' && msg.room && msg.room.code === roomCode) {
            applyRemoteRoomState(msg.room);
          }
        };
      }
    } catch (e) {}

    window.addEventListener('storage', (ev) => {
      if (ev.key === `wizard_chess_room_${roomCode}` && ev.newValue) {
        try {
          applyRemoteRoomState(JSON.parse(ev.newValue));
        } catch (e) {}
      }
    });

    function getStaticRoom(code) {
      try {
        const raw = localStorage.getItem(`wizard_chess_room_${code}`);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }

    function saveAndBroadcastStaticRoom(room) {
      try {
        localStorage.setItem(`wizard_chess_room_${room.code}`, JSON.stringify(room));
      } catch (e) {}
      try {
        if (staticBroadcastChannel) {
          staticBroadcastChannel.postMessage({ type: 'room_state', room });
        }
      } catch (e) {}
    }

    function ensurePlayerToken() {
      if (!playerToken) {
        playerToken =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : 'tok_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
        saveStoredPlayerToken(playerToken);
      }
      return playerToken;
    }

    async function mpApiRequest(apiPath, options = {}) {
      const bases = isStaticHost
        ? (CLOUD_MP_API_BASE ? [CLOUD_MP_API_BASE] : [])
        : (CLOUD_MP_API_BASE ? ['', CLOUD_MP_API_BASE] : ['']);
      for (const base of bases) {
        try {
          const res = await fetch(`${base}${apiPath}`, options);
          const ct = res.headers.get('content-type') || '';
          // Any JSON answer (including 4xx rejections) comes from a live room server.
          if (ct.includes('application/json')) {
            return await res.json();
          }
        } catch (e) {}
      }
      return null;
    }

    function showRoomApiError(message) {
      const mpMsg = document.getElementById('mp-status-msg');
      if (mpMsg) mpMsg.textContent = message;
      const duelStatusEl = document.getElementById('duel-status-msg');
      if (duelStatusEl) duelStatusEl.textContent = `Máy chủ phòng từ chối: ${message}`;
    }

    function pushStaticRoomMove(movePayload) {
      const stRoom = getStaticRoom(roomCode);
      if (!stRoom) return;
      stRoom.moves = stRoom.moves || [];
      stRoom.moves.push({
        seq: stRoom.moves.length + 1,
        color: movePayload.color,
        from: movePayload.from,
        to: movePayload.to,
        promotion: movePayload.promotion || 'queen',
        ts: Date.now()
      });
      stRoom.turn = movePayload.color === 'w' ? 'b' : 'w';
      stRoom.updatedAt = Date.now();
      saveAndBroadcastStaticRoom(stRoom);
    }

    async function sendMultiplayerMove(movePayload) {
      if (!roomCode) return;
      // Static hosts have no room server; share the move with other tabs right away.
      if (isStaticHost) pushStaticRoomMove(movePayload);
      const data = await mpApiRequest(`/api/rooms/${roomCode}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(movePayload)
      });
      if (data === null) {
        // Server unreachable: the static localStorage/BroadcastChannel room carries the game.
        if (!isStaticHost) pushStaticRoomMove(movePayload);
        return;
      }
      if (!data.ok) {
        // Only the server's move list is authoritative; a rejected move must not reach other tabs.
        if (data.room) {
          saveAndBroadcastStaticRoom(data.room);
          resyncFromRoomMoves(data.room);
        }
        showRoomApiError(data.error || 'Move rejected');
      }
    }

    function stopMultiplayerSync() {
      if (roomEventSource) {
        roomEventSource.close();
        roomEventSource = null;
      }
      if (roomPollTimer) {
        clearInterval(roomPollTimer);
        roomPollTimer = null;
      }
      remoteSyncSession += 1;
      remoteDrainActive = false;
      latestRemoteRoom = null;
    }

    function drainRemoteMoves(session) {
      if (remoteDrainActive) return;
      remoteDrainActive = true;
      const step = () => {
        if (session !== remoteSyncSession || gameMode !== 'multi') {
          if (session === remoteSyncSession) remoteDrainActive = false;
          return;
        }
        const room = latestRemoteRoom;
        // A variant switch loads models asynchronously; wait for it like an animation.
        if (isAnimatingMove || variantSwitchPending) {
          setTimeout(step, 120);
          return;
        }
        const moves = room?.moves || [];
        if (appliedMoveSeq >= moves.length) {
          remoteDrainActive = false;
          return;
        }
        const next = moves[appliedMoveSeq];
        const piece = boardState[next.from.r]?.[next.from.c];
        const inSync =
          multiPlyCount === appliedMoveSeq && piece && piece.color === currentTurn && piece.color === next.color;
        if (!inSync) {
          remoteDrainActive = false;
          resyncFromRoomMoves(room);
          return;
        }
        executeChessMove(next.from.r, next.from.c, next.to.r, next.to.c, {
          fromRemote: true,
          promotion: next.promotion || 'queen'
        });
        appliedMoveSeq = next.seq;
        setTimeout(step, 250);
      };
      step();
    }

    function resyncFromRoomMoves(room) {
      if (!room || !Array.isArray(room.moves) || variantSwitchPending) return false;
      remoteSyncSession += 1;
      remoteDrainActive = false;
      lastResyncAt = performance.now();
      if (isAnimatingMove) completeCurrentMoveImmediately();
      resetChessBoard(false);
      appliedMoveSeq = 0;
      for (const move of room.moves) {
        const applied = executeChessMove(move.from.r, move.from.c, move.to.r, move.to.c, {
          fromRemote: true,
          promotion: move.promotion || 'queen'
        });
        if (applied !== false) completeCurrentMoveImmediately();
        if (applied === false || isAnimatingMove) {
          console.error('Room resync stopped at an unplayable move', room.code, move.seq);
          return false;
        }
        appliedMoveSeq = move.seq;
      }
      console.warn('Room resynced from server move list', room.code, room.moves.length);
      return true;
    }

    function applyRemoteRoomState(room) {
      if (!room) return;
      if (roomCode && room.code && room.code !== roomCode) return;
      latestRemoteRoom = room;
      const statusEl = document.getElementById('hud-room-status');
      const bothReady = Boolean(room.whiteJoined && room.blackJoined);
      const prevBothReady = roomBothReady;
      roomBothReady = bothReady;
      if (bothReady) {
        roomInviteCopied = false;
      }
      if (statusEl) {
        statusEl.textContent = bothReady ? '2/2 Connected' : 'Waiting for Opponent';
      }
      const mpMsg = document.getElementById('mp-status-msg');
      if (mpMsg && roomCode) {
        mpMsg.textContent = bothReady
          ? `Both players connected to Room ${room.code}!`
          : `Room ${room.code} ready — waiting for second player to join...`;
      }
      const duelCodeEl = document.getElementById('duel-room-code');
      if (duelCodeEl && room.code) {
        duelCodeEl.textContent = room.code;
      }
      const duelBoxEl = document.getElementById('duel-active-room-box');
      if (duelBoxEl && room.code) {
        duelBoxEl.style.display = 'block';
      }
      const duelStatusEl = document.getElementById('duel-status-msg');
      if (duelStatusEl && room.code) {
        duelStatusEl.textContent = bothReady
          ? `Đã kết nối đủ 2/2 người chơi tại phòng ${room.code}! Bắt đầu trận đấu.`
          : `Phòng ${room.code} đã sẵn sàng — gửi mã ${room.code} hoặc link mời cho người thứ 2...`;
      }
      if (prevBothReady !== bothReady) {
        updateTurnUI();
        if (bothReady) {
          closeLobbyModal();
        }
      }

      if (room.gameVariant === 'xiangqi' || room.gameVariant === 'chess') {
        if (room.gameVariant !== gameVariant) {
          gameVariant = room.gameVariant;
          chessBoardDeckGroup.visible = gameVariant === 'chess';
          xiangqiBoardDeckGroup.visible = gameVariant === 'xiangqi';
          remoteSyncSession += 1;
          remoteDrainActive = false;
          if (gameVariant === 'xiangqi') {
            // The board still holds the old variant until the models load; hold remote moves until then.
            variantSwitchPending = true;
            ensureXiangqiModelsLoaded().then(() => {
              resetChessBoard(false);
              appliedMoveSeq = 0;
              variantSwitchPending = false;
              if (latestRemoteRoom && gameMode === 'multi') drainRemoteMoves(remoteSyncSession);
            });
          } else {
            variantSwitchPending = false;
            resetChessBoard(false);
            appliedMoveSeq = 0;
          }
        }
      }

      if (room.whiteSkin && PIECE_THEMES[room.whiteSkin] && room.whiteSkin !== activeSkinWhite) {
        applyPieceTheme(room.whiteSkin, 'w');
      }
      if (room.blackSkin && PIECE_THEMES[room.blackSkin] && room.blackSkin !== activeSkinBlack) {
        applyPieceTheme(room.blackSkin, 'b');
      }

      if (room.resetCount > appliedResetCount) {
        appliedResetCount = room.resetCount;
        remoteSyncSession += 1;
        remoteDrainActive = false;
        appliedMoveSeq = 0;
        resetChessBoard(false);
      }

      if (Array.isArray(room.moves) && room.moves.length > appliedMoveSeq) {
        drainRemoteMoves(remoteSyncSession);
      }
    }

    function startMultiplayerSync(code) {
      stopMultiplayerSync();
      roomCode = code;

      if (!isStaticHost) {
        try {
          roomEventSource = new EventSource(`/api/rooms/${code}/events`);
          roomEventSource.onmessage = (ev) => {
            try {
              const data = JSON.parse(ev.data);
              if (data.room) applyRemoteRoomState(data.room);
            } catch (e) {}
          };
        } catch (e) {}
      }

      roomPollTimer = setInterval(async () => {
        if (gameMode !== 'multi' || !roomCode) return;
        const data = await mpApiRequest(
          `/api/rooms/${roomCode}/state?playerToken=${encodeURIComponent(playerToken)}`
        );
        if (data && data.ok && data.room) {
          saveAndBroadcastStaticRoom(data.room);
          applyRemoteRoomState(data.room);
          return;
        }
        const stRoom = getStaticRoom(roomCode);
        if (stRoom) {
          applyRemoteRoomState(stRoom);
        }
      }, 1500);
    }

    async function createMultiplayerRoom(preferredColor) {
      const mpMsg = document.getElementById('mp-status-msg');
      if (mpMsg) mpMsg.textContent = 'Creating room...';
      const duelStatusEl = document.getElementById('duel-status-msg');
      if (duelStatusEl) duelStatusEl.textContent = 'Đang tạo phòng mới...';
      ensurePlayerToken();

      let data = await mpApiRequest('/api/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredColor,
          playerToken,
          skinId: preferredColor === 'b' ? activeSkinBlack : activeSkinWhite,
          gameVariant
        })
      });

      if (data && !data.ok) {
        showRoomApiError(data.error || 'Could not create room');
        return false;
      }

      // Pure static fallback if neither local nor remote server is reachable
      if (!data) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let genCode = '';
        for (let i = 0; i < 4; i++) {
          genCode += chars[Math.floor(Math.random() * chars.length)];
        }
        const side = preferredColor === 'b' ? 'b' : 'w';
        const staticRoom = {
          code: genCode,
          status: 'waiting',
          gameVariant,
          whiteJoined: side === 'w',
          blackJoined: side === 'b',
          whiteSkin: side === 'w' ? activeSkinWhite : 'hogwarts',
          blackSkin: side === 'b' ? activeSkinBlack : 'hogwarts',
          whiteToken: side === 'w' ? playerToken : null,
          blackToken: side === 'b' ? playerToken : null,
          turn: 'w',
          moves: [],
          resetCount: 0,
          updatedAt: Date.now()
        };
        saveAndBroadcastStaticRoom(staticRoom);
        data = {
          ok: true,
          code: genCode,
          color: side,
          playerToken,
          room: staticRoom
        };
      } else if (data.room) {
        saveAndBroadcastStaticRoom(data.room);
      }

      playerToken = data.playerToken;
      saveStoredPlayerToken(playerToken);
      scriptedGameActive = false;
      gameMode = 'multi';
      isPassAndPlay = false;
      aiAutoPlay = false;
      playerColor = data.color;
      roomCode = data.code;
      appliedMoveSeq = 0;
      appliedResetCount = data.room.resetCount || 0;
      roomBothReady = Boolean(data.room.whiteJoined && data.room.blackJoined);
      roomInviteCopied = false;

      const modalRoomCodeEl = document.getElementById('modal-room-code');
      if (modalRoomCodeEl) modalRoomCodeEl.textContent = roomCode;
      const roomCreatedPanelEl = document.getElementById('room-created-panel');
      if (roomCreatedPanelEl) roomCreatedPanelEl.style.display = 'block';
      const duelRoomCodeEl = document.getElementById('duel-room-code');
      if (duelRoomCodeEl) duelRoomCodeEl.textContent = roomCode;
      const duelActiveBoxEl = document.getElementById('duel-active-room-box');
      if (duelActiveBoxEl) duelActiveBoxEl.style.display = 'block';

      resetChessBoard(true);
      startMultiplayerSync(roomCode);
      applyRemoteRoomState(data.room);
      window.history.replaceState({}, '', `?room=${roomCode}`);
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(window.location.href);
          roomInviteCopied = true;
        }
      } catch (e) {}
      if (duelStatusEl) {
        duelStatusEl.textContent = roomInviteCopied
          ? `Đã tạo phòng ${roomCode} (Đã tự động sao chép link mời!)`
          : `Đã tạo phòng ${roomCode} — gửi mã này cho người thứ 2!`;
      }
      updateTurnUI();
      return roomCode;
    }

    async function joinMultiplayerRoom(codeInput) {
      const code = String(codeInput || '').trim().toUpperCase();
      const mpMsg = document.getElementById('mp-status-msg');
      const duelStatusEl = document.getElementById('duel-status-msg');
      if (!code) {
        if (mpMsg) mpMsg.textContent = 'Please enter a 4-character Room Code.';
        if (duelStatusEl) duelStatusEl.textContent = 'Vui lòng nhập mã phòng gồm 4 ký tự!';
        return false;
      }
      if (mpMsg) mpMsg.textContent = `Joining room ${code}...`;
      if (duelStatusEl) duelStatusEl.textContent = `Đang kết nối vào phòng ${code}...`;
      ensurePlayerToken();

      let data = await mpApiRequest('/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, playerToken, skinId: currentPieceThemeId })
      });

      if (data && !data.ok) {
        showRoomApiError(data.error || 'Could not join room');
        return false;
      }

      if (!data) {
        let stRoom = getStaticRoom(code);
        let assignedColor = 'b';
        if (!stRoom) {
          assignedColor = 'w';
          stRoom = {
            code,
            status: 'waiting',
            whiteJoined: true,
            blackJoined: false,
            whiteToken: playerToken,
            blackToken: null,
            turn: 'w',
            moves: [],
            resetCount: 0,
            updatedAt: Date.now()
          };
        } else {
          if (stRoom.whiteToken === playerToken) {
            assignedColor = 'w';
            stRoom.whiteJoined = true;
          } else if (stRoom.blackToken === playerToken) {
            assignedColor = 'b';
            stRoom.blackJoined = true;
          } else if (!stRoom.whiteJoined) {
            stRoom.whiteJoined = true;
            stRoom.whiteToken = playerToken;
            assignedColor = 'w';
          } else {
            stRoom.blackJoined = true;
            stRoom.blackToken = playerToken;
            assignedColor = 'b';
          }
          stRoom.status = stRoom.whiteJoined && stRoom.blackJoined ? 'playing' : 'waiting';
          stRoom.updatedAt = Date.now();
        }
        saveAndBroadcastStaticRoom(stRoom);
        data = {
          ok: true,
          code,
          color: assignedColor,
          playerToken,
          room: stRoom
        };
      } else if (data.room) {
        saveAndBroadcastStaticRoom(data.room);
      }

      playerToken = data.playerToken;
      saveStoredPlayerToken(playerToken);
      scriptedGameActive = false;
      gameMode = 'multi';
      isPassAndPlay = false;
      aiAutoPlay = false;
      playerColor = data.color;
      roomCode = data.code;
      appliedMoveSeq = 0;
      appliedResetCount = data.room.resetCount || 0;
      roomBothReady = Boolean(data.room.whiteJoined && data.room.blackJoined);
      roomInviteCopied = false;

      resetChessBoard(true);
      startMultiplayerSync(roomCode);
      applyRemoteRoomState(data.room);
      window.history.replaceState({}, '', `?room=${roomCode}`);
      updateTurnUI();
      closeLobbyModal();
      return true;
    }

    // =========================================================================
    // Camera Presets & HUD Controls
    // =========================================================================
    const camButtons = [
      'btn-cam-spectator',
      'btn-cam-player',
      'btn-cam-top',
      'btn-cam-side',
      'btn-cam-wide'
    ];

    function setActiveCamButton(activeId) {
      camPresetActiveCleared = false;
      for (const id of camButtons) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', id === activeId);
      }
      const btnQuickCam = document.getElementById('btn-quick-cam');
      if (btnQuickCam) {
        btnQuickCam.classList.toggle('active', activeId === 'btn-cam-spectator' || activeId === 'btn-cam-top');
        btnQuickCam.textContent = activeId === 'btn-cam-top' ? '📐 Góc: Top' : '📐 Góc: 3D';
      }
    }

    let playerCamSide = 'w';     // toggles 'w' (White) <-> 'b' (Black) on repeat click of Player Cam
    let spectatorCamSide = 'w';  // toggles 'w' (White) <-> 'b' (Black) on repeat click of the 3/4 view
    let overheadCamSide = 'w';   // toggles 'w' (White) <-> 'b' (Black) on repeat click of Overhead
    let sideCamSide = 'east';    // toggles 'east' (+X) <-> 'west' (-X) on repeat click of Side
    let cathedralWideSide = 'north'; // toggles 'north' (Rose Window) <-> 'south' (Narthex Triptych) on repeat click of Cathedral

    /** Screen positions (NDC) of the four outer corners of the board top surface. */
    function projectBoardCorners() {
      const halfW = (getBoardCols() * getActiveSqSize()) / 2;
      const halfD = (getBoardRows() * getActiveSqSize()) / 2;
      camera.updateMatrixWorld();
      return [
        [-halfW, -halfD],
        [halfW, -halfD],
        [-halfW, halfD],
        [halfW, halfD]
      ].map(([x, z]) => {
        const v = new THREE.Vector3(x, BOARD_SURFACE_Y, z).project(camera);
        return [Number(v.x.toFixed(3)), Number(v.y.toFixed(3))];
      });
    }

    function boardCornerState() {
      const boardCornerNdc = projectBoardCorners();
      return {
        boardCornerNdc,
        boardCornersInView: boardCornerNdc.every(([x, y]) => Math.abs(x) <= 0.96 && Math.abs(y) <= 0.92)
      };
    }

    function setCameraPose(posArr, targetArr) {
      activeCamTransition = null;
      if (Array.isArray(posArr) && posArr.length === 3) {
        camera.position.set(posArr[0], posArr[1], posArr[2]);
      }
      if (Array.isArray(targetArr) && targetArr.length === 3) {
        orbitControls.target.set(targetArr[0], targetArr[1], targetArr[2]);
      }
      enforceCathedralBoundsAndSolidColumns(null, camera.position, orbitControls.target);
      flushOrbitControlsDamping();
    }

    function setCameraPreset(preset) {
      const tPortrait = syncResponsiveCameraFov();
      if (preset === 'player') {
        const wasPlayerActive = document.getElementById('btn-cam-player')?.classList.contains('active');
        const expectedY = 3.82 + tPortrait * 3.03;
        const expectedZ = (playerCamSide === 'b' ? -1 : 1) * (3.58 + tPortrait * 2.10);
        const isNearCurrentSeat =
          Math.hypot(camera.position.x, camera.position.y - expectedY, camera.position.z - expectedZ) < 0.45;
        if (wasPlayerActive && isNearCurrentSeat) {
          playerCamSide = playerCamSide === 'w' ? 'b' : 'w';
        } else {
          playerCamSide = playerColor === 'b' ? 'b' : 'w';
        }
        setActiveCamButton('btn-cam-player');
        setCameraForSide(playerCamSide, false);
      } else if (preset === 'spectator') {
        const wasSpectatorActive = document.getElementById('btn-cam-spectator')?.classList.contains('active');
        if (wasSpectatorActive) {
          spectatorCamSide = spectatorCamSide === 'w' ? 'b' : 'w';
        } else {
          spectatorCamSide = playerColor === 'b' ? 'b' : 'w';
        }
        setActiveCamButton('btn-cam-spectator');
        const pose = getSpectatorPose(spectatorCamSide, tPortrait);
        smoothCameraTo(pose.pos, pose.lookAt, 0.75);
      } else if (preset === 'top') {
        const wasTopActive = document.getElementById('btn-cam-top')?.classList.contains('active');
        if (wasTopActive) {
          overheadCamSide = overheadCamSide === 'w' ? 'b' : 'w';
        } else {
          overheadCamSide = playerColor === 'b' ? 'b' : 'w';
        }
        setActiveCamButton('btn-cam-top');
        const zSign = overheadCamSide === 'b' ? -1 : 1;
        smoothCameraTo(
          new THREE.Vector3(0, 7.35 + tPortrait * 1.45, zSign * (3.95 + tPortrait * 0.45)),
          new THREE.Vector3(0, 0.78, zSign * (-tPortrait * 0.28)),
          0.75
        );
      } else if (preset === 'side') {
        const wasSideActive = document.getElementById('btn-cam-side')?.classList.contains('active');
        if (wasSideActive) {
          sideCamSide = sideCamSide === 'east' ? 'west' : 'east';
        } else {
          sideCamSide = 'east';
        }
        setActiveCamButton('btn-cam-side');
        const xSign = sideCamSide === 'west' ? -1 : 1;
        smoothCameraTo(
          new THREE.Vector3(xSign * (3.45 + tPortrait * 1.35), 2.25 + tPortrait * 0.85, 0),
          new THREE.Vector3(0, 0.84, 0),
          0.75
        );
      } else if (preset === 'wide') {
        const wasWideActive = document.getElementById('btn-cam-wide')?.classList.contains('active');
        if (wasWideActive) {
          cathedralWideSide = cathedralWideSide === 'north' ? 'south' : 'north';
        } else {
          cathedralWideSide = playerColor === 'b' ? 'south' : 'north';
        }
        setActiveCamButton('btn-cam-wide');
        if (cathedralWideSide === 'south') {
          // Black's wide Cathedral perspective looking South toward the Narthex Triptych (chessboard centered in frame)
          smoothCameraTo(new THREE.Vector3(0, 2.55, -6.65), new THREE.Vector3(0, 1.95, 2.50), 0.85);
        } else {
          // White's wide Cathedral perspective looking North toward the Rose Window (chessboard centered in frame)
          smoothCameraTo(new THREE.Vector3(0, 2.55, 6.65), new THREE.Vector3(0, 1.95, -2.50), 0.85);
        }
      } else if (preset === 'white_backdrop') {
        smoothCameraTo(new THREE.Vector3(0, 2.35, -3.10), new THREE.Vector3(0, 2.20, 8.50), 0.85);
      } else if (preset === 'vaults') {
        smoothCameraTo(new THREE.Vector3(-1.60, 2.65, 3.20), new THREE.Vector3(2.20, 7.60, -9.50), 0.85);
      } else if (preset === 'side_windows') {
        smoothCameraTo(new THREE.Vector3(-1.40, 2.30, 0.60), new THREE.Vector3(5.20, 4.10, -5.80), 0.85);
      } else if (preset === 'back_windows') {
        smoothCameraTo(new THREE.Vector3(0, 3.40, -7.80), new THREE.Vector3(0, 4.60, -18.10), 0.85);
      } else if (preset === 'rear_windows') {
        smoothCameraTo(new THREE.Vector3(0, 3.40, 7.80), new THREE.Vector3(0, 4.60, 18.10), 0.85);
      }
    }

    function updateCameraLockUI() {
      const btnLock = document.getElementById('btn-cam-lock');
      if (btnLock) {
        btnLock.textContent = isCameraLocked ? '🔒 Khóa Cam' : '🎥 Cam Tự Do';
        btnLock.classList.toggle('active', isCameraLocked);
      }
      const btnQuickLock = document.getElementById('btn-quick-lock');
      if (btnQuickLock) {
        btnQuickLock.textContent = isCameraLocked ? '🎥 Xoay 3D' : '🔒 Khóa góc';
        btnQuickLock.classList.toggle('active', !isCameraLocked);
      }
      const btnTopCam = document.getElementById('btn-top-cam');
      if (btnTopCam) btnTopCam.textContent = isCameraLocked ? '🎥 Xoay 3D' : '🔒 Khóa góc';
      const btnCamHome = document.getElementById('btn-cam-home');
      if (btnCamHome) btnCamHome.hidden = isCameraLocked;
      const hintEl = document.getElementById('controls-hint');
      if (hintEl) {
        hintEl.innerHTML = isCameraLocked
          ? '<strong>Điều khiển:</strong> Click chọn quân &amp; ô để đi &nbsp;•&nbsp; <strong>🔒 Đang Khóa Cam cố định</strong> (Bấm &ldquo;🔒 Khóa Cam&rdquo; nếu muốn mở Cam 3D Tự Do) &nbsp;•&nbsp; H: Ẩn UI'
          : '<strong>Cam 3D Tự Do:</strong> Click quân để đi &nbsp;•&nbsp; Kéo chuột trái: Xoay 3D &nbsp;•&nbsp; Chuột phải: Di chuyển &nbsp;•&nbsp; Lăn chuột: Zoom &nbsp;•&nbsp; WASD: Bay &nbsp;•&nbsp; Bấm &ldquo;🎥 Cam 3D Tự Do&rdquo; để khóa lại';
      }
    }

    function setCameraLocked(locked) {
      isCameraLocked = Boolean(locked);
      heldCameraKeys.clear();
      keyMoveVelocity.set(0, 0, 0);
      keyRotVelocity.yaw = 0;
      keyRotVelocity.pitch = 0;
      orbitControls.enabled = !isCameraLocked && !isAnimatingMove;
      if (isCameraLocked) {
        const hasActivePreset = camButtons.some((id) =>
          document.getElementById(id)?.classList.contains('active')
        );
        if (!hasActivePreset) {
          overheadCamSide = playerColor === 'b' ? 'b' : 'w';
          setActiveCamButton('btn-cam-top');
          setOverheadCameraForSide(overheadCamSide, false);
        }
      }
      updateCameraLockUI();
      return isCameraLocked;
    }

    /** Back to the 3/4 view on the side of whoever is playing, without the side flip a repeated preset click does. */
    function returnCameraHome() {
      spectatorCamSide = (gameMode !== 'multi' && isPassAndPlay ? currentTurn : playerColor) === 'b' ? 'b' : 'w';
      setActiveCamButton('btn-cam-spectator');
      const pose = getSpectatorPose(spectatorCamSide, syncResponsiveCameraFov());
      smoothCameraTo(pose.pos, pose.lookAt, 0.75);
    }

    const CAM_GUIDE_SEEN_KEY = 'wizard_chess_cam_guide_seen';
    const forceCamGuide = new URLSearchParams(window.location.search).get('camguide') === '1';
    function hasSeenCameraGuide() {
      try {
        return localStorage.getItem(CAM_GUIDE_SEEN_KEY) === '1';
      } catch (e) {
        return true;
      }
    }
    function closeCameraGuide() {
      const guide = document.getElementById('cam-guide');
      if (guide) guide.hidden = true;
      try {
        localStorage.setItem(CAM_GUIDE_SEEN_KEY, '1');
      } catch (e) {}
    }
    /** One-time card after the first move; automated runs skip it unless they ask for it with ?camguide=1. */
    function maybeShowCameraGuide() {
      if (hasSeenCameraGuide() || (isAutomatedTest && !forceCamGuide)) return;
      const guide = document.getElementById('cam-guide');
      const text = document.getElementById('cam-guide-text');
      if (!guide || !text || !guide.hidden) return;
      const isTouch = Boolean(window.matchMedia?.('(pointer: coarse)')?.matches || window.innerWidth <= 768);
      const btnTry = document.getElementById('btn-cam-guide-try');
      const btnLater = document.getElementById('btn-cam-guide-later');
      if (isCameraLocked) {
        text.textContent = isTouch
          ? 'Bàn cờ này là 3D. Bấm “🎥 Xoay 3D” để xoay, kéo để đổi góc, chụm hai ngón để phóng to.'
          : 'Bàn cờ này là 3D. Bấm “🎥 Xoay 3D” để xoay, kéo để đổi góc, lăn chuột để phóng to.';
        if (btnTry) btnTry.textContent = 'Thử ngay';
        if (btnLater) btnLater.hidden = false;
      } else {
        text.textContent =
          'Bàn cờ này là 3D. Kéo để đổi góc, lăn chuột để phóng to. Bấm “🔒 Khóa góc” nếu muốn giữ yên, nút ↺ để về góc chuẩn.';
        if (btnTry) btnTry.textContent = 'Đã hiểu';
        if (btnLater) btnLater.hidden = true;
      }
      guide.hidden = false;
    }
    document.getElementById('btn-cam-guide-try')?.addEventListener('click', () => {
      closeCameraGuide();
      if (isCameraLocked) setCameraLocked(false);
    });
    document.getElementById('btn-cam-guide-later')?.addEventListener('click', closeCameraGuide);
    document.getElementById('btn-top-cam')?.addEventListener('click', () => {
      setCameraLocked(!isCameraLocked);
    });
    document.getElementById('btn-cam-home')?.addEventListener('click', returnCameraHome);
    document.getElementById('btn-quick-home')?.addEventListener('click', returnCameraHome);
    // A mouse can drag to orbit without getting in the way of clicks, so desktop starts free; touch starts locked.
    if (!isCoarseOrMobile) setCameraLocked(false);

    document.getElementById('mobile-quick-dock')?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
    document.getElementById('btn-cam-lock')?.addEventListener('click', () => {
      setCameraLocked(!isCameraLocked);
    });
    document.getElementById('btn-quick-lock')?.addEventListener('click', () => {
      setCameraLocked(!isCameraLocked);
    });
    document.getElementById('btn-piece-labels')?.addEventListener('click', () => {
      cyclePieceLabelMode();
    });
    document.getElementById('btn-quick-labels')?.addEventListener('click', () => {
      cyclePieceLabelMode();
    });
    document.getElementById('btn-quick-cam')?.addEventListener('click', () => {
      const isTopActive = document.getElementById('btn-cam-top')?.classList.contains('active');
      if (isTopActive) {
        spectatorCamSide = gameMode === 'multi' ? playerColor : isPassAndPlay ? currentTurn : playerColor;
        setActiveCamButton('btn-cam-spectator');
        const pose = getSpectatorPose(spectatorCamSide, syncResponsiveCameraFov());
        smoothCameraTo(pose.pos, pose.lookAt, 0.75);
      } else {
        overheadCamSide = gameMode === 'multi' ? playerColor : isPassAndPlay ? currentTurn : playerColor;
        setActiveCamButton('btn-cam-top');
        const tPortrait = syncResponsiveCameraFov();
        const zSign = overheadCamSide === 'b' ? -1 : 1;
        smoothCameraTo(
          new THREE.Vector3(0, 7.35 + tPortrait * 1.45, zSign * (3.95 + tPortrait * 0.45)),
          new THREE.Vector3(0, 0.78, zSign * (-tPortrait * 0.28)),
          0.75
        );
      }
    });
    document.getElementById('btn-quick-undo')?.addEventListener('click', () => {
      undoLastMove();
    });
    document.getElementById('btn-quick-duel')?.addEventListener('click', () => {
      openLobbyModal();
    });
    window.wizardSetPieceSkin = applyPieceTheme;
    document.getElementById('btn-cam-spectator')?.addEventListener('click', () => setCameraPreset('spectator'));
    document.getElementById('btn-cam-player')?.addEventListener('click', () => setCameraPreset('player'));
    document.getElementById('btn-cam-top')?.addEventListener('click', () => setCameraPreset('top'));
    document.getElementById('btn-cam-side')?.addEventListener('click', () => setCameraPreset('side'));
    document.getElementById('btn-cam-wide')?.addEventListener('click', () => setCameraPreset('wide'));
    document.getElementById('btn-hide-ui')?.addEventListener('click', () => toggleUI());

    document.getElementById('btn-ai-move')?.addEventListener('click', () => {
      triggerAIMoveAsync();
    });

    function setPassAndPlayMode(enabled, autoFlip = autoFlipCamera2P) {
      const nextEnabled = Boolean(enabled);
      stopMultiplayerSync();
      roomCode = null;
      roomBothReady = false;
      roomInviteCopied = false;
      const duelBoxEl = document.getElementById('duel-active-room-box');
      if (duelBoxEl) duelBoxEl.style.display = 'none';
      scriptedGameActive = false;
      gameMode = 'single';
      isPassAndPlay = nextEnabled;
      autoFlipCamera2P = Boolean(autoFlip);
      if (isPassAndPlay) {
        aiAutoPlay = false;
        cancelPendingAISearch();
        playerColor = currentTurn;
        if (autoFlipCamera2P && document.getElementById('btn-cam-player')?.classList.contains('active')) {
          playerCamSide = currentTurn;
          setCameraForSide(currentTurn, false);
        }
        updateTurnUI();
      } else {
        aiAutoPlay = true;
        playerColor = playerCamSide === 'b' ? 'b' : 'w';
        updateTurnUI();
        maybeScheduleAIMove();
      }
      return isPassAndPlay;
    }

    function applyAIDifficultySelection(nextDiff) {
      const valid = ['novice', 'tactical', 'grandmaster'];
      if (!valid.includes(nextDiff)) return;
      aiDifficulty = nextDiff;
      if (gameMode === 'multi' || isPassAndPlay) {
        if (gameMode === 'multi') {
          window.history.replaceState({}, '', window.location.pathname);
        }
        setPassAndPlayMode(false, autoFlipCamera2P);
      } else {
        updateTurnUI();
        if (aiTimer !== null || aiSearchInFlight) {
          maybeScheduleAIMove();
        }
      }
    }

    document.getElementById('btn-ai-difficulty')?.addEventListener('click', () => {
      const order = ['novice', 'tactical', 'grandmaster'];
      if (gameMode === 'multi' || isPassAndPlay) {
        applyAIDifficultySelection(aiDifficulty);
        return;
      }
      const idx = order.indexOf(aiDifficulty);
      const nextDiff = order[(idx + 1) % order.length];
      applyAIDifficultySelection(nextDiff);
    });

    document.querySelectorAll('[data-ai-diff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tier = btn.getAttribute('data-ai-diff') || 'tactical';
        applyAIDifficultySelection(tier);
      });
    });

    document.getElementById('btn-menu-2p-pass')?.addEventListener('click', () => {
      setPassAndPlayMode(true, autoFlipCamera2P);
    });

    document.getElementById('btn-menu-2p-online')?.addEventListener('click', () => {
      openLobbyModal();
    });

    document.getElementById('btn-undo')?.addEventListener('click', () => {
      undoLastMove();
    });

    document.getElementById('btn-audio-toggle')?.addEventListener('click', () => {
      wizardAudio.toggleMuted();
      updateTurnUI();
    });

    const MOTION_ORDER = ['full', 'quick', 'off'];
    const MOTION_NAMES = { full: 'Đầy Đủ', quick: 'Nhanh', off: 'Tắt' };
    const QUALITY_ORDER = ['auto', 'ultra', 'high', 'base'];
    const QUALITY_NAMES = { ultra: 'Ultra', high: 'High', base: 'Base' };
    function updateVisualSettingsUI() {
      const motionLabel = document.getElementById('motion-level-label');
      if (motionLabel) motionLabel.textContent = `🎬 Hoạt Cảnh: ${MOTION_NAMES[motionLevel]}`;
      const qualityLabel = document.getElementById('quality-tier-label');
      if (qualityLabel) {
        qualityLabel.textContent =
          qualityPreference === 'auto'
            ? `✨ Chất Lượng: Tự Động (${QUALITY_NAMES[qualityTier]})`
            : `✨ Chất Lượng: ${QUALITY_NAMES[qualityTier]}`;
      }
    }
    window.addEventListener('wizardchess:visual-settings', updateVisualSettingsUI);
    updateVisualSettingsUI();
    document.getElementById('btn-motion-level')?.addEventListener('click', () => {
      setMotionLevel(MOTION_ORDER[(MOTION_ORDER.indexOf(motionLevel) + 1) % MOTION_ORDER.length]);
    });
    document.getElementById('btn-quality-tier')?.addEventListener('click', () => {
      setQualityTier(QUALITY_ORDER[(QUALITY_ORDER.indexOf(qualityPreference) + 1) % QUALITY_ORDER.length]);
    });

    document.querySelectorAll('[data-promotion-piece]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pieceType = btn.getAttribute('data-promotion-piece') || 'queen';
        if (pendingPromotion) {
          const mv = pendingPromotion;
          hidePromotionModal();
          executeChessMove(mv.fromR, mv.fromC, mv.toR, mv.toC, { promotion: pieceType });
        }
      });
    });

    document.getElementById('promotion-overlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        hidePromotionModal();
      }
    });
    document.getElementById('btn-promotion-cancel')?.addEventListener('click', () => {
      hidePromotionModal();
    });

    document.getElementById('btn-side-toggle')?.addEventListener('click', () => {
      if (gameMode === 'multi') {
        stopMultiplayerSync();
        roomCode = null;
        roomBothReady = false;
        roomInviteCopied = false;
        const duelBoxEl = document.getElementById('duel-active-room-box');
        if (duelBoxEl) duelBoxEl.style.display = 'none';
        gameMode = 'single';
        isPassAndPlay = false;
        aiAutoPlay = true;
        playerColor = 'w';
        window.history.replaceState({}, '', window.location.pathname);
        resetChessBoard(true, false);
        return;
      }
      if (isPassAndPlay) {
        autoFlipCamera2P = !autoFlipCamera2P;
        if (autoFlipCamera2P && document.getElementById('btn-cam-player')?.classList.contains('active')) {
          playerCamSide = currentTurn;
          setCameraForSide(currentTurn, false);
        }
        updateTurnUI();
        return;
      }
      playerColor = playerColor === 'w' ? 'b' : 'w';
      resetChessBoard(true, scriptedGameActive);
    });

    async function handleGameResetAction() {
      if (gameMode === 'multi' && roomCode) {
        const stRoom = getStaticRoom(roomCode);
        if (stRoom) {
          stRoom.moves = [];
          stRoom.turn = 'w';
          stRoom.resetCount = (stRoom.resetCount || 0) + 1;
          stRoom.updatedAt = Date.now();
          saveAndBroadcastStaticRoom(stRoom);
          applyRemoteRoomState(stRoom);
        }
        const resetData = await mpApiRequest(`/api/rooms/${roomCode}/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerToken })
        });
        if (resetData && !resetData.ok) {
          showRoomApiError(resetData.error || 'Reset rejected');
        }
      } else {
        resetChessBoard(true, false);
      }
    }

    document.getElementById('btn-reset')?.addEventListener('click', () => {
      handleGameResetAction();
    });

    function syncGameSelectorUI() {
      const cardChess = document.getElementById('card-select-chess');
      const cardXiangqi = document.getElementById('card-select-xiangqi');
      const badgeChess = document.getElementById('badge-active-chess');
      const badgeXiangqi = document.getElementById('badge-active-xiangqi');
      if (cardChess) cardChess.classList.toggle('selected', gameVariant === 'chess');
      if (cardXiangqi) cardXiangqi.classList.toggle('selected', gameVariant === 'xiangqi');
      if (badgeChess) {
        badgeChess.textContent = gameVariant === 'chess' ? '✓ Đang Chọn' : 'Sẵn Sàng';
      }
      if (badgeXiangqi) {
        badgeXiangqi.textContent = gameVariant === 'xiangqi' ? '✓ Đang Chọn' : 'MỚI RA MẮT';
      }
    }

    function openGameSelectorModal() {
      syncGameSelectorUI();
      document.getElementById('game-selector-overlay')?.classList.add('visible');
    }

    function closeGameSelectorModal() {
      document.getElementById('game-selector-overlay')?.classList.remove('visible');
    }

    function setGameVariant(nextVariant) {
      endKillCam(true);
      const normalized = nextVariant === 'xiangqi' ? 'xiangqi' : 'chess';
      if (typeof document !== 'undefined' && document.body) {
        document.body.dataset.gameVariant = normalized;
      }
      if (gameVariant === normalized && boardState.length === getBoardRows()) {
        syncGameSelectorUI();
        closeGameSelectorModal();
        updateTurnUI();
        return gameVariant;
      }
      cancelPendingAISearch();
      hidePromotionModal();
      scriptedGameActive = false;
      scriptDeviated = false;
      preMoveHighlightTask = null;
      gameVariant = normalized;
      chessBoardDeckGroup.visible = gameVariant === 'chess';
      xiangqiBoardDeckGroup.visible = gameVariant === 'xiangqi';
      applyPieceTheme(currentPieceThemeId, 'both');
      resetChessBoard(true, false);
      syncGameSelectorUI();
      closeGameSelectorModal();
      renderer.shadowMap.needsUpdate = true;
      renderFrame();
      return gameVariant;
    }

    function toggleGameVariant() {
      return setGameVariant(gameVariant === 'xiangqi' ? 'chess' : 'xiangqi');
    }

    document.getElementById('btn-game-variant')?.addEventListener('click', () => {
      const overlay = document.getElementById('game-selector-overlay');
      if (overlay && !overlay.classList.contains('visible')) {
        openGameSelectorModal();
      } else {
        toggleGameVariant();
      }
    });
    document.getElementById('btn-quick-variant')?.addEventListener('click', () => {
      const overlay = document.getElementById('game-selector-overlay');
      if (overlay && !overlay.classList.contains('visible')) {
        openGameSelectorModal();
      } else {
        toggleGameVariant();
      }
    });
    document.getElementById('card-select-chess')?.addEventListener('click', () => {
      setGameVariant('chess');
    });
    document.getElementById('btn-select-chess')?.addEventListener('click', (e) => {
      e.stopPropagation();
      setGameVariant('chess');
    });
    document.getElementById('card-select-xiangqi')?.addEventListener('click', () => {
      setGameVariant('xiangqi');
    });
    document.getElementById('btn-select-xiangqi')?.addEventListener('click', (e) => {
      e.stopPropagation();
      setGameVariant('xiangqi');
    });
    document.getElementById('btn-selector-close')?.addEventListener('click', () => {
      closeGameSelectorModal();
    });
    document.querySelectorAll('[data-set-variant]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetVar = btn.getAttribute('data-set-variant');
        if (targetVar === 'chess' || targetVar === 'xiangqi') {
          setGameVariant(targetVar);
        }
      });
    });
    document.getElementById('game-selector-overlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        closeGameSelectorModal();
      }
    });

    // =========================================================================
    // Backward-Compatible Programmatic Modal Stubs & 2-Player Room Overlay
    // =========================================================================
    const lobbyModal = document.getElementById('lobby-modal');
    const duelRoomOverlay = document.getElementById('duel-room-overlay');

    function openLobbyModal() {
      lobbyModal?.classList.add('open');
      duelRoomOverlay?.classList.add('visible');
      const duelCodeEl = document.getElementById('duel-room-code');
      const duelBoxEl = document.getElementById('duel-active-room-box');
      if (roomCode && duelCodeEl && duelBoxEl) {
        duelCodeEl.textContent = roomCode;
        duelBoxEl.style.display = 'block';
      }
    }

    function closeLobbyModal() {
      lobbyModal?.classList.remove('open');
      duelRoomOverlay?.classList.remove('visible');
    }

    document.getElementById('btn-duel-room')?.addEventListener('click', () => {
      openLobbyModal();
    });
    document.getElementById('mode-badge')?.addEventListener('click', () => {
      openLobbyModal();
    });
    document.getElementById('btn-duel-close')?.addEventListener('click', () => {
      closeLobbyModal();
    });
    duelRoomOverlay?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        closeLobbyModal();
      }
    });
    document.getElementById('btn-duel-create-white')?.addEventListener('click', () => {
      createMultiplayerRoom('w');
    });
    document.getElementById('btn-duel-create-black')?.addEventListener('click', () => {
      createMultiplayerRoom('b');
    });
    document.getElementById('btn-duel-copy-link')?.addEventListener('click', async () => {
      if (!roomCode) return;
      const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(inviteUrl);
          roomInviteCopied = true;
          const duelStatusEl = document.getElementById('duel-status-msg');
          if (duelStatusEl) {
            duelStatusEl.textContent = `Đã sao chép link mời: ${inviteUrl}`;
          }
          updateTurnUI();
        }
        if (
          typeof navigator !== 'undefined' &&
          typeof navigator.share === 'function' &&
          Boolean(window.matchMedia?.('(pointer: coarse)')?.matches || window.innerWidth <= 768)
        ) {
          await navigator.share({
            title: 'Wizard Chess 3D',
            text: `Vào phòng ${roomCode} đấu Cờ Phù Thủy 3D với tôi!`,
            url: inviteUrl
          });
        }
      } catch (e) {}
    });
    document.getElementById('btn-duel-join')?.addEventListener('click', () => {
      const inputEl = document.getElementById('input-duel-code');
      const val = inputEl && 'value' in inputEl ? inputEl.value : '';
      joinMultiplayerRoom(val);
    });
    document.getElementById('input-duel-code')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const inputEl = e.currentTarget;
        const val = inputEl && 'value' in inputEl ? inputEl.value : '';
        joinMultiplayerRoom(val);
      }
    });
    document.getElementById('btn-duel-passplay')?.addEventListener('click', () => {
      setPassAndPlayMode(true, autoFlipCamera2P);
      closeLobbyModal();
    });

    document.getElementById('btn-checkmate-replay')?.addEventListener('click', () => {
      const defCol = checkmateState.defeatedColor || currentTurn;
      const winCol = checkmateState.winnerColor || (defCol === 'w' ? 'b' : 'w');
      triggerCheckmateSequence(defCol, winCol);
    });
    document.getElementById('btn-checkmate-newgame')?.addEventListener('click', () => {
      handleGameResetAction();
    });
    document.getElementById('btn-checkmate-dismiss')?.addEventListener('click', () => {
      const overlay = document.getElementById('checkmate-overlay');
      if (overlay) overlay.classList.remove('visible');
      checkmateState.bannerVisible = false;
    });

    // =========================================================================
    // Programmatic API for Automated Verification & Camera Inspection
    // =========================================================================
    window.wizardChess = {
      SKIN_CATALOG: PIECE_THEMES,
      PIECE_THEME_ORDER,
      ATTACK_SYNC_PROFILES,
      LOCOMOTION_GAIT_PROFILES,
      ROLE_SCALE_MULTIPLIERS,
      PIECE_ROLE_METADATA,
      XIANGQI_ROLE_METADATA,
      setGameVariant,
      toggleGameVariant,
      openGameSelectorModal,
      closeGameSelectorModal,
      getGameVariant: () => gameVariant,
      getXiangqiBlockedPointsForPiece: (r, c) =>
        getXiangqiBlockedPointsForPiece(extractPureXiangqiBoard(boardState), r, c),
      getAllLegalMoves: (color) => getAllLegalMoves(color || currentTurn),
      setMotionLevel,
      setQualityTier,
      setCombatCameraZoomEnabled: (enabled) => {
        combatCameraZoomEnabled = Boolean(enabled);
        return combatCameraZoomEnabled;
      },
      isCombatCameraZoomEnabled: () => combatCameraZoomEnabled,
      setPieceLabelMode,
      cyclePieceLabelMode,
      getPieceLabelMode: () => pieceLabelMode,
      getSquareScreenPoint: (r, c) => {
        const rect = renderer.domElement.getBoundingClientRect();
        const v = new THREE.Vector3((c - 3.5) * BOARD_SQ_SIZE, BOARD_SURFACE_Y, (r - 3.5) * BOARD_SQ_SIZE).project(camera);
        return {
          x: rect.left + (v.x + 1) * 0.5 * rect.width,
          y: rect.top + (-v.y + 1) * 0.5 * rect.height
        };
      },
      // Measurement aid: draws only the piece bodies, flat white on black, so a screenshot is a per-pixel piece mask.
      setPieceMaskView: (on) => {
        if (Boolean(on) === Boolean(pieceMaskViewState)) return Boolean(on);
        if (!on) {
          for (const [o, visible] of pieceMaskViewState.visibility) o.visible = visible;
          scene.background = pieceMaskViewState.background;
          scene.overrideMaterial = null;
          pieceMaskViewState = null;
          return false;
        }
        const roots = new Set();
        for (const row of boardState) for (const p of row) if (p && p.mesh) roots.add(p.mesh);
        const visibility = new Map();
        for (const o of scene.children) {
          visibility.set(o, o.visible);
          if (!roots.has(o)) o.visible = false;
        }
        for (const root of roots) {
          const ring = root.getObjectByName('PiecePedestalRing');
          if (ring) {
            visibility.set(ring, ring.visible);
            ring.visible = false;
          }
        }
        pieceMaskViewState = { visibility, background: scene.background };
        scene.background = new THREE.Color(0x000000);
        scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
        return true;
      },
      getPieceScreenPoint: (r, c) => {
        const p = boardState[r]?.[c];
        if (!p || !p.mesh) return null;
        const rect = renderer.domElement.getBoundingClientRect();
        const roleScale = ROLE_SCALE_MULTIPLIERS[p.type] || 1.0;
        const midY = p.mesh.position.y + (PIECE_HEIGHTS[p.type] || 0.38) * roleScale * 0.5;
        const v = new THREE.Vector3(p.mesh.position.x, midY, p.mesh.position.z).project(camera);
        const base = p.mesh.position.clone().project(camera);
        return {
          x: rect.left + (v.x + 1) * 0.5 * rect.width,
          y: rect.top + (-v.y + 1) * 0.5 * rect.height,
          baseX: rect.left + (base.x + 1) * 0.5 * rect.width,
          baseY: rect.top + (-base.y + 1) * 0.5 * rect.height
        };
      },
      inspectSquare: (r, c) => {
        if (
          typeof r !== 'number' ||
          typeof c !== 'number' ||
          r < 0 ||
          r >= getBoardRows() ||
          c < 0 ||
          c >= getBoardCols()
        ) {
          clearSquareHighlights();
          selectedSquare = null;
          inspectedSquare = null;
          validMoves = [];
          updatePieceOverheadOverlay();
          return null;
        }
        const p = boardState[r]?.[c];
        if (!p) {
          clearSquareHighlights();
          selectedSquare = null;
          inspectedSquare = null;
          validMoves = [];
          updatePieceOverheadOverlay();
          return null;
        }
        if (p.color === currentTurn) {
          selectedSquare = { r, c };
          inspectedSquare = { r, c };
          validMoves = getLegalMovesForPiece(r, c);
          showSquareHighlights(r, c, validMoves);
        } else {
          clearSquareHighlights();
          selectedSquare = null;
          validMoves = [];
          inspectedSquare = { r, c };
          showEnemyInspectHighlight(r, c);
        }
        updatePieceOverheadOverlay();
        return {
          r,
          c,
          type: p.type,
          color: p.color,
          isFriendly: p.color === currentTurn
        };
      },
      setPieceTheme: applyPieceTheme,
      getPieceTheme: () => currentPieceThemeId,
      getActiveSkins: () => ({ white: activeSkinWhite, black: activeSkinBlack }),
      setCameraPreset,
      setCameraLocked,
      isCameraLocked: () => isCameraLocked,
      setCameraPose,
      setCameraLook: setCameraPose,
      setCameraKeySpeedPercent,
      setCameraRotSpeedPercent,
      setWallStoneLook,
      nextWallStoneLook,
      prevWallStoneLook,
      setFloorStoneLook,
      nextFloorStoneLook,
      prevFloorStoneLook,
      WALL_STONE_LOOKS,
      FLOOR_STONE_LOOKS,
      holdCameraKey: (code, down = true) => {
        if (down) heldCameraKeys.add(code);
        else heldCameraKeys.delete(code);
      },
      executeChessMove,
      triggerAIMoveNow,
      triggerAIMoveAsync,
      undoLastMove,
      openPromotionModal,
      cancelPromotion: hidePromotionModal,
      setPassAndPlayMode,
      setAutoFlipCamera2P: (enabled) => {
        autoFlipCamera2P = Boolean(enabled);
        if (isPassAndPlay && autoFlipCamera2P && document.getElementById('btn-cam-player')?.classList.contains('active')) {
          playerCamSide = currentTurn;
          setCameraForSide(currentTurn, false);
        }
        updateTurnUI();
        return autoFlipCamera2P;
      },
      createMultiplayerRoom,
      joinMultiplayerRoom,
      setAIDifficulty: (diff) => {
        if (diff === '2p') {
          setPassAndPlayMode(true, autoFlipCamera2P);
          return '2p';
        }
        if (diff === 'online') {
          createMultiplayerRoom('w');
          return 'online';
        }
        if (diff === 'novice' || diff === 'tactical' || diff === 'grandmaster') {
          aiDifficulty = diff;
          if (isPassAndPlay || gameMode === 'multi') {
            if (gameMode === 'multi') {
              window.history.replaceState({}, '', window.location.pathname);
            }
            setPassAndPlayMode(false, autoFlipCamera2P);
          } else {
            updateTurnUI();
            if (aiTimer !== null || aiSearchInFlight) {
              maybeScheduleAIMove();
            }
          }
        }
        return aiDifficulty;
      },
      getAIDifficulty: () => (gameMode === 'multi' ? 'online' : isPassAndPlay ? '2p' : aiDifficulty),
      toggleAudioMute: () => {
        const m = wizardAudio.toggleMuted();
        updateTurnUI();
        return m;
      },
      getAudioState: () => wizardAudio.getState(),
      resetChessBoard,
      openLobbyModal,
      closeLobbyModal,
      toggleUI,
      loadNotation: (pgn, opts) => loadNotationScript(pgn, opts),
      stepScriptForward,
      stepScriptBackward,
      triggerCheckmateSequence,
      injectFaultyTweenForTest: () => {
        activeMoveTweens.push(() => {
          throw new Error('injected tween fault');
        });
      },
      testColumnCollisionSlide: (startArr, endArr, steps = 20) => {
        activeCamTransition = null;
        camera.position.set(startArr[0], startArr[1], startArr[2]);
        const path = [];
        for (let i = 1; i <= steps; i++) {
          const u = i / steps;
          const prev = camera.position.clone();
          camera.position.set(
            startArr[0] + (endArr[0] - startArr[0]) * u,
            startArr[1] + (endArr[1] - startArr[1]) * u,
            startArr[2] + (endArr[2] - startArr[2]) * u
          );
          enforceCathedralBoundsAndSolidColumns(prev, camera.position, orbitControls.target);
          path.push(camera.position.toArray().map((v) => Number(v.toFixed(3))));
        }
        renderFrame();
        return path;
      },
      setSinglePlayerSide: (color) => {
        stopMultiplayerSync();
        roomCode = null;
        scriptedGameActive = false;
        gameMode = 'single';
        isPassAndPlay = false;
        aiAutoPlay = true;
        playerColor = color === 'b' ? 'b' : 'w';
        resetChessBoard(true);
      },
      setupCustomScenario: (pieces, turn = 'w', epTarget = null) => {
        stopMultiplayerSync();
        cancelPendingAISearch();
        activeMoveTweens.length = 0;
        isAnimatingMove = false;
        gameOver = false;
        scriptedGameActive = false;
        scriptDeviated = false;
        preMoveHighlightTask = null;
        enPassantTarget = epTarget ? { ...epTarget } : null;
        halfMoveClock = 0;
        lastMoveSquares = null;
        drawReason = '';
        moveHistory = [];
        multiPlyCount = 0;
        hidePromotionModal();
        clearCheckmateSequence();
        clearSquareHighlights();
        clearAllPieces();
        for (const p of pieces) {
          const inst = instantiatePiece(p.type, p.color, p.r, p.c);
          inst.hasMoved = Boolean(p.hasMoved);
          boardState[p.r][p.c] = inst;
        }
        currentTurn = turn;
        positionHistory = [
          gameVariant === 'xiangqi'
            ? computeXiangqiPositionHash(extractPureXiangqiBoard(boardState), currentTurn)
            : computePositionHash(extractPureBoard(boardState), currentTurn, enPassantTarget)
        ];
        updateTurnUI();
        renderFrame();
      },
      triggerDemoCapture: () => {
        // Set up an immediate pawn capture (e4 x d5) and execute it
        resetChessBoard(true);
        // Move White e2->e4 and Black d7->d5 immediately on boardState, then animate White e4xd5
        const wp = boardState[6][4];
        boardState[6][4] = null;
        boardState[4][4] = wp;
        wp.r = 4; wp.c = 4;
        wp.mesh.position.copy(boardToWorld(4, 4));

        const bp = boardState[1][3];
        boardState[1][3] = null;
        boardState[3][3] = bp;
        bp.r = 3; bp.c = 3;
        bp.mesh.position.copy(boardToWorld(3, 3));

        currentTurn = 'w';
        return executeChessMove(4, 4, 3, 3);
      },
      getState: () => ({
        gameVariant,
        boardRows: getBoardRows(),
        boardCols: getBoardCols(),
        gameMode,
        isPassAndPlay,
        autoFlipCamera2P,
        aiAutoPlay,
        aiDifficulty,
        aiSearchInFlight,
        pendingPromotion: pendingPromotion ? { ...pendingPromotion } : null,
        currentActiveDpr,
        rollingFrameMs: Number(rollingFrameMs.toFixed(2)),
        enPassantTarget,
        halfMoveClock,
        drawReason,
        lastMoveSquares,
        undoAvailableCount: moveHistory.length,
        tacticalMarkerCount: tacticalMarkersGroup.children.length,
        isWebGLContextLost,
        rendererMemory: {
          geometries: renderer.info?.memory?.geometries ?? 0,
          textures: renderer.info?.memory?.textures ?? 0,
          programs: renderer.info?.programs ? renderer.info.programs.length : 0
        },
        audioState: wizardAudio.getState(),
        postFx: {
          active: Boolean(postComposer),
          gtao: Boolean(postPasses.gtao),
          bloom: Boolean(postPasses.bloom),
          dof: Boolean(postPasses.bokeh?.enabled)
        },
        motionLevel,
        qualityTier,
        qualityTierSource,
        qualityPreference,
        gpuRenderer: gpuRendererString,
        scriptedGameActive,
        scriptDeviated,
        scriptMovesCount: scriptMoves.length,
        scriptCursor,
        moveHistoryCount: moveHistory.length,
        preMoveHighlightActive: Boolean(preMoveHighlightTask),
        selectedSquare,
        validMovesCount: validMoves.length,
        highlightMeshCount: squareHighlightsGroup.children.length,
        uiHidden: document.body.classList.contains('cinematic-ui-hidden'),
        playerColor,
        currentTurn,
        roomCode,
        roomBothReady,
        roomInviteCopied,
        isAnimatingMove,
        gameOver,
        checkmateState: { ...checkmateState },
        cinematicActive,
        killCamDof: Boolean(postPasses.bokeh?.enabled),
        capturedByWhite,
        capturedByBlack,
        cameraPos: camera.position.toArray(),
        cameraTarget: orbitControls.target.toArray(),
        ...boardCornerState(),
        cameraFov: camera.fov,
        portraitFramingFactor: Number(getPortraitFramingFactor().toFixed(3)),
        playerCamSide,
        overheadCamSide,
        sideCamSide,
        cathedralWideSide,
        cameraKeySpeedPct,
        cameraRotSpeedPct,
        wallStoneLookIndex: currentWallStoneLookIdx,
        wallStoneLookName: WALL_STONE_LOOKS[currentWallStoneLookIdx]?.name || '',
        floorStoneLookIndex: currentFloorStoneLookIdx,
        floorStoneLookName: FLOOR_STONE_LOOKS[currentFloorStoneLookIdx]?.name || '',
        floorMaterialRoughness: cathedralFloorMats[0]?.roughness ?? null,
        floorMaterialMetalness: cathedralFloorMats[0]?.metalness ?? null,
        keyMoveVelocity: keyMoveVelocity.toArray().map((v) => Number(v.toFixed(4))),
        keyRotVelocity: {
          yaw: Number(keyRotVelocity.yaw.toFixed(4)),
          pitch: Number(keyRotVelocity.pitch.toFixed(4))
        },
        cathedralBounds: CATHEDRAL_BOUNDS,
        solidColumnsCount: CATHEDRAL_SOLID_PILLARS.filter((p) => p.isColumn).length,
        brazierPillars: CATHEDRAL_SOLID_PILLARS.filter((p) => !p.isColumn),
        boardSqSize: BOARD_SQ_SIZE,
        pieceScaleFactor: PIECE_SCALE_FACTOR,
        roleScaleMultipliers: ROLE_SCALE_MULTIPLIERS,
        combatCameraZoomEnabled,
        pieceLabelMode,
        inspectedSquare,
        visibleOverheadBadgeCount: overheadBadgeSlots.filter((s) => s.visible).length,
        hoveredSquare: hoveredSquare ? { ...hoveredSquare } : null,
        inspectCardVisible: Boolean(
          document.getElementById('piece-inspect-card')?.classList.contains('visible')
        ),
        inspectCardText: document.getElementById('piece-inspect-card')?.textContent || '',
        currentPieceThemeId,
        activeSkinWhite,
        activeSkinBlack,
        sanctumAltarMeshCount: boardGroup.children.length,
        sanctumRelicCrystalsCount: sanctumRelicCrystals.length,
        sanctumOuterArenaTheme: currentOuterMonumentArchetype,
        sanctumOuterMonumentThemes: Object.keys(outerMonumentGroupsByTheme),
        sanctumOuterFloatingRelicsCount: sanctumOuterFloatingRelics.length,
        telemetry: cameraTelemetry
      }),
      captureScreenshot: async (filename) => {
        renderFrame();
        const outCanvas = document.createElement('canvas');
        outCanvas.width = renderer.domElement.width;
        outCanvas.height = renderer.domElement.height;
        const ctx = outCanvas.getContext('2d');
        ctx.drawImage(renderer.domElement, 0, 0);

        const scale = outCanvas.width / window.innerWidth;

        // Draw Gothic Cathedral Checkmate Banner if active
        if (checkmateState.bannerVisible) {
          ctx.save();
          ctx.scale(scale, scale);
          const bw = 560;
          const bh = 168;
          const bx = (window.innerWidth - bw) / 2;
          const by = 84;

          ctx.fillStyle = 'rgba(10, 12, 20, 0.94)';
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.88)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, bh, 6);
          ctx.fill();
          ctx.stroke();

          ctx.strokeStyle = 'rgba(212, 175, 55, 0.38)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(bx + 6, by + 6, bw - 12, bh - 12, 4);
          ctx.stroke();

          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(212, 175, 55, 0.88)';
          ctx.font = '600 12px Georgia, serif';
          ctx.fillText('✦   SANCTUM JUDGMENT   ✦', window.innerWidth / 2, by + 28);

          ctx.fillStyle = '#f5d76e';
          ctx.font = '26px serif';
          const crownChar = checkmateState.winnerColor === 'b' ? '♚' : '♔';
          ctx.fillText(crownChar, window.innerWidth / 2, by + 56);

          ctx.fillStyle = '#f7e299';
          ctx.font = 'bold 40px Georgia, serif';
          ctx.fillText('C H E C K M A T E', window.innerWidth / 2, by + 102);

          ctx.strokeStyle = 'rgba(212, 175, 55, 0.65)';
          ctx.beginPath();
          ctx.moveTo(bx + 90, by + 116);
          ctx.lineTo(bx + bw - 90, by + 116);
          ctx.stroke();

          const subTxt =
            document.getElementById('checkmate-subtitle')?.textContent ||
            'WHITE TRIUMPHS • THE BLACK KING HAS FALLEN';
          ctx.fillStyle = '#f0ece1';
          ctx.font = 'bold 14px Georgia, serif';
          ctx.fillText(subTxt.toUpperCase(), window.innerWidth / 2, by + 142);
          ctx.restore();
        }

        // Only draw HUD summary bar if UI is NOT hidden by cinematic mode
        if (!document.body.classList.contains('cinematic-ui-hidden')) {
          ctx.save();
          ctx.scale(scale, scale);
          ctx.fillStyle = 'rgba(12, 15, 22, 0.82)';
          ctx.strokeStyle = 'rgba(212, 175, 55, 0.45)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(16, 16, 520, 42, 10);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#d4af37';
          ctx.font = 'bold 13px Inter, sans-serif';
          ctx.fillText('WIZARD CHESS', 30, 42);

          const turnStr = document.getElementById('turn-text')?.textContent || '';
          const modeStr = document.getElementById('mode-badge')?.textContent || '';
          ctx.fillStyle = '#f0ece1';
          ctx.font = '600 13px Inter, sans-serif';
          ctx.fillText(`${turnStr}   |   ${modeStr}`, 155, 42);

          if (lobbyModal?.classList.contains('open')) {
            ctx.fillStyle = 'rgba(6, 8, 14, 0.72)';
            ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
            const cw = 440;
            const ch = 290;
            const cx = (window.innerWidth - cw) / 2;
            const cy = (window.innerHeight - ch) / 2;
            ctx.fillStyle = 'rgba(14, 17, 26, 0.96)';
            ctx.strokeStyle = '#d4af37';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(cx, cy, cw, ch, 16);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#d4af37';
            ctx.font = 'bold 18px Inter, sans-serif';
            ctx.fillText('MULTIPLAYER LOBBY • ROOM CODE', cx + 28, cy + 42);

            ctx.fillStyle = '#9aa0a6';
            ctx.font = '13px Inter, sans-serif';
            ctx.fillText('Share this 4-character Room Code with Player 2:', cx + 28, cy + 82);

            ctx.fillStyle = '#f5d76e';
            ctx.font = 'bold 38px monospace';
            ctx.fillText(roomCode || '----', cx + 150, cy + 138);

            ctx.fillStyle = '#4ea8de';
            ctx.font = '600 14px Inter, sans-serif';
            ctx.fillText('Create Room  •  Join Room by Code  •  Live Move Sync', cx + 42, cy + 195);

            ctx.fillStyle = '#f0ece1';
            ctx.font = '13px Inter, sans-serif';
            ctx.fillText(`Host Assigned: ${playerColor === 'w' ? 'White' : 'Black'}  |  Status: Waiting for Opponent`, cx + 48, cy + 240);
          }
          ctx.restore();
        }

        const dataUrl = outCanvas.toDataURL('image/png');
        const res = await fetch('/api/upload-screenshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl, filename })
        });
        return res.json();
      }
    };

    window.wizardChess.stepBy = (seconds, steps = 24) => {
      const subDt = seconds / steps;
      for (let i = 0; i < steps; i++) {
        stepScene(subDt, false);
      }
      renderFrame();
      updatePieceOverheadOverlay();
    };

    // =========================================================================
    // Main Animation Loop
    // =========================================================================
    let elapsedTotal = 0;
    let idleMixerAccum = 0;
    let shadowUpdateAccum = 0;
    let animIdleFrames = 0;
    // Per-frame scratch vectors for stepScene; never stored beyond the frame.
    const _prevCamPos = new THREE.Vector3();
    const _camForward = new THREE.Vector3();
    const _camRight = new THREE.Vector3();
    const _camHorizDir = new THREE.Vector3();
    const _audioForward = new THREE.Vector3();
    function stepScene(dt, doRender = true) {
      elapsedTotal += dt;
      if (cinematicActive) {
        cinematicTimer += dt;
        if (cinematicTimer >= KILL_CAM_HOLD_S) endKillCam(false);
      }
      const prevCamPos = _prevCamPos.copy(camera.position);
      // The listener trails the camera by one frame, which is inaudible; it is a no-op until audio runs.
      wizardAudio.setListener(camera.position, camera.getWorldDirection(_audioForward), camera.up);

      if (isAnimatingMove && activeCombatMixers.size > 0) {
        idleMixerAccum += dt;
        const updateBackgroundIdle = idleMixerAccum >= 0.048;
        const bgDt = idleMixerAccum;
        if (updateBackgroundIdle) idleMixerAccum = 0;
        for (const mixer of activeMixers) {
          if (activeCombatMixers.has(mixer)) {
            mixer.update(dt);
          } else if (updateBackgroundIdle) {
            const p = mixer.userData?.piece;
            if (!p || !p.isIdleClip || p.idleSettleRemaining > 0) {
              if (p && p.idleSettleRemaining > 0) {
                p.idleSettleRemaining = Math.max(0, p.idleSettleRemaining - bgDt);
              }
              mixer.update(bgDt);
            }
          }
        }
      } else {
        idleMixerAccum = 0;
        let settledAnyIdle = false;
        for (const mixer of activeMixers) {
          const p = mixer.userData?.piece;
          if (!p || !p.isIdleClip || p.idleSettleRemaining > 0) {
            if (p && p.idleSettleRemaining > 0) {
              p.idleSettleRemaining = Math.max(0, p.idleSettleRemaining - dt);
              if (p.idleSettleRemaining === 0) {
                settledAnyIdle = true;
              }
            }
            mixer.update(dt);
          }
        }
        if (settledAnyIdle) {
          renderer.shadowMap.needsUpdate = true;
        }
      }

      // Feature 3c: Advance pre-move piece selection & valid-squares highlight beat before executing scripted move
      if (preMoveHighlightTask && !isAnimatingMove) {
        preMoveHighlightTask.elapsedSim += dt;
        const wallElapsed = (performance.now() - preMoveHighlightTask.startWallMs) / 1000;
        if (
          preMoveHighlightTask.elapsedSim >= preMoveHighlightTask.duration ||
          wallElapsed >= preMoveHighlightTask.duration
        ) {
          const mv = preMoveHighlightTask.move;
          const fromScriptFlag = Boolean(preMoveHighlightTask.fromScript);
          preMoveHighlightTask = null;
          executeChessMove(mv.fromR, mv.fromC, mv.toR, mv.toC, { fromScript: fromScriptFlag });
        }
      }

      runTweens(activeMoveTweens, dt, reportTweenError);
      if (tweenErrorPending) {
        tweenErrorPending = false;
        recoverFromDroppedMoveTween();
      }
      // Last-resort fallback: a move flagged as animating with nothing left to animate never finishes.
      if (isAnimatingMove && activeMoveTweens.length === 0 && !preMoveHighlightTask) {
        animIdleFrames += 1;
      } else {
        animIdleFrames = 0;
      }
      if (animIdleFrames > 90) {
        animIdleFrames = 0;
        recoverFromDroppedMoveTween();
      }

      // Feature 4: Video-game style WASD + R/F camera translation AND Arrow-key camera rotation
      // with separate UI-configurable Move Speed & Rot Speed (both default 10%) and smooth ease-in / ease-out velocity damping
      if (!isAnimatingMove && !isCameraLocked) {
        const moveSpeedScale = cameraKeySpeedPct / 100;
        const rotSpeedScale = cameraRotSpeedPct / 100;
        const maxMoveSpeed = 3.2 * moveSpeedScale; // 0.32 m/s at default 10%
        const maxVertSpeed = 2.6 * moveSpeedScale; // 0.26 m/s at default 10%
        const maxRotSpeed = 1.2 * rotSpeedScale;   // 0.12 rad/s at default 10%

        const forward = _camForward.subVectors(orbitControls.target, camera.position);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) {
          camera.getWorldDirection(forward);
          forward.y = 0;
        }
        forward.normalize();
        const right = _camRight.set(-forward.z, 0, forward.x).normalize();

        const horizDir = _camHorizDir.set(0, 0, 0);
        if (heldCameraKeys.has('KeyW')) horizDir.add(forward);
        if (heldCameraKeys.has('KeyS')) horizDir.sub(forward);
        if (heldCameraKeys.has('KeyD')) horizDir.add(right);
        if (heldCameraKeys.has('KeyA')) horizDir.sub(right);
        if (horizDir.lengthSq() > 1e-6) horizDir.normalize();

        const desiredMoveVel = horizDir.multiplyScalar(maxMoveSpeed);
        if (heldCameraKeys.has('KeyR')) desiredMoveVel.y += maxVertSpeed;
        if (heldCameraKeys.has('KeyF')) desiredMoveVel.y -= maxVertSpeed;

        let desiredYawVel = 0;
        let desiredPitchVel = 0;
        if (heldCameraKeys.has('ArrowLeft')) desiredYawVel += maxRotSpeed;
        if (heldCameraKeys.has('ArrowRight')) desiredYawVel -= maxRotSpeed;
        if (heldCameraKeys.has('ArrowUp')) desiredPitchVel += maxRotSpeed;
        if (heldCameraKeys.has('ArrowDown')) desiredPitchVel -= maxRotSpeed;

        // Smooth ease-in when keys are pressed and smooth ease-out when keys are released
        const easeAlpha = 1 - Math.exp(-Math.max(0.001, dt) * 7.5);
        keyMoveVelocity.lerp(desiredMoveVel, easeAlpha);
        keyRotVelocity.yaw += (desiredYawVel - keyRotVelocity.yaw) * easeAlpha;
        keyRotVelocity.pitch += (desiredPitchVel - keyRotVelocity.pitch) * easeAlpha;

        if (keyMoveVelocity.lengthSq() < 1e-8 && desiredMoveVel.lengthSq() === 0) {
          keyMoveVelocity.set(0, 0, 0);
        }
        if (Math.abs(keyRotVelocity.yaw) < 1e-5 && desiredYawVel === 0) keyRotVelocity.yaw = 0;
        if (Math.abs(keyRotVelocity.pitch) < 1e-5 && desiredPitchVel === 0) keyRotVelocity.pitch = 0;

        const hasActiveMove = keyMoveVelocity.lengthSq() > 0;
        const hasActiveRot = keyRotVelocity.yaw !== 0 || keyRotVelocity.pitch !== 0;

        if (hasActiveMove || hasActiveRot) {
          activeCamTransition = null;

          if (hasActiveMove) {
            const moveDelta = keyMoveVelocity.clone().multiplyScalar(dt);
            const beforeMovePos = camera.position.clone();
            camera.position.add(moveDelta);
            enforceCathedralBoundsAndSolidColumns(beforeMovePos, camera.position, orbitControls.target);
            const actualMoveDelta = camera.position.clone().sub(beforeMovePos);
            orbitControls.target.add(actualMoveDelta);
          }

          if (hasActiveRot) {
            const lookOffset = new THREE.Vector3().subVectors(orbitControls.target, camera.position);
            const dist = Math.max(0.5, lookOffset.length());
            const dir = lookOffset.normalize();
            let yaw = Math.atan2(dir.x, dir.z);
            let pitch = Math.asin(Math.max(-0.98, Math.min(0.98, dir.y)));

            yaw += keyRotVelocity.yaw * dt;
            pitch = Math.max(-1.35, Math.min(1.35, pitch + keyRotVelocity.pitch * dt));

            const cosP = Math.cos(pitch);
            const newOffset = new THREE.Vector3(
              Math.sin(yaw) * cosP * dist,
              Math.sin(pitch) * dist,
              Math.cos(yaw) * cosP * dist
            );
            orbitControls.target.copy(camera.position).add(newOffset);
          }

          if (heldCameraKeys.size > 0) {
            clearCameraPresetActive();
          }
        }
      }

      if (activeCamTransition && !isAnimatingMove) {
        activeCamTransition.elapsed += dt;
        const u = Math.min(1, activeCamTransition.elapsed / activeCamTransition.duration);
        const ease = easeInOutCubic(u);
        camera.position.lerpVectors(activeCamTransition.startPos, activeCamTransition.endPos, ease);
        orbitControls.target.lerpVectors(activeCamTransition.startTarget, activeCamTransition.endTarget, ease);
        enforceCathedralBoundsAndSolidColumns(prevCamPos, camera.position, orbitControls.target);
        camera.lookAt(orbitControls.target);
        if (u >= 1) {
          activeCamTransition = null;
          flushOrbitControlsDamping();
        }
      } else if (orbitControls.enabled && !isAnimatingMove) {
        orbitControls.update();
        enforceCathedralBoundsAndSolidColumns(prevCamPos, camera.position, orbitControls.target);
        camera.lookAt(orbitControls.target);
      } else if (isAnimatingMove) {
        enforceCathedralBoundsAndSolidColumns(prevCamPos, camera.position, orbitControls.target);
        camera.lookAt(orbitControls.target);
      }

      if (impactFlashLight.intensity > 0) {
        impactFlashLight.intensity = Math.max(0, impactFlashLight.intensity - dt * 28);
      }
      pieceEffects.update(dt);
      if (checkFlinch) {
        const { piece: king } = checkFlinch;
        checkFlinch.t += dt / CHECK_FLINCH_DURATION;
        if (checkFlinch.t >= 1 || isAnimatingMove || !king.mesh || !king.mesh.parent) {
          if (king.mesh && !isAnimatingMove) applyPieceBaseScale(king.mesh, king.type);
          checkFlinch = null;
        } else {
          // Two quick, decaying dips: the king shrinks back from the threat and recovers.
          const dip = Math.abs(Math.sin(checkFlinch.t * Math.PI * 2)) * (1 - checkFlinch.t) * 0.12;
          applyPieceBaseScale(king.mesh, king.type, 1 + dip * 0.5, 1 - dip);
        }
      }
      if (brazierFlare > 0) brazierFlare = Math.max(0, brazierFlare - dt * 2);

      if (shatterDebris.length > 0) {
        const pieceCoords = [];
        const rows = getBoardRows();
        const cols = getBoardCols();
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const p = boardState[r]?.[c];
            if (p && p.mesh) {
              pieceCoords.push(p.mesh.position.x, p.mesh.position.z);
            }
          }
        }
        const nCoords = pieceCoords.length;

        for (let i = shatterDebris.length - 1; i >= 0; i--) {
          const d = shatterDebris[i];
          d.life -= dt;
          if (d.life <= 0) {
            scene.remove(d.mesh);
            shatterDebris.splice(i, 1);
            continue;
          }
          d.vel.y -= 9.8 * dt;
          d.mesh.position.addScaledVector(d.vel, dt);
          if (d.mesh.position.y < BOARD_SURFACE_Y + 0.03) {
            d.mesh.position.y = BOARD_SURFACE_Y + 0.03;
            d.vel.y *= -0.35;
            d.vel.x *= 0.72;
            d.vel.z *= 0.72;
          }
          // Bounce flying stone shards off intact pieces on the board so all statues feel solid
          if (d.mesh.position.y < BOARD_SURFACE_Y + 0.48) {
            const dxPos = d.mesh.position.x;
            const dzPos = d.mesh.position.z;
            for (let k = 0; k < nCoords; k += 2) {
              const px = pieceCoords[k];
              const pz = pieceCoords[k + 1];
              const rx = dxPos - px;
              const rz = dzPos - pz;
              const rDistSq = rx * rx + rz * rz;
              if (rDistSq < 0.027225 && rDistSq > 1e-8) {
                const rDist = Math.sqrt(rDistSq);
                const nx = rx / rDist;
                const nz = rz / rDist;
                d.mesh.position.x = px + nx * 0.165;
                d.mesh.position.z = pz + nz * 0.165;
                const vn = d.vel.x * nx + d.vel.z * nz;
                if (vn < 0) {
                  d.vel.x -= 1.55 * vn * nx;
                  d.vel.z -= 1.55 * vn * nz;
                }
              }
            }
          }
          d.mesh.rotation.x += d.rotVel.x * dt;
          d.mesh.rotation.y += d.rotVel.y * dt;
          d.mesh.rotation.z += d.rotVel.z * dt;
          if (d.life < 0.5) {
            const s = Math.max(0.01, d.life * 2);
            d.mesh.scale.setScalar((d.baseScale || 0.036) * s);
          }
        }
      }

      if (combatVfxList.length > 0) {
        for (let i = combatVfxList.length - 1; i >= 0; i--) {
          const vfx = combatVfxList[i];
          vfx.life -= dt;
          if (vfx.life <= 0) {
            if (vfx.mesh) scene.remove(vfx.mesh);
            if (vfx.mat && typeof vfx.mat.dispose === 'function') {
              vfx.mat.dispose();
            }
            combatVfxList.splice(i, 1);
            continue;
          }
          const u = Math.max(0, Math.min(1, 1 - vfx.life / Math.max(0.01, vfx.maxLife)));
          if (typeof vfx.updateFn === 'function') {
            vfx.updateFn(vfx, u, dt);
          }
        }
      }

      // Advance volumetric GLSL brazier flames & active warm firelight flicker
      for (let i = 0; i < brazierFireUniforms.length; i++) {
        brazierFireUniforms[i].uTime.value = elapsedTotal;
      }
      for (let i = 0; i < brazierGlowSprites.length; i++) {
        const sp = brazierGlowSprites[i];
        const baseOp = sp.userData.baseOpacity || 0.4;
        const seed = sp.userData.seed || 0;
        sp.material.opacity =
          baseOp * (1 + brazierFlare * 0.8) +
          Math.sin(elapsedTotal * 5.2 + seed) * 0.045 +
          Math.cos(elapsedTotal * 8.4 + seed * 1.3) * 0.025;
      }
      for (let i = 0; i < brazierLights.length; i++) {
        const baseInt = brazierLights[i].userData.baseIntensity || 3.2;
        brazierLights[i].intensity =
          baseInt * (1 + brazierFlare * 0.9) +
          Math.sin(elapsedTotal * 5.6 + i * 1.7) * 0.28 +
          Math.cos(elapsedTotal * 9.1 + i) * 0.16;
      }

      if (activeCheckRingMesh && activeCheckRingMesh.material) {
        activeCheckRingMesh.material.opacity = 0.65 + Math.sin(elapsedTotal * 5.0) * 0.25;
        sharedCheckLineMat.opacity = motionLevel === 'off' ? 0.5 : 0.42 + Math.sin(elapsedTotal * 5.0) * 0.16;
      }

      // Levitate & rotate the 4 Corner Sentinel Relic Crystals on the Sanctum Battle Dais
      for (let i = 0; i < sanctumRelicCrystals.length; i++) {
        const rc = sanctumRelicCrystals[i];
        if (rc.mesh) {
          rc.mesh.position.y = rc.baseY + Math.sin(elapsedTotal * 2.2 + rc.phase) * 0.032;
          rc.mesh.rotation.y = elapsedTotal * 1.15 + rc.phase;
        }
        if (rc.ring) {
          rc.ring.rotation.z = elapsedTotal * 0.85 + rc.phase;
        }
      }

      // Levitate & rotate the 8 Outer Perimeter Sentinel Relics & advance GPU Perimeter Motes
      for (let i = 0; i < sanctumOuterFloatingRelics.length; i++) {
        const orc = sanctumOuterFloatingRelics[i];
        if (orc.mesh) {
          orc.mesh.position.y = orc.baseY + Math.sin(elapsedTotal * 1.9 + orc.phase) * 0.042;
          orc.mesh.rotation.y = elapsedTotal * 0.95 + orc.phase;
        }
        if (orc.ring) {
          orc.ring.rotation.z = elapsedTotal * 0.72 + orc.phase;
        }
      }
      if (sanctumPerimeterMotesUniforms && sanctumPerimeterMotesUniforms.uTime) {
        sanctumPerimeterMotesUniforms.uTime.value = elapsedTotal;
      }

      if (isAnimatingMove || activeMoveTweens.length > 0 || checkmateState.active) {
        shadowUpdateAccum += dt;
        if (shadowUpdateAccum >= 0.042) {
          shadowUpdateAccum = 0;
          renderer.shadowMap.needsUpdate = true;
        }
      } else {
        shadowUpdateAccum = 0;
      }

      if (doRender && !isWebGLContextLost) {
        processPendingHover();
        renderFrame(dt);
        updatePieceOverheadOverlay();
      }
    }

    let manualStepMode = false;
    let rafPending = false;
    window.wizardChess.setManualStepMode = (v) => {
      const prev = manualStepMode;
      manualStepMode = Boolean(v);
      if (prev && !manualStepMode && !rafPending) {
        clock.getDelta();
        rafPending = true;
        requestAnimationFrame(animate);
      }
    };

    function feedFrameTimeSample(frameMs) {
      if (!Number.isFinite(frameMs) || frameMs <= 1.0 || frameMs >= 1000.0) {
        return currentActiveDpr;
      }
      rollingFrameMs = rollingFrameMs * 0.88 + frameMs * 0.12;
      const isMobileNow = Boolean(
        window.innerWidth <= 768 || coarsePointerQuery?.matches
      );
      trackSlowFramesForTier(frameMs, currentActiveDpr <= (isMobileNow ? 1.35 : 1.0));
      if (dprFrozen) return currentActiveDpr;
      if (isMobileNow) {
        const targetMobileRetinaDpr = Math.min(Math.max(window.devicePixelRatio || 1, 1.75), 2.0);
        if (rollingFrameMs > 28.0) {
          highFrameTimeStreak += 1;
          lowFrameTimeStreak = 0;
          if (
            highFrameTimeStreak >= 18 &&
            currentActiveDpr > 1.35 &&
            elapsedTotal - lastDprAdjustTime > 2.5
          ) {
            currentActiveDpr = 1.35;
            highFrameTimeStreak = 0;
            lastDprAdjustTime = elapsedTotal;
            applyRendererSize();
          }
        } else {
          highFrameTimeStreak = 0;
          if (rollingFrameMs < 18.5 && currentActiveDpr < targetMobileRetinaDpr) {
            lowFrameTimeStreak += 1;
            if (lowFrameTimeStreak >= 60 && elapsedTotal - lastDprAdjustTime > 4.0) {
              currentActiveDpr = targetMobileRetinaDpr;
              lowFrameTimeStreak = 0;
              lastDprAdjustTime = elapsedTotal;
              applyRendererSize();
            }
          } else {
            lowFrameTimeStreak = 0;
          }
        }
        return currentActiveDpr;
      }
      if (rollingFrameMs > 20.0) {
        highFrameTimeStreak += 1;
        lowFrameTimeStreak = 0;
        if (
          highFrameTimeStreak >= 12 &&
          currentActiveDpr > 1.0 &&
          elapsedTotal - lastDprAdjustTime > 1.5
        ) {
          currentActiveDpr = 1.0;
          highFrameTimeStreak = 0;
          lastDprAdjustTime = elapsedTotal;
          applyRendererSize();
        }
      } else {
        highFrameTimeStreak = 0;
        if (rollingFrameMs < 13.5 && currentActiveDpr < maxTargetDpr) {
          lowFrameTimeStreak += 1;
          if (lowFrameTimeStreak >= 60 && elapsedTotal - lastDprAdjustTime > 4.0) {
            currentActiveDpr = maxTargetDpr;
            lowFrameTimeStreak = 0;
            lastDprAdjustTime = elapsedTotal;
            applyRendererSize();
          }
        } else {
          lowFrameTimeStreak = 0;
        }
      }
      return currentActiveDpr;
    }
    window.wizardChess.feedFrameTimeSample = feedFrameTimeSample;

    // Once DPR can drop no further, two seconds of slow frames lower the tier for this session only.
    function trackSlowFramesForTier(frameMs, dprAtFloor) {
      if (isAutomatedTest && !window.__WIZARD_ALLOW_TIER_DOWNGRADE__) return;
      // Shader compiles and asset loads stall the first seconds; a fresh tier also needs time to settle.
      const settling = elapsedTotal < 4 || elapsedTotal - lastTierAdjustTime < 3;
      if (qualityTier === 'base' || settling || rollingFrameMs <= 20.0 || !dprAtFloor) {
        slowFrameSeconds = 0;
        return;
      }
      // Cap each sample so one long hitch cannot count as two seconds of slow play.
      slowFrameSeconds += Math.min(frameMs, 50) / 1000;
      if (slowFrameSeconds < 2) return;
      slowFrameSeconds = 0;
      lastTierAdjustTime = elapsedTotal;
      rollingFrameMs = 16.67;
      qualityTier = downgradeTier(qualityTier);
      qualityTierSource = 'downgraded';
      announceVisualSettings();
    }

    // Test-only frame recorder: real deltas between frames into a fixed buffer, no per-frame allocation.
    const frameRecorder = new Float32Array(4096);
    let frameRecorderCount = -1;
    let frameRecorderLast = 0;
    let dprFrozen = false;
    window.wizardChess.startFrameRecorder = () => {
      frameRecorderCount = 0;
      frameRecorderLast = performance.now();
    };
    window.wizardChess.stopFrameRecorder = () => {
      const count = Math.max(0, frameRecorderCount);
      frameRecorderCount = -1;
      const sorted = Array.from(frameRecorder.subarray(0, count)).sort((a, b) => a - b);
      const at = (q) => (count ? Number(sorted[Math.min(count - 1, Math.floor(count * q))].toFixed(2)) : 0);
      const mean = count ? sorted.reduce((n, v) => n + v, 0) / count : 0;
      return {
        count,
        mean: Number(mean.toFixed(2)),
        p50: at(0.5),
        p95: at(0.95),
        max: count ? Number(sorted[count - 1].toFixed(2)) : 0,
        over33: sorted.filter((v) => v > 33).length
      };
    };
    /** Holds the adaptive DPR still (optionally at a given value) so perf runs measure a fixed pixel count. */
    window.wizardChess.freezeDpr = (on, dpr) => {
      dprFrozen = Boolean(on);
      if (dprFrozen && Number.isFinite(dpr)) {
        currentActiveDpr = dpr;
        applyRendererSize();
      }
      return currentActiveDpr;
    };

    function animate() {
      rafPending = false;
      if (manualStepMode) return;
      rafPending = true;
      requestAnimationFrame(animate);
      if (frameRecorderCount >= 0 && frameRecorderCount < frameRecorder.length) {
        const now = performance.now();
        frameRecorder[frameRecorderCount++] = now - frameRecorderLast;
        frameRecorderLast = now;
      }
      const rawDelta = clock.getDelta();
      if (rawDelta > 0.001 && rawDelta < 1.0) {
        feedFrameTimeSample(rawDelta * 1000);
      }
      const dt = Math.min(rawDelta, 0.1);
      stepScene(dt || 0.016, true);
    }

    function handleViewportResize() {
      const isMobileNow = Boolean(
        window.innerWidth <= 768 || coarsePointerQuery?.matches
      );
      if (isMobileNow) {
        currentActiveDpr = Math.min(Math.max(window.devicePixelRatio || 1, 1.75), 2.0);
      }
      camera.aspect = window.innerWidth / window.innerHeight;
      syncResponsiveCameraFov();
      camera.updateProjectionMatrix();
      applyRendererSize();
      // The saved kill-cam pose no longer frames the new viewport, so a resize ends it.
      endKillCam(true);
      if (!isAnimatingMove) {
        if (document.getElementById('btn-cam-player')?.classList.contains('active')) {
          setCameraForSide(playerCamSide, true);
        } else if (document.getElementById('btn-cam-spectator')?.classList.contains('active')) {
          const pose = getSpectatorPose(spectatorCamSide, getPortraitFramingFactor());
          activeCamTransition = null;
          camera.position.copy(pose.pos);
          orbitControls.target.copy(pose.lookAt);
          flushOrbitControlsDamping();
        } else if (document.getElementById('btn-cam-top')?.classList.contains('active')) {
          const tPortrait = getPortraitFramingFactor();
          const zSign = overheadCamSide === 'b' ? -1 : 1;
          camera.position.set(0, 7.35 + tPortrait * 1.45, zSign * (3.95 + tPortrait * 0.45));
          orbitControls.target.set(0, 0.78, zSign * (-tPortrait * 0.28));
          flushOrbitControlsDamping();
        }
      }
      if (!isWebGLContextLost) {
        renderFrame();
        updatePieceOverheadOverlay();
      }
    }

    // Mobile URL-bar show/hide fires bursts of resize events; apply at most one per frame.
    let resizeRafId = 0;
    function scheduleViewportResize() {
      if (resizeRafId) return;
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = 0;
        handleViewportResize();
      });
    }
    window.addEventListener('resize', scheduleViewportResize);
    window.visualViewport?.addEventListener('resize', scheduleViewportResize);


    // Startup sequence (Standalone Single-Player AI Studio Applet)
    (async () => {
      try {
        await loadAllAssets();
      } catch (err) {
        console.warn('Startup asset load warning:', err);
      } finally {
        const params = new URLSearchParams(window.location.search);
        const urlSide = params.get('side');
        const urlMode = (params.get('mode') || '').toLowerCase();
        const urlVariant = (params.get('variant') || params.get('game') || '').toLowerCase();
        const urlRoom = (params.get('room') || '').trim().toUpperCase();
        if (urlVariant === 'xiangqi' || urlVariant === 'cotuong') {
          gameVariant = 'xiangqi';
          chessBoardDeckGroup.visible = false;
          xiangqiBoardDeckGroup.visible = true;
          closeGameSelectorModal();
        } else if (urlVariant === 'chess' || urlVariant === 'covua') {
          closeGameSelectorModal();
        }
        if (urlRoom) {
          closeGameSelectorModal();
        }
        syncGameSelectorUI();
        if (urlMode === '2p' || urlMode === 'pass' || urlMode === 'hotseat') {
          isPassAndPlay = true;
          aiAutoPlay = false;
        } else if (urlSide === 'b' || urlSide === 'black') {
          playerColor = 'b';
        }
        const loadingTextEl = document.getElementById('loading-text');
        if (loadingTextEl) {
          loadingTextEl.textContent = 'Awakening the Sanctum Altar...';
        }
        resetChessBoard(true, true);
        if (urlRoom) {
          await joinMultiplayerRoom(urlRoom);
        }
        for (let i = 0; i < 15; i++) {
          stepScene(0.9 / 15, false);
        }
        if (typeof renderer.compileAsync === 'function') {
          try {
            await renderer.compileAsync(scene, camera);
          } catch (compileErr) {
            console.warn('Shader pre-compile warning:', compileErr);
          }
        }
        renderer.shadowMap.needsUpdate = true;
        renderFrame();
        clock.getDelta();
        if (!manualStepMode) {
          animate();
        }
        document.getElementById('loading-overlay')?.classList.add('hidden');
      }
    })();
}
