export default class SwitchableStream {
  private _controller: ReadableStreamDefaultController | null = null;
  private _readable: ReadableStream;
  private _currentReader: ReadableStreamDefaultReader | null = null;
  private _switches = 0;
  private _isSwitchPending = false;
  private _closed = false;
  private _idleTimeout: ReturnType<typeof setTimeout> | null = null;
  private _keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private _lastDataTime = Date.now();
  private _textDecoder = new TextDecoder();
  private _textEncoder = new TextEncoder();
  private _lineBuffer = '';

  constructor() {
    let controllerRef: ReadableStreamDefaultController | undefined;

    this._readable = new ReadableStream({
      start(controller) {
        controllerRef = controller;
      },
      cancel: () => {
        this.close();
      },
    });

    if (controllerRef === undefined) {
      throw new Error('Controller not properly initialized');
    }

    this._controller = controllerRef;
    this._startKeepAlive();
  }

  get readable(): ReadableStream {
    return this._readable;
  }

  private _startKeepAlive() {
    if (this._keepAliveInterval || this._closed) {
      return;
    }

    /*
     * Keep the HTTP/3 QUIC connection alive from the very moment the stream is returned
     * to the client, preventing Cloudflare Pages net::ERR_QUIC_PROTOCOL_ERROR while
     * the LLM is thinking or compiling the response.
     */
    this._keepAliveInterval = setInterval(() => {
      if (this._closed || !this._controller) {
        if (this._keepAliveInterval) {
          clearInterval(this._keepAliveInterval);
          this._keepAliveInterval = null;
        }

        return;
      }

      // If no data was sent in the last 2 seconds, emit an empty AI SDK text delta chunk
      if (Date.now() - this._lastDataTime >= 2000) {
        try {
          this._controller.enqueue(this._textEncoder.encode('0:""\n'));
          this._lastDataTime = Date.now();
        } catch {
          // ignore if closed
        }
      }
    }, 2000);
  }

  markSwitchPending() {
    this._isSwitchPending = true;

    if (this._idleTimeout) {
      clearTimeout(this._idleTimeout);
      this._idleTimeout = null;
    }

    this._startKeepAlive();
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
          /*
           * Suppress finish_message ('d:') and finish_step ('e:') so the AI SDK client
           * does not finalize the assistant message prematurely between continuation segments.
           */
          if (line.startsWith('d:') || line.startsWith('e:') || !line.trim()) {
            continue;
          }

          passThrough += line + '\n';
        }

        if (passThrough.length > 0) {
          this._controller.enqueue(this._textEncoder.encode(passThrough));
          this._lastDataTime = Date.now();
        }
      }

      /*
       * If no switch is pending, give onFinish enough time to inspect the text and decide
       * whether to continue (markSwitchPending / switchSource) or close (close).
       */
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
        this.fail(error);
      }
    }
  }

  fail(error: unknown) {
    if (this._closed) {
      return;
    }

    const message = (error instanceof Error ? error.message : String(error))
      .replace(/\b(?:Bearer\s+)[A-Za-z0-9._-]{12,}/gi, 'Bearer [redacted]')
      .slice(0, 1200);

    try {
      this._controller?.enqueue(this._textEncoder.encode(`3:${JSON.stringify(message)}\n`));
    } catch {
      // The client may already have disconnected; there is no error frame to deliver.
    }

    this.close();
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

    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
      this._keepAliveInterval = null;
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
        this._controller.close();
      }
    } catch {
      // ignore if already closed
    }
  }

  get switches() {
    return this._switches;
  }
}
