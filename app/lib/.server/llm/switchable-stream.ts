export default class SwitchableStream extends TransformStream {
  private _controller: TransformStreamDefaultController | null = null;
  private _currentReader: ReadableStreamDefaultReader | null = null;
  private _switches = 0;
  private _isSwitchPending = false;
  private _closed = false;
  private _idleTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    let controllerRef: TransformStreamDefaultController | undefined;

    super({
      start(controller) {
        controllerRef = controller;
      },
    });

    if (controllerRef === undefined) {
      throw new Error('Controller not properly initialized');
    }

    this._controller = controllerRef;
  }

  markSwitchPending() {
    this._isSwitchPending = true;
    if (this._idleTimeout) {
      clearTimeout(this._idleTimeout);
      this._idleTimeout = null;
    }
  }

  async switchSource(newStream: ReadableStream) {
    if (this._closed) {
      return;
    }

    this._isSwitchPending = false;
    if (this._idleTimeout) {
      clearTimeout(this._idleTimeout);
      this._idleTimeout = null;
    }

    if (this._currentReader) {
      try {
        await this._currentReader.cancel();
      } catch {
        // ignore
      }
    }

    this._currentReader = newStream.getReader();
    this._switches++;
    this._pumpStream();
  }

  private async _pumpStream() {
    if (!this._currentReader || !this._controller || this._closed) {
      return;
    }

    try {
      while (true) {
        const { done, value } = await this._currentReader.read();

        if (done || this._closed) {
          break;
        }

        this._controller.enqueue(value);
      }

      // If no switch is pending, give onFinish enough time to inspect the text and decide
      // whether to continue (markSwitchPending / switchSource) or close (close).
      if (!this._isSwitchPending && !this._closed) {
        if (this._idleTimeout) {
          clearTimeout(this._idleTimeout);
        }
        this._idleTimeout = setTimeout(() => {
          if (!this._isSwitchPending && !this._closed) {
            this.close();
          }
        }, 8000);
      }
    } catch (error) {
      if (!this._closed) {
        console.error('Error pumping switchable stream:', error);
        this._controller.error(error);
      }
    }
  }

  close() {
    if (this._closed) {
      return;
    }
    this._closed = true;

    if (this._idleTimeout) {
      clearTimeout(this._idleTimeout);
      this._idleTimeout = null;
    }

    if (this._currentReader) {
      try {
        this._currentReader.cancel();
      } catch {
        // ignore
      }
    }

    try {
      this._controller?.terminate();
    } catch {
      // ignore if already terminated
    }
  }

  get switches() {
    return this._switches;
  }
}
