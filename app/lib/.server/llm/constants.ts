// see https://docs.anthropic.com/en/docs/about-claude/models
// Keep individual provider requests below common completion limits; large builds continue in segments.
export const MAX_TOKENS = 32768;

// Continuations are compacted so large builds can span response segments.
export const MAX_RESPONSE_SEGMENTS = 3;
