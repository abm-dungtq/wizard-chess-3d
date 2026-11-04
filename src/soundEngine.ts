export interface AudioStateSnapshot {
  muted: boolean;
  supported: boolean;
  playCount: number;
  lastCue: string | null;
  contextState: string;
}

export interface AudioPoint {
  x: number;
  y: number;
  z: number;
}

/** Positioned cues end within ~0.7 s; their panner is released after this, with margin. */
const PANNER_RELEASE_MS = 1500;

export class WizardAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastListener = new Float64Array(9).fill(NaN);
  private slideNoiseBuf: AudioBuffer | null = null;
  private shatterNoiseBuf: AudioBuffer | null = null;
  private muted = false;
  private playCount = 0;
  private lastCue: string | null = null;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    // Safari also reports 'interrupted' after a call or app switch; resume from any non-running state.
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /** Call from a user gesture: starts the context and builds the noise buffers before the first move needs them. */
  public unlock(): boolean {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'running') return true;
    try {
      // iOS Safari only unlocks audio once a source starts inside the gesture.
      const silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      silent.connect(ctx.destination);
      silent.start();
    } catch {}
    this.getSlideNoiseBuffer(ctx);
    this.getShatterNoiseBuffer(ctx);
    try {
      // The first HRTF panner loads the HRTF data; doing it here keeps the first positioned hit from playing dry.
      ctx.createPanner().panningModel = 'HRTF';
    } catch {}
    ctx.resume().catch(() => {});
    return true;
  }

  private output(ctx: AudioContext): AudioNode {
    return this.master || ctx.destination;
  }

  /** Routes a cue through an HRTF panner at `at`; without a position it plays unpositioned. */
  private spatialOut(ctx: AudioContext, at?: AudioPoint): AudioNode {
    if (!at) return this.output(ctx);
    try {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 2;
      panner.rolloffFactor = 0.6;
      if (panner.positionX) {
        panner.positionX.value = at.x;
        panner.positionY.value = at.y;
        panner.positionZ.value = at.z;
      } else {
        panner.setPosition(at.x, at.y, at.z);
      }
      panner.connect(this.output(ctx));
      setTimeout(() => {
        try {
          panner.disconnect();
        } catch {}
      }, PANNER_RELEASE_MS);
      return panner;
    } catch {
      return this.output(ctx);
    }
  }

  /** Stores one point of the listener pose; returns 1 when it moved. */
  private storeListenerPoint(offset: number, p: AudioPoint): number {
    const last = this.lastListener;
    const moved =
      !(Math.abs(p.x - last[offset]) < 1e-4) ||
      !(Math.abs(p.y - last[offset + 1]) < 1e-4) ||
      !(Math.abs(p.z - last[offset + 2]) < 1e-4);
    last[offset] = p.x;
    last[offset + 1] = p.y;
    last[offset + 2] = p.z;
    return moved ? 1 : 0;
  }

  /** Keeps the listener on the camera so positioned cues come from the right side of the board. */
  public setListener(pos: AudioPoint, forward: AudioPoint, up: AudioPoint): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // A still camera writes nothing, so the listener's AudioParam timeline stays empty.
    const moved = this.storeListenerPoint(0, pos) | this.storeListenerPoint(3, forward) | this.storeListenerPoint(6, up);
    if (!moved) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = forward.x;
      l.forwardY.value = forward.y;
      l.forwardZ.value = forward.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  private getSlideNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.slideNoiseBuf || this.slideNoiseBuf.sampleRate !== ctx.sampleRate) {
      const bufLen = Math.floor(ctx.sampleRate * 1.4);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.5;
      }
      this.slideNoiseBuf = buf;
    }
    return this.slideNoiseBuf;
  }

  private getShatterNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.shatterNoiseBuf || this.shatterNoiseBuf.sampleRate !== ctx.sampleRate) {
      const dur = 0.55;
      const bufLen = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data = buf.getChannelData(0);
      const invTau = 1 / (ctx.sampleRate * 0.16);
      for (let i = 0; i < bufLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i * invTau);
      }
      this.shatterNoiseBuf = buf;
    }
    return this.shatterNoiseBuf;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): boolean {
    this.muted = Boolean(mute);
    return this.muted;
  }

  public toggleMuted(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  public getState(): AudioStateSnapshot {
    const supported =
      typeof window !== 'undefined' &&
      Boolean(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
    return {
      muted: this.muted,
      supported,
      playCount: this.playCount,
      lastCue: this.lastCue,
      contextState: this.ctx ? this.ctx.state : 'none'
    };
  }

  private recordCue(name: string) {
    if (this.muted) return;
    this.playCount += 1;
    this.lastCue = name;
  }

  private bindAutoDisconnect(source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    source.onended = () => {
      try {
        source.disconnect();
      } catch {}
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {}
      }
    };
  }

  // Heavy sculpted marble/obsidian statue sliding across the stone altar
  public playMoveSlide(durationSec = 0.65): void {
    this.recordCue('move');
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const dur = Math.max(0.25, Math.min(1.4, durationSec));

    // Low stone rumble oscillator
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(68, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + dur);

    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.linearRampToValueAtTime(0.11, now + 0.06);
    oscGain.gain.setValueAtTime(0.09, now + dur * 0.78);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(oscGain);
    oscGain.connect(this.output(ctx));
    this.bindAutoDisconnect(osc, oscGain);
    osc.start(now);
    osc.stop(now + dur);

    // Filtered friction noise (reuses precomputed noise buffer to avoid main-thread allocation during move start)
    const noise = ctx.createBufferSource();
    noise.buffer = this.getSlideNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(210, now);
    filter.Q.setValueAtTime(2.4, now);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.001, now);
    nGain.gain.linearRampToValueAtTime(0.08, now + 0.05);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.output(ctx));
    this.bindAutoDisconnect(noise, filter, nGain);
    noise.start(now);
    noise.stop(now + dur);
  }

  // Metallic sword/axe cleaving into defending stone armor
  public playWeaponClash(at?: AudioPoint): void {
    this.recordCue('clash');
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.spatialOut(ctx, at);

    const now = ctx.currentTime;
    const freqs = [420, 685, 1140, 1790];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.65, now + 0.24);

      gain.gain.setValueAtTime(0.065, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.24);

      osc.connect(gain);
      gain.connect(dest);
      this.bindAutoDisconnect(osc, gain);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  }

  // Explosive 32-shard stone shatter burst + low cathedral impact boom
  public playStoneShatter(at?: AudioPoint): void {
    this.recordCue('shatter');
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.spatialOut(ctx, at);

    const now = ctx.currentTime;

    // Sub-bass impact boom
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(115, now);
    sub.frequency.exponentialRampToValueAtTime(32, now + 0.48);

    subGain.gain.setValueAtTime(0.28, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    sub.connect(subGain);
    subGain.connect(dest);
    this.bindAutoDisconnect(sub, subGain);
    sub.start(now);
    sub.stop(now + 0.52);

    // Multi-tap falling stone debris bursts (reuses precomputed decaying noise buffer for zero main-thread lag at impact)
    const dur = 0.55;
    const noise = ctx.createBufferSource();
    noise.buffer = this.getShatterNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1450, now);
    filter.frequency.exponentialRampToValueAtTime(280, now + dur);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.22, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(dest);
    this.bindAutoDisconnect(noise, filter, nGain);
    noise.start(now);
    noise.stop(now + dur);
  }

  // Cathedral brass warning chime when King is in Check
  public playCheckWarning(): void {
    this.recordCue('check');
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [293.66, 349.23]; // D4 -> F4 minor third tension
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.11;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.14, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);

      osc.connect(gain);
      gain.connect(this.output(ctx));
      this.bindAutoDisconnect(osc, gain);
      osc.start(start);
      osc.stop(start + 0.58);
    });
  }

  // Grand Gothic cathedral chord when Checkmate or Promotion occurs
  public playCheckmateFanfare(): void {
    this.recordCue('checkmate');
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const chord = [146.83, 220.0, 293.66, 369.99]; // D major cathedral resonance
    for (const freq of chord) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.10, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 1.45);

      osc.connect(gain);
      gain.connect(this.output(ctx));
      this.bindAutoDisconnect(osc, gain);
      osc.start(now);
      osc.stop(now + 1.5);
    }
  }

  public playPromotionChime(): void {
    this.recordCue('promotion');
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const arpeggio = [329.63, 440.0, 554.37, 659.25];
    arpeggio.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = now + i * 0.07;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.11, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42);
      osc.connect(gain);
      gain.connect(this.output(ctx));
      this.bindAutoDisconnect(osc, gain);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    });
  }

  // Piece-specific signature combat audio synthesis for each of the 6 characters
  public playSignatureAttack(
    pieceType: string,
    stage: 'windup' | 'contact1' | 'contact2' | 'finisher' = 'finisher',
    at?: AudioPoint
  ): void {
    const pType = (pieceType || 'queen').toLowerCase();
    this.recordCue(`sig_${pType}_${stage}`);
    const ctx = this.ensureContext();
    if (!ctx) return;
    const dest = this.spatialOut(ctx, at);

    const now = ctx.currentTime;

    if (pType === 'pawn') {
      if (stage === 'contact1') {
        // Heavy Phalanx Bronze Shield Bash punch (low-mid impact thud + brass ring)
        const thud = ctx.createOscillator();
        const thudGain = ctx.createGain();
        thud.type = 'triangle';
        thud.frequency.setValueAtTime(165, now);
        thud.frequency.exponentialRampToValueAtTime(48, now + 0.22);
        thudGain.gain.setValueAtTime(0.24, now);
        thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        thud.connect(thudGain);
        thudGain.connect(dest);
        this.bindAutoDisconnect(thud, thudGain);
        thud.start(now);
        thud.stop(now + 0.25);

        const brass = ctx.createOscillator();
        const brassGain = ctx.createGain();
        brass.type = 'sawtooth';
        brass.frequency.setValueAtTime(520, now);
        brass.frequency.exponentialRampToValueAtTime(340, now + 0.18);
        brassGain.gain.setValueAtTime(0.08, now);
        brassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
        brass.connect(brassGain);
        brassGain.connect(dest);
        this.bindAutoDisconnect(brass, brassGain);
        brass.start(now);
        brass.stop(now + 0.20);
      } else {
        // Lethal Gladius/Spear Pierce whistle & armor puncture
        const pierceFreqs = [880, 1420, 2180];
        for (const f of pierceFreqs) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(f * 1.18, now);
          osc.frequency.exponentialRampToValueAtTime(f * 0.58, now + 0.22);
          gain.gain.setValueAtTime(0.075, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
          osc.connect(gain);
          gain.connect(dest);
          this.bindAutoDisconnect(osc, gain);
          osc.start(now);
          osc.stop(now + 0.24);
        }
      }
      return;
    }

    if (pType === 'rook') {
      // Colossal Titan Earthshaker Slam: tectonic sub-bass drop + anvil stone crush
      const quake = ctx.createOscillator();
      const quakeGain = ctx.createGain();
      quake.type = 'sine';
      quake.frequency.setValueAtTime(stage === 'contact1' ? 105 : 88, now);
      quake.frequency.exponentialRampToValueAtTime(24, now + 0.58);
      quakeGain.gain.setValueAtTime(0.32, now);
      quakeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.60);
      quake.connect(quakeGain);
      quakeGain.connect(dest);
      this.bindAutoDisconnect(quake, quakeGain);
      quake.start(now);
      quake.stop(now + 0.62);

      const anvilFreqs = [190, 310, 465];
      for (const f of anvilFreqs) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(f, now);
        osc.frequency.exponentialRampToValueAtTime(f * 0.45, now + 0.34);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(gain);
        gain.connect(dest);
        this.bindAutoDisconnect(osc, gain);
        osc.start(now);
        osc.stop(now + 0.36);
      }
      return;
    }

    if (pType === 'knight') {
      if (stage === 'windup') {
        // War-steed cavalry horn & sky-vault charge rise
        const horn = ctx.createOscillator();
        const hornGain = ctx.createGain();
        horn.type = 'sawtooth';
        horn.frequency.setValueAtTime(220, now);
        horn.frequency.exponentialRampToValueAtTime(440, now + 0.32);
        hornGain.gain.setValueAtTime(0.001, now);
        hornGain.gain.linearRampToValueAtTime(0.09, now + 0.12);
        hornGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        horn.connect(hornGain);
        hornGain.connect(dest);
        this.bindAutoDisconnect(horn, hornGain);
        horn.start(now);
        horn.stop(now + 0.36);
      } else {
        // Sonic-boom diving lance impact + twin hoof thunder
        const sonic = ctx.createOscillator();
        const sonicGain = ctx.createGain();
        sonic.type = 'triangle';
        sonic.frequency.setValueAtTime(340, now);
        sonic.frequency.exponentialRampToValueAtTime(42, now + 0.34);
        sonicGain.gain.setValueAtTime(0.25, now);
        sonicGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
        sonic.connect(sonicGain);
        sonicGain.connect(dest);
        this.bindAutoDisconnect(sonic, sonicGain);
        sonic.start(now);
        sonic.stop(now + 0.38);
      }
      return;
    }

    if (pType === 'bishop') {
      if (stage === 'windup' || stage === 'contact1') {
        // Ethereal Sacred Geometry Rune Circle harmonic choir chime
        const choir = [523.25, 659.25, 783.99, 1046.5];
        choir.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const t0 = now + idx * 0.035;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t0);
          osc.frequency.exponentialRampToValueAtTime(freq * 1.06, t0 + 0.38);
          gain.gain.setValueAtTime(0.001, t0);
          gain.gain.linearRampToValueAtTime(0.085, t0 + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42);
          osc.connect(gain);
          gain.connect(dest);
          this.bindAutoDisconnect(osc, gain);
          osc.start(t0);
          osc.stop(t0 + 0.44);
        });
      } else {
        // Celestial Judgment Pillar arcane implosion beam
        const beam = ctx.createOscillator();
        const beamGain = ctx.createGain();
        beam.type = 'sawtooth';
        beam.frequency.setValueAtTime(980, now);
        beam.frequency.exponentialRampToValueAtTime(64, now + 0.44);
        beamGain.gain.setValueAtTime(0.18, now);
        beamGain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
        beam.connect(beamGain);
        beamGain.connect(dest);
        this.bindAutoDisconnect(beam, beamGain);
        beam.start(now);
        beam.stop(now + 0.48);
      }
      return;
    }

    if (pType === 'queen') {
      if (stage === 'contact1' || stage === 'contact2') {
        // Valkyrie Whirlwind Blitz high-speed crescent blade slash
        const baseF = stage === 'contact1' ? 740 : 960;
        for (const mult of [1, 1.5, 2.25]) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(baseF * mult * 1.25, now);
          osc.frequency.exponentialRampToValueAtTime(baseF * mult * 0.55, now + 0.18);
          gain.gain.setValueAtTime(0.065, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
          osc.connect(gain);
          gain.connect(dest);
          this.bindAutoDisconnect(osc, gain);
          osc.start(now);
          osc.stop(now + 0.20);
        }
      } else {
        // Royal Scepter Nova Finisher resonance
        const nova = [440, 554.37, 659.25, 880, 1318.5];
        for (const freq of nova) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now);
          osc.frequency.exponentialRampToValueAtTime(freq * 0.72, now + 0.45);
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
          osc.connect(gain);
          gain.connect(dest);
          this.bindAutoDisconnect(osc, gain);
          osc.start(now);
          osc.stop(now + 0.48);
        }
      }
      return;
    }

    if (pType === 'cannon') {
      if (stage === 'windup' || stage === 'contact1') {
        // Dragon-Mouth Siege Cannon fuse ignition & mortar launch whistle
        const launch = ctx.createOscillator();
        const launchGain = ctx.createGain();
        launch.type = 'sawtooth';
        launch.frequency.setValueAtTime(140, now);
        launch.frequency.exponentialRampToValueAtTime(620, now + 0.22);
        launch.frequency.exponentialRampToValueAtTime(190, now + 0.42);
        launchGain.gain.setValueAtTime(0.24, now);
        launchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
        launch.connect(launchGain);
        launchGain.connect(dest);
        this.bindAutoDisconnect(launch, launchGain);
        launch.start(now);
        launch.stop(now + 0.45);
      } else {
        // Artillery shell detonation & bronze barrel recoil boom
        const boom = ctx.createOscillator();
        const boomGain = ctx.createGain();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(160, now);
        boom.frequency.exponentialRampToValueAtTime(26, now + 0.56);
        boomGain.gain.setValueAtTime(0.34, now);
        boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
        boom.connect(boomGain);
        boomGain.connect(dest);
        this.bindAutoDisconnect(boom, boomGain);
        boom.start(now);
        boom.stop(now + 0.60);
      }
      return;
    }

    if (pType === 'elephant') {
      // Armored War Elephant trumpet & twin-tusk seismic stomp
      const stomp = ctx.createOscillator();
      const stompGain = ctx.createGain();
      stomp.type = 'triangle';
      stomp.frequency.setValueAtTime(stage === 'windup' ? 280 : 96, now);
      stomp.frequency.exponentialRampToValueAtTime(stage === 'windup' ? 180 : 28, now + 0.48);
      stompGain.gain.setValueAtTime(0.28, now);
      stompGain.gain.exponentialRampToValueAtTime(0.001, now + 0.50);
      stomp.connect(stompGain);
      stompGain.connect(dest);
      this.bindAutoDisconnect(stomp, stompGain);
      stomp.start(now);
      stomp.stop(now + 0.52);
      return;
    }

    if (pType === 'advisor') {
      // Imperial Twin-Jian Guard crisp jade & steel cross-slash
      const slashFreqs = [660, 990, 1485];
      for (const f of slashFreqs) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f * 1.2, now);
        osc.frequency.exponentialRampToValueAtTime(f * 0.62, now + 0.20);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
        osc.connect(gain);
        gain.connect(dest);
        this.bindAutoDisconnect(osc, gain);
        osc.start(now);
        osc.stop(now + 0.22);
      }
      return;
    }

    // Default / King: Sovereign Execution — Heaven-Cleaver Greatsword & Royal Lightning Smite
    if (stage === 'windup' || stage === 'contact1') {
      // Sovereign brass horn + sky-lightning crackle
      const hornFreqs = [146.83, 293.66, 440.0, 1680];
      for (const freq of hornFreqs) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = freq > 1000 ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq > 1000 ? 320 : freq * 0.88, now + 0.32);
        gain.gain.setValueAtTime(freq > 1000 ? 0.11 : 0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
        osc.connect(gain);
        gain.connect(dest);
        this.bindAutoDisconnect(osc, gain);
        osc.start(now);
        osc.stop(now + 0.35);
      }
    } else {
      // Thunderous Sovereign Execution earth-cleave detonation
      const boom = ctx.createOscillator();
      const boomGain = ctx.createGain();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(135, now);
      boom.frequency.exponentialRampToValueAtTime(22, now + 0.62);
      boomGain.gain.setValueAtTime(0.34, now);
      boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.64);
      boom.connect(boomGain);
      boomGain.connect(dest);
      this.bindAutoDisconnect(boom, boomGain);
      boom.start(now);
      boom.stop(now + 0.66);
    }
  }
}

export const wizardAudio = new WizardAudioEngine();
