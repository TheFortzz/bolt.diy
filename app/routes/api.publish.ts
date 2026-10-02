import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { Client, Databases, ID, Permission, Role, Storage } from 'appwrite';

const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID || '6a83071d00217ab38269';
const APPWRITE_API_KEY =
  process.env.APPWRITE_API_KEY ||
  'standard_7fe71eb4f155a39814240f07a84ba98b1fe70f439e2443e9718d75fb55e33c6cbd046a106b22f38ba8c0725aa66851318755ed32037fd4ab7e9dfbf18341ad8a9ad6e21a555ff48ea4f8698031ecf707959e31459bf9efb692b55cfe7efe055d7eabbf85eaa2c3bfc8ac722d2cd7e71ab31e35cac1a9c4fcc27a56eab3e67676';
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || 'fortz_db';
const COLLECTION_ID = process.env.APPWRITE_GAMES_COLLECTION_ID || 'games';
const BUCKET_ID = process.env.APPWRITE_BUCKET_ID || 'games';

function getAppwriteAdminClient(): Client {
  const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
  if (APPWRITE_API_KEY) {
    (client as any).headers['X-Appwrite-Key'] = APPWRITE_API_KEY;
  }
  return client;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { title, genre, description, thumbDataUrl, files, creatorName, creatorId } =
      (await request.json()) as any;

    if (!title || !String(title).trim()) {
      return json({ error: 'Title is required' }, { status: 400 });
    }

    const client = getAppwriteAdminClient();
    const storage = new Storage(client);
    const databases = new Databases(client);

    // Normalize and assemble files
    const cleanFiles: Record<string, string> = {};
    if (files && typeof files === 'object') {
      for (const [key, val] of Object.entries(files)) {
        const cleanPath = key.replace(/^\.?\//, '');
        if (typeof val === 'string') {
          cleanFiles[cleanPath] = val;
        } else if (val && typeof val === 'object' && (val as any).type === 'file' && typeof (val as any).content === 'string') {
          cleanFiles[cleanPath] = (val as any).content;
        }
      }
    }

    // Bundle HTML
    let htmlContent = cleanFiles['index.html'] || `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1></body></html>`;
    if (cleanFiles['style.css'] && !htmlContent.includes(cleanFiles['style.css'])) {
      htmlContent = htmlContent.replace('</head>', `<style>\n${cleanFiles['style.css']}\n</style></head>`);
    }
    const jsKey = cleanFiles['game.js'] ? 'game.js' : cleanFiles['main.js'] ? 'main.js' : cleanFiles['script.js'] ? 'script.js' : null;
    if (jsKey && !htmlContent.includes(cleanFiles[jsKey])) {
      htmlContent = htmlContent.replace('</body>', `<script>\n${cleanFiles[jsKey]}\n</script></body>`);
    }

    const cleanId = `pub_${Date.now()}`;

    // 1. Upload Game HTML to Storage
    let htmlUrl = '';
    try {
      const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
      const htmlFile = new File([htmlBlob], `${cleanId}.html`, { type: 'text/html' });
      const createdHtml = await storage.createFile(BUCKET_ID, ID.unique(), htmlFile, [Permission.read(Role.any())]);
      htmlUrl = `${APPWRITE_ENDPOINT}/storage/buckets/${BUCKET_ID}/files/${createdHtml.$id}/view?project=${APPWRITE_PROJECT_ID}`;
    } catch (e: any) {
      console.warn('[api.publish] HTML upload to storage note:', e?.message);
    }

    // 2. Upload Thumbnail to Storage
    let thumbUrl = thumbDataUrl || '';
    let thumbFileId = cleanId;
    if (thumbDataUrl && thumbDataUrl.startsWith('data:')) {
      try {
        const comma = thumbDataUrl.indexOf(',');
        const mime = thumbDataUrl.match(/data:([^;]+)/)?.[1]?.trim() || 'image/png';
        const base64 = thumbDataUrl.slice(comma + 1);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const thumbFile = new File([bytes], `${cleanId}.png`, { type: mime });
        const createdThumb = await storage.createFile(BUCKET_ID, ID.unique(), thumbFile, [Permission.read(Role.any())]);
        thumbUrl = `${APPWRITE_ENDPOINT}/storage/buckets/${BUCKET_ID}/files/${createdThumb.$id}/view?project=${APPWRITE_PROJECT_ID}`;
        thumbFileId = createdThumb.$id;
      } catch (e: any) {
        console.warn('[api.publish] Thumbnail upload note:', e?.message);
      }
    }

    // 3. Create Game Document in Database
    let docId = cleanId;
    try {
      const doc = await databases.createDocument(
        DATABASE_ID,
        COLLECTION_ID,
        ID.unique(),
        {
          title: String(title).trim(),
          genre: String(genre || 'ACTION').toUpperCase(),
          description: String(description || '').trim(),
          creator: creatorName || 'Studio Creator',
          creatorId: creatorId || undefined,
          status: 'live',
          plays: 0,
          likes: 0,
          publishedAt: Date.now(),
          createdAt: Date.now(),
          thumbnailFileId: thumbFileId,
          codeFiles: JSON.stringify(cleanFiles).slice(0, 950_000),
        },
        [Permission.read(Role.any()), Permission.update(Role.any()), Permission.delete(Role.any())],
      );
      docId = doc.$id;
    } catch (e: any) {
      console.warn('[api.publish] Database createDocument note:', e?.message);
    }

    return json({
      success: true,
      id: docId,
      title: String(title).trim(),
      htmlUrl,
      thumbUrl,
    });
  } catch (err: any) {
    console.error('[api.publish] error:', err);
    return json({ error: err?.message || 'Publish failed' }, { status: 500 });
  }
}
