import { SignJWT, jwtVerify } from 'jose';
import { blueprintSchema, canonicalJson, contentHash, revisionHash, type Blueprint } from '~/lib/harness/blueprint';

type CapabilityPurpose = 'review' | 'execute';

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');

  if (origin !== new URL(request.url).origin || site === 'cross-site') {
    throw new Error('Harness requests require the same studio origin.');
  }
}

export async function getHarnessSecret(env?: Partial<Env>): Promise<string> {
  const configured =
    process.env.FORTZ_HARNESS_SIGNING_KEY ||
    (typeof env === 'object' && env !== null ? env.FORTZ_HARNESS_SIGNING_KEY : undefined);

  if (configured && configured.trim().length >= 32) {
    return configured.trim();
  }

  // Derive a deterministic, stable HMAC key across all edge isolates.
  // In serverless environments (e.g. Cloudflare Pages/Workers), each request may run in a separate
  // isolate. Using an in-memory random UUID causes signature verification to fail between /api/plan and /api/chat.
  // By hashing deployment-stable values (configured API keys, deployment flags, and salt),
  // all isolates in the deployment compute the exact same key deterministically.
  const envObj = typeof env === 'object' && env !== null ? env : {};
  const seedParts = [
    configured,
    process.env.FORTZ_HARNESS_SIGNING_KEY,
    envObj.FORTZ_HARNESS_SIGNING_KEY,
    process.env.OPENAI_LIKE_API_KEY,
    envObj.OPENAI_LIKE_API_KEY,
    process.env.OPENAI_API_KEY,
    envObj.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    envObj.ANTHROPIC_API_KEY,
    process.env.GROQ_API_KEY,
    envObj.GROQ_API_KEY,
    process.env.OPEN_ROUTER_API_KEY,
    envObj.OPEN_ROUTER_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    envObj.GOOGLE_GENERATIVE_AI_API_KEY,
    process.env.DEEPSEEK_API_KEY,
    envObj.DEEPSEEK_API_KEY,
    process.env.MISTRAL_API_KEY,
    envObj.MISTRAL_API_KEY,
    process.env.XAI_API_KEY,
    envObj.XAI_API_KEY,
    process.env.FORTZ_AI_DEPLOYMENT,
    envObj.FORTZ_AI_DEPLOYMENT,
    process.env.CF_PAGES_COMMIT_SHA,
    // Stable salt ensures deterministic secret even when no API keys are configured in env
    'fortz-studio-stable-harness-salt-v1-92b8d0e74f1a',
  ].filter(Boolean) as string[];

  const rawSeed = seedParts.join('::');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawSeed));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function issueCapability(
  plan: Blueprint,
  purpose: CapabilityPurpose,
  secret: string | Promise<string>,
  audience: string,
) {
  const resolvedSecret = typeof secret === 'string' ? secret : await secret;
  const parsed = blueprintSchema.parse(plan);

  return new SignJWT({
    purpose,
    planHash: await contentHash(canonicalJson(parsed)),
    baseRevision: parsed.baseRevision,
    planId: parsed.id,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('fortz-studio-harness')
    .setAudience(audience)
    .setSubject(parsed.workspaceId)
    .setIssuedAt()
    .setExpirationTime(purpose === 'review' ? '20m' : '30m')
    .sign(new TextEncoder().encode(resolvedSecret));
}

export async function verifyCapability(
  token: string,
  plan: Blueprint,
  purpose: CapabilityPurpose,
  secret: string | Promise<string>,
  audience: string,
) {
  const resolvedSecret = typeof secret === 'string' ? secret : await secret;
  const parsed = blueprintSchema.parse(plan);
  const { payload } = await jwtVerify(token, new TextEncoder().encode(resolvedSecret), {
    algorithms: ['HS256'],
    issuer: 'fortz-studio-harness',
    audience,
    subject: parsed.workspaceId,
  });

  if (
    payload.purpose !== purpose ||
    payload.planId !== parsed.id ||
    payload.baseRevision !== parsed.baseRevision ||
    payload.planHash !== (await contentHash(canonicalJson(parsed))) ||
    parsed.baseRevision !== (await revisionHash(parsed.manifest))
  ) {
    throw new Error('The approved blueprint was changed or belongs to a different revision.');
  }

  return parsed;
}
