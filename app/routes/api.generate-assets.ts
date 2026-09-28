import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from '@remix-run/cloudflare';
import { getFluxApiKey, generateFluxImage } from '~/lib/.server/flux/flux-client';
import { selectVisualElementsWithModel } from '~/lib/.server/flux/asset-selector';
import { integrateAssetsWithModel } from '~/lib/.server/flux/code-updater';
import { getModel } from '~/lib/.server/llm/model';
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '~/utils/constants';

export async function loader({ context }: LoaderFunctionArgs) {
  const apiKey = getFluxApiKey(context.cloudflare?.env);
  return json({
    available: Boolean(apiKey),
  });
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method Not Allowed' }, { status: 405 });
  }

  // Security: Read API key only from FLUX_API_KEY in the environment. Never hardcode, log, or commit it.
  const apiKey = getFluxApiKey(context.cloudflare?.env);

  if (!apiKey) {
    // If missing, retain the existing rendering behavior gracefully
    return json({
      ok: false,
      skipped: true,
      reason: 'FLUX_API_KEY is not configured in the environment',
    });
  }

  try {
    const payload = await request.json<{
      userPrompt?: string;
      files?: Record<string, string>;
      model?: string;
      provider?: string;
      apiKeys?: Record<string, string>;
    }>();

    const userPrompt = payload.userPrompt || '2D video game';
    const files = payload.files || {};
    const selectedModel = payload.model || DEFAULT_MODEL;
    const selectedProvider = payload.provider || DEFAULT_PROVIDER.name;
    const userApiKeys = payload.apiKeys || {};

    let languageModel: any = null;
    try {
      languageModel = getModel(selectedProvider, selectedModel, context.cloudflare?.env as any, userApiKeys);
    } catch {
      /* proceed with heuristic if model resolution fails */
    }

    // 1. Select 2-4 important visual elements
    const elements = await selectVisualElementsWithModel(userPrompt, files, languageModel);

    // 2. Generate each image through FLUX.2-pro deployment
    const generatedAssets: Array<{
      id: string;
      fileName: string;
      base64: string;
      description: string;
    }> = [];

    await Promise.all(
      elements.map(async (element) => {
        try {
          const result = await generateFluxImage(
            {
              prompt: element.prompt,
              isSprite: element.isSprite,
              width: element.width || 512,
              height: element.height || 512,
              timeoutMs: 35000,
            },
            apiKey,
          );

          if (result.ok && result.base64) {
            generatedAssets.push({
              id: element.id,
              fileName: element.fileName,
              base64: result.base64,
              description: element.description,
            });
          }
        } catch {
          // Individual image failure must not break asset generation flow
        }
      }),
    );

    // 3. Update the relevant game code to load and draw images with shape fallback preserved
    const updatedFiles: Record<string, string> = {};

    if (generatedAssets.length > 0) {
      // Find candidate code file to update (e.g. game.js, main.js, or index.html)
      const targetFileEntry =
        Object.entries(files).find(([name]) => /^(game|main|app|entities)\.js$/i.test(name)) ||
        Object.entries(files).find(([name, content]) => name.endsWith('.js') && (content.includes('ctx.') || content.includes('requestAnimationFrame'))) ||
        Object.entries(files).find(([name]) => name.endsWith('.html'));

      if (targetFileEntry) {
        const [targetPath, originalContent] = targetFileEntry;
        const matchingElements = elements.filter((el) =>
          generatedAssets.some((a) => a.id === el.id),
        );

        if (matchingElements.length > 0) {
          const updatedContent = await integrateAssetsWithModel(
            originalContent,
            targetPath,
            matchingElements,
            languageModel,
          );

          if (updatedContent && updatedContent !== originalContent) {
            updatedFiles[targetPath] = updatedContent;
          }
        }
      }
    }

    return json({
      ok: true,
      elements,
      assets: generatedAssets,
      updatedFiles,
    });
  } catch (err: any) {
    return json({
      ok: false,
      error: `Asset generation process error: ${err?.message || 'Unknown error'}`,
    });
  }
}
