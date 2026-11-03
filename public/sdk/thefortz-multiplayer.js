/**
 * THEFORTZ Multiplayer SDK v1.0 — client library for game creators
 * ─────────────────────────────────────────────────────────────────
 * Works with the multiplayer-relay Appwrite Function. Vanilla JS, zero
 * dependencies, runs in any modern browser (and inside game iframes).
 *
 * QUICK START
 *   <script src="https://studio.thefortz.me/sdk/thefortz-multiplayer.js"></script>
 *   <script>
 *     const mp = new TheFortzMultiplayer(); // uses the Fortz Appwrite relay
 *     mp.join("my-room-1", "player_" + Math.random().toString(36).slice(2, 8));
 *     mp.onPlayerUpdate((players) => { /* draw other players *​/ }); 
 *   </script>
 *
 * API
 *   const mp = new TheFortzMultiplayer(relayUrl, options?)
 *   await mp.join(roomId, playerId, displayName?)
 *   mp.updatePosition(x, y)        // ~4 Hz, throttled automatically
 *   mp.send({ hp: 80, color: "#f00", ... })  // extra custom state
 *   mp.onPlayerUpdate(callback)    // (players, selfId) — others only
 *   mp.getPlayers()                // latest snapshot
 *   mp.leave()                     // call on game over / page exit
 *   mp.connected                   // boolean
 *
 * FREE-TIER BEHAVIOR
 *   Sends are coalesced and flushed at ~4 Hz; a heartbeat every 2.5s keeps
  *   presence alive when idle; players stale >5s vanish; rooms cap at 500.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TheFortzMultiplayer = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var APPWRITE_PROJECT_ID = "6a83071d00217ab38269";
  var DEFAULT_URL = "https://fra.cloud.appwrite.io/v1/functions/multiplayer-relay/executions";
  var SEND_MS = 250;        // ~4 Hz state flush to keep Appwrite calls bounded
  var HEARTBEAT_MS = 2500;  // presence refresh when idle
  var REQUEST_TIMEOUT_MS = 4000;
  var PROTOCOL_VERSION = 1;

  function TheFortzMultiplayer(relayUrl, options) {
    options = options || {};
    this.url = String(relayUrl || DEFAULT_URL).replace(/\/+$/, "");
    this.projectId = String(options.projectId || APPWRITE_PROJECT_ID);
    this._usesAppwriteExecution = !relayUrl || /\/functions\/multiplayer-relay\/executions\/?$/.test(this.url);
    this.room = null;
    this.playerId = null;
    this.displayName = null;
    this.connected = false;
    this.players = [];            // latest others-only snapshot
    this.lastError = null;

    this._listeners = [];         // onPlayerUpdate callbacks
    this._sendTimer = null;
    this._heartbeatTimer = null;
    this._pending = {};           // coalesced outgoing state
    this._lastSendAt = 0;
    this._inFlight = false;
    this._leftCleanly = false;
    this._pagehideBound = this._onPageHide.bind(this);

    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this._pagehideBound, { once: true });
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Join a room. Resolves once the server confirms membership. */
  TheFortzMultiplayer.prototype.join = function (roomId, playerId, displayName) {
    var self = this;
    this.room = String(roomId || "").trim().slice(0, 64);
    this.playerId = String(playerId || ("p_" + Math.random().toString(36).slice(2, 10)));
    this.displayName = displayName ? String(displayName).slice(0, 24) : null;
    this._leftCleanly = false;

    return this._request({
      action: "join",
      room: this.room,
      playerId: this.playerId,
      displayName: this.displayName,
    }).then(function (data) {
      self.connected = true;
      self._updatePlayers(data);
      if (!self._sendTimer) {
        self._sendTimer = setInterval(function () { self._flush(); }, SEND_MS);
      }
      if (!self._heartbeatTimer) {
        self._heartbeatTimer = setInterval(function () {
          if (!self._pending || Object.keys(self._pending).length === 0) {
            self._pending = { heartbeat: true };
          }
        }, HEARTBEAT_MS);
      }
      return { ok: true, selfId: self.playerId, room: self.room, players: self.players };
    });
  };

  /** Queue a position update (throttled to ~10 Hz by the flush loop). */
  TheFortzMultiplayer.prototype.updatePosition = function (x, y) {
    this._enqueue({ x: Number(x) || 0, y: Number(y) || 0 });
  };

  /** Queue arbitrary extra state (hp, color, animation…). */
  TheFortzMultiplayer.prototype.send = function (state) {
    if (state && typeof state === "object") this._enqueue(state);
  };

  /** Register the callback for others-only player updates. Returns an off() fn. */
  TheFortzMultiplayer.prototype.onPlayerUpdate = function (callback) {
    var self = this;
    if (typeof callback === "function") this._listeners.push(callback);
    return function off() {
      self._listeners = self._listeners.filter(function (l) { return l !== callback; });
    };
  };

  /** Latest snapshot of OTHER players in the room. */
  TheFortzMultiplayer.prototype.getPlayers = function () {
    return this.players.slice();
  };

  /** Leave the room and stop all traffic. */
  TheFortzMultiplayer.prototype.leave = function () {
    var self = this;
    this._leftCleanly = true;
    this.connected = false;
    if (this._sendTimer) { clearInterval(this._sendTimer); this._sendTimer = null; }
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    if (!this.room || !this.playerId) return Promise.resolve({ ok: true });
    var body = { action: "leave", room: this.room, playerId: this.playerId };
    return this._request(body, 2000)
      .catch(function () { /* best-effort */ })
      .then(function () {
        self.players = [];
        self.room = null;
        self.playerId = null;
        return { ok: true };
      });
  };

  // ── Internals ──────────────────────────────────────────────────────────────

  TheFortzMultiplayer.prototype._enqueue = function (partial) {
    if (!this.connected) return;
    var k;
    for (k in partial) {
      if (Object.prototype.hasOwnProperty.call(partial, k)) this._pending[k] = partial[k];
    }
  };

  TheFortzMultiplayer.prototype._flush = function () {
    var self = this;
    if (!this.connected || this._inFlight || !this._pending) return;
    var now = Date.now();
    if (now - this._lastSendAt < SEND_MS - 10) return;
    if (Object.keys(this._pending).length === 0) return;

    var payload = this._pending;
    this._pending = {};
    this._lastSendAt = now;
    this._inFlight = true;

    this._request({
      action: "state",
      room: this.room,
      playerId: this.playerId,
      x: payload.x, y: payload.y,
      displayName: this.displayName,
      extra: payload,
    })
      .then(function (data) {
        self._updatePlayers(data);
      })
      .catch(function (err) {
        self.lastError = err && err.message ? err.message : "relay unreachable";
        // Keep trying silently — the heartbeat path re-establishes presence.
      })
      .then(function () {
        self._inFlight = false;
        // Merge anything queued while the request was in flight back in.
        if (payload && payload.extra) {
          var k; for (k in payload.extra) {
            if (!(k in self._pending)) self._pending[k] = payload.extra[k];
          }
        }
      });
  };

  /** POST and parse the relay's JSON. Non-2xx and network errors reject. */
  TheFortzMultiplayer.prototype._request = function (body, timeoutMs) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, timeoutMs || REQUEST_TIMEOUT_MS);
    var requestBody = this._usesAppwriteExecution
      ? { body: JSON.stringify(body), async: false, method: "POST", path: "/" }
      : body;
    var headers = { "Content-Type": "application/json" };
    if (this._usesAppwriteExecution) headers["X-Appwrite-Project"] = this.projectId;
    var self = this;
    return fetch(this.url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
      signal: controller ? controller.signal : undefined,
      keepalive: body.action === "leave",
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error("relay HTTP " + res.status);
      return res.json().then(function (data) {
        if (!self._usesAppwriteExecution) return data;
        if (data.status !== "completed") throw new Error(data.errors || "Appwrite multiplayer execution failed");
        if (data.responseStatusCode < 200 || data.responseStatusCode >= 300) {
          throw new Error(data.responseBody || ("relay HTTP " + data.responseStatusCode));
        }
        try { return JSON.parse(data.responseBody || "{}"); }
        catch { return { ok: false, error: "Appwrite relay returned invalid JSON" }; }
      });
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  };

  TheFortzMultiplayer.prototype._updatePlayers = function (data) {
    if (!data || !Array.isArray(data.players)) return;
    var self = this;
    this.players = data.players
      .filter(function (p) {
        return p && p.playerId && p.playerId !== self.playerId;
      })
      .map(function (p) {
        // Flatten custom state (send({color,…})) onto the player object for
        // ergonomic access (p.color) while top-level relay fields win.
        if (p.extra && typeof p.extra === "object") {
          var merged = Object.assign({}, p.extra, p);
          delete merged.extra;
          return merged;
        }
        return p;
      });
    this.connected = true;
    this.lastError = null;
    for (var i = 0; i < this._listeners.length; i++) {
      try { this._listeners[i](this.players.slice(), this.playerId, this.room); } catch (e) { /* user callback error */ }
    }
  };

  TheFortzMultiplayer.prototype._onPageHide = function () {
    if (this.connected && !this._leftCleanly) {
      if (this._usesAppwriteExecution) {
        this._request({ action: "leave", room: this.room, playerId: this.playerId }, 2000).catch(function () {});
        return;
      }
      try {
        navigator.sendBeacon(
          this.url,
          new Blob([JSON.stringify({ action: "leave", room: this.room, playerId: this.playerId })],
            { type: "application/json" })
        );
      } catch (e) { /* best effort */ }
    }
  };

  TheFortzMultiplayer.VERSION = "1.0.0";
  TheFortzMultiplayer.PROTOCOL_VERSION = PROTOCOL_VERSION;
  TheFortzMultiplayer.DEFAULT_URL = DEFAULT_URL;
  return TheFortzMultiplayer;
});
