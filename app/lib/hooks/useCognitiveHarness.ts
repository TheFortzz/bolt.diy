import type { Message } from 'ai';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { captureProject } from '~/lib/persistence/checkpoints';
import { blueprintSchema, createWorkspaceManifest, revisionHash, type Blueprint } from '~/lib/harness/blueprint';
import { executionPolicy } from '~/lib/harness/execution-policy';
import { harnessState, harnessIsBusy, transitionHarness } from '~/lib/stores/harness';
import { workbenchStore } from '~/lib/stores/workbench';
import { getWebContainer } from '~/lib/webcontainer';
import { compileSystemContext } from '~/lib/runtime/system-context';
import { validationState } from '~/lib/runtime/build-validator';
import { generatedAssets } from '~/lib/stores/generated-assets';
import { generateProjectAssets } from '~/lib/runtime/asset-generator';
import { runActivityStep, startActivity, updateActivity } from '~/lib/stores/activity';

interface HarnessOptions {
  model: string;
  provider: string;
  apiKeys: Record<string, string>;
  workspaceId: string;
  setMessages: (update: (messages: Message[]) => Message[]) => void;
  append: (message: Message | Omit<Message, 'id'>, options?: { body?: Record<string, unknown> }) => Promise<unknown>;
}

function sourceContext(snapshot: Record<string, Uint8Array>, budget: number, perFile: number, priority: string[] = []) {
  const result: Record<string, string> = {};
  const decoder = new TextDecoder('utf8', { fatal: true });
  const paths = [...new Set([...priority, ...Object.keys(snapshot)])];
  let used = 0;

  for (const path of paths) {
    if (!/\.(?:html|js|mjs|css|json|md)$/.test(path) || !snapshot[path]) {
      continue;
    }

    try {
      const text = decoder.decode(snapshot[path]).slice(0, perFile);

      if (used + text.length <= budget) {
        result[path] = text;
        used += text.length;
      }
    } catch {
      // Binary sources are represented by the manifest, never text context.
    }
  }

  return result;
}

async function postHarness<T>(payload: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  const result = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(result.error || `Plan service returned HTTP ${response.status}.`);
  }

  return result;
}

export function useCognitiveHarness(options: HarnessOptions) {
  const controllerRef = useRef<AbortController>();
  const requestSequence = useRef(0);
  const referenceImagePattern = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i;

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      executionPolicy.revoke();

      const phase = harnessState.get().phase;
      const resetState = {
        detail: '',
        blueprint: undefined,
        blueprintMessageId: undefined,
        editorMessageId: undefined,
        request: undefined,
        reviewToken: undefined,
        executionToken: undefined,
        diagnosis: undefined,
      };

      if (phase === 'failed' || phase === 'verified') {
        transitionHarness('idle', resetState);
        return;
      }

      if (phase !== 'idle' && phase !== 'cancelled') {
        transitionHarness('cancelled', { detail: 'Studio session closed · active agent work was stopped' });
      }

      if (harnessState.get().phase === 'cancelled') {
        transitionHarness('idle', resetState);
      }
    },
    [],
  );

  const requestPlan = useCallback(
    async (request: string, images: string[] = []) => {
      if (harnessIsBusy(harnessState.get().phase)) {
        return;
      }

      controllerRef.current?.abort();

      const controller = new AbortController();
      controllerRef.current = controller;

      const sequence = ++requestSequence.current;
      executionPolicy.revoke();

      const messageId = crypto.randomUUID();
      transitionHarness('planning', {
        detail: 'Planning your game…',
        request,
        blueprint: undefined,
        blueprintMessageId: messageId,
        editorMessageId: undefined,
        reviewToken: undefined,
        executionToken: undefined,
        diagnosis: undefined,
      });

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: request,
        annotations: [{ type: 'user-prompt', text: request }],
        ...(images.length
          ? {
              experimental_attachments: images.map((url) => ({
                url,
                contentType: /^data:(image\/[^;]+);/i.exec(url)?.[1] || 'image/png',
              })),
            }
          : {}),
      };
      options.setMessages((messages) => [...messages, userMessage]);
      startActivity(messageId, 'manager:plan', 'Planning game systems and file changes', 'Build plan prepared');

      try {
        if (
          images.length > 4 ||
          images.some((image) => image.length > 2_000_000 || !referenceImagePattern.test(image))
        ) {
          throw new Error('Use up to four PNG, JPEG, WebP, or GIF reference images, each under 2 MB.');
        }

        await workbenchStore.saveAllFiles();
        await workbenchStore.waitForExecutionQueue();

        const snapshot = await captureProject(await getWebContainer());
        const manifest = await createWorkspaceManifest(snapshot);
        const result = await postHarness<{ blueprint: Blueprint; reviewToken: string }>(
          {
            intent: 'plan',
            request,
            workspaceId: options.workspaceId,
            manifest,
            systemContext: compileSystemContext(
              workbenchStore.files.get(),
              generatedAssets.get(),
              validationState.get(),
            ),
            sources: sourceContext(snapshot, 100000, 20000),
            images,
            model: options.model,
            provider: options.provider,
            apiKeys: options.apiKeys,
          },
          controller.signal,
        );

        if (sequence !== requestSequence.current || controller.signal.aborted) {
          return;
        }

        const blueprint = blueprintSchema.parse(result.blueprint);

        if (
          blueprint.workspaceId !== options.workspaceId ||
          blueprint.baseRevision !== (await revisionHash(manifest))
        ) {
          throw new Error('Manager blueprint does not match the current workspace snapshot.');
        }

        options.setMessages((messages) => [
          ...messages,
          {
            id: messageId,
            role: 'assistant',
            content: 'Your build plan is ready. Review the systems, files, and images below, then approve the build.',
            annotations: [{ type: 'studio-blueprint', blueprint }],
          },
        ]);
        updateActivity(messageId, 'manager:plan', 'complete');
        transitionHarness('awaiting-approval', {
          blueprint,
          reviewToken: result.reviewToken,
          detail: 'Review the build plan · code and images are blocked',
        });
      } catch (error) {
        if (sequence !== requestSequence.current || controller.signal.aborted) {
          return;
        }

        const detail = (error as Error).message || 'Planning failed';
        updateActivity(messageId, 'manager:plan', 'failed');
        transitionHarness('failed', { detail });
        options.setMessages((messages) => [
          ...messages,
          {
            id: messageId,
            role: 'assistant',
            content: `I could not prepare a valid build plan. No files were changed.\n\n${detail}`,
          },
        ]);
        toast.error(detail);
      }
    },
    [options],
  );

  const approvePlan = useCallback(async () => {
    const state = harnessState.get();

    if (state.phase !== 'awaiting-approval' || !state.blueprint || !state.reviewToken || !state.blueprintMessageId) {
      return;
    }

    const blueprint = blueprintSchema.parse(state.blueprint);
    const messageId = state.blueprintMessageId;
    const sequence = requestSequence.current;
    const controller = controllerRef.current ?? new AbortController();
    controllerRef.current = controller;
    transitionHarness('preparing-assets', { detail: 'Validating your approval and workspace revision…' });

    try {
      await workbenchStore.saveAllFiles();
      await workbenchStore.waitForExecutionQueue();

      const snapshot = await captureProject(await getWebContainer());
      const currentRevision = await revisionHash(await createWorkspaceManifest(snapshot));

      if (currentRevision !== blueprint.baseRevision) {
        throw new Error('The workspace changed after planning. Send your request again for a fresh blueprint.');
      }

      const approval = await postHarness<{ executionToken: string }>(
        { intent: 'approve', blueprint, reviewToken: state.reviewToken, currentRevision, confirmed: true },
        controller.signal,
      );

      if (sequence !== requestSequence.current || controller.signal.aborted) {
        return;
      }

      transitionHarness('preparing-assets', {
        executionToken: approval.executionToken,
        detail: blueprint.assetOperations.length
          ? 'Preparing approved game visuals…'
          : 'Using existing assets and procedural visuals…',
      });
      validationState.set({ status: 'checking', detail: 'Preparing approved game assets…' });
      await runActivityStep(
        messageId,
        'assets:approved',
        'Preparing approved game images',
        async () => {
          const result = await generateProjectAssets({
            messageId,
            approvedBlueprint: blueprint,
            executionToken: approval.executionToken,
          });

          if (!result.ok) {
            throw new Error(result.error || 'Image Builder failed');
          }
        },
        blueprint.assetOperations.length ? 'Approved images ready' : 'No new images requested',
      );

      if (sequence !== requestSequence.current || controller.signal.aborted) {
        return;
      }

      executionPolicy.approve(blueprint);
      transitionHarness('editing', { detail: 'Building your game…' });
      validationState.set({ status: 'idle', detail: '' });

      const artifactId = workbenchStore.firstArtifact?.id || `game-${blueprint.workspaceId}`;
      await options.append(
        {
          role: 'user',
          content: `[Model: ${options.model}]\n\n[Provider: ${options.provider}]\n\n[Studio Mode: BUILD]\n\nImplement the approved blueprint for this request: ${state.request}\nUse artifact id="${artifactId}". All approved image files are now available.`,
          annotations: [{ type: 'harness-execution', planId: blueprint.id }],
        },
        {
          body: {
            approvedBlueprint: blueprint,
            executionToken: approval.executionToken,
            systemContext: compileSystemContext(
              workbenchStore.files.get(),
              generatedAssets.get(),
              validationState.get(),
            ),
            workspaceSources: sourceContext(snapshot, 300000, 200000, [
              ...blueprint.fileOperations.map((file) => file.path),
              ...blueprint.scriptOrder,
            ]),
          },
        },
      );
    } catch (error) {
      if (sequence !== requestSequence.current || controller.signal.aborted) {
        return;
      }

      const detail = (error as Error).message || 'Could not start the approved build';
      executionPolicy.revoke();
      transitionHarness('failed', { detail });
      validationState.set({ status: 'failed', detail });
      startActivity(messageId, 'approval:failed', detail, detail, 'failed');
      toast.error(detail);
    }
  }, [options]);

  const cancelPlan = useCallback(() => {
    controllerRef.current?.abort();
    requestSequence.current++;
    executionPolicy.revoke();

    const state = harnessState.get();

    if (
      state.phase !== 'idle' &&
      state.phase !== 'verified' &&
      state.phase !== 'failed' &&
      state.phase !== 'cancelled'
    ) {
      transitionHarness('cancelled', { detail: 'Build stopped · no further agent mutations are allowed' });
    }

    validationState.set({ status: 'idle', detail: '' });
  }, []);

  return { requestPlan, approvePlan, cancelPlan };
}
