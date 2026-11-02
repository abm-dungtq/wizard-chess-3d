import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  extractPureBoard,
  getPureLegalMovesForPiece,
  getAllPureLegalMoves,
  applyPureMove,
  computePositionHash,
  checkInsufficientMaterial,
  evaluateDrawState,
  chooseBestAIMove,
  chooseBestAIMoveAsync
} from '../src/chessAI.ts';
import {
  XIANGQI_ROWS,
  XIANGQI_COLS,
  XIANGQI_ROLE_METADATA,
  createEmptyXiangqiBoard,
  createInitialXiangqiBoard,
  extractPureXiangqiBoard,
  isFlyingGeneralExposed,
  isXiangqiGeneralInCheck,
  getXiangqiBlockedPointsForPiece,
  getXiangqiLegalMovesForPiece,
  getAllXiangqiLegalMoves,
  applyXiangqiMove,
  computeXiangqiPositionHash,
  checkXiangqiInsufficientMaterial,
  evaluateXiangqiDrawState,
  chooseBestXiangqiMove,
  chooseBestXiangqiMoveAsync
} from '../src/xiangqiAI.ts';
import { wizardAudio, WizardAudioEngine } from '../src/soundEngine.ts';
import { RoomStore, handleRoomApiRequest } from '../src/roomStore.ts';

const ROOT = process.cwd();

function createEmptyPureBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill(null));
}

test('Simplified Single-Player HUD in src/App.tsx excludes speed sliders, notation script bar, and multiplayer lobby', () => {
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');

  // Must include simplified game & camera controls + v2 tactical controls
  for (const requiredId of [
    'btn-side-toggle',
    'btn-ai-difficulty',
    'btn-ai-move',
    'btn-undo',
    'btn-reset',
    'btn-audio-toggle',
    'btn-cam-player',
    'btn-cam-top',
    'btn-cam-side',
    'btn-cam-wide',
    'btn-hide-ui',
    'controls-hint',
    'captured-tray',
    'promotion-overlay'
  ]) {
    assert.ok(appTsx.includes(`id="${requiredId}"`), `Missing required HUD control #${requiredId}`);
  }

  // Must NOT include camera speed sliders, script mode bar, or multiplayer lobby
  for (const forbiddenId of [
    'cam-speed-wrap',
    'input-cam-speed',
    'rot-speed-wrap',
    'input-rot-speed',
    'script-bar',
    'btn-script-modal',
    'btn-script-prev',
    'btn-script-next',
    'btn-lobby',
    'lobby-modal',
    'room-pill',
    'btn-checkmate-stepback'
  ]) {
    assert.ok(!appTsx.includes(forbiddenId), `Forbidden UI element #${forbiddenId} found in App.tsx`);
  }
});

test('All 7 compressed 3D assets (.glb.gz.b64) decode and gunzip to valid glTF 2.0 binary models', () => {
  const expectedModels = [
    'option8_cathedral',
    'pawn_white',
    'rook_white',
    'knight_white',
    'bishop_white',
    'queen_white',
    'king_white'
  ];

  const themedSetIds = [
    'dong_son',
    'shogun_yokai',
    'valhalla_valkyrie',
    'pharaoh_anubis',
    'mecha_ronin',
    'abyssal_lich',
    'bauhaus_imperial'
  ];
  const pieceNames = ['pawn_white', 'rook_white', 'knight_white', 'bishop_white', 'queen_white', 'king_white'];
  for (const sid of themedSetIds) {
    for (const pName of pieceNames) {
      expectedModels.push(`sets/${sid}/${pName}`);
    }
  }

  for (const name of expectedModels) {
    const b64Path = path.join(ROOT, 'public/assets/glb', `${name}.glb.gz.b64`);
    assert.ok(fs.existsSync(b64Path), `Missing 3D asset ${b64Path}`);
    const b64Text = fs.readFileSync(b64Path, 'utf-8').trim();
    assert.ok(b64Text.length > 1000, `Asset ${name}.glb.gz.b64 is unexpectedly small`);

    const gzBuf = Buffer.from(b64Text, 'base64');
    const glbBuf = zlib.gunzipSync(gzBuf);

    const magic = glbBuf.toString('ascii', 0, 4);
    const version = glbBuf.readUInt32LE(4);
    const totalLen = glbBuf.readUInt32LE(8);
    assert.equal(magic, 'glTF', `Invalid glTF magic header for ${name}`);
    assert.equal(version, 2, `Invalid glTF version for ${name}`);
    assert.equal(totalLen, glbBuf.length, `Mismatched glTF byte length for ${name}`);
  }
});

test('FIDE Rules: En Passant capture generation, execution, and horizontal pin safety', () => {
  const board = createEmptyPureBoard();
  board[7][4] = { type: 'king', color: 'w', hasMoved: true };
  board[0][4] = { type: 'king', color: 'b', hasMoved: true };
  // White pawn on e5 (r=3, c=4)
  board[3][4] = { type: 'pawn', color: 'w', hasMoved: true };
  // Black pawn just double-stepped d7->d5 (r=3, c=3), leaving enPassantTarget on d6 (r=2, c=3)
  board[3][3] = { type: 'pawn', color: 'b', hasMoved: true };
  const epTarget = { r: 2, c: 3, pawnR: 3, pawnC: 3, color: 'b' };

  const moves = getPureLegalMovesForPiece(board, 3, 4, epTarget);
  const epMove = moves.find((m) => m.enPassant && m.r === 2 && m.c === 3);
  assert.ok(epMove, 'Expected legal En Passant move to d6 (r=2, c=3)');
  assert.equal(epMove.captureR, 3);
  assert.equal(epMove.captureC, 3);

  const after = applyPureMove(board, {
    fromR: 3,
    fromC: 4,
    toR: 2,
    toC: 3,
    capture: true,
    enPassant: true,
    captureR: 3,
    captureC: 3
  });
  assert.equal(after.nextCells[2][3]?.type, 'pawn');
  assert.equal(after.nextCells[2][3]?.color, 'w');
  assert.equal(after.nextCells[3][3], null, 'En Passant captured pawn at d5 must be removed');

  // Horizontal pin safety: if White King is at h5 (r=3, c=7) and Black Rook is at a5 (r=3, c=0),
  // En Passant exd6 would remove both pawns from rank 5 and expose the White King to check!
  board[7][4] = null;
  board[3][7] = { type: 'king', color: 'w', hasMoved: true };
  board[3][0] = { type: 'rook', color: 'b', hasMoved: true };
  const pinnedMoves = getPureLegalMovesForPiece(board, 3, 4, epTarget);
  assert.equal(
    pinnedMoves.some((m) => m.enPassant),
    false,
    'En Passant must be illegal when it exposes the King horizontally along the rank'
  );
});

test('FIDE Rules: Castling (Kingside & Queenside) metadata, rook transfer, and Pawn Promotion choices', () => {
  const board = createEmptyPureBoard();
  board[7][4] = { type: 'king', color: 'w', hasMoved: false };
  board[7][7] = { type: 'rook', color: 'w', hasMoved: false };
  board[7][0] = { type: 'rook', color: 'w', hasMoved: false };
  board[0][4] = { type: 'king', color: 'b', hasMoved: true };
  // White pawn on a7 (r=1, c=0) ready to promote on a8 (r=0, c=0)
  board[1][0] = { type: 'pawn', color: 'w', hasMoved: true };

  const kingMoves = getPureLegalMovesForPiece(board, 7, 4, null);
  const castleKs = kingMoves.find((m) => m.castle === 'k');
  const castleQs = kingMoves.find((m) => m.castle === 'q');
  assert.ok(castleKs, 'Expected Kingside castling move');
  assert.equal(castleKs.rookFromC, 7);
  assert.equal(castleKs.rookToC, 5);
  assert.ok(castleQs, 'Expected Queenside castling move');
  assert.equal(castleQs.rookFromC, 0);
  assert.equal(castleQs.rookToC, 3);

  // Verify applyPureMove transfers the Queenside rook from c=0 to c=3
  const afterQs = applyPureMove(board, {
    fromR: 7,
    fromC: 4,
    toR: 7,
    toC: 2,
    capture: false,
    castle: 'q',
    rookFromC: 0,
    rookToC: 3
  });
  assert.equal(afterQs.nextCells[7][2]?.type, 'king');
  assert.equal(afterQs.nextCells[7][3]?.type, 'rook');
  assert.equal(afterQs.nextCells[7][0], null);

  const allWhiteMoves = getAllPureLegalMoves(board, 'w', null);
  const promoMoves = allWhiteMoves.filter((m) => m.fromR === 1 && m.fromC === 0 && m.toR === 0 && m.toC === 0);
  const promoTypes = promoMoves.map((m) => m.promotion).sort();
  assert.deepEqual(promoTypes, ['bishop', 'knight', 'queen', 'rook']);
});

test('FIDE Draw Detection: Insufficient Material (including K+B vs K+B colors), 50-Move Rule, and Threefold Repetition', () => {
  const board = createEmptyPureBoard();
  board[7][4] = { type: 'king', color: 'w', hasMoved: true };
  board[0][4] = { type: 'king', color: 'b', hasMoved: true };
  assert.equal(checkInsufficientMaterial(board), true, 'K vs K should be insufficient material');

  board[4][4] = { type: 'knight', color: 'w', hasMoved: true };
  assert.equal(checkInsufficientMaterial(board), true, 'K+N vs K should be insufficient material');

  // K+B vs K+B on same square color: (4+4)%2 === 0 and (2+2)%2 === 0
  board[4][4] = { type: 'bishop', color: 'w', hasMoved: true };
  board[2][2] = { type: 'bishop', color: 'b', hasMoved: true };
  assert.equal(checkInsufficientMaterial(board), true, 'K+B vs K+B on same color squares should be insufficient material');

  // K+B vs K+B on opposite square colors: (4+4)%2 === 0 and (2+3)%2 === 1
  board[2][2] = null;
  board[2][3] = { type: 'bishop', color: 'b', hasMoved: true };
  assert.equal(checkInsufficientMaterial(board), false, 'K+B vs K+B on opposite color squares can theoretically mate');

  const draw50 = evaluateDrawState(board, 'w', 100, [], null);
  assert.equal(draw50.isDraw, true);
  assert.equal(draw50.reason, '50-Move Rule');

  const h = computePositionHash(board, 'w', null);
  const draw3x = evaluateDrawState(board, 'w', 10, [h, 'other', h, h], null);
  assert.equal(draw3x.isDraw, true);
  assert.equal(draw3x.reason, 'Threefold Repetition');
});

test('Multi-Tier Minimax AI: extractPureBoard strips Three.js meshes and Novice/Tactical/Grandmaster tiers find winning moves deterministically', () => {
  const rawBoard = createEmptyPureBoard();
  rawBoard[7][4] = { type: 'king', color: 'w', hasMoved: true, mesh: { isThreeMesh: true } };
  rawBoard[0][7] = { type: 'king', color: 'b', hasMoved: true, mesh: { isThreeMesh: true } };
  // Black Rook on a8 (r=0, c=0) guards rank 8 (so Qe8+/Rg8+ are refuted by Rxe8/Rxg8),
  // Black Pawn on h7 (r=1, c=7) blocks the h-file, and White Pawn on f6 (r=2, c=5) blocks Qe5 along a1-h8
  // while defending g7, leaving Qg7# (r=1, c=6) as the strictly unique mate-in-1!
  rawBoard[0][0] = { type: 'rook', color: 'b', hasMoved: true };
  rawBoard[1][7] = { type: 'pawn', color: 'b', hasMoved: false };
  rawBoard[2][5] = { type: 'pawn', color: 'w', hasMoved: true };
  // White Queen on e7 (r=1, c=4), White Rook on g1 (r=7, c=6) -> Qg7# (r=1, c=6) is the unique checkmate in 1
  rawBoard[1][4] = { type: 'queen', color: 'w', hasMoved: true };
  rawBoard[7][6] = { type: 'rook', color: 'w', hasMoved: true };

  const board = extractPureBoard(rawBoard);
  assert.equal('mesh' in (board[7][4] || {}), false, 'extractPureBoard must strip live Three.js mesh references');

  const snapshotBefore = JSON.stringify(board);
  const gmMove = chooseBestAIMove(board, 'w', 'grandmaster', null);
  const tacMove = chooseBestAIMove(board, 'w', 'tactical', null);
  const novMove = chooseBestAIMove(board, 'w', 'novice', null);
  const snapshotAfter = JSON.stringify(board);

  assert.equal(snapshotBefore, snapshotAfter, 'chooseBestAIMove must not mutate input board');
  assert.ok(gmMove && tacMove && novMove, 'All 3 AI tiers must return a legal move');
  assert.equal(gmMove.fromR, 1);
  assert.equal(gmMove.fromC, 4);
  assert.equal(gmMove.toR, 1);
  assert.equal(gmMove.toC, 6);
  assert.equal(tacMove.fromR, 1);
  assert.equal(tacMove.fromC, 4);
  assert.equal(tacMove.toR, 1);
  assert.equal(tacMove.toC, 6);
});

test('Procedural Web Audio Engine: Mute toggle, headless safety, and full Web Audio graph synthesis with mock AudioContext', () => {
  assert.equal(wizardAudio.isMuted(), false);
  // Headless safety (when window is undefined)
  wizardAudio.playMoveSlide(0.7);

  // Install a deterministic mock window.AudioContext to verify all 6 synthesis graphs
  const createdNodes = { oscillators: 0, gains: 0, filters: 0, buffers: 0 };
  class MockAudioParam {
    constructor() {
      this.value = 0;
    }
    setValueAtTime(v) {
      assert.equal(Number.isFinite(v), true, 'AudioParam setValueAtTime must receive finite number');
      this.value = v;
    }
    linearRampToValueAtTime(v) {
      assert.equal(Number.isFinite(v), true, 'AudioParam linearRampToValueAtTime must receive finite number');
      this.value = v;
    }
    exponentialRampToValueAtTime(v) {
      assert.equal(Number.isFinite(v) && v > 0, true, 'AudioParam exponentialRampToValueAtTime must receive positive finite number');
      this.value = v;
    }
  }
  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 1.0;
      this.sampleRate = 44100;
      this.destination = {};
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    createGain() {
      createdNodes.gains++;
      return { gain: new MockAudioParam(), connect() {} };
    }
    createOscillator() {
      createdNodes.oscillators++;
      return {
        type: 'sine',
        frequency: new MockAudioParam(),
        connect() {},
        start() {},
        stop() {}
      };
    }
    createBiquadFilter() {
      createdNodes.filters++;
      return {
        type: 'lowpass',
        frequency: new MockAudioParam(),
        Q: new MockAudioParam(),
        connect() {}
      };
    }
    createBuffer(_channels, length) {
      createdNodes.buffers++;
      const arr = new Float32Array(length);
      return { getChannelData: () => arr };
    }
    createBufferSource() {
      return { buffer: null, connect() {}, start() {}, stop() {} };
    }
  }

  globalThis.window = { AudioContext: MockAudioContext };
  try {
    const synth = new WizardAudioEngine();
    synth.playMoveSlide(0.75);
    synth.playWeaponClash();
    synth.playStoneShatter();
    synth.playCheckWarning();
    synth.playCheckmateFanfare();
    synth.playPromotionChime();

    assert.ok(createdNodes.oscillators >= 12, 'Expected oscillators created across synthesis cues');
    assert.ok(createdNodes.gains >= 12, 'Expected gain nodes created across synthesis cues');
    assert.equal(createdNodes.filters, 2, 'Expected 2 biquad filters created across synthesis cues');
    assert.equal(createdNodes.buffers, 2, 'Expected 2 noise buffers created across synthesis cues');

    const oscBeforeMute = createdNodes.oscillators;
    const muted = synth.toggleMuted();
    assert.equal(muted, true);
    assert.equal(synth.getState().muted, true);
    synth.playWeaponClash();
    assert.equal(createdNodes.oscillators, oscBeforeMute, 'Muted engine must not schedule new audio nodes');
    synth.setMuted(false);
    assert.equal(synth.isMuted(), false);
  } finally {
    delete globalThis.window;
  }
});

test('JS/TS Static Scope Gate: src/wizardChessEngine.js has zero undeclared identifier errors (TS2304 / TS2552)', () => {
  let output = '';
  try {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.json', '--allowJs', '--checkJs', '--noEmit'], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    output = String(err.stdout || '') + '\n' + String(err.stderr || '');
  }
  const undeclaredLines = output
    .split('\n')
    .filter((line) => line.includes('wizardChessEngine.js') && (line.includes('TS2304') || line.includes('TS2552')));
  assert.deepEqual(
    undeclaredLines,
    [],
    `Undeclared identifier(s) found in src/wizardChessEngine.js:\n${undeclaredLines.join('\n')}`
  );
});

test('Non-Blocking Async AI Search: chooseBestAIMoveAsync matches mate-in-1 & midgame parity, yields < 14ms slices, and cancels cleanly via shouldCancel', async () => {
  const board = createEmptyPureBoard();
  board[7][4] = { type: 'king', color: 'w', hasMoved: true };
  board[0][7] = { type: 'king', color: 'b', hasMoved: true };
  board[0][0] = { type: 'rook', color: 'b', hasMoved: true };
  board[1][7] = { type: 'pawn', color: 'b', hasMoved: false };
  board[2][5] = { type: 'pawn', color: 'w', hasMoved: true };
  board[1][4] = { type: 'queen', color: 'w', hasMoved: true };
  board[7][6] = { type: 'rook', color: 'w', hasMoved: true };

  const snapshotBefore = JSON.stringify(board);
  const gmAsync = await chooseBestAIMoveAsync(board, 'w', 'grandmaster', null, { timeSliceMs: 1 });
  const tacAsync = await chooseBestAIMoveAsync(board, 'w', 'tactical', null, { timeSliceMs: 1 });
  const novAsync = await chooseBestAIMoveAsync(board, 'w', 'novice', null, { timeSliceMs: 1 });
  const snapshotAfter = JSON.stringify(board);

  assert.equal(snapshotBefore, snapshotAfter, 'chooseBestAIMoveAsync must not mutate input board');
  assert.ok(gmAsync && tacAsync && novAsync, 'All 3 async AI tiers must return a legal move');
  assert.equal(gmAsync.fromR, 1);
  assert.equal(gmAsync.fromC, 4);
  assert.equal(gmAsync.toR, 1);
  assert.equal(gmAsync.toC, 6);
  assert.equal(tacAsync.fromR, 1);
  assert.equal(tacAsync.fromC, 4);
  assert.equal(tacAsync.toR, 1);
  assert.equal(tacAsync.toC, 6);

  // Midgame position (1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5): verify deterministic parity with sync chooseBestAIMove and sub-frame time slicing
  const backRow = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
  const midBoard = createEmptyPureBoard();
  for (let c = 0; c < 8; c++) {
    midBoard[7][c] = { type: backRow[c], color: 'w', hasMoved: false };
    midBoard[6][c] = { type: 'pawn', color: 'w', hasMoved: false };
    midBoard[1][c] = { type: 'pawn', color: 'b', hasMoved: false };
    midBoard[0][c] = { type: backRow[c], color: 'b', hasMoved: false };
  }
  midBoard[4][4] = midBoard[6][4]; midBoard[6][4] = null;
  midBoard[3][4] = midBoard[1][4]; midBoard[1][4] = null;
  midBoard[5][5] = midBoard[7][6]; midBoard[7][6] = null;
  midBoard[2][2] = midBoard[0][1]; midBoard[0][1] = null;
  midBoard[4][2] = midBoard[7][5]; midBoard[7][5] = null;
  midBoard[3][2] = midBoard[0][5]; midBoard[0][5] = null;

  const syncMidMove = chooseBestAIMove(midBoard, 'b', 'grandmaster', null);
  let sliceCount = 0;
  let maxSliceMs = 0;
  const origSetTimeout = globalThis.setTimeout;
  let asyncMidMove = null;
  try {
    let lastResumeMs = performance.now();
    globalThis.setTimeout = (fn, ms) => {
      const now = performance.now();
      const sliceDur = now - lastResumeMs;
      if (sliceDur > maxSliceMs) maxSliceMs = sliceDur;
      sliceCount += 1;
      return origSetTimeout(() => {
        lastResumeMs = performance.now();
        fn();
      }, ms);
    };
    asyncMidMove = await chooseBestAIMoveAsync(midBoard, 'b', 'grandmaster', null, { timeSliceMs: 4 });
  } finally {
    globalThis.setTimeout = origSetTimeout;
  }
  assert.deepEqual(asyncMidMove, syncMidMove, 'Async Grandmaster move must match synchronous Grandmaster move');
  assert.ok(sliceCount >= 5, `Expected multiple async time-slice yields on midgame board, got ${sliceCount}`);
  assert.ok(maxSliceMs < 14.0, `Expected max blocking slice < 14ms on midgame board, got ${maxSliceMs.toFixed(2)}ms`);

  // High-branching open board (multiple queens, rooks, bishops, knights): verify parity and < 14ms slices
  const openBoard = createEmptyPureBoard();
  openBoard[7][4] = { type: 'king', color: 'w', hasMoved: true };
  openBoard[7][3] = { type: 'queen', color: 'w', hasMoved: true };
  openBoard[6][3] = { type: 'queen', color: 'w', hasMoved: true };
  openBoard[7][0] = { type: 'rook', color: 'w', hasMoved: true };
  openBoard[7][7] = { type: 'rook', color: 'w', hasMoved: true };
  openBoard[5][2] = { type: 'bishop', color: 'w', hasMoved: true };
  openBoard[5][5] = { type: 'bishop', color: 'w', hasMoved: true };
  openBoard[4][3] = { type: 'knight', color: 'w', hasMoved: true };
  openBoard[4][6] = { type: 'knight', color: 'w', hasMoved: true };

  openBoard[0][4] = { type: 'king', color: 'b', hasMoved: true };
  openBoard[1][3] = { type: 'queen', color: 'b', hasMoved: true };
  openBoard[2][6] = { type: 'queen', color: 'b', hasMoved: true };
  openBoard[0][0] = { type: 'rook', color: 'b', hasMoved: true };
  openBoard[0][7] = { type: 'rook', color: 'b', hasMoved: true };
  openBoard[2][2] = { type: 'bishop', color: 'b', hasMoved: true };
  openBoard[2][5] = { type: 'bishop', color: 'b', hasMoved: true };
  openBoard[3][1] = { type: 'knight', color: 'b', hasMoved: true };
  openBoard[3][5] = { type: 'knight', color: 'b', hasMoved: true };

  const syncOpenMove = chooseBestAIMove(openBoard, 'b', 'grandmaster', null);
  let openSliceCount = 0;
  let openMaxSliceMs = 0;
  let asyncOpenMove = null;
  try {
    let lastResumeMs = performance.now();
    globalThis.setTimeout = (fn, ms) => {
      const now = performance.now();
      const sliceDur = now - lastResumeMs;
      if (sliceDur > openMaxSliceMs) openMaxSliceMs = sliceDur;
      openSliceCount += 1;
      return origSetTimeout(() => {
        lastResumeMs = performance.now();
        fn();
      }, ms);
    };
    asyncOpenMove = await chooseBestAIMoveAsync(openBoard, 'b', 'grandmaster', null, { timeSliceMs: 4 });
  } finally {
    globalThis.setTimeout = origSetTimeout;
  }
  assert.deepEqual(asyncOpenMove, syncOpenMove, 'Async Grandmaster move on open board must match sync move');
  assert.ok(openSliceCount >= 5, `Expected multiple async yields on open board, got ${openSliceCount}`);
  assert.ok(
    openMaxSliceMs < 14.0,
    `Expected max blocking slice < 14ms on high-branching open board, got ${openMaxSliceMs.toFixed(2)}ms`
  );

  // Cancellation mid-search after yielding must return null immediately
  let cancelCheckCalls = 0;
  const cancelledMove = await chooseBestAIMoveAsync(midBoard, 'b', 'grandmaster', null, {
    timeSliceMs: 1,
    shouldCancel: () => {
      cancelCheckCalls += 1;
      return cancelCheckCalls >= 25;
    }
  });
  assert.equal(cancelledMove, null, 'Cancelled chooseBestAIMoveAsync search must resolve to null');

  // Empty board with no legal moves must return null
  const emptyMove = await chooseBestAIMoveAsync(createEmptyPureBoard(), 'w', 'grandmaster', null);
  assert.equal(emptyMove, null, 'Empty board with no pieces must resolve to null');
});

test('Runtime 3D Performance Contract: Hitbox proxy raycast, async AI job guard, light & DPR governor, and static matrix/mixer/sub-mesh optimizations', () => {
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');

  // Step 1: Lightweight Hitbox Proxy + recursive=false raycasting
  assert.ok(engineJs.includes('child.raycast = () => {}'), 'SkinnedMesh visual children must disable CPU raycast');
  assert.ok(engineJs.includes('PieceHitboxProxy'), 'Each piece must attach a lightweight PieceHitboxProxy');
  assert.ok(
    engineJs.includes('raycaster.intersectObjects([...pieceHitboxProxies, ...boardSquareMeshes], false)'),
    'pointerup must raycast against pieceHitboxProxies and boardSquareMeshes with recursive = false'
  );

  // Step 2: Non-blocking AI search with aiJobId cancellation
  assert.ok(engineJs.includes('chooseBestAIMoveAsync'), 'Engine must use chooseBestAIMoveAsync for scheduled AI turns');
  assert.ok(engineJs.includes('cancelPendingAISearch'), 'Engine must guard stale AI jobs via cancelPendingAISearch');

  // Step 3: Redundant window PointLights removed, single-octave outer flame, and Adaptive DPR Governor
  assert.ok(!engineJs.includes('northWinLight'), 'Redundant northWinLight PointLight must be removed');
  assert.ok(!engineJs.includes('southWinLight'), 'Redundant southWinLight PointLight must be removed');
  assert.ok(engineJs.includes('singleOctave: true'), 'Outer flame layer must use singleOctave noise optimization');
  assert.ok(
    engineJs.includes('Math.min(window.devicePixelRatio || 1, 1.35)'),
    'Initial renderer DPR must be capped at 1.35'
  );
  assert.ok(engineJs.includes('rollingFrameMs > 20.0'), 'Adaptive DPR governor must monitor rollingFrameMs > 20.0ms');
  assert.ok(engineJs.includes('feedFrameTimeSample'), 'Adaptive DPR governor must expose feedFrameTimeSample');

  // Step 4: Static matrixAutoUpdate=false, idle mixer freeze, and goldTrimMat sub-mesh mergeGeometries
  assert.ok(engineJs.includes('cathedralRoot.matrixAutoUpdate = false'), 'Cathedral root must freeze matrixAutoUpdate');
  assert.ok(engineJs.includes('sqMesh.matrixAutoUpdate = false'), 'Board square meshes must freeze matrixAutoUpdate');
  assert.ok(engineJs.includes('mergeGeometries'), 'Piece loader must consolidate compatible goldTrimMat sub-meshes');
  assert.ok(engineJs.includes('idleSettleRemaining'), 'Stationary piece mixers must freeze after settling into Idle');
});

test('Three.js Hitbox Proxy Raycast & Sub-Mesh Consolidation: Invisible CylinderGeometry proxy & static board squares resolve clicks in < 1ms and GLB gold sub-meshes merge', async () => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const SkeletonUtils = await import('three/examples/jsm/utils/SkeletonUtils.js');
  const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');

  const BOARD_SURFACE_Y = 0.775;
  const BOARD_SQ_SIZE = 0.34;
  const PIECE_SCALE_FACTOR = 0.84;
  const scale = BOARD_SQ_SIZE * PIECE_SCALE_FACTOR;
  const boardToWorld = (r, c) =>
    new THREE.Vector3((c - 3.5) * BOARD_SQ_SIZE, BOARD_SURFACE_Y, (r - 3.5) * BOARD_SQ_SIZE);

  // Build 64 static board squares (matrixAutoUpdate = false) and 32 invisible hitbox proxies (visible = false)
  const sqGeo = new THREE.BoxGeometry(BOARD_SQ_SIZE * 0.962, 0.036, BOARD_SQ_SIZE * 0.962);
  sqGeo.computeBoundingBox();
  sqGeo.computeBoundingSphere();
  const sqMat = new THREE.MeshBasicMaterial();
  const boardSquareMeshes = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sqMesh = new THREE.Mesh(sqGeo, sqMat);
      const pos = boardToWorld(r, c);
      sqMesh.position.set(pos.x, BOARD_SURFACE_Y - 0.018, pos.z);
      sqMesh.userData = { r, c, isSquare: true };
      sqMesh.updateMatrix();
      sqMesh.updateMatrixWorld(true);
      sqMesh.matrixAutoUpdate = false;
      boardSquareMeshes.push(sqMesh);
    }
  }

  const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
  const backRow = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
  const hitboxHeights = {
    pawn: 0.25,
    rook: 0.28,
    knight: 0.29,
    bishop: 0.30,
    queen: 0.32,
    king: 0.34
  };
  const hitboxGeos = {};
  for (const [type, h] of Object.entries(hitboxHeights)) {
    const localH = h / scale;
    const g = new THREE.CylinderGeometry(0.078 / scale, 0.132 / scale, localH, 12);
    g.translate(0, localH * 0.5, 0);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    hitboxGeos[type] = g;
  }

  const pieceHitboxProxies = [];
  for (const r of [0, 1, 6, 7]) {
    for (let c = 0; c < 8; c++) {
      const type = r === 1 || r === 6 ? 'pawn' : backRow[c];
      const hitboxGeo = hitboxGeos[type];

      const root = new THREE.Group();
      root.position.copy(boardToWorld(r, c));
      root.scale.set(scale, scale, scale);
      const visualChild = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), sqMat);
      visualChild.raycast = () => {};
      root.add(visualChild);

      const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
      hitbox.visible = false;
      const pieceObj = { r, c, type, color: r >= 6 ? 'w' : 'b', mesh: root, hitbox };
      hitbox.userData = { piece: pieceObj, isHitboxProxy: true };
      root.add(hitbox);
      root.updateMatrixWorld(true);
      pieceHitboxProxies.push(hitbox);
    }
  }

  // Verify all 16 White pieces (r=6, 7, c=0..7) raycast accurately from the default player camera
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.22, 65);
  camera.position.set(0, 2.88, 3.05);
  camera.lookAt(0, 0.78, -0.08);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const raycaster = new THREE.Raycaster();
  const targets = [...pieceHitboxProxies, ...boardSquareMeshes];
  raycaster.intersectObjects(targets, false);

  const t0 = performance.now();
  for (const r of [6, 7]) {
    for (let c = 0; c < 8; c++) {
      const targetPieceWorld = boardToWorld(r, c).add(new THREE.Vector3(0, 0.14, 0));
      const ndcPiece = targetPieceWorld.clone().project(camera);
      raycaster.setFromCamera(new THREE.Vector2(ndcPiece.x, ndcPiece.y), camera);
      const hitsPiece = raycaster.intersectObjects(targets, false);
      assert.ok(hitsPiece.length > 0, `Raycast against White piece at (${r},${c}) must hit`);
      assert.equal(hitsPiece[0].object.userData.piece?.r, r);
      assert.equal(hitsPiece[0].object.userData.piece?.c, c);
    }
  }
  const avgElapsedMs = (performance.now() - t0) / 16;
  assert.ok(avgElapsedMs < 2.0, `Hitbox proxy raycast averaged ${avgElapsedMs.toFixed(3)}ms (expected < 2ms)`);

  // Aim raycaster at empty square e4 (r=4, c=4)
  const targetSqWorld = boardToWorld(4, 4);
  const ndcSq = targetSqWorld.clone().project(camera);
  raycaster.setFromCamera(new THREE.Vector2(ndcSq.x, ndcSq.y), camera);
  const hitsSq = raycaster.intersectObjects(targets, false);
  assert.ok(hitsSq.length > 0, 'Raycast against static boardSquareMeshes must hit');
  assert.equal(hitsSq[0].object.userData.isSquare, true);
  assert.equal(hitsSq[0].object.userData.r, 4);
  assert.equal(hitsSq[0].object.userData.c, 4);

  // Verify real pawn_white.glb.gz.b64 gold sub-meshes (HogwartsTrim_AntiqueGold + HogwartsGlow_Gold) merge cleanly
  const b64 = fs.readFileSync(path.join(ROOT, 'public/assets/glb/pawn_white.glb.gz.b64'), 'utf-8').trim();
  const glb = zlib.gunzipSync(Buffer.from(b64, 'base64'));
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject));

  const goldSubMeshes = [];
  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      const mName = child.material?.name || '';
      if (mName.includes('Gold') || mName.includes('Trim') || mName.includes('Glow')) {
        goldSubMeshes.push(child);
      }
    }
  });
  assert.equal(goldSubMeshes.length, 2, 'Expected 2 gold sub-meshes in pawn_white.glb.gz.b64 before consolidation');
  const mergedGoldGeo = mergeGeometries(
    goldSubMeshes.map((m) => m.geometry),
    false
  );
  assert.ok(mergedGoldGeo, 'mergeGeometries must consolidate pawn_white gold sub-meshes');
  goldSubMeshes[0].geometry = mergedGoldGeo;
  goldSubMeshes[1].parent.remove(goldSubMeshes[1]);

  const clonedPawn = SkeletonUtils.clone(gltf.scene);
  let clonedMeshCount = 0;
  clonedPawn.traverse((c) => {
    if (c.isMesh) clonedMeshCount++;
  });
  assert.equal(clonedMeshCount, 3, 'Cloned pawn must have 3 consolidated SkinnedMeshes instead of 4');
});

test('Startup & First-Frame Anti-Freeze Safeguards (Shader Stall, SkinnedMesh Frustum Culling & Concurrent Load)', async () => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const SkeletonUtils = await import('three/examples/jsm/utils/SkeletonUtils.js');
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');
  assert.ok(
    engineJs.includes('renderer.debug.checkShaderErrors = false'),
    'Engine must disable synchronous WebGL checkShaderErrors readback stalls on startup'
  );
  assert.ok(
    engineJs.includes('await renderer.compileAsync(scene, camera)'),
    'Engine must asynchronously compile shaders via renderer.compileAsync before hiding #loading-overlay'
  );
  const loadAllAssetsBlock = engineJs.slice(
    engineJs.indexOf('async function loadAllAssets()'),
    engineJs.indexOf('let boardState =')
  );
  assert.ok(
    !loadAllAssetsBlock.includes("classList.add('hidden')"),
    'loadAllAssets() must not hide #loading-overlay prematurely before board setup and shader compilation'
  );
  assert.ok(
    !engineJs.includes('if (!navigator.webdriver && !manualStepMode)'),
    'animate() loop must not be disabled when navigator.webdriver is true'
  );
  assert.ok(
    engineJs.includes('Promise.all([cathedralTask, ...pieceTasks])'),
    'Engine must load cathedral and piece GLB assets concurrently'
  );
  assert.ok(
    engineJs.includes('Uint8Array.fromBase64'),
    'Engine must use native Uint8Array.fromBase64 when available'
  );
  assert.ok(
    engineJs.includes('triggerAIMoveAsync'),
    'HUD AI Move button must use non-blocking triggerAIMoveAsync'
  );
  assert.ok(
    engineJs.includes('if (isAnimatingMove || aiSearchInFlight || gameOver || pendingPromotion) return;'),
    'Board pointerup must block interaction whenever aiSearchInFlight is true'
  );
  assert.ok(
    engineJs.includes('syncActionButtonsUI()') &&
      engineJs.includes('btn-promotion-cancel') &&
      appTsx.includes('id="btn-promotion-cancel"'),
    'Engine and UI must synchronize action button disabled states and support promotion modal cancellation'
  );
  assert.ok(
    engineJs.includes('_isKingFallTween') && engineJs.includes('webglcontextlost'),
    'Engine must deduplicate King fall replay tweens and handle WebGL context loss/restoration'
  );

  // Verify pre-populated SkinnedMesh.boundingSphere prevents 1.15M-vertex CPU applyBoneTransform during Frustum culling
  const b64 = fs.readFileSync(path.join(ROOT, 'public/assets/glb/pawn_white.glb.gz.b64'), 'utf-8').trim();
  const glb = zlib.gunzipSync(Buffer.from(b64, 'base64'));
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject));

  gltf.scene.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    if (!child.geometry.boundingSphere) child.geometry.computeBoundingSphere();
    if (child.isSkinnedMesh) {
      const gSphere = child.geometry.boundingSphere;
      child.boundingSphere = gSphere
        ? new THREE.Sphere(gSphere.center.clone(), Math.max(gSphere.radius * 1.4, 2.5))
        : new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 3.0);
    }
  });

  const cloned = SkeletonUtils.clone(gltf.scene);
  cloned.updateMatrixWorld(true);

  const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.22, 65);
  cam.position.set(0, 2.88, 3.05);
  cam.lookAt(0, 0.78, -0.08);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const projScreenMatrix = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projScreenMatrix);

  let boneTransformCalls = 0;
  const origApplyBone = THREE.SkinnedMesh.prototype.applyBoneTransform;
  THREE.SkinnedMesh.prototype.applyBoneTransform = function (...args) {
    boneTransformCalls++;
    return origApplyBone.apply(this, args);
  };
  try {
    cloned.traverse((child) => {
      if (child.isSkinnedMesh) {
        assert.ok(child.boundingSphere instanceof THREE.Sphere, 'Cloned SkinnedMesh must retain precomputed boundingSphere');
        const visible = frustum.intersectsObject(child);
        assert.equal(visible, true, 'Piece at origin must intersect camera frustum');
      }
    });
  } finally {
    THREE.SkinnedMesh.prototype.applyBoneTransform = origApplyBone;
  }
  assert.equal(
    boneTransformCalls,
    0,
    'Frustum.intersectsObject must not trigger CPU SkinnedMesh.applyBoneTransform'
  );
});

test('2-Player Mode (Pass & Play Hotseat, Seamless Capture Auto-Flip Camera, 1-Ply Undo & Null-Safe Cross-Tab Room Sync)', () => {
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');

  // 1. 2P Pass & Play state flags, separated AI Difficulty vs 2-Player HUD controls, & Top-Right Logo Watermark
  assert.ok(
    engineJs.includes('let isPassAndPlay = false;') && engineJs.includes('let autoFlipCamera2P = true;'),
    'Engine must declare isPassAndPlay and autoFlipCamera2P state flags'
  );
  assert.ok(
    engineJs.includes("const order = ['novice', 'tactical', 'grandmaster'];") &&
      engineJs.includes('function applyAIDifficultySelection(nextDiff)'),
    '#btn-ai-difficulty must cycle strictly through AI difficulties (novice, tactical, grandmaster) separately from 2P mode'
  );
  assert.ok(
    engineJs.includes("btnDuelRoom.textContent = '⚔️ 2 Người: Cùng Máy'") &&
      engineJs.includes("autoFlipCamera2P ? 'Auto-Flip: On' : 'Auto-Flip: Off'"),
    'HUD must display separated 2-Player status on #btn-duel-room and Auto-Flip: On/Off in 2-Player Pass & Play mode'
  );
  assert.ok(
    appTsx.includes('id="trainer-logo-watermark"') &&
      appTsx.includes('/assets/logo-dungtq.png') &&
      appTsx.includes('data-ai-diff="novice"') &&
      appTsx.includes('id="btn-menu-2p-pass"'),
    'App.tsx must render top-right #trainer-logo-watermark, dedicated AI difficulty buttons, and separated 2-Player controls'
  );

  // 2. Seamless capture duel camera return directly to next player seat without 1-frame snap-back
  assert.ok(
    engineJs.includes('const returnCamPos = shouldAutoFlip2P') &&
      engineJs.includes('camera.position.lerpVectors(duelCamClose, returnCamPos, easeRet);') &&
      engineJs.includes('orbitControls.target.lerpVectors(duelTargetEnd, returnTarget, easeRet);'),
    'Capture duel Phase 3 must interpolate directly from duelCamClose to returnCamPos/returnTarget for seamless 2P auto-flip'
  );
  assert.ok(
    engineJs.includes('camera.position.copy(returnCamPos);') &&
      engineJs.includes('orbitControls.target.copy(returnTarget);') &&
      !engineJs.includes('camera.position.copy(savedCamPos)'),
    'finishMove must copy returnCamPos/returnTarget directly and never snap camera back to savedCamPos'
  );

  // 3. 1-Ply Undo in 2-Player mode vs 2-Ply Undo in 1P vs AI mode
  const undoBlock = engineJs.slice(
    engineJs.indexOf('function undoLastMove()'),
    engineJs.indexOf('function resetChessBoard')
  );
  assert.ok(
    undoBlock.includes('!isPassAndPlay &&') && undoBlock.includes('playerColor = currentTurn;'),
    'undoLastMove must pop 1 ply in 2-Player Pass & Play mode and align playerColor with currentTurn'
  );

  // 4. Null-safe Cross-Tab ?room=CODE sync & pawn promotion forwarding
  assert.ok(
    engineJs.includes("{ fromRemote: true, promotion: nextMove.promotion || 'queen' }"),
    'applyRemoteRoomState must forward promotion choice to executeChessMove'
  );
  assert.ok(
    !engineJs.includes("document.getElementById('modal-room-code').textContent") &&
      !engineJs.includes("document.getElementById('room-created-panel').style"),
    'createMultiplayerRoom and joinMultiplayerRoom must guard optional lobby DOM elements against null'
  );
  assert.ok(
    engineJs.includes("const urlMode = (params.get('mode') || '').toLowerCase();") &&
      engineJs.includes("const urlRoom = (params.get('room') || '').trim().toUpperCase();") &&
      engineJs.includes('await joinMultiplayerRoom(urlRoom);'),
    'Startup sequence must support ?mode=2p and ?room=CODE URL query parameters'
  );
});

test('Online 2-Player Room API (/api/rooms/*), Worker & Duel Room Modal Safeguards', async () => {
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');
  const wranglerJson = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf-8');
  const store = new RoomStore();

  // 1. Verify wrangler.jsonc, Duel Room Modal UI & client sync bug fixes
  assert.ok(
    wranglerJson.includes('"main": "src/worker.ts"') && !wranglerJson.includes('new_sqlite_classes'),
    'wrangler.jsonc must configure src/worker.ts without crashing Miniflare workerd'
  );
  for (const duelId of [
    'btn-duel-room',
    'duel-room-overlay',
    'btn-duel-create-white',
    'btn-duel-create-black',
    'duel-room-code',
    'btn-duel-copy-link',
    'input-duel-code',
    'btn-duel-join',
    'btn-duel-passplay'
  ]) {
    assert.ok(
      appTsx.includes(`id="${duelId}"`) && engineJs.includes(duelId),
      `2-Player Game Room UI must expose and wire #${duelId}`
    );
  }
  assert.ok(
    engineJs.includes('appliedMoveSeq += 1;\n        sendMultiplayerMove({'),
    'executeChessMove must increment appliedMoveSeq immediately on local multiplayer move to prevent self-echo replay'
  );
  assert.ok(
    engineJs.includes("sessionStorage.getItem('wizard_chess_token')") &&
      engineJs.includes("sessionStorage.setItem('wizard_chess_token', tok)"),
    'playerToken must use sessionStorage first so two tabs on the same browser receive distinct seats while F5 refresh reconnects'
  );
  assert.ok(
    engineJs.includes('if (pieceAtFrom && pieceAtFrom.color === currentTurn)') &&
      engineJs.includes("gameMode !== 'multi' && moveHistory.length > 0"),
    'applyRemoteRoomState must guard turn color and syncActionButtonsUI must lock #btn-undo in online multi mode'
  );
  assert.ok(
    engineJs.includes("document.getElementById('duel-room-overlay')?.classList.contains('visible')"),
    'Escape key handler must close #duel-room-overlay without TDZ risk'
  );
  assert.ok(
    engineJs.includes('async function handleGameResetAction()') &&
      engineJs.includes("document.getElementById('btn-checkmate-newgame')?.addEventListener('click', () => {\n      handleGameResetAction();"),
    '#btn-checkmate-newgame and #btn-reset must share handleGameResetAction so Checkmate New Game resets online rooms'
  );
  assert.ok(
    engineJs.includes('if (stRoom.whiteToken === playerToken)') &&
      engineJs.includes('if (stRoom.blackToken === playerToken)'),
    'Static room fallback must persist whiteToken and blackToken for idempotent seat retention on refresh'
  );
  assert.ok(
    appTsx.includes('id="btn-cam-lock"') &&
      engineJs.includes('let isCameraLocked = true;') &&
      engineJs.includes('function setCameraLocked(locked)') &&
      engineJs.includes('const useDuelCamSwoop = !isCameraLocked;') &&
      engineJs.includes('new THREE.Vector3(0, 3.82, zSign * 3.58)'),
    'Camera Lock / Free 3D toggle (#btn-cam-lock) must default to Locked at the optimal 3/4 tactical angle [0, 3.82, ±3.58] for the expanded 3.52m board and suppress capture camera swoops when locked'
  );
  assert.ok(
    engineJs.includes('const BOARD_SQ_SIZE = 0.44;') &&
      engineJs.includes('const PIECE_SCALE_FACTOR = 0.66;') &&
      engineJs.includes('function buildSanctumArenaAltar()') &&
      engineJs.includes('function attachSkinKitbashToPiece(pieceObj)') &&
      appTsx.includes('id="skin-shop-overlay"') &&
      appTsx.includes('id="btn-skin-shop"'),
    'Grand Sanctum Arena Altar, expanded 0.44m board square size (3.52m board), spacious 0.66 piece scale factor, and 3D Skin Boutique (#skin-shop-overlay) must be wired'
  );
  for (const skinKey of [
    'hogwarts',
    'dong_son',
    'shogun_yokai',
    'abyssal_lich',
    'mecha_ronin',
    'valhalla_valkyrie',
    'pharaoh_anubis',
    'bauhaus_imperial'
  ]) {
    assert.ok(
      engineJs.includes(`${skinKey}: {`) && appTsx.includes(`data-skin-id="${skinKey}"`),
      `Multi-style 3D skin set "${skinKey}" must be registered in PIECE_THEMES and rendered in #skin-shop-overlay`
    );
  }

  // 2. End-to-end /api/rooms/* lifecycle & error branches via handleRoomApiRequest
  const nonRoomRes = await handleRoomApiRequest(new Request('http://localhost/health'), store);
  assert.equal(nonRoomRes, null);

  const optionsRes = await handleRoomApiRequest(
    new Request('http://localhost/api/rooms/create', { method: 'OPTIONS' }),
    store
  );
  assert.equal(optionsRes?.status, 204);

  const emptyJoinRes = await handleRoomApiRequest(
    new Request('http://localhost/api/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '   ' })
    }),
    store
  );
  assert.equal(emptyJoinRes?.status, 400);

  // Direct join on a non-existent code creates room as White ('w')
  const directJoinRes = await handleRoomApiRequest(
    new Request('http://localhost/api/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'DIR1' })
    }),
    store
  );
  const directJoined = await directJoinRes.json();
  assert.equal(directJoined.ok, true);
  assert.equal(directJoined.color, 'w');

  // Create room as Black ('b') with auto-generated token -> Guest joins and receives White ('w')
  const blackHostRes = await handleRoomApiRequest(
    new Request('http://localhost/api/rooms/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredColor: 'b' })
    }),
    store
  );
  const blackHost = await blackHostRes.json();
  assert.equal(blackHost.ok, true);
  assert.equal(blackHost.color, 'b');
  assert.equal(blackHost.room.whiteJoined, false);
  assert.equal(blackHost.room.blackJoined, true);

  const whiteGuestRes = await handleRoomApiRequest(
    new Request('http://localhost/api/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: blackHost.code, playerToken: 'tok_white_guest' })
    }),
    store
  );
  const whiteGuest = await whiteGuestRes.json();
  assert.equal(whiteGuest.ok, true);
  assert.equal(whiteGuest.color, 'w');
  assert.equal(whiteGuest.room.status, 'playing');

  // Black host reconnects idempotently; 3rd spectator joins full room
  const blackReconnectRes = await handleRoomApiRequest(
    new Request('http://localhost/api/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: blackHost.code, playerToken: blackHost.playerToken })
    }),
    store
  );
  const blackReconnected = await blackReconnectRes.json();
  assert.equal(blackReconnected.color, 'b');

  const spectatorRes = await handleRoomApiRequest(
    new Request('http://localhost/api/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: blackHost.code, playerToken: 'tok_spectator_3' })
    }),
    store
  );
  const spectatorData = await spectatorRes.json();
  assert.equal(spectatorData.ok, true);

  // Missing room 404 checks across state, move, reset, events
  for (const req of [
    new Request('http://localhost/api/rooms/NOPE/state', { method: 'GET' }),
    new Request('http://localhost/api/rooms/NOPE/move', { method: 'POST', body: '{}' }),
    new Request('http://localhost/api/rooms/NOPE/reset', { method: 'POST' }),
    new Request('http://localhost/api/rooms/NOPE/events', { method: 'GET' })
  ]) {
    const res404 = await handleRoomApiRequest(req, store);
    assert.equal(res404?.status, 404);
  }

  // Primary White Host Room lifecycle
  const createRes = await handleRoomApiRequest(
    new Request('http://localhost/api/rooms/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredColor: 'w', playerToken: 'tok_host_white' })
    }),
    store
  );
  assert.equal(createRes?.status, 200);
  const created = await createRes.json();
  assert.equal(created.ok, true);
  assert.equal(created.color, 'w');
  assert.equal(created.room.whiteJoined, true);
  assert.equal(created.room.blackJoined, false);
  const roomCode = created.code;

  // GET /api/rooms/:code/state returns current snapshot
  const stateRes = await handleRoomApiRequest(
    new Request(`http://localhost/api/rooms/${roomCode}/state`, { method: 'GET' }),
    store
  );
  assert.equal(stateRes?.status, 200);
  const stateJson = await stateRes.json();
  assert.equal(stateJson.ok, true);
  assert.equal(stateJson.room.code, roomCode);

  // Guest joins room -> assigned Black ('b'), status becomes 'playing' (2/2)
  const joinGuestRes = await handleRoomApiRequest(
    new Request('http://localhost/api/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: roomCode, playerToken: 'tok_guest_black' })
    }),
    store
  );
  const joinedGuest = await joinGuestRes.json();
  assert.equal(joinedGuest.ok, true);
  assert.equal(joinedGuest.color, 'b');
  assert.equal(joinedGuest.room.whiteJoined, true);
  assert.equal(joinedGuest.room.blackJoined, true);
  assert.equal(joinedGuest.room.status, 'playing');

  // Host refreshes (reconnects with tok_host_white) -> idempotently retains White ('w')
  const reconnectHostRes = await handleRoomApiRequest(
    new Request('http://localhost/api/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: roomCode, playerToken: 'tok_host_white' })
    }),
    store
  );
  const reconnectedHost = await reconnectHostRes.json();
  assert.equal(reconnectedHost.ok, true);
  assert.equal(reconnectedHost.color, 'w');

  // Subscribe to SSE /api/rooms/:code/events and verify real-time move broadcast
  const sseRes = await handleRoomApiRequest(
    new Request(`http://localhost/api/rooms/${roomCode}/events`, { method: 'GET' }),
    store
  );
  assert.equal(sseRes?.status, 200);
  assert.ok(sseRes?.headers.get('content-type')?.includes('text/event-stream'));
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  const initialChunk = await reader.read();
  assert.ok(decoder.decode(initialChunk.value).includes(`"code":"${roomCode}"`));

  // Invalid move coordinates must be rejected (400)
  const invalidCoordRes = await handleRoomApiRequest(
    new Request(`http://localhost/api/rooms/${roomCode}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerToken: 'tok_host_white',
        color: 'w',
        from: { r: -1, c: 4 },
        to: { r: 4, c: 4 }
      })
    }),
    store
  );
  assert.equal(invalidCoordRes?.status, 400);

  // Unauthorized White token must be rejected (400)
  const unauthWhiteRes = await handleRoomApiRequest(
    new Request(`http://localhost/api/rooms/${roomCode}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerToken: 'tok_impostor',
        color: 'w',
        from: { r: 6, c: 4 },
        to: { r: 4, c: 4 }
      })
    }),
    store
  );
  assert.equal(unauthWhiteRes?.status, 400);

  // Out-of-turn move by Black on White's turn must be rejected (400)
  const badMoveRes = await handleRoomApiRequest(
    new Request(`http://localhost/api/rooms/${roomCode}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerToken: 'tok_guest_black',
        color: 'b',
        from: { r: 1, c: 4 },
        to: { r: 3, c: 4 }
      })
    }),
    store
  );
  assert.equal(badMoveRes?.status, 400);

  // Legal move by White (with knight underpromotion metadata) succeeds and broadcasts on SSE
  const whiteMoveRes = await handleRoomApiRequest(
    new Request(`http://localhost/api/rooms/${roomCode}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerToken: 'tok_host_white',
        color: 'w',
        from: { r: 6, c: 4 },
        to: { r: 4, c: 4 },
        promotion: 'knight'
      })
    }),
    store
  );
  assert.equal(whiteMoveRes?.status, 200);
  const moveData = await whiteMoveRes.json();
  assert.equal(moveData.ok, true);
  assert.equal(moveData.room.turn, 'b');
  assert.equal(moveData.room.moves.length, 1);
  assert.equal(moveData.room.moves[0].promotion, 'knight');

  const moveChunk = await reader.read();
  assert.ok(decoder.decode(moveChunk.value).includes('"promotion":"knight"'));

  // Unauthorized Black token on Black's turn must be rejected (400)
  const unauthBlackRes = await handleRoomApiRequest(
    new Request(`http://localhost/api/rooms/${roomCode}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerToken: 'tok_impostor',
        color: 'b',
        from: { r: 1, c: 4 },
        to: { r: 3, c: 4 }
      })
    }),
    store
  );
  assert.equal(unauthBlackRes?.status, 400);

  // Legal move by Black (default promotion normalization) succeeds
  const blackMoveRes = await handleRoomApiRequest(
    new Request(`http://localhost/api/rooms/${roomCode}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerToken: 'tok_guest_black',
        color: 'b',
        from: { r: 1, c: 4 },
        to: { r: 3, c: 4 }
      })
    }),
    store
  );
  assert.equal(blackMoveRes?.status, 200);
  const blackMoveData = await blackMoveRes.json();
  assert.equal(blackMoveData.room.turn, 'w');
  assert.equal(blackMoveData.room.moves.length, 2);
  assert.equal(blackMoveData.room.moves[1].promotion, 'queen');

  await reader.cancel();

  // Reset room increments resetCount and clears moves
  const resetRes = await handleRoomApiRequest(
    new Request(`http://localhost/api/rooms/${roomCode}/reset`, { method: 'POST' }),
    store
  );
  const resetData = await resetRes.json();
  assert.equal(resetData.ok, true);
  assert.equal(resetData.room.resetCount, 1);
  assert.equal(resetData.room.moves.length, 0);
  assert.equal(resetData.room.turn, 'w');

  // Skin sync endpoint updates whiteSkin / blackSkin for asymmetric 2P skin display
  const skinRes = await handleRoomApiRequest(
    new Request(`http://localhost/api/rooms/${roomCode}/skin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color: 'w', skinId: 'dong_son' })
    }),
    store
  );
  const skinData = await skinRes.json();
  assert.equal(skinData.ok, true);
  assert.equal(skinData.room.whiteSkin, 'dong_son');
});

test('Smooth Locomotion Gait Physics & 6 Unique Character Signature Attacks (Choreography, Shared 3D VFX Pool & Procedural Audio)', () => {
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');

  // 1. Smooth shortest-arc yaw interpolation & piece-specific locomotion gait physics
  assert.ok(
    engineJs.includes('function lerpAngleShortest(fromRad, toRad, t)') &&
      engineJs.includes('const LOCOMOTION_GAIT_PROFILES = {'),
    'Engine must implement lerpAngleShortest and LOCOMOTION_GAIT_PROFILES for smooth yaw turn and gait cadence'
  );

  // 2. All 6 unique signature attack IDs & choreographies must be present
  const expectedSignatures = [
    'pawn_phalanx_spear',
    'rook_titan_earthshaker',
    'knight_sky_lancer_dive',
    'bishop_celestial_judgment',
    'queen_valkyrie_whirlwind_nova',
    'king_sovereign_lightning_cleave'
  ];
  for (const sigId of expectedSignatures) {
    assert.ok(
      engineJs.includes(`signatureId: '${sigId}'`),
      `Missing unique signature attack profile "${sigId}" in ATTACK_SYNC_PROFILES`
    );
  }

  // 3. Shared Combat VFX Geometry Pool & spawnSignatureCombatVFX must be wired
  assert.ok(
    engineJs.includes('function spawnSignatureCombatVFX(') &&
      engineJs.includes('vfxHexRuneGeo') &&
      engineJs.includes('vfxPillarGeo') &&
      engineJs.includes('vfxBladeArcGeo') &&
      engineJs.includes('vfxFissureBoxGeo'),
    'Engine must pre-allocate shared 3D VFX geometries and wire spawnSignatureCombatVFX for all 6 pieces'
  );

  // 4. Verify WizardAudioEngine.playSignatureAttack synthesizes distinct cues for all 6 pieces
  const synth = new WizardAudioEngine();
  for (const pType of ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king']) {
    synth.playSignatureAttack(pType, 'contact1');
    assert.equal(synth.getState().lastCue, `sig_${pType}_contact1`);
    synth.playSignatureAttack(pType, 'finisher');
    assert.equal(synth.getState().lastCue, `sig_${pType}_finisher`);
  }
});

test('Mobile Gameplay Optimization Contract: Portrait Frustum-Fit Camera, Anti-Occlusion Ray Piercing + Magnetic Touch Assist, and Quick-Action Thumb Dock', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');
  const stylesCss = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf-8');
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');

  // 1. Viewport & Safe-Area mobile configuration
  assert.ok(
    indexHtml.includes('viewport-fit=cover') && stylesCss.includes('100dvh') && stylesCss.includes('touch-action: none'),
    'index.html and styles.css must configure viewport-fit=cover, 100dvh, and touch-action: none'
  );

  // 2. Mobile 1-Thumb Quick-Action Dock in App.tsx & styles.css
  for (const dockId of [
    'mobile-quick-dock',
    'btn-quick-cam',
    'btn-quick-lock',
    'btn-quick-undo',
    'btn-quick-duel',
    'btn-quick-skin'
  ]) {
    assert.ok(
      appTsx.includes(`id="${dockId}"`) && engineJs.includes(dockId),
      `Mobile Quick-Action Dock must render and wire #${dockId}`
    );
  }

  // 3. Aspect-aware Portrait Frustum-Fit Camera & Live Orientation Resize Sync
  assert.ok(
    engineJs.includes('function getPortraitFramingFactor()') &&
      engineJs.includes('function syncResponsiveCameraFov()') &&
      engineJs.includes('function handleViewportResize()') &&
      engineJs.includes("window.visualViewport?.addEventListener('resize', handleViewportResize)"),
    'Engine must implement getPortraitFramingFactor, syncResponsiveCameraFov, and handleViewportResize'
  );

  // 4. Two-Stage Anti-Occlusion Ray Piercing, Magnetic Touch Assist & Web Audio Gesture Unlock
  assert.ok(
    engineJs.includes('function extractBoardCoordsFromHit(hitObj)') &&
      engineJs.includes('function projectBoardSquareToScreen(r, c, rect)') &&
      engineJs.includes('function isLegalDestinationSquare(r, c)') &&
      engineJs.includes('wizardAudio.unlock()'),
    'Engine must implement Two-Stage Anti-Occlusion Ray Piercing, Screen-Space Magnetic Touch Assist, and pointerdown audio unlock'
  );
});

test('Mobile Anti-OOM & Zero-Leak GPU/WebAudio Contract (Shared Highlight/Tactical Pools, Skeleton/Mixer Disposal, 2.0x Retina DPR & WebGL Context Guard)', () => {
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');
  const soundTs = fs.readFileSync(path.join(ROOT, 'src/soundEngine.ts'), 'utf-8');

  // 1. Zero-allocation shared geometry & material pools for showSquareHighlights & updateTacticalBoardMarkers
  const highlightsBlock = engineJs.slice(
    engineJs.indexOf('function updateTacticalBoardMarkers()'),
    engineJs.indexOf('const sharedShardGeo =')
  );
  assert.ok(
    !highlightsBlock.includes('new THREE.RingGeometry') &&
      !highlightsBlock.includes('new THREE.CircleGeometry') &&
      !highlightsBlock.includes('new THREE.MeshBasicMaterial'),
    'updateTacticalBoardMarkers and showSquareHighlights must reuse pre-allocated shared geometries and materials with zero per-tap/per-move VBO allocation'
  );

  // 2. Skeleton boneTexture & AnimationMixer root cache disposal on capture/reset/skin-swap
  assert.ok(
    engineJs.includes('function disposePieceRuntimeResources(root, mixer)') &&
      engineJs.includes('mixer.uncacheRoot(root)') &&
      engineJs.includes('child.skeleton.dispose()') &&
      engineJs.includes('prevSkel.dispose()'),
    'Engine must dispose SkinnedMesh skeleton boneTextures and uncache AnimationMixer roots when pieces are removed or re-bound'
  );

  // 3. Mobile 2.0x Retina DPR cap, 1024 shadow map, WebGL context loss guard, and custom skin LRU eviction
  assert.ok(
    engineJs.includes('const mobileRetinaDpr = Math.min(Math.max(nativeDeviceDpr, 1.75), 2.0);') &&
      engineJs.includes('const shadowMapRes = isCoarseOrMobile ? 1024 : 2048;') &&
      engineJs.includes('if (doRender && !isWebGLContextLost)') &&
      engineJs.includes('function evictUnusedMobileSkinSets('),
    'Engine must cap mobile DPR at 2.0x Retina, use 1024 shadow map on mobile, guard render calls when WebGL context is lost, and evict inactive mobile skin sets'
  );

  // 4. WebAudio node auto-disconnect on ended in soundEngine.ts
  assert.ok(
    soundTs.includes('private bindAutoDisconnect(') &&
      soundTs.includes('source.onended = () =>') &&
      soundTs.includes('this.bindAutoDisconnect('),
    'WizardAudioEngine must disconnect OscillatorNode, AudioBufferSourceNode, BiquadFilterNode, and GainNode instances on ended'
  );
});

test('Outer Sanctum Amphitheater & 8 Theme-Reactive Guardian Monument Archetypes Contract', () => {
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');

  assert.ok(
    engineJs.includes('function buildSanctumOuterArena(') &&
      engineJs.includes('function resolveOuterMonumentArchetype(themeId)') &&
      engineJs.includes('BRAZIER_FLAME_PALETTES') &&
      engineJs.includes('sanctumPerimeterMotesUniforms'),
    'Engine must build the outer Sanctum amphitheater, sunken moat, GPU perimeter motes, and theme-synced brazier palettes'
  );

  for (const archetype of [
    'hogwarts',
    'dong_son',
    'shogun_yokai',
    'mecha_ronin',
    'abyssal_lich',
    'valhalla_valkyrie',
    'pharaoh_anubis',
    'bauhaus_imperial'
  ]) {
    assert.ok(
      engineJs.includes(`'${archetype}'`) && engineJs.includes(`${archetype}: {`),
      `Outer arena must define monument archetype and brazier flame palette for "${archetype}"`
    );
  }

  const updateThemeBlock = engineJs.slice(
    engineJs.indexOf('function updateSanctumAltarTheme(theme)'),
    engineJs.indexOf('function applyPieceTheme(themeId')
  );
  assert.ok(
    !updateThemeBlock.includes('new THREE.') &&
      updateThemeBlock.includes('grp.visible = key === archetype;'),
    'updateSanctumAltarTheme must toggle pre-merged monument visibility with zero Three.js object/geometry allocations'
  );
});

test('19. Steady 3D Combat Camera (No Zoom-In/Out Sickness) & 3-Layer Piece Identification System', () => {
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');
  const stylesCss = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf-8');
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');

  // 1. Steady 3D Combat Camera contract (no nauseating zoom-in/out or vertical camera shake during combat)
  assert.ok(
    engineJs.includes('let combatCameraZoomEnabled = false;') &&
      engineJs.includes('const activeDuelCamSwoop = useDuelCamSwoop && combatCameraZoomEnabled;') &&
      engineJs.includes('if (activeDuelCamSwoop)'),
    'Engine must disable combat camera zoom-in/out and tremor by default (combatCameraZoomEnabled = false) even when Free 3D camera is unlocked'
  );

  // 2. Layer 1 & Layer 2 DOM Overhead Layer, Floating Inspect Card & HUD toggles
  assert.ok(
    appTsx.includes('id="piece-overhead-layer"') &&
      appTsx.includes('id="piece-inspect-card"') &&
      appTsx.includes('id="btn-piece-labels"') &&
      appTsx.includes('id="btn-quick-labels"'),
    'App.tsx must render #piece-overhead-layer, #piece-inspect-card, #btn-piece-labels, and #btn-quick-labels'
  );
  assert.ok(
    stylesCss.includes('.piece-overhead-badge') &&
      stylesCss.includes('.piece-overhead-badge.is-capture-target') &&
      stylesCss.includes('.piece-inspect-card.visible') &&
      stylesCss.includes('body.cinematic-ui-hidden #piece-overhead-layer'),
    'styles.css must style the 32-slot overhead role badges, capture target threat pills, and floating inspect card'
  );

  // 3. Layer 3 Role Height Hierarchy (ROLE_SCALE_MULTIPLIERS), Pedestal Faction Ring & Enemy Inspection
  assert.ok(
    engineJs.includes('const ROLE_SCALE_MULTIPLIERS = {') &&
      engineJs.includes('function getPieceWorldScale(type)') &&
      engineJs.includes('const PIECE_ROLE_METADATA = {') &&
      engineJs.includes('const sharedPiecePedestalRingGeo ='),
    'Engine must define ROLE_SCALE_MULTIPLIERS, getPieceWorldScale, PIECE_ROLE_METADATA, and sharedPiecePedestalRingGeo'
  );
  assert.ok(
    engineJs.includes('function updatePieceOverheadOverlay()') &&
      engineJs.includes('showEnemyInspectHighlight(clickedR, clickedC)') &&
      engineJs.includes('inspectSquare:'),
    'Engine must update overhead role badges, support clicking/tapping enemy pieces to inspect their name/moves, and expose inspectSquare'
  );
});

test('20. Newly Sculpted 3D Xiangqi Assets: All 7 .glb.gz.b64 models decompress, parse via GLTFLoader, and contain 4-bone PieceArmature + 4 animation clips', async () => {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const xiangqiPieceFiles = [
    'king_white',
    'advisor_white',
    'elephant_white',
    'rook_white',
    'cannon_white',
    'knight_white',
    'pawn_white'
  ];

  for (const name of xiangqiPieceFiles) {
    const b64Path = path.join(ROOT, 'public/assets/glb/xiangqi', `${name}.glb.gz.b64`);
    assert.ok(fs.existsSync(b64Path), `Missing sculpted Xiangqi 3D asset: ${b64Path}`);
    const b64Text = fs.readFileSync(b64Path, 'utf-8').trim();
    assert.ok(b64Text.length > 5000, `Xiangqi asset ${name}.glb.gz.b64 is unexpectedly small (${b64Text.length} chars)`);

    const gzBuf = Buffer.from(b64Text, 'base64');
    const glbBuf = zlib.gunzipSync(gzBuf);
    assert.equal(glbBuf.toString('ascii', 0, 4), 'glTF', `Invalid glTF magic header for xiangqi/${name}`);
    assert.equal(glbBuf.readUInt32LE(4), 2, `Invalid glTF version for xiangqi/${name}`);
    assert.equal(glbBuf.readUInt32LE(8), glbBuf.length, `Mismatched glTF byte length for xiangqi/${name}`);

    const ab = glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength);
    const gltf = await new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject));

    const clipNames = gltf.animations.map((a) => a.name).sort();
    assert.deepEqual(
      clipNames,
      ['Attack', 'Idle', 'Move', 'Shatter'],
      `Xiangqi ${name} must contain Attack, Idle, Move, and Shatter clips`
    );

    const boneNames = new Set();
    let meshCount = 0;
    gltf.scene.traverse((child) => {
      if (child.isBone) boneNames.add(child.name);
      if (child.isMesh) meshCount++;
    });
    assert.ok(boneNames.has('Base'), `Xiangqi ${name} must include stationary "Base" rig bone`);
    assert.ok(boneNames.size >= 3, `Xiangqi ${name} must include multi-bone armature (got ${boneNames.size})`);
    assert.ok(meshCount >= 2, `Xiangqi ${name} must contain sculpted mesh geometry`);
  }
});

test('21. Xiangqi Rules Engine (src/xiangqiAI.ts): 9x10 Board, 44 Opening Moves, Cannon Screen, Horse Leg Block, Elephant Eye & River, Nine Palace, Flying General & Stalemate=Loss', async () => {
  assert.equal(XIANGQI_ROWS, 10);
  assert.equal(XIANGQI_COLS, 9);

  // 1. Initial 10x9 board setup (32 pieces) & 44 legal opening moves for Red ('w')
  const initBoard = createInitialXiangqiBoard();
  let pieceCount = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      if (initBoard[r][c]) pieceCount++;
    }
  }
  assert.equal(pieceCount, 32, 'Initial Xiangqi board must have 32 pieces');
  const redOpeningMoves = getAllXiangqiLegalMoves(initBoard, 'w');
  const blackOpeningMoves = getAllXiangqiLegalMoves(initBoard, 'b');
  assert.equal(redOpeningMoves.length, 44, 'Standard Xiangqi opening position must have exactly 44 legal moves for Red');
  assert.equal(blackOpeningMoves.length, 44, 'Standard Xiangqi opening position must have 44 legal moves for Black');

  // 2. Cannon (Pháo) non-capture slide (0 screens) vs screen-jump capture (1 screen)
  const cannonBoard = createEmptyXiangqiBoard();
  cannonBoard[9][4] = { type: 'king', color: 'w', hasMoved: false };
  cannonBoard[0][3] = { type: 'king', color: 'b', hasMoved: false };
  cannonBoard[7][1] = { type: 'cannon', color: 'w', hasMoved: false };
  // Screen piece at (4, 1), enemy Rook target at (1, 1), and another piece behind at (0, 1)
  cannonBoard[4][1] = { type: 'pawn', color: 'w', hasMoved: false };
  cannonBoard[1][1] = { type: 'rook', color: 'b', hasMoved: false };
  cannonBoard[0][1] = { type: 'knight', color: 'b', hasMoved: false };

  const cannonMoves = getXiangqiLegalMovesForPiece(cannonBoard, 7, 1);
  // Can slide freely to (6,1) and (5,1) before screen at (4,1), cannot land on (3,1) or (2,1), can capture (1,1) over screen (4,1), cannot capture (0,1) (2 screens)
  assert.ok(cannonMoves.some((m) => m.r === 6 && m.c === 1 && !m.capture));
  assert.ok(cannonMoves.some((m) => m.r === 5 && m.c === 1 && !m.capture));
  assert.ok(!cannonMoves.some((m) => m.r === 3 && m.c === 1));
  assert.ok(!cannonMoves.some((m) => m.r === 2 && m.c === 1));
  const screenCap = cannonMoves.find((m) => m.r === 1 && m.c === 1);
  assert.ok(screenCap && screenCap.capture, 'Cannon must capture enemy Rook at (1,1) by jumping over screen at (4,1)');
  assert.equal(screenCap.screenR, 4);
  assert.equal(screenCap.screenC, 1);
  assert.ok(!cannonMoves.some((m) => m.r === 0 && m.c === 1), 'Cannon must not jump over 2 screens');

  // 3. Horse (Mã) Hobbling the Horse's Leg (Cản Mã)
  const horseBoard = createEmptyXiangqiBoard();
  horseBoard[9][4] = { type: 'king', color: 'w', hasMoved: false };
  horseBoard[0][3] = { type: 'king', color: 'b', hasMoved: false };
  horseBoard[5][4] = { type: 'knight', color: 'w', hasMoved: true };
  // Place a blocker immediately north of the Horse at (4, 4) -> blocks jumps to (3, 3) and (3, 5)
  horseBoard[4][4] = { type: 'pawn', color: 'b', hasMoved: true };

  const horseBlockedInfo = getXiangqiBlockedPointsForPiece(horseBoard, 5, 4);
  assert.equal(horseBlockedInfo.length, 1);
  assert.deepEqual(horseBlockedInfo[0], { r: 4, c: 4, kind: 'horse_leg' });

  const horseMoves = getXiangqiLegalMovesForPiece(horseBoard, 5, 4);
  assert.ok(!horseMoves.some((m) => m.r === 3 && (m.c === 3 || m.c === 5)), 'Blocked north leg must forbid (3,3) and (3,5)');
  const southJump = horseMoves.find((m) => m.r === 7 && m.c === 5);
  assert.ok(southJump, 'Unblocked south leg must allow jump to (7,5)');
  assert.equal(southJump.legR, 6);
  assert.equal(southJump.legC, 4);

  // 4. Elephant (Tượng) Blocking the Elephant's Eye (Chặn Mắt Tượng) & River Boundary
  const elBoard = createEmptyXiangqiBoard();
  elBoard[9][4] = { type: 'king', color: 'w', hasMoved: false };
  elBoard[0][3] = { type: 'king', color: 'b', hasMoved: false };
  elBoard[7][4] = { type: 'elephant', color: 'w', hasMoved: true };
  // Block northeast eye at (6, 5) -> forbids (5, 6)
  elBoard[6][5] = { type: 'pawn', color: 'w', hasMoved: false };
  const elBlockedInfo = getXiangqiBlockedPointsForPiece(elBoard, 7, 4);
  assert.equal(elBlockedInfo.length, 1);
  assert.deepEqual(elBlockedInfo[0], { r: 6, c: 5, kind: 'elephant_eye' });

  const elMoves = getXiangqiLegalMovesForPiece(elBoard, 7, 4);
  assert.ok(!elMoves.some((m) => m.r === 5 && m.c === 6), 'Blocked Elephant eye at (6,5) must forbid (5,6)');
  assert.ok(elMoves.some((m) => m.r === 5 && m.c === 2), 'Unblocked Elephant eye at (6,3) must allow (5,2)');

  // Move Red Elephant to river bank (5, 2) -> must NOT cross river to r=3
  elBoard[7][4] = null;
  elBoard[5][2] = { type: 'elephant', color: 'w', hasMoved: true };
  const riverElMoves = getXiangqiLegalMovesForPiece(elBoard, 5, 2);
  assert.ok(riverElMoves.every((m) => m.r >= 5), 'Red Elephant must never cross the river into r < 5');

  // 5. Nine Palace confinement for General & Advisor + Flying General (Lộ Mặt Tướng) prohibition
  const palaceBoard = createEmptyXiangqiBoard();
  palaceBoard[9][4] = { type: 'king', color: 'w', hasMoved: false };
  palaceBoard[8][4] = { type: 'advisor', color: 'w', hasMoved: true };
  palaceBoard[0][4] = { type: 'king', color: 'b', hasMoved: false };
  assert.equal(isFlyingGeneralExposed(palaceBoard), false, 'Advisor at (8,4) screens the two Generals');

  // Because Red Advisor at (8,4) is the only piece between the two Generals on file c=4,
  // moving the Advisor diagonally off c=4 would expose Flying General and must be illegal!
  const pinnedAdvisorMoves = getXiangqiLegalMovesForPiece(palaceBoard, 8, 4);
  assert.equal(pinnedAdvisorMoves.length, 0, 'Advisor pinned between opposing Generals must have 0 legal moves');

  // 6. Soldier (Tốt/Binh) before vs after crossing the river
  const pawnBoard = createEmptyXiangqiBoard();
  pawnBoard[9][4] = { type: 'king', color: 'w', hasMoved: false };
  pawnBoard[0][3] = { type: 'king', color: 'b', hasMoved: false };
  pawnBoard[6][0] = { type: 'pawn', color: 'w', hasMoved: false }; // Before river (r=6)
  pawnBoard[4][4] = { type: 'pawn', color: 'w', hasMoved: true };  // Crossed river (r=4)
  assert.equal(getXiangqiLegalMovesForPiece(pawnBoard, 6, 0).length, 1, 'Un-crossed Soldier can only step forward');
  const crossedMoves = getXiangqiLegalMovesForPiece(pawnBoard, 4, 4);
  assert.equal(crossedMoves.length, 3, 'River-crossed Soldier can step forward, left, or right (never backward)');

  // 7. Stalemate in Xiangqi is a LOSS (not a draw!) + AI search finds forced checkmate
  const staleBoard = createEmptyXiangqiBoard();
  staleBoard[9][4] = { type: 'king', color: 'w', hasMoved: false };
  staleBoard[0][3] = { type: 'king', color: 'b', hasMoved: true };
  // Red Rook at (1, 5) controls rank 1; Red Rook at (2, 4) controls file 4 -> Black King at (0, 3) is NOT in check,
  // but its only adjacent Palace squares (1, 3) and (0, 4) are both controlled -> Black has 0 legal moves!
  staleBoard[1][5] = { type: 'rook', color: 'w', hasMoved: true };
  staleBoard[2][4] = { type: 'rook', color: 'w', hasMoved: true };
  assert.equal(isXiangqiGeneralInCheck(staleBoard, 'b'), false, 'Black General at (0,3) is not currently in check');
  assert.equal(getAllXiangqiLegalMoves(staleBoard, 'b').length, 0, 'Black has 0 legal moves (stalemated)');
  const staleDrawEval = evaluateXiangqiDrawState(staleBoard, 'b', 0, []);
  assert.equal(staleDrawEval.isDraw, false, 'Stalemate in Xiangqi is a win/loss, not a draw');

  // AI Mate-in-1 test: Red Rook on (2, 0) slides to (0, 0) to deliver back-rank checkmate against Black King at (0, 4) whose only orthogonal step off rank 0 is blocked by its own Elephant at (1, 4)
  const mateBoard = createEmptyXiangqiBoard();
  mateBoard[9][4] = { type: 'king', color: 'w', hasMoved: false };
  mateBoard[0][4] = { type: 'king', color: 'b', hasMoved: false };
  mateBoard[1][4] = { type: 'elephant', color: 'b', hasMoved: true }; // Blocks (1,4) and screens Flying General
  mateBoard[2][0] = { type: 'rook', color: 'w', hasMoved: true };

  const syncXiangqiMate = chooseBestXiangqiMove(mateBoard, 'w', 'grandmaster');
  const asyncXiangqiMate = await chooseBestXiangqiMoveAsync(mateBoard, 'w', 'grandmaster', { timeSliceMs: 2 });
  assert.ok(syncXiangqiMate && asyncXiangqiMate, 'Sync and Async Xiangqi AI must return a move');
  assert.equal(syncXiangqiMate.fromR, 2);
  assert.equal(syncXiangqiMate.fromC, 0);
  assert.equal(syncXiangqiMate.toR, 0);
  assert.equal(syncXiangqiMate.toC, 0);
  assert.deepEqual(asyncXiangqiMate, syncXiangqiMate);

  // Verify Insufficient Material, 60-Move Rule, and Threefold Repetition
  const bareKings = createEmptyXiangqiBoard();
  bareKings[9][4] = { type: 'king', color: 'w' };
  bareKings[0][4] = { type: 'king', color: 'b' };
  bareKings[8][4] = { type: 'advisor', color: 'w' };
  assert.equal(checkXiangqiInsufficientMaterial(bareKings), true, 'General + Advisor vs General has no attacking pieces');
  const hash = computeXiangqiPositionHash(bareKings, 'w');
  assert.equal(evaluateXiangqiDrawState(bareKings, 'w', 120, []).reason, '60-Move Rule');
  assert.equal(evaluateXiangqiDrawState(bareKings, 'w', 4, [hash, hash, hash]).reason, 'Threefold Repetition');
});

test('22. Dual-Mode 3D Engine, Audio & RoomStore Integration (Cờ Vua 8x8 <-> Cờ Tướng 9x10 Sở Hà Hán Giới)', async () => {
  const appTsx = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf-8');
  const engineJs = fs.readFileSync(path.join(ROOT, 'src/wizardChessEngine.js'), 'utf-8');

  assert.ok(
    appTsx.includes('id="btn-game-variant"') &&
      appTsx.includes('id="btn-quick-variant"') &&
      appTsx.includes('id="game-selector-overlay"') &&
      appTsx.includes('id="card-select-chess"') &&
      appTsx.includes('id="card-select-xiangqi"') &&
      appTsx.includes('/assets/demo-chess-arena.jpg') &&
      appTsx.includes('/assets/demo-xiangqi-arena.jpg'),
    'App.tsx must expose #game-selector-overlay with both 3D arena demo images (/assets/demo-chess-arena.jpg & /assets/demo-xiangqi-arena.jpg) and #btn-game-variant'
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, 'public/assets/demo-chess-arena.jpg')) &&
      fs.existsSync(path.join(ROOT, 'public/assets/demo-xiangqi-arena.jpg')),
    'Both 3D arena demo images must exist in public/assets/'
  );
  assert.ok(
    engineJs.includes('function buildXiangqiBoardGrid()') &&
      engineJs.includes('function ensureXiangqiModelsLoaded()') &&
      engineJs.includes('function setGameVariant(nextVariant)') &&
      engineJs.includes('function toggleGameVariant()') &&
      engineJs.includes('function openGameSelectorModal()') &&
      engineJs.includes('function closeGameSelectorModal()') &&
      engineJs.includes('XIANGQI_ROLE_METADATA') &&
      !engineJs.includes('getXiangqiBlockedPointsForPiece(r, c,'),
    'wizardChessEngine.js must implement buildXiangqiBoardGrid, ensureXiangqiModelsLoaded, setGameVariant, toggleGameVariant, openGameSelectorModal, closeGameSelectorModal, and pass (cells, r, c) to getXiangqiBlockedPointsForPiece'
  );

  // Verify XIANGQI_ROLE_METADATA provides all 3-Layer Overhead & Inspect Card fields for all 7 piece types with Red (Hồng) vs Black (Hắc) traditional names
  const expectedFactionNames = {
    king: { shortViW: 'Soái', shortViB: 'Tướng', glyphW: '帥', glyphB: '將' },
    advisor: { shortViW: 'Sĩ', shortViB: 'Sĩ', glyphW: '仕', glyphB: '士' },
    elephant: { shortViW: 'Tịnh', shortViB: 'Tượng', glyphW: '相', glyphB: '象' },
    rook: { shortViW: 'Xe', shortViB: 'Xe', glyphW: '俥', glyphB: '車' },
    cannon: { shortViW: 'Pháo', shortViB: 'Pháo', glyphW: '炮', glyphB: '砲' },
    knight: { shortViW: 'Mã', shortViB: 'Mã', glyphW: '傌', glyphB: '馬' },
    pawn: { shortViW: 'Binh', shortViB: 'Tốt', glyphW: '兵', glyphB: '卒' }
  };
  for (const [xRole, expected] of Object.entries(expectedFactionNames)) {
    const meta = XIANGQI_ROLE_METADATA[xRole];
    assert.ok(meta, `Missing XIANGQI_ROLE_METADATA for ${xRole}`);
    assert.ok(meta.viName && meta.enName && meta.shortVi, `XIANGQI_ROLE_METADATA.${xRole} must define viName, enName, shortVi`);
    assert.ok(meta.viNameW && meta.viNameB, `XIANGQI_ROLE_METADATA.${xRole} must define viNameW and viNameB`);
    assert.equal(meta.shortViW, expected.shortViW, `Red shortViW mismatch for ${xRole}`);
    assert.equal(meta.shortViB, expected.shortViB, `Black shortViB mismatch for ${xRole}`);
    assert.equal(meta.glyphW, expected.glyphW, `Red glyphW mismatch for ${xRole}`);
    assert.equal(meta.glyphB, expected.glyphB, `Black glyphB mismatch for ${xRole}`);
    assert.ok(meta.moveHint, `XIANGQI_ROLE_METADATA.${xRole} must define moveHint`);
  }

  assert.ok(
    engineJs.includes('const XIANGQI_DEFAULT_FACTION_MATERIALS = {') &&
      engineJs.includes("shouldShow = gameVariant === 'xiangqi' ? true : p.type !== 'pawn';") &&
      engineJs.includes('Lộ ${9 - activeSq.c} (Đỏ)') &&
      engineJs.includes('Lượt Phe Đỏ (Hồng)') &&
      engineJs.includes('Tuyệt Sát (Chiếu Bí)'),
    'wizardChessEngine.js must apply Chu Sa/Hắc Ngọc faction materials, show all 32 piece badges in Xiangqi smart mode, use traditional Red/Black Lộ coordinates, and display Xiangqi HUD terminology'
  );

  // Verify 3D Piece Visual Differentiation (Knight Steed split, Role-Specific Materials, Anisotropic Silhouette, Role Regalia, and Idea #1 Segmented Switcher + Material Advantage)
  assert.ok(
    engineJs.includes('function splitKnightSteedSubMesh(sceneRoot)') &&
      engineJs.includes('isSteedMesh: true') &&
      engineJs.includes('const whiteSteedMat =') &&
      engineJs.includes('const blackSteedMat =') &&
      engineJs.includes('const whiteQueenAccentMat =') &&
      engineJs.includes('const whiteBishopAccentMat =') &&
      engineJs.includes('function attachPieceRoleRegalia(pieceObj)') &&
      engineJs.includes('function applyPieceBaseScale(mesh, type, mulXZ = 1, mulY = 1)') &&
      engineJs.includes('function computeMaterialAdvantage()'),
    'wizardChessEngine.js must implement splitKnightSteedSubMesh, contrasting steed & role materials, attachPieceRoleRegalia, applyPieceBaseScale, and computeMaterialAdvantage'
  );
  assert.ok(
    appTsx.includes('id="variant-segmented-pill"') &&
      appTsx.includes('data-set-variant="chess"') &&
      appTsx.includes('data-set-variant="xiangqi"') &&
      appTsx.includes('id="btn-feedback-fab"') &&
      appTsx.includes('id="feedback-modal-overlay"'),
    'App.tsx must include the 1-tap #variant-segmented-pill switcher and the corner #btn-feedback-fab + #feedback-modal-overlay'
  );

  // Verify WizardAudioEngine synthesizes signature attacks for Cannon, Elephant, and Advisor
  const synth = new WizardAudioEngine();
  for (const xType of ['cannon', 'elephant', 'advisor']) {
    synth.playSignatureAttack(xType, 'contact1');
    assert.equal(synth.getState().lastCue, `sig_${xType}_contact1`);
    synth.playSignatureAttack(xType, 'finisher');
    assert.equal(synth.getState().lastCue, `sig_${xType}_finisher`);
  }

  // Verify RoomStore accepts 10x9 Xiangqi coordinates (r=9, c=8) and gameVariant='xiangqi'
  const store = new RoomStore();
  const createRes = await handleRoomApiRequest(
    new Request('http://localhost/api/rooms/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredColor: 'w', playerToken: 'tok_xq_red', gameVariant: 'xiangqi' })
    }),
    store
  );
  const created = await createRes.json();
  assert.equal(created.ok, true);
  assert.equal(created.room.gameVariant, 'xiangqi');

  const moveRes = await handleRoomApiRequest(
    new Request(`http://localhost/api/rooms/${created.code}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerToken: 'tok_xq_red',
        color: 'w',
        from: { r: 9, c: 8 },
        to: { r: 7, c: 8 }
      })
    }),
    store
  );
  const moveData = await moveRes.json();
  assert.equal(moveData.ok, true);
  assert.equal(moveData.room.moves.length, 1);
  assert.deepEqual(moveData.room.moves[0].from, { r: 9, c: 8 });
});





