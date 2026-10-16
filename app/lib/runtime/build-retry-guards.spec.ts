import { describe, expect, it } from 'vitest';
import { createStallDetector, isEnvironmentFatalRuntimeError } from './build-retry-guards';

describe('build retry guards', () => {
  it('treats a dead preview sandbox as unfixable by retrying', () => {
    expect(
      isEnvironmentFatalRuntimeError('WebAssembly.instantiate(): Out of memory: Cannot allocate Wasm memory'),
    ).toBe(true);
    expect(
      isEnvironmentFatalRuntimeError(
        'WebContainer is unavailable. Reload the studio with cross-origin isolation enabled.',
      ),
    ).toBe(true);
    expect(isEnvironmentFatalRuntimeError('cross-origin isolation is required')).toBe(true);
  });

  it('never mistakes a real game or build error for a dead sandbox', () => {
    expect(isEnvironmentFatalRuntimeError('index.html is missing or empty after this phase.')).toBe(false);
    expect(isEnvironmentFatalRuntimeError('RangeError: Maximum call stack size exceeded')).toBe(false);
    expect(isEnvironmentFatalRuntimeError("Uncaught TypeError: Cannot read properties of null (reading 'x')")).toBe(
      false,
    );
    expect(isEnvironmentFatalRuntimeError('')).toBe(false);
    expect(isEnvironmentFatalRuntimeError(undefined)).toBe(false);
  });

  it('only reports a stall when the same error repeats at the same progress point', () => {
    const detector = createStallDetector();

    // Same error, but the build wrote more files -> real progress, keep going.
    expect(detector.isStalled('0:2', 'src/main.js has a syntax error')).toBe(false);
    expect(detector.isStalled('0:5', 'src/main.js has a syntax error')).toBe(false);
    expect(detector.isStalled('0:5', 'src/main.js has a syntax error')).toBe(false);
    expect(detector.isStalled('0:5', 'src/main.js has a syntax error')).toBe(true);
  });

  it('does not stall while each attempt reports a different error', () => {
    const detector = createStallDetector();

    expect(detector.isStalled('1:4', 'first error')).toBe(false);
    expect(detector.isStalled('1:4', 'second error')).toBe(false);
    expect(detector.isStalled('1:4', 'third error')).toBe(false);
    expect(detector.isStalled('1:4', 'third error')).toBe(false);
    expect(detector.isStalled('1:4', 'third error')).toBe(true);
  });

  it('resets after progress is made', () => {
    const detector = createStallDetector();

    detector.isStalled('0:1', 'same');
    detector.isStalled('0:1', 'same');
    detector.reset();
    expect(detector.isStalled('0:1', 'same')).toBe(false);
  });
});
