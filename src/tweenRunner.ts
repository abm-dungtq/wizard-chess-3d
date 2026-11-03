export type Tween = ((dt: number) => boolean) & { _isKingFallTween?: boolean };

/** Steps every tween once; a tween that throws is reported and dropped so it cannot stall the loop. */
export function runTweens(tweens: Tween[], dt: number, onError: (err: unknown) => void): void {
  for (let i = tweens.length - 1; i >= 0; i--) {
    let done = true;
    try {
      done = tweens[i](dt);
    } catch (err) {
      onError(err);
    }
    if (done) tweens.splice(i, 1);
  }
}
