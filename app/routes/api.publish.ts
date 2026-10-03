import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { Client, Databases, ID, Permission, Role, Storage } from 'appwrite';
import { z } from 'zod';

const DEFAULT_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const DEFAULT_PROJECT_ID = '6a83071d00217ab38269';
const DEFAULT_DATABASE_ID = 'fortz_db';
const DEFAULT_COLLECTION_ID = 'games';
const DEFAULT_BUCKET_ID = 'games';

const publishInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  genre: z.string().trim().max(40).optional(),
  description: z.string().trim().max(2000).optional(),
  thumbDataUrl: z.string().max(7_000_000).optional(),
  files: z.record(z.unknown()).default({}),
  creatorName: z.string().trim().max(100).optional(),
  creatorId: z.string().trim().max(100).optional(),
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return entities[character];
  });
}

function inlineProjectFiles(files: Record<string, string>, title: string): string {
  let html =
    files['index.html'] ||
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body></body></html>`;
  const inlinedStyles = new Set<string>();
  const inlinedScripts = new Set<string>();
  const cleanPath = (path: string) => decodeURIComponent(path).replace(/^\.\//, '').replace(/^\//, '');

  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    const path = href && cleanPath(href);
    const css = path && files[path];

    if (!path || !css || !/\.css(?:$|[?#])/i.test(href || '')) {
      return tag;
    }

    inlinedStyles.add(path);

    return `<style>\n${css}\n</style>`;
  });

  html = html.replace(/<script\b([^>]*)>(?:[\s\S]*?)<\/script>/gi, (tag, attributes: string) => {
    const src = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    const path = src && cleanPath(src);
    const script = path && files[path];

    if (!path || script === undefined || !/\.(?:m?js)(?:$|[?#])/i.test(src || '')) {
      return tag;
    }

    inlinedScripts.add(path);

    const moduleAttribute = /\btype\s*=\s*["']module["']/i.test(attributes) ? ' type="module"' : '';

    return `<script${moduleAttribute}>\n${script.replace(/<\/script/gi, '<\\/script')}\n</script>`;
  });

  const remainingStyles = Object.entries(files)
    .filter(([path]) => /\.css$/i.test(path) && !inlinedStyles.has(path) && !html.includes(files[path]))
    .map(([, css]) => `<style>\n${css}\n</style>`)
    .join('\n');
  const remainingScripts = Object.entries(files)
    .filter(([path]) => /\.(?:m?js)$/i.test(path) && !inlinedScripts.has(path) && !html.includes(files[path]))
    .map(([path, script]) => {
      const moduleAttribute = /\.mjs$/i.test(path) ? ' type="module"' : '';
      return `<script${moduleAttribute}>\n${script.replace(/<\/script/gi, '<\\/script')}\n</script>`;
    })
    .join('\n');

  if (remainingStyles) {
    html = html.includes('</head>')
      ? html.replace('</head>', `${remainingStyles}</head>`)
      : `${remainingStyles}${html}`;
  }

  if (remainingScripts) {
    html = html.includes('</body>')
      ? html.replace('</body>', `${remainingScripts}</body>`)
      : `${html}${remainingScripts}`;
  }

  return html;
}

export async function action({ context, request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const origin = request.headers.get('Origin');

  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: 'Publish requests must come from this Studio.' }, { status: 403 });
  }

  const env = context.cloudflare?.env;
  const apiKey = env?.APPWRITE_API_KEY || process.env.APPWRITE_API_KEY;

  if (!apiKey) {
    return json(
      { error: 'Publishing is not configured. Add APPWRITE_API_KEY as a Cloudflare Pages secret and redeploy.' },
      { status: 503 },
    );
  }

  try {
    const input = publishInputSchema.parse(await request.json());
    const { title, genre, description, thumbDataUrl, creatorName, creatorId } = input;
    const client = new Client()
      .setEndpoint(env?.APPWRITE_ENDPOINT || process.env.APPWRITE_ENDPOINT || DEFAULT_ENDPOINT)
      .setProject(env?.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT_ID || DEFAULT_PROJECT_ID);
    (client as any).headers['X-Appwrite-Key'] = apiKey;

    const storage = new Storage(client);
    const databases = new Databases(client);
    const databaseId = env?.APPWRITE_DATABASE_ID || process.env.APPWRITE_DATABASE_ID || DEFAULT_DATABASE_ID;
    const collectionId =
      env?.APPWRITE_GAMES_COLLECTION_ID || process.env.APPWRITE_GAMES_COLLECTION_ID || DEFAULT_COLLECTION_ID;
    const bucketId = env?.APPWRITE_BUCKET_ID || process.env.APPWRITE_BUCKET_ID || DEFAULT_BUCKET_ID;

    const cleanFiles: Record<string, string> = {};

    for (const [path, value] of Object.entries(input.files)) {
      const cleanPath = path.replace(/^\.?\//, '').trim();

      if (typeof value === 'string') {
        cleanFiles[cleanPath] = value;
      } else if (
        value &&
        typeof value === 'object' &&
        'type' in value &&
        value.type === 'file' &&
        'content' in value &&
        typeof value.content === 'string'
      ) {
        cleanFiles[cleanPath] = value.content;
      }
    }

    if (Object.keys(cleanFiles).length === 0) {
      return json(
        { error: 'There are no game files to publish. Build the game first, then try again.' },
        { status: 400 },
      );
    }

    const serializedFiles = JSON.stringify(cleanFiles);

    if (serializedFiles.length > 950_000) {
      return json(
        { error: 'This project is too large to publish. Reduce the code/assets and try again.' },
        { status: 413 },
      );
    }

    let thumbnail: File | undefined;

    if (thumbDataUrl?.startsWith('data:')) {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(thumbDataUrl);

      if (!match) {
        return json({ error: 'Thumbnail must be a PNG, JPEG, or WebP image.' }, { status: 400 });
      }

      const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
      thumbnail = new File([bytes], `thumbnail.${match[1].split('/')[1]}`, { type: match[1] });
    }

    const htmlContent = inlineProjectFiles(cleanFiles, title);
    const cleanId = `pub_${Date.now()}`;
    const endpoint = env?.APPWRITE_ENDPOINT || process.env.APPWRITE_ENDPOINT || DEFAULT_ENDPOINT;
    const projectId = env?.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT_ID || DEFAULT_PROJECT_ID;
    const uploadedFileIds: string[] = [];

    try {
      const htmlFile = new File([htmlContent], `${cleanId}.html`, { type: 'text/html' });
      const createdHtml = await storage.createFile(bucketId, ID.unique(), htmlFile, [Permission.read(Role.any())]);
      uploadedFileIds.push(createdHtml.$id);

      const htmlUrl = `${endpoint}/storage/buckets/${bucketId}/files/${createdHtml.$id}/view?project=${projectId}`;

      let thumbUrl = '';
      let thumbFileId = '';

      if (thumbnail) {
        const createdThumb = await storage.createFile(bucketId, ID.unique(), thumbnail, [Permission.read(Role.any())]);
        uploadedFileIds.push(createdThumb.$id);
        thumbFileId = createdThumb.$id;
        thumbUrl = `${endpoint}/storage/buckets/${bucketId}/files/${createdThumb.$id}/view?project=${projectId}`;
      }

      const doc = await databases.createDocument(
        databaseId,
        collectionId,
        ID.unique(),
        {
          title,
          genre: (genre || 'ACTION').toUpperCase(),
          description: description || '',
          creator: creatorName || 'Studio Creator',
          ...(creatorId ? { creatorId } : {}),
          status: 'pending',
          plays: 0,
          likes: 0,
          publishedAt: Date.now(),
          createdAt: Date.now(),
          htmlFileId: createdHtml.$id,
          thumbnailFileId: thumbFileId,
          codeFiles: serializedFiles,
        },
        [Permission.read(Role.any())],
      );

      return json({ success: true, id: doc.$id, title, status: 'pending', htmlUrl, thumbUrl });
    } catch (error) {
      await Promise.all(uploadedFileIds.map((fileId) => storage.deleteFile(bucketId, fileId).catch(() => undefined)));
      throw error;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json(
        { error: 'The publish details are invalid. Check the title, description, and game files.' },
        { status: 400 },
      );
    }

    const appwriteError = error as { code?: number; message?: string };
    console.error('[api.publish] Appwrite publish failed:', appwriteError.message || 'Unknown error');

    const message =
      appwriteError.code === 401 || appwriteError.code === 403
        ? 'Appwrite rejected the server publish credentials. Rotate the exposed API key, update APPWRITE_API_KEY in Cloudflare, and redeploy.'
        : 'Appwrite could not save this game. Check the server-side database, collection, bucket, and required attributes.';

    return json({ error: message }, { status: 502 });
  }
}
