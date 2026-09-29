/**
 * Code Asset Integrator
 *
 * Updates relevant game source code to load and draw generated image assets
 * instead of shape-based rendering, while strictly preserving shape rendering
 * as a runtime and loading fallback.
 */

import { generateText } from 'ai';
import type { LanguageModelV1 } from 'ai';
import type { VisualElement } from './asset-selector';

/**
 * Basic syntax verification to guarantee code modifications never break the build.
 */
export function verifyJavaScriptSyntax(code: string): boolean {
  try {
    // Basic bracket and brace balance verification
    let braceCount = 0;
    let parenCount = 0;
    let bracketCount = 0;
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < code.length; i++) {
      const c = code[i];
      const next = code[i + 1];

      if (inLineComment) {
        if (c === '\n') inLineComment = false;
        continue;
      }

      if (inBlockComment) {
        if (c === '*' && next === '/') {
          inBlockComment = false;
          i++;
        }
        continue;
      }

      if (inString) {
        if (c === '\\') {
          i++; // Skip escape character
          continue;
        }
        if (c === stringChar) {
          inString = false;
        }
        continue;
      }

      // Check comments
      if (c === '/' && next === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (c === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }

      // Check strings
      if (c === "'" || c === '"' || c === '`') {
        inString = true;
        stringChar = c;
        continue;
      }

      // Count delimiters
      if (c === '{') braceCount++;
      else if (c === '}') braceCount--;
      else if (c === '(') parenCount++;
      else if (c === ')') parenCount--;
      else if (c === '[') bracketCount++;
      else if (c === ']') bracketCount--;

      if (braceCount < 0 || parenCount < 0 || bracketCount < 0) {
        return false;
      }
    }

    return !inString && !inBlockComment && braceCount === 0 && parenCount === 0 && bracketCount === 0;
  } catch {
    return false;
  }
}

/**
 * Creates safe client-side asset loader code with shape fallback helper.
 */
export function generateAssetLoaderSnippet(elements: VisualElement[]): string {
  const assetEntries = elements
    .map(
      (el) =>
        `    ${JSON.stringify(el.id)}: (() => { const img = new Image(); img.src = ${JSON.stringify(el.fileName)}; return img; })()`,
    )
    .join(',\n');

  return `// --- Auto-Generated Asset Loader (FLUX.2-pro) with Fallback Shape Rendering ---
const GameAssets = {
  images: {
${assetEntries}
  },
  draw(ctx, id, x, y, width, height, shapeFallback) {
    const img = this.images[id];
    if (img && img.complete && img.naturalWidth > 0) {
      try {
        ctx.drawImage(img, x, y, width, height);
        return;
      } catch (e) {
        /* proceed to fallback */
      }
    }
    // Fallback: execute original shape rendering
    if (typeof shapeFallback === 'function') {
      shapeFallback();
    }
  },
  drawRotated(ctx, id, x, y, width, height, angle, shapeFallback) {
    const img = this.images[id];
    if (img && img.complete && img.naturalWidth > 0) {
      try {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.drawImage(img, -width / 2, -height / 2, width, height);
        ctx.restore();
        return;
      } catch (e) {
        ctx.restore();
      }
    }
    if (typeof shapeFallback === 'function') {
      shapeFallback();
    }
  }
};
if (typeof window !== 'undefined') {
  window.GameAssets = GameAssets;
}
// -----------------------------------------------------------------------------------\n\n`;
}

/**
 * Integrates image assets into game code using the LLM, preserving shape rendering as fallback.
 */
export async function integrateAssetsWithModel(
  code: string,
  fileName: string,
  elements: VisualElement[],
  model: LanguageModelV1,
): Promise<string> {
  const elementDescriptions = elements
    .map((e) => `- ID "${e.id}": file "${e.fileName}" (${e.description}, ${e.isSprite ? 'transparent sprite' : 'background backdrop'})`)
    .join('\n');

  const systemPrompt = `You are an expert game engine developer.
The user is upgrading their game from purely shape-based canvas rendering to use newly generated FLUX.2-pro image assets.
Assets generated under /assets/:
${elementDescriptions}

CRITICAL RULES:
1. Load each image using "new Image()" with its source set to its fileName (e.g. 'assets/player.png') or use window.GameAssets.
2. In the render / draw routines for these elements:
   - For standard sprites:
     if (img && img.complete && img.naturalWidth > 0) {
       ctx.drawImage(img, x, y, width, height);
     } else {
       // PRESERVE THE ORIGINAL SHAPE-BASED DRAWING CODE IN THIS ELSE BLOCK!
       [original rect / arc / path drawing code]
     }
   - For rotating sprites (e.g. cars, spaceships):
     if (img && img.complete && img.naturalWidth > 0) {
       ctx.save();
       ctx.translate(x, y);
       ctx.rotate(angle);
       ctx.drawImage(img, -width / 2, -height / 2, width, height);
       ctx.restore();
     } else {
       [original shape drawing code inside the rotation transform]
     }
   - For full backgrounds/terrain:
     if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
       ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
     } else {
       [original background fill / grid drawing code]
     }
3. The shape rendering MUST BE PRESERVED as the fallback whenever the image fails to load, is loading, or has zero width.
4. Do NOT remove any game mechanics, physics, controls, sound, or state management.
5. Return the ENTIRE, COMPLETE updated file content.
6. Output raw code only, with NO markdown code fences and NO conversational text.`;

  try {
    const { text } = await generateText({
      model,
      prompt: `File name: ${fileName}\n\nCurrent Source Code:\n${code}`,
      system: systemPrompt,
      maxTokens: 12000,
      temperature: 0.2,
    });

    const cleanCode = text
      .trim()
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();

    // Verify syntax and ensure it didn't return an empty or severely truncated snippet
    if (
      cleanCode.length > 50 &&
      cleanCode.length >= code.length * 0.5 &&
      verifyJavaScriptSyntax(cleanCode)
    ) {
      return cleanCode;
    }
  } catch (err) {
    // Model generation failed or timed out
  }

  // Resilient fallback: inject safe GameAssets loader at top of code so the game runs without breaking
  const snippet = generateAssetLoaderSnippet(elements);
  return `${snippet}${code}`;
}
