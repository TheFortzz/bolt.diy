import { atom } from 'nanostores';
import type { Blueprint } from '~/lib/harness/blueprint';

export type HarnessPhase = 'idle' | 'planning' | 'awaiting-approval' | 'preparing-assets' | 'editing' | 'verifying' | 'verified' | 'failed' | 'cancelled';

export interface HarnessState {
  phase: HarnessPhase;
  detail: string;
  blueprint?: Blueprint;
  blueprintMessageId?: string;
  editorMessageId?: string;
  request?: string;
  reviewToken?: string;
  executionToken?: string;
  diagnosis?: string;
}

export const harnessState = atom<HarnessState>({ phase: 'idle', detail: '' });
export const publishedPreviewHtml = atom<string | undefined>();

const transitions: Record<HarnessPhase, HarnessPhase[]> = {
  idle: ['planning'],
  planning: ['awaiting-approval', 'failed', 'cancelled'],
  'awaiting-approval': ['preparing-assets', 'planning', 'failed', 'cancelled'],
  'preparing-assets': ['editing', 'failed', 'cancelled'],
  editing: ['verifying', 'failed', 'cancelled'],
  verifying: ['verified', 'failed', 'cancelled'],
  verified: ['planning', 'idle'],
  failed: ['planning', 'idle'],
  cancelled: ['planning', 'idle'],
};

export function transitionHarness(phase: HarnessPhase, update: Partial<Omit<HarnessState, 'phase'>> = {}) {
  const previous = harnessState.get();

  if (previous.phase !== phase && !transitions[previous.phase].includes(phase)) {
    throw new Error(`Invalid harness transition: ${previous.phase} → ${phase}`);
  }
  harnessState.set({ ...previous, ...update, phase });
}

export function harnessIsBusy(phase: HarnessPhase) {
  return ['planning', 'preparing-assets', 'editing', 'verifying'].includes(phase);
}
