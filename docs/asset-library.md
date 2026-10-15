# Fortz asset library

## What is implemented

- The catalogue schema preserves Appwrite bucket/file IDs, original filenames,
  paths, MIME types, sizes, hashes, licensing, technical metadata, dependencies,
  and confidence/provenance for descriptions.
- The byte probe reads PNG/APNG/GIF/JPEG/WebP/SVG/BMP, GLB/glTF, OBJ/MTL, WAV,
  MP3 and Ogg metadata. GLB/glTF external texture/buffer refs are separated
  from embedded textures; OBJ->MTL->texture chains are retained.
- Classification never treats a preview/thumbnail as a loadable asset.
  Filename-derived meaning has low confidence; dimensions alone do not prove
  something is a background, particle, or spritesheet. Optional vision analysis
  is bounded to 50 images per admin run and can return `other` when uncertain.
- Search gives the planner at most 10 relevant, loadable candidates. It does
  not send the catalogue, Appwrite URLs, credentials, or file bytes to the model.
- Plans can select exact candidate IDs, destination paths and complete groups.
  The server re-validates selections against the shortlist, rejects collisions,
  requires WebGL for 3D assets, and signs the selected group in the execution
  capability.
- During approved builds, `/api/asset-library` verifies that capability and
  only downloads selected IDs plus their dependencies. The key is server-side;
  asset writes are create-only and roll back on failure. glTF/GLB sidecar URIs
  are rewritten to data URLs so models loaded from data URLs can still find
  their textures and buffers.
- Preview reloads rehydrate supported binary formats. Both the Studio publish
  route and the embedded-site publish path inline binary assets into the final
  standalone HTML, subject to a 24 MiB total transfer budget.
- The build gate validates image, model, audio and font references. An asset
  path is accepted only if the file is present in the workspace or was
  materialized from the signed approved plan.

## Appwrite / Pages setup

The repo already references project `6a83071d00217ab38269` and endpoint
`https://fra.cloud.appwrite.io/v1`. The actual asset bucket ID is **not recorded
in the repo** and must not be guessed.

Set these as Cloudflare Pages **server-side** environment values/secrets:

- `APPWRITE_API_KEY`: a currently valid, rotated Appwrite server key with the
  minimum `buckets.read`, `files.list` and `files.read` scopes.
- `APPWRITE_ASSETS_BUCKET_ID`: the verified bucket ID containing the library.
- `ASSET_CATALOGUE_ADMIN_TOKEN`: a separate random operator token for catalogue
  maintenance. Never reuse the Appwrite key as this token.
- Bind a Cloudflare KV namespace named `ASSET_CATALOGUE_KV`. The live key is
  `asset-catalogue.json` (override with `ASSET_CATALOGUE_PATH` if needed).

The code only reads Appwrite Storage. Catalogue maintenance writes a timestamped
backup to KV before replacing the live catalogue, refuses empty results, and
never creates/deletes/overwrites Appwrite files.

## Safe indexing workflow

1. Configure the server values and KV binding above; no key belongs in a
   browser, prompt, generated game, source commit, or log.
2. Call `POST /api/admin/asset-catalogue` from the same origin with
   `Authorization: Bearer <ASSET_CATALOGUE_ADMIN_TOKEN>` and
   `{"dryRun":true,"maxFiles":500,"analyzeImages":false}`.
3. Review `filesSeen`, per-format/category counts, previews, unreadable files,
   missing dependencies, and unusable reasons. This is where the real Appwrite
   asset count comes from; do not infer it from local paths.
4. Only after the dry-run report is acceptable, call again with `dryRun:false`.
   Add `analyzeImages:true` to opt in to at most 50 image-analysis calls for that
   scan.

If Appwrite returns `api_key_invalid`, `buckets.read` is missing, or the bucket
is absent, the route reports that blocker and writes nothing.

## Rollback

- Code changes are isolated in `app/lib/assets`, `app/lib/.server/assets`, the
  approved-build asset bridge, preview rehydration, and publish payload paths.
- `git revert <commit>` rolls back code. It does not touch Appwrite Storage.
- Before every KV update, the prior JSON is preserved under
  `asset-catalogue.json.<timestamp>.bak`; restore that key to
  `asset-catalogue.json` to roll back metadata.
