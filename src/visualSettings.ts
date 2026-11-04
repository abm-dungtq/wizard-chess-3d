export type MotionLevel = 'full' | 'quick' | 'off';
export type QualityTier = 'ultra' | 'high' | 'base';
export type QualityPreference = QualityTier | 'auto';

export interface VisualSettings {
  motion?: MotionLevel;
  quality?: QualityPreference;
}

export interface QualitySignals {
  coarsePointer: boolean;
  maxTouchPoints: number;
  gpuRenderer: string;
  isAutomatedTest: boolean;
}

const STORAGE_KEY = 'wizard_chess_settings_v1';
const MOTION_LEVELS: MotionLevel[] = ['full', 'quick', 'off'];
const QUALITY_PREFERENCES: QualityPreference[] = ['auto', 'ultra', 'high', 'base'];

export const isMotionLevel = (value: unknown): value is MotionLevel => MOTION_LEVELS.includes(value as MotionLevel);
export const isQualityPreference = (value: unknown): value is QualityPreference =>
  QUALITY_PREFERENCES.includes(value as QualityPreference);

export function loadVisualSettings(): VisualSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>;
    const settings: VisualSettings = {};
    if (isMotionLevel(raw.motion)) settings.motion = raw.motion;
    if (isQualityPreference(raw.quality)) settings.quality = raw.quality;
    return settings;
  } catch {
    // Private browsing and corrupt JSON both fall back to defaults.
    return {};
  }
}

export function saveVisualSettings(patch: VisualSettings): VisualSettings {
  const next = { ...loadVisualSettings(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

/** A saved choice wins; otherwise the OS "reduce motion" switch decides. */
export function resolveMotionLevel(saved: unknown, prefersReducedMotion: boolean): MotionLevel {
  if (isMotionLevel(saved)) return saved;
  return prefersReducedMotion ? 'off' : 'full';
}

/** Only Apple-silicon Macs start at `ultra`; touch devices start at `base`. */
export function pickQualityTier(signals: QualitySignals): QualityTier {
  if (signals.coarsePointer) return 'base';
  if (signals.isAutomatedTest) return 'high';
  if (signals.maxTouchPoints === 0 && /Apple (M\d|GPU)/.test(signals.gpuRenderer)) return 'ultra';
  return 'high';
}

export function downgradeTier(tier: QualityTier): QualityTier {
  return tier === 'ultra' ? 'high' : 'base';
}
