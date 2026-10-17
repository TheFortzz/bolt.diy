import type { WebContainer } from '@webcontainer/api';
import { atom } from 'nanostores';

export interface PreviewInfo {
  port: number;
  ready: boolean;
  baseUrl: string;
}

export class PreviewsStore {
  #availablePreviews = new Map<number, PreviewInfo>();
  #webcontainer: Promise<WebContainer>;

  previews = atom<PreviewInfo[]>([]);

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;

    this.#init();
  }

  async #init() {
    const webcontainer = await this.#webcontainer;

    if (!webcontainer || typeof webcontainer.on !== 'function') {
      return;
    }

    webcontainer.on('port', (port, type, url) => {
      let previewInfo = this.#availablePreviews.get(port);

      if (type === 'close' && previewInfo) {
        this.#availablePreviews.delete(port);
        this.previews.set(this.previews.get().filter((preview) => preview.port !== port));

        return;
      }

      const previews = this.previews.get();

      if (!previewInfo) {
        previewInfo = { port, ready: type === 'open', baseUrl: url };
        this.#availablePreviews.set(port, previewInfo);
        previews.push(previewInfo);
      }

      previewInfo.ready = type === 'open';
      previewInfo.baseUrl = url;

      this.previews.set([...previews]);
    });

    /*
     * `server-ready` is a second notification channel for the same runtime
     * event (a server began listening). Some WebContainer builds emit it when
     * the granular `port` stream misses an exotic bind, so listen to both —
     * a duplicate registration for an existing port is idempotent above.
     */
    webcontainer.on('server-ready', (port, url) => {
      const previews = this.previews.get();
      let previewInfo = this.#availablePreviews.get(port);

      if (!previewInfo) {
        previewInfo = { port, ready: true, baseUrl: url };
        this.#availablePreviews.set(port, previewInfo);
        previews.push(previewInfo);
      } else {
        previewInfo.ready = true;
        previewInfo.baseUrl = url;
      }

      this.previews.set([...previews]);
    });
  }
}
