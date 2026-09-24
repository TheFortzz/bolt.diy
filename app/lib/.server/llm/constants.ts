// see https://docs.anthropic.com/en/docs/about-claude/models
// Raised so FortzAI can emit real multi-file games instead of truncating at ~1k lines.
export const MAX_TOKENS = 16384;

// limits the number of model responses that can be returned in a single request
// More segments = continuations can finish large multi-file projects.
export const MAX_RESPONSE_SEGMENTS = 8;
