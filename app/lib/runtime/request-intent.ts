import type { StudioAgentMode } from '~/utils/constants';

const ACTION =
  '(?:buil[ds]?|buid|biuld|bld|make?|create?|crate|generate|implement|develop|code|script|write|design|plan|add|change|update|fix{1,2}|fxx|repair|reapir|edit|modify|remove|delete|replace|rewrite|improve|redesign|fin(?:ish|sh|sih)|complete|cont(?:[iu]nue|inew)|cont|resume|retry|proceed|rebuil[ds]?|use|tweak|adjust|polish|style|customize|enhance|refine|tune|rework|give|set|put|turn|switch|convert|transform)';

const DIRECT_ACTION = new RegExp(
  `^(?:(?:please|pleas|pls|now|also|just|then|and)\\s+)*(?:(?:can|could|would|will)\\s+(?:you|u)\\s+(?:(?:please|pleas|pls|now|also|just|then)\\s+)*)?${ACTION}\\b`,
  'i',
);

const REQUESTED_ACTION = new RegExp(
  `\\b(?:can|could|would|will)\\s+(?:you|u)\\s+(?:(?:please|pleas|pls|now|also|just|then)\\s+)*${ACTION}\\b`,
  'i',
);

const REQUESTED_HELP_ACTION = new RegExp(
  `^(?:(?:can|could|would|will)\\s+(?:you|u)\\s+)?help\\s+(?:me\\s+)?(?:to\\s+)?(?:(?:please|pleas|pls|now|also|just|then)\\s+)*${ACTION}\\b`,
  'i',
);

const REQUESTED_FIRST_PERSON_ACTION = new RegExp(
  `^(?:i\\s+want|i\\s+would\\s+like|i'd\\s+like|i\\s+need|can\\s+we|we\\s+need|let's|lets)\\s+(?:(?:(?:you|u)\\s+)?(?:to\\s+)?)?(?:(?:please|pleas|pls|now|also|just|then)\\s+)*${ACTION}\\b`,
  'i',
);

const RESUME_OR_CONTINUE =
  /^(?:(?:please|pleas|pls)\s+)?(?:(?:can|could|would|will)\s+(?:you|u)\s+)?(?:keep\s+(?:going|building|coding|working)|cont(?:[iu]nue|inew)|resume|fin(?:ish|sh|sih)(?:ed)?(?:\s+(?:it|up|this|the\s+game|building|coding|then|the\s+build))?|complete(?:\s+(?:it|this|the\s+game|the\s+build))?|proceed|retry)\b/i;

const WORKSPACE_REPAIR =
  /^(?:(?:my|the|this|it)\s+)?(?:game|project|workspace|app|site|page|build)?\b.{0,100}\b(?:broken|not working|doesn't work|does not work|crashes|crashed|is stuck|is lagging|has an error|has a bug|stopped|halted|failed|incomplete|unfinished|missing|didn't finish|not finished)\b|\b(?:why\s+did\s+(?:it|the\s+build|you)\s+stop|it\s+stopped|build\s+stopped)\b/i;

const REQUESTED_GAME =
  /^(?:i\s+want|i\s+would\s+like|i'd\s+like|i\s+need)\s+(?:a|an|new)\s+.{0,48}\b(?:game|app|site|page|project)\b/i;

const REQUESTED_EDIT_OR_FEATURE =
  /^(?:i\s+want|i\s+would\s+like|i'd\s+like|i\s+need|can\s+we\s+have|let's\s+have|lets\s+have)\s+.{0,60}\b(?:colors?|background|theme|enemies|enemy|speed|boss|levels?|sound|music|audio|ui|hud|graphics?|visuals?|controls?|weapons?|player|ship|score|scoring|health|stars?|effects?)\b/i;

const EMBEDDED_BUILD_REQUEST =
  /\b(?:buil[ds]?|buid|biuld|bld|make?|create?|crate)\s+(?:a|an|new|another)?\s*.{0,40}\b(?:game|app|site|page|project)\b/i;

const IMPLICIT_GAME_CONCEPT = /^(?:(?:a|an|new)\s+)?[a-z0-9-]+(?:\s+[a-z0-9-]+){0,3}\s+game$/i;

const EXPLANATION_OR_GREETING =
  /^(?:hi|hello|hey|yo|thanks|thank you|good morning|good evening|what|why|how|when|where|who|which|explain|tell me|(?:can|could) you tell me|do you|are you|is it)\b/i;

const LEADING_INTERJECTION =
  /^(?:hi|hello|hey|yo|bro|dude|man|ok|okay|alright|all\s+right|ya|yeah|yes|yep|so|please|pleas|pls|nice|very\s+nice|good|very\s+good|great|great\s+job|good\s+job|awesome|cool|super|perfect|wonderful|fantastic|looks?\s+(?:good|great|nice)|loved?\s+it|now|next|also|and|then|again|well|but|however)[,!\s.-]+/i;

function stripInterjections(text: string): string {
  let cleaned = text;
  while (LEADING_INTERJECTION.test(cleaned)) {
    cleaned = cleaned.replace(LEADING_INTERJECTION, '').trim();
  }
  return cleaned;
}

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

  const stripped = stripInterjections(text);

  if (
    DIRECT_ACTION.test(text) ||
    DIRECT_ACTION.test(stripped) ||
    RESUME_OR_CONTINUE.test(text) ||
    RESUME_OR_CONTINUE.test(stripped) ||
    REQUESTED_FIRST_PERSON_ACTION.test(text) ||
    REQUESTED_FIRST_PERSON_ACTION.test(stripped)
  ) {
    return true;
  }

  if (WORKSPACE_REPAIR.test(text) || WORKSPACE_REPAIR.test(stripped)) {
    return true;
  }

  if (EXPLANATION_OR_GREETING.test(text)) {
    return false;
  }

  return (
    REQUESTED_ACTION.test(text) ||
    REQUESTED_ACTION.test(stripped) ||
    REQUESTED_HELP_ACTION.test(text) ||
    REQUESTED_HELP_ACTION.test(stripped) ||
    REQUESTED_GAME.test(text) ||
    REQUESTED_GAME.test(stripped) ||
    REQUESTED_EDIT_OR_FEATURE.test(text) ||
    REQUESTED_EDIT_OR_FEATURE.test(stripped) ||
    EMBEDDED_BUILD_REQUEST.test(text) ||
    IMPLICIT_GAME_CONCEPT.test(text)
  );
}
