export interface ClineHostRequest {
  prompt: string;
  files: Record<string, string>;
  readOnly?: boolean;
  planningOnly?: boolean;
  approvedPaths?: string[];
  systemContext?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  previewErrors?: Array<{ message: string; source?: string; line?: number }>;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ClineHostEvent {
  type: string;
  payload?: any;
}

function isTrustedFortzOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === 'thefortz.me' ||
      hostname.endsWith('.thefortz.me') ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.app.github.dev')
    );
  } catch {
    return false;
  }
}

export function getFortzHostOrigin() {
  if (typeof window === 'undefined' || window.parent === window) {
    return undefined;
  }

  try {
    if (document.referrer) {
      const origin = new URL(document.referrer).origin;
      return isTrustedFortzOrigin(origin) ? origin : undefined;
    }

    const ancestorOrigin = (window.location as any).ancestorOrigins?.[0] as string | undefined;
    return ancestorOrigin && isTrustedFortzOrigin(ancestorOrigin) ? ancestorOrigin : undefined;
  } catch {
    return undefined;
  }
}

export function announceFortzReady() {
  const origin = getFortzHostOrigin();

  if (origin) {
    window.parent.postMessage({ type: 'thefortz-studio-ready' }, origin);
  }
}

export function runClineInFortzHost(
  request: ClineHostRequest,
  options: {
    signal?: AbortSignal;
    onEvent: (event: ClineHostEvent) => void;
  },
) {
  const origin = getFortzHostOrigin();

  if (!origin) {
    return Promise.reject(new Error('Cline Agent is available when Bolt Studio is opened inside TheFortz.'));
  }

  const requestId = crypto.randomUUID();

  return new Promise<ClineHostEvent>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
      options.signal?.removeEventListener('abort', handleAbort);
      clearTimeout(timeout);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const handleAbort = () => {
      window.parent.postMessage({ type: 'thefortz-cline-cancel', requestId }, origin);
      settle(() => reject(new DOMException('Cline run cancelled.', 'AbortError')));
    };
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== origin ||
        event.source !== window.parent ||
        event.data?.type !== 'thefortz-cline-event' ||
        event.data?.requestId !== requestId
      ) {
        return;
      }

      const clineEvent = event.data.event as ClineHostEvent;
      options.onEvent(clineEvent);

      if (clineEvent?.type === 'result') {
        settle(() => resolve(clineEvent));
      } else if (clineEvent?.type === 'fatal_error') {
        settle(() => reject(new Error(clineEvent.payload?.error || 'Cline Agent failed.')));
      }
    };
    const timeout = setTimeout(() => {
      window.parent.postMessage({ type: 'thefortz-cline-cancel', requestId }, origin);
      settle(() => reject(new Error('Cline Agent timed out after 10 minutes.')));
    }, 10 * 60 * 1000);

    if (options.signal?.aborted) {
      handleAbort();
      return;
    }

    window.addEventListener('message', handleMessage);
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    window.parent.postMessage({ type: 'thefortz-cline-run', requestId, payload: request }, origin);
  });
}
