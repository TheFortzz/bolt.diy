/**
 * Server-side Appwrite Storage client for the asset library.
 *
 * Security rules enforced here:
 *  - The API key is read from the server environment only and is NEVER
 *    returned, logged, or included in an error message.
 *  - Every file id is validated against a strict charset before it is placed
 *    in a URL, so a crafted id can never escape the bucket path.
 *  - Operations are READ-ONLY. Nothing in this module deletes, overwrites or
 *    re-uploads a file; catalogue improvement never touches remote state.
 *
 * Failures are reported as a structured `AssetLibraryBlocker` rather than a
 * thrown string, so callers can tell "the key is missing" apart from "the
 * bucket is wrong" instead of retrying blindly.
 */

export interface AssetLibraryConfig {
  endpoint: string;
  projectId: string;
  bucketId: string;

  /** Held privately: never surfaced in results or errors. */
  apiKey: string;
}

export type AssetLibraryBlockerCode =
  | 'missing-api-key'
  | 'missing-bucket'
  | 'unauthorized'
  | 'not-found'
  | 'network'
  | 'too-large'
  | 'invalid-file-id'
  | 'appwrite-error';

export interface AssetLibraryBlocker {
  code: AssetLibraryBlockerCode;

  /** Operator-facing, credential-free explanation. */
  message: string;
  httpStatus?: number;
}

export type AssetLibraryResult<T> = { ok: true; data: T } | { ok: false; blocker: AssetLibraryBlocker };

/** A file as Appwrite Storage lists it (no content). */
export interface RemoteAssetFile {
  id: string;
  name: string;
  sizeOriginal: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;

  /** Only present for files uploaded with client-side encryption metadata. */
  md5?: string;
}

export interface AssetEnv {
  APPWRITE_API_KEY?: string;
  APPWRITE_ENDPOINT?: string;
  APPWRITE_PROJECT_ID?: string;
  APPWRITE_ASSETS_BUCKET_ID?: string;
}

/** Same Appwrite project the studio already publishes to. */
const DEFAULT_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const DEFAULT_PROJECT_ID = '6a83071d00217ab38269';

/** Appwrite file ids are opaque tokens; anything else is rejected outright. */
const SAFE_FILE_ID = /^[\w.-]{1,64}$/;
const SAFE_BUCKET_ID = /^[\w-]{1,64}$/;

/** Hard ceiling on a single asset download during catalogue building. */
export const MAX_ASSET_BYTES = 64 * 1024 * 1024;

/**
 * Strip anything key-shaped out of a message before it can reach a log line
 * or an API response.
 */
export function redactSecrets(message: string): string {
  return (
    String(message || '')
      // Whole-line credentials: `Authorization: Bearer <token>`, `{"X-Appwrite-Key": "<key>"}`.
      .replace(
        /(["']?(?:authorization|x-appwrite-key|x-appwrite-session|api[_-]?key|apikey)["']?\s*[:=]\s*)["']?[^\r\n"']+/gi,
        '$1[redacted]',
      )
      // Query-style credentials: `?api-key=abc`, `&token=abc`.
      .replace(/([?&](?:api[-_]?key|key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]')
      // Bare assignments: `using key=abc`, `token: abc`.
      .replace(/(\b(?:api[-_]?key|apikey|key|token|secret|password)\s*[:=]\s*)['"]?[^\s'"&]+/gi, '$1[redacted]')
      .slice(0, 300)
  );
}

export function isSafeFileId(fileId: string): boolean {
  return typeof fileId === 'string' && SAFE_FILE_ID.test(fileId);
}

/**
 * Resolve configuration from the server environment, or explain exactly what is
 * missing. Never throws, never echoes the key.
 */
export function resolveAssetLibraryConfig(env: AssetEnv): AssetLibraryResult<AssetLibraryConfig> {
  const apiKey = (env.APPWRITE_API_KEY || '').trim();

  if (!apiKey) {
    return {
      ok: false,
      blocker: {
        code: 'missing-api-key',
        message:
          'APPWRITE_API_KEY is not set in the server environment. Add a freshly rotated admin key with the buckets.read, files.read and files.list scopes.',
      },
    };
  }

  const bucketId = (env.APPWRITE_ASSETS_BUCKET_ID || '').trim();

  if (!bucketId) {
    return {
      ok: false,
      blocker: {
        code: 'missing-bucket',
        message:
          'APPWRITE_ASSETS_BUCKET_ID is not set, so there is no asset library bucket to read. Create the bucket, then set its id here.',
      },
    };
  }

  if (!SAFE_BUCKET_ID.test(bucketId)) {
    return {
      ok: false,
      blocker: {
        code: 'missing-bucket',
        message: `APPWRITE_ASSETS_BUCKET_ID ("${redactSecrets(bucketId)}") is not a valid bucket id.`,
      },
    };
  }

  return {
    ok: true,
    data: {
      endpoint: (env.APPWRITE_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, ''),
      projectId: (env.APPWRITE_PROJECT_ID || DEFAULT_PROJECT_ID).trim(),
      bucketId,
      apiKey,
    },
  };
}

function storageUrl(config: AssetLibraryConfig, suffix: string): string {
  return `${config.endpoint}/storage/buckets/${config.bucketId}/files${suffix}`;
}

function authHeaders(config: AssetLibraryConfig): Record<string, string> {
  return { 'X-Appwrite-Key': config.apiKey, 'Content-Type': 'application/json' };
}

async function blockerFromResponse(response: Response, action: string): Promise<AssetLibraryBlocker> {
  const httpStatus = response.status;

  if (httpStatus === 401) {
    return {
      code: 'unauthorized',
      httpStatus,
      message:
        'Appwrite rejected the asset library key (401). It is missing, invalid, or expired — rotate APPWRITE_API_KEY and confirm it still has files.read/files.list on the assets bucket.',
    };
  }

  if (httpStatus === 403) {
    return {
      code: 'unauthorized',
      httpStatus,
      message:
        'The asset library key lacks permission for this bucket (403). Grant the key access to the assets bucket, or set APPWRITE_ASSETS_BUCKET_ID to a bucket it can read.',
    };
  }

  if (httpStatus === 404) {
    return {
      code: 'not-found',
      httpStatus,
      message: `Appwrite has no asset library bucket for this project (404). Verify APPWRITE_ASSETS_BUCKET_ID.`,
    };
  }

  let detail = '';

  try {
    detail = redactSecrets(await response.text());
  } catch {
    detail = '';
  }

  return {
    code: 'appwrite-error',
    httpStatus,
    message: `Appwrite returned ${httpStatus} while ${action}${detail ? `: ${detail}` : '.'}`,
  };
}

/**
 * List library files, one page at a time.
 * `maxPages` bounds the scan so a huge bucket can never turn into an unbounded
 * loop or an unbounded memory spike.
 */
export async function listAssetFiles(
  config: AssetLibraryConfig,
  options: { limit?: number; cursor?: string; maxPages?: number; fetchImpl?: typeof fetch } = {},
): Promise<AssetLibraryResult<{ files: RemoteAssetFile[]; nextCursor?: string; pages: number }>> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const maxPages = Math.min(20, Math.max(1, options.maxPages ?? 4));
  const doFetch = options.fetchImpl ?? fetch;

  const files: RemoteAssetFile[] = [];
  let cursor = options.cursor;
  let pages = 0;

  while (pages < maxPages) {
    const query = new URLSearchParams({ projectId: config.projectId, limit: String(limit) });

    if (cursor) {
      query.set('cursor', cursor);
    }

    let response: Response;

    try {
      response = await doFetch(storageUrl(config, `?${query.toString()}`), { headers: authHeaders(config) });
    } catch (error) {
      return {
        ok: false,
        blocker: {
          code: 'network',
          message: `Could not reach Appwrite Storage while listing assets: ${redactSecrets(
            error instanceof Error ? error.message : String(error),
          )}`,
        },
      };
    }

    if (!response.ok) {
      return { ok: false, blocker: await blockerFromResponse(response, 'listing asset files') };
    }

    const payload = (await response.json()) as { files?: unknown[]; nextCursor?: string };
    const batch = Array.isArray(payload.files) ? payload.files : [];

    for (const entry of batch) {
      const file = normalizeRemoteFile(entry);

      if (file) {
        files.push(file);
      }
    }

    pages += 1;
    cursor = payload.nextCursor;

    if (!cursor) {
      break;
    }
  }

  return { ok: true, data: { files, nextCursor: cursor, pages } };
}

function normalizeRemoteFile(entry: unknown): RemoteAssetFile | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const raw = entry as Record<string, unknown>;
  const id = typeof raw.$id === 'string' ? raw.$id : '';
  const name = typeof raw.name === 'string' ? raw.name : '';

  if (!isSafeFileId(id) || !name) {
    return undefined;
  }

  return {
    id,
    name,
    sizeOriginal: typeof raw.sizeOriginal === 'number' ? raw.sizeOriginal : 0,
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : '',
    createdAt: typeof raw.$createdAt === 'string' ? raw.$createdAt : '',
    updatedAt: typeof raw.$updatedAt === 'string' ? raw.$updatedAt : '',
    md5: typeof raw.md5 === 'string' ? raw.md5 : undefined,
  };
}

/** Public view URL for a library file. Requires a client-readable permission. */
export function assetViewUrl(config: AssetLibraryConfig, fileId: string): AssetLibraryResult<string> {
  if (!isSafeFileId(fileId)) {
    return {
      ok: false,
      blocker: {
        code: 'invalid-file-id',
        message: `Refusing to build a URL for an unsafe file id: ${redactSecrets(fileId)}.`,
      },
    };
  }

  const query = new URLSearchParams({ projectId: config.projectId });

  return { ok: true, data: storageUrl(config, `/${encodeURIComponent(fileId)}/view?${query.toString()}`) };
}

/**
 * Download a library file's bytes for probing.
 * Refuses anything over `maxBytes` so one huge file cannot exhaust a Worker.
 */
export async function fetchAssetBytes(
  config: AssetLibraryConfig,
  fileId: string,
  options: { maxBytes?: number; fetchImpl?: typeof fetch } = {},
): Promise<AssetLibraryResult<Uint8Array>> {
  if (!isSafeFileId(fileId)) {
    return {
      ok: false,
      blocker: {
        code: 'invalid-file-id',
        message: `Refusing to download an unsafe file id: ${redactSecrets(fileId)}.`,
      },
    };
  }

  const maxBytes = options.maxBytes ?? MAX_ASSET_BYTES;
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;

  try {
    response = await doFetch(storageUrl(config, `/${encodeURIComponent(fileId)}/download`), {
      headers: authHeaders(config),
    });
  } catch (error) {
    return {
      ok: false,
      blocker: {
        code: 'network',
        message: `Could not reach Appwrite Storage while downloading ${fileId}: ${redactSecrets(
          error instanceof Error ? error.message : String(error),
        )}`,
      },
    };
  }

  if (!response.ok) {
    return { ok: false, blocker: await blockerFromResponse(response, `downloading ${fileId}`) };
  }

  const declared = Number(response.headers.get('content-length') || '0');

  if (declared && declared > maxBytes) {
    return {
      ok: false,
      blocker: {
        code: 'too-large',
        message: `Asset ${fileId} is ${declared} bytes, above the ${maxBytes} byte probing limit.`,
      },
    };
  }

  const body = await response.arrayBuffer();
  const buffer = ArrayBuffer.isView(body)
    ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    : body;

  if (buffer.byteLength > maxBytes) {
    return {
      ok: false,
      blocker: {
        code: 'too-large',
        message: `Asset ${fileId} exceeds the ${maxBytes} byte probing limit.`,
      },
    };
  }

  return { ok: true, data: new Uint8Array(buffer as ArrayBuffer) };
}

/**
 * Confirm one file is still reachable. Used by the catalogue builder to mark a
 * record unavailable instead of deleting it.
 */
export async function verifyAssetAccess(
  config: AssetLibraryConfig,
  fileId: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<AssetLibraryResult<{ sizeOriginal: number; mimeType: string }>> {
  if (!isSafeFileId(fileId)) {
    return {
      ok: false,
      blocker: { code: 'invalid-file-id', message: `Refusing to verify an unsafe file id: ${redactSecrets(fileId)}.` },
    };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const query = new URLSearchParams({ projectId: config.projectId });

  let response: Response;

  try {
    response = await doFetch(storageUrl(config, `/${encodeURIComponent(fileId)}?${query.toString()}`), {
      headers: authHeaders(config),
    });
  } catch (error) {
    return {
      ok: false,
      blocker: {
        code: 'network',
        message: `Could not reach Appwrite Storage while verifying ${fileId}: ${redactSecrets(
          error instanceof Error ? error.message : String(error),
        )}`,
      },
    };
  }

  if (!response.ok) {
    return { ok: false, blocker: await blockerFromResponse(response, `verifying ${fileId}`) };
  }

  const payload = (await response.json()) as { sizeOriginal?: unknown; mimeType?: unknown };

  return {
    ok: true,
    data: {
      sizeOriginal: typeof payload.sizeOriginal === 'number' ? payload.sizeOriginal : 0,
      mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : '',
    },
  };
}

/** True when a blocker is a configuration problem the operator must fix. */
export function isConfigurationBlocker(blocker: AssetLibraryBlocker): boolean {
  return blocker.code === 'missing-api-key' || blocker.code === 'missing-bucket';
}
