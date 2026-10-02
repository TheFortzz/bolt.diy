import type { StudioAgentMode } from '~/utils/constants';

const ACTION =
  '(?:build|make|create|generate|implement|develop|code|script|write|design|plan|add|change|update|fix|repair|edit|modify|remove|delete|replace|rewrite|improve|redesign|finish|complete|continue|resume|retry|proceed|rebuild)';
const DIRECT_ACTION = new RegExp(`^(?:please\\s+)?(?:(?:can|could|would)\\s+you\\s+)?${ACTION}\\b`, 'i');
const REQUESTED_ACTION = new RegExp(`\\b(?:can|could|would)\\s+you\\s+(?:please\\s+)?${ACTION}\\b`, 'i');
const REQUESTED_HELP_ACTION = new RegExp(`^(?:can|could|would)\\s+you\\s+help\\s+me\\s+(?:to\\s+)?${ACTION}\\b`, 'i');
const REQUESTED_FIRST_PERSON_ACTION = new RegExp(
  `^(?:i want|i would like|i'd like|i need)\\s+(?:(?:you\\s+)?to\\s+)?${ACTION}\\b`,
  'i',
);
const RESUME_OR_CONTINUE =
  /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:keep\s+(?:going|building|coding|working)|continue|resume|finish(?:ed)?(?:\s+(?:it|up|this|the\s+game|building|coding|then))?|finish|complete(?:\s+(?:it|this|the\s+game))?|proceed|retry)\b/i;
const WORKSPACE_REPAIR =
  /^(?:(?:my|the|this|it)\s+)?(?:game|project|workspace|app|site|page|build)?\b.{0,100}\b(?:broken|not working|doesn't work|does not work|crashes|crashed|is stuck|is lagging|has an error|has a bug|stopped|halted|failed|incomplete|unfinished|missing|didn't finish|not finished)\b|\b(?:why\s+did\s+(?:it|the\s+build|you)\s+stop|it\s+stopped|build\s+stopped)\b/i;
const REQUESTED_GAME =
  /^(?:i want|i would like|i'd like|i need)\s+(?:a|an|new)\s+.{0,48}\b(?:game|app|site|page|project)\b/i;
const IMPLICIT_GAME_CONCEPT = /^(?:(?:a|an|new)\s+)?[a-z0-9-]+(?:\s+[a-z0-9-]+){0,3}\s+game$/i;
const EXPLANATION_OR_GREETING =
  /^(?:hi|hello|hey|yo|thanks|thank you|good morning|good evening|what|why|how|when|where|who|which|explain|tell me|(?:can|could) you tell me|do you|are you|is it)\b/i;

/** Route only clear create/edit/repair requests through the approval planner. */
export function shouldUseBuildPlanner(request: string, mode: StudioAgentMode = 'auto') {
  if (mode === 'plan' || mode === 'build') {
    return true;
  }

  if (mode === 'chat') {
    return false;
  }

  const text = request.trim();

  if (!text) {
    return false;
  }

  const afterGreeting = text.replace(/^(?:hi|hello|hey|yo)[,!\s]+/i, '').trim();

  if (
    DIRECT_ACTION.test(text) ||
    DIRECT_ACTION.test(afterGreeting) ||
    RESUME_OR_CONTINUE.test(text) ||
    RESUME_OR_CONTINUE.test(afterGreeting) ||
    REQUESTED_FIRST_PERSON_ACTION.test(text)
  ) {
    return true;
  }

  if (WORKSPACE_REPAIR.test(text) || WORKSPACE_REPAIR.test(afterGreeting)) {
    return true;
  }

  if (EXPLANATION_OR_GREETING.test(text)) {
    return false;
  }

  return (
    REQUESTED_ACTION.test(text) ||
    REQUESTED_HELP_ACTION.test(text) ||
    REQUESTED_GAME.test(text) ||
    IMPLICIT_GAME_CONCEPT.test(text)
  );
}
