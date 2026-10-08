/*
 * Per-response output budgets. Large completions carry whole game files per
 * response; per-model ceilings still apply on top of these caps.
 * See https://docs.anthropic.com/en/docs/about-claude/models
 */
export const MAX_TOKENS = 16384;

// Approved game builds stream whole files; a larger budget allows big, complete updates.
export const EDITOR_MAX_TOKENS = 32000;

// Continuations are compacted so large builds can span response segments.
export const MAX_RESPONSE_SEGMENTS = 64;
