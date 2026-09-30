import { SignJWT, jwtVerify } from 'jose';
import { blueprintSchema, canonicalJson, contentHash, revisionHash, type Blueprint } from '~/lib/harness/blueprint';

type CapabilityPurpose = 'review' | 'execute';
let developmentSecret: string | undefined;

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');

  if (origin !== new URL(request.url).origin || site === 'cross-site') {
    throw new Error('Harness requests require the same studio origin.');
  }
}

export function getHarnessSecret(env: Env) {
  const configured = process.env.FORTZ_HARNESS_SIGNING_KEY || env.FORTZ_HARNESS_SIGNING_KEY;

  if (configured) {
    if (configured.length < 32) {
      throw new Error('FORTZ_HARNESS_SIGNING_KEY must contain at least 32 characters.');
    }

    return configured;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Configure server-only FORTZ_HARNESS_SIGNING_KEY before enabling the production harness.');
  }
  developmentSecret ??= crypto.randomUUID() + crypto.randomUUID();

  return developmentSecret;
}

export async function issueCapability(plan: Blueprint, purpose: CapabilityPurpose, secret: string, audience: string) {
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
    .sign(new TextEncoder().encode(secret));
}

export async function verifyCapability(token: string, plan: Blueprint, purpose: CapabilityPurpose, secret: string, audience: string) {
  const parsed = blueprintSchema.parse(plan);
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ['HS256'], issuer: 'fortz-studio-harness', audience, subject: parsed.workspaceId,
  });

  if (
    payload.purpose !== purpose ||
    payload.planId !== parsed.id ||
    payload.baseRevision !== parsed.baseRevision ||
    payload.planHash !== await contentHash(canonicalJson(parsed)) ||
    parsed.baseRevision !== await revisionHash(parsed.manifest)
  ) {
    throw new Error('The approved blueprint was changed or belongs to a different revision.');
  }

  return parsed;
}
