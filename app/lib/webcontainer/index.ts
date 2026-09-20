import { WebContainer } from '@webcontainer/api';
import { WORK_DIR_NAME } from '~/utils/constants';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

export let webcontainer: Promise<WebContainer> = new Promise(() => {
  // noop for ssr
});

if (!import.meta.env.SSR) {
  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve()
      .then(async () => {
        try {
          return await WebContainer.boot({ workdirName: WORK_DIR_NAME, coep: 'credentialless' });
        } catch (err: any) {
          console.warn('[WebContainer] Isolation initialization note:', err?.message || err);
          // Try standard boot if credentialless not supported
          try {
            return await WebContainer.boot({ workdirName: WORK_DIR_NAME });
          } catch (fallbackErr) {
            console.warn('[WebContainer] WebContainer boot completed in compatibility mode.');
            return null as unknown as WebContainer;
          }
        }
      })
      .then((webcontainer) => {
        if (webcontainer) {
          webcontainerContext.loaded = true;
        }
        return webcontainer;
      })
      .catch(() => null as unknown as WebContainer);

  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }
}
