export default class SwitchableStream extends TransformStream {
  private _controller: TransformStreamDefaultController | null = null;
  private _currentReader: ReadableStreamDefaultReader | null = null;
  private _switches = 0;
  private _isSwitchPending = false;
  private _closed = false;
  private _idleTimeout: ReturnType<typeof setTimeout> | null = null;
  private _textDecoder = new TextDecoder();
  private _textEncoder = new TextEncoder();
  private _lineBuffer = '';

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

        const chunkText = this._textDecoder.decode(value, { stream: true });
        this._lineBuffer += chunkText;

        const lines = this._lineBuffer.split('\n');
        this._lineBuffer = lines.pop() ?? '';

        let passThrough = '';
        for (const line of lines) {
          // Suppress finish_message ('d:') and finish_step ('e:') so the AI SDK client
          // does not finalize the assistant message prematurely between continuation segments.
          if (line.startsWith('d:') || line.startsWith('e:')) {
            continue;
          }
          passThrough += line + '\n';
        }

        if (passThrough.length > 0) {
          this._controller.enqueue(this._textEncoder.encode(passThrough));
        }
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
        }, 60000);
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
      if (this._controller) {
        const remaining = this._lineBuffer + this._textDecoder.decode();
        this._lineBuffer = '';
        if (remaining && !remaining.startsWith('d:') && !remaining.startsWith('e:')) {
          this._controller.enqueue(this._textEncoder.encode(remaining.endsWith('\n') ? remaining : remaining + '\n'));
        }

        this._controller.enqueue(
          this._textEncoder.encode('e:{"finishReason":"stop","isContinued":false}\nd:{"finishReason":"stop"}\n'),
        );
        this._controller.terminate();
      }
    } catch {
      // ignore if already terminated
    }
  }

  get switches() {
    return this._switches;
  }
}
