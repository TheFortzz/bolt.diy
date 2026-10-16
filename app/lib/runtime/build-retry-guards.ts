/**
 * Guards that stop the game builder from looping forever.
 *
 * The build loop retries real errors (a broken file, a failing preview), which
 * is what makes the agent finish a game instead of giving up. Two kinds of
 * failure must NOT consume the retry budget, though:
 *
 * 1. The in-browser sandbox itself died (WebContainer/WebAssembly ran out of
 *    memory, cross-origin isolation was lost). Every further attempt fails
 *    identically, so retrying looks like an infinite loop. Reloading the page
 *    is the only fix.
 * 2. The exact same error keeps coming back with no new files written. Another
 *    identical attempt cannot converge, so the loop stops and says so.
 */

const ENVIRONMENT_FATAL_PATTERN =
  /out of memory|cannot allocate|WebAssembly|wasm memory|WebContainer is unavailable|cross-origin isolat/i;

/** True when retrying cannot possibly help because the preview sandbox is gone. */
export function isEnvironmentFatalRuntimeError(message: string | undefined | null): boolean {
  return ENVIRONMENT_FATAL_PATTERN.test(String(message || ''));
}

export interface StallDetector {
  /** Feed the current failure; true when it is a dead end that must stop retrying. */
  isStalled(progressKey: string | number, message: string): boolean;
  reset(): void;
}

/**
 * Repeat detector for unproductive retries. The signature combines the current
 * progress position (phase + files written) with the error text, so a build that
 * keeps repairing *different* problems is never considered stalled.
 */
export function createStallDetector(repeatThreshold = 2): StallDetector {
  let lastSignature = '';
  let repeats = 0;

  return {
    isStalled(progressKey, message) {
      const signature = `${progressKey}:${String(message || '').slice(0, 180)}`;
      repeats = signature === lastSignature ? repeats + 1 : 0;
      lastSignature = signature;

      return repeats >= repeatThreshold;
    },
    reset() {
      lastSignature = '';
      repeats = 0;
    },
  };
}
