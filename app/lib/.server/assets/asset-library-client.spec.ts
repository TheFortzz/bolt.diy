import { describe, expect, it, vi } from 'vitest';
import {
  assetViewUrl,
  fetchAssetBytes,
  isConfigurationBlocker,
  isSafeFileId,
  listAssetFiles,
  redactSecrets,
  resolveAssetLibraryConfig,
  verifyAssetAccess,
  type AssetLibraryConfig,
} from './asset-library-client';

const SECRET = 'standard_super_secret_appwrite_key_value';

function config(overrides: Partial<AssetLibraryConfig> = {}): AssetLibraryConfig {
  return {
    endpoint: 'https://fra.cloud.appwrite.io/v1',
    projectId: '6a83071d00217ab38269',
    bucketId: 'assets',
    apiKey: SECRET,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('resolveAssetLibraryConfig', () => {
  it('reuses the studio Appwrite project and endpoint', () => {
    const result = resolveAssetLibraryConfig({
      APPWRITE_API_KEY: SECRET,
      APPWRITE_ASSETS_BUCKET_ID: 'assets',
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.endpoint).toBe('https://fra.cloud.appwrite.io/v1');
      expect(result.data.projectId).toBe('6a83071d00217ab38269');
      expect(result.data.bucketId).toBe('assets');
    }
  });

  it('reports a missing key precisely instead of failing later', () => {
    const result = resolveAssetLibraryConfig({ APPWRITE_ASSETS_BUCKET_ID: 'assets' });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.blocker.code).toBe('missing-api-key');
      expect(result.blocker.message).toContain('rotated');
      expect(isConfigurationBlocker(result.blocker)).toBe(true);
    }
  });

  it('reports a missing bucket precisely', () => {
    const result = resolveAssetLibraryConfig({ APPWRITE_API_KEY: SECRET });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.blocker.code).toBe('missing-bucket');
      expect(isConfigurationBlocker(result.blocker)).toBe(true);
    }
  });

  it('never echoes the key in any message', () => {
    const result = resolveAssetLibraryConfig({ APPWRITE_API_KEY: SECRET, APPWRITE_ASSETS_BUCKET_ID: '../escape' });

    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe('secret redaction', () => {
  it('removes key-shaped query params and headers', () => {
    expect(redactSecrets('GET /x?api-key=abc123&projectId=p1 failed')).toContain('[redacted]');
    expect(redactSecrets('headers: {"X-Appwrite-Key": "abc123"}')).not.toContain('abc123');
    expect(redactSecrets('Authorization: Bearer secret-token')).not.toContain('secret-token');
  });
});

describe('file id safety', () => {
  it('accepts real Appwrite ids', () => {
    expect(isSafeFileId('68b1f0a2c3d4e5f60718')).toBe(true);
    expect(isSafeFileId('crate_albedo.png')).toBe(true);
  });

  it('rejects traversal and injection attempts', () => {
    expect(isSafeFileId('../../etc/passwd')).toBe(false);
    expect(isSafeFileId('a/b')).toBe(false);
    expect(isSafeFileId('file?x=1')).toBe(false);
    expect(isSafeFileId('')).toBe(false);
  });

  it('refuses to build a view URL for an unsafe id', () => {
    const result = assetViewUrl(config(), '../../secret');

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.blocker.code).toBe('invalid-file-id');
    }
  });

  it('builds a project-scoped view URL', () => {
    const result = assetViewUrl(config(), 'crate');

    expect(result.ok && result.data).toBe(
      'https://fra.cloud.appwrite.io/v1/storage/buckets/assets/files/crate/view?projectId=6a83071d00217ab38269',
    );
  });
});

describe('listAssetFiles', () => {
  it('sends the key as a header and never in the URL', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        files: [
          {
            $id: 'f1',
            name: 'crate.png',
            sizeOriginal: 2048,
            mimeType: 'image/png',
            $createdAt: '2026-01-01T00:00:00.000Z',
            $updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      }),
    );

    const result = await listAssetFiles(config(), { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok && result.data.files).toHaveLength(1);
    expect(result.ok && result.data.files[0].name).toBe('crate.png');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(SECRET);
    expect((init.headers as Record<string, string>)['X-Appwrite-Key']).toBe(SECRET);
    expect((init.headers as Record<string, string>)['X-Appwrite-Project']).toBe('6a83071d00217ab38269');
  });

  it('follows pagination up to the page cap', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ files: [{ $id: 'f1', name: 'a.png' }], nextCursor: 'cursor-1' }))
      .mockResolvedValue(jsonResponse({ files: [{ $id: 'f2', name: 'b.png' }] }));

    const result = await listAssetFiles(config(), { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok && result.data.files.map((file) => file.id)).toEqual(['f1', 'f2']);
    expect(result.ok && result.data.pages).toBe(2);
    expect(String((fetchImpl.mock.calls[1] as unknown as [string])[0])).toContain('cursor=cursor-1');
  });

  it('stops at maxPages instead of scanning forever', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ files: [{ $id: 'f', name: 'a.png' }], nextCursor: 'more' }));

    const result = await listAssetFiles(config(), {
      maxPages: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.ok && result.data.nextCursor).toBe('more');
  });

  it('drops entries with an unsafe or missing id instead of trusting them', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        files: [{ $id: '../evil', name: 'x.png' }, { name: 'no-id.png' }, { $id: 'ok', name: 'ok.png' }],
      }),
    );

    const result = await listAssetFiles(config(), { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok && result.data.files.map((file) => file.id)).toEqual(['ok']);
  });

  it('preserves api_key_invalid so an invalid/wrong-project key is distinguishable from missing scopes', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"type":"api_key_invalid","message":"API key is invalid"}', { status: 401 }),
    );

    const result = await listAssetFiles(config(), { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.blocker.code).toBe('unauthorized');
      expect(result.blocker.httpStatus).toBe(401);
      expect(result.blocker.providerCode).toBe('api_key_invalid');
      expect(result.blocker.message).toContain('different project');
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
  });

  it('reports a recognized key missing scopes without telling the user to rotate it', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          '{"type":"general_unauthorized_scope","message":"API key missing scopes [files.list]"}',
          { status: 401 },
        ),
    );

    const result = await listAssetFiles(config(), { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.blocker.providerCode).toBe('general_unauthorized_scope');
      expect(result.blocker.message).toContain('Add buckets.read, files.list and files.read');
      expect(result.blocker.message).toContain('files.list');
    }
  });

  it('translates a 403 into a permissions message', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"Forbidden"}', { status: 403 }));

    const result = await listAssetFiles(config(), { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.blocker.code).toBe('unauthorized');
      expect(result.blocker.message).toContain('permission');
    }
  });

  it('reports a network failure without leaking the key', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED using key=${SECRET}`);
    });

    const result = await listAssetFiles(config(), { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.blocker.code).toBe('network');
      expect(result.blocker.message).not.toContain(SECRET);
    }
  });
});

describe('fetchAssetBytes', () => {
  it('returns bytes for a readable file', async () => {
    const fetchImpl = vi.fn(async () => new Response(Uint8Array.from([1, 2, 3, 4]), { status: 200 }));

    const result = await fetchAssetBytes(config(), 'crate.png', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok && result.data).toEqual(Uint8Array.from([1, 2, 3, 4]));
  });

  it('refuses a file above the probing limit', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(Uint8Array.from([1]), { status: 200, headers: { 'content-length': '999' } }),
    );

    const result = await fetchAssetBytes(config(), 'huge.glb', {
      maxBytes: 100,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.blocker.code).toBe('too-large');
    }
  });

  it('refuses to download an unsafe id', async () => {
    const fetchImpl = vi.fn();

    const result = await fetchAssetBytes(config(), '../secrets', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('verifyAssetAccess', () => {
  it('confirms a reachable file', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ sizeOriginal: 4096, mimeType: 'image/png' }));

    const result = await verifyAssetAccess(config(), 'crate.png', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok && result.data.sizeOriginal).toBe(4096);
  });

  it('reports a missing file so it can be marked unavailable rather than deleted', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"Not found"}', { status: 404 }));

    const result = await verifyAssetAccess(config(), 'gone.png', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.blocker.code).toBe('not-found');
    }
  });
});
