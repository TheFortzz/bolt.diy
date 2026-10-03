// see https://docs.anthropic.com/en/docs/about-claude/models
// Smaller completions stay below edge/provider resource limits; the plan allows many segments for big games.
export const MAX_TOKENS = 8192;

// Continuations are compacted so large builds can span response segments.
export const MAX_RESPONSE_SEGMENTS = 64;
