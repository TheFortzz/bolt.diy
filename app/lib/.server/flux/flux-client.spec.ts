import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getFluxApiKey,
  formatFluxPrompt,
  parseFluxResponse,
  generateFluxImage,
  getFluxEndpoint,
  FLUX_ENDPOINT,
} from './flux-client';

describe('flux-client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getFluxApiKey', () => {
    it('returns undefined when FLUX_API_KEY is not set', () => {
      delete process.env.FLUX_API_KEY;
      expect(getFluxApiKey()).toBeUndefined();
    });

    it('returns key from process.env.FLUX_API_KEY', () => {
      process.env.FLUX_API_KEY = 'test-secret-key-123';
      expect(getFluxApiKey()).toBe('test-secret-key-123');
    });

    it('returns key from passed env dictionary', () => {
      delete process.env.FLUX_API_KEY;
      expect(getFluxApiKey({ FLUX_API_KEY: 'cloudflare-secret-key' })).toBe('cloudflare-secret-key');
    });

    it('reads the Cloudflare thumbnail-maker secret binding without exposing it', () => {
      delete process.env.FLUX_API_KEY;
      expect(getFluxApiKey({ 'tunbnailmaker-key': 'dashboard-secret' })).toBe('dashboard-secret');
    });

    it('ignores empty whitespace keys', () => {
      process.env.FLUX_API_KEY = '   ';
      expect(getFluxApiKey()).toBeUndefined();
    });
  });

  describe('getFluxEndpoint', () => {
    it('prefers the Cloudflare thumbnail-maker endpoint binding', () => {
      expect(getFluxEndpoint({ 'tunbnailmaker-url': 'https://image.example/flux' })).toBe('https://image.example/flux');
    });

    it('supports the standard spelling and falls back to the legacy endpoint', () => {
      expect(getFluxEndpoint({ THUMBNAILMAKER_URL: 'https://image.example/standard' })).toBe('https://image.example/standard');
      expect(getFluxEndpoint({})).toBe(FLUX_ENDPOINT);
    });
  });

  describe('formatFluxPrompt', () => {
    it('appends transparent background requirements for sprites', () => {
      const prompt = 'retro spaceship';
      const formatted = formatFluxPrompt(prompt, true);
      expect(formatted).toContain('transparent background');
      expect(formatted).toContain('clean alpha channel');
      expect(formatted).toContain('2D video game sprite');
    });

    it('retains base prompt for non-sprite background textures', () => {
      const prompt = 'scenic space nebula background';
      const formatted = formatFluxPrompt(prompt, false);
      expect(formatted).toBe('scenic space nebula background');
    });
  });

  describe('parseFluxResponse', () => {
    it('parses base64 response from data[0].b64_json', async () => {
      const sampleBase64 = Buffer.from('test-image-bytes').toString('base64');
      const mockResponse = new Response(
        JSON.stringify({
          data: [{ b64_json: sampleBase64 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

      const result = await parseFluxResponse(mockResponse);
      expect(result.ok).toBe(true);
      expect(result.base64).toBe(sampleBase64);
      expect(result.buffer).toBeInstanceOf(Uint8Array);
    });

    it('handles non-200 error responses gracefully without throwing', async () => {
      const mockResponse = new Response(
        JSON.stringify({ error: { message: 'Quota exceeded' } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );

      const result = await parseFluxResponse(mockResponse);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('429');
    });
  });

  describe('generateFluxImage', () => {
    it('returns skipped when apiKey is missing', async () => {
      const result = await generateFluxImage({ prompt: 'test' }, undefined);
      expect(result.ok).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.error).toContain('secret is not configured');
    });

    it('sends correct headers and body to FLUX endpoint', async () => {
      const sampleBase64 = Buffer.from('generated-png-data').toString('base64');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ b64_json: sampleBase64 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const result = await generateFluxImage(
        { prompt: 'pixel hero warrior', isSprite: true, width: 512, height: 512 },
        'dummy-test-key',
      );

      expect(result.ok).toBe(true);
      expect(result.base64).toBe(sampleBase64);
      expect(fetchSpy).toHaveBeenCalledWith(
        FLUX_ENDPOINT,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer dummy-test-key',
            'api-key': 'dummy-test-key',
          }),
        }),
      );
    });

    it('handles network failure gracefully without breaking', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection reset'));

      const result = await generateFluxImage(
        { prompt: 'pixel hero', isSprite: true },
        'dummy-test-key',
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Connection reset');
    });
  });
});
