# Phase 3: Procedural Web Audio Synthesizer (`src/soundEngine.ts`)

## Goal
Create a zero-external-asset procedural Web Audio API sound engine (`src/soundEngine.ts`) synthesizing Gothic cathedral chess audio: heavy stone slide on move, metallic sword/axe clash on weapon contact, 32-shard stone shatter explosion, cathedral brass/bell chord on Check and Checkmate, promotion chime, and subtle brazier fire crackle, with safe browser autoplay unlock and Mute/Unmute toggle.

## Files to Create or Modify
- `src/soundEngine.ts` (create)

## Tasks & Steps

### Task 3.1 — Author `src/soundEngine.ts` with procedural Web Audio synthesis
- **Goal:** Provide `wizardAudio` singleton with `setMuted(boolean)`, `toggleMuted()`, `isMuted()`, `playMoveSlide(durationSec)`, `playWeaponClash()`, `playStoneShatter()`, `playCheckWarning()`, `playCheckmateFanfare()`, `playPromotionChime()`, and `getState()`.
- **Target files and symbols:** `src/soundEngine.ts` (`WizardAudioEngine`, `wizardAudio`).
- **Steps:**
  1. Implement lazy `AudioContext` initialization that safely no-ops in headless/Node environments or when muted.
  2. Synthesize `playMoveSlide` using low-pass filtered noise + low-frequency stone resonance.
  3. Synthesize `playWeaponClash` using inharmonic FM metallic partials + sharp transient impact.
  4. Synthesize `playStoneShatter` using sub-bass impact boom + staggered noise bursts representing tumbling stone shards.
  5. Synthesize `playCheckWarning`, `playCheckmateFanfare`, and `playPromotionChime` using Gothic cathedral fifth/minor-third brass/chime oscillators.
- **Success criteria:** `src/soundEngine.ts` passes `npm run lint` and works safely in both browser and headless test environments.
- **Verify:** `npm run lint` exits 0.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
