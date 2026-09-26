/**
 * WebSocket wrapper for the run event stream.
 *
 *  - Exponential backoff with full jitter: min(maxDelay, base·2^attempt)·rand.
 *  - Resumes with `?since={lastSeq}`; the server answers with a snapshot.
 *  - Drops duplicate/stale events by seq; a seq gap forces a reconnect.
 *  - Heartbeat watchdog: no frame for `heartbeatTimeoutMs` ⇒ reconnect.
 *  - Stops for good on terminal run events, close code 4404, or `close()`.
 *  - Reconnects immediately when the browser comes back online / tab visible.
 *
 * Kept transport-only so it can be unit-tested with a fake WebSocket.
 */
import type { PingFrame, PipelineEvent } from "../contract";
import type { ConnectionState, SubscribeHandlers } from "../pipelineService";

export interface ReconnectOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  heartbeatTimeoutMs?: number;
  /** Injected for tests. */
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
}

const TERMINAL_EVENTS = new Set<PipelineEvent["type"]>(["run.completed", "run.failed", "run.cancelled"]);

export function backoffDelay(attempt: number, base: number, max: number, random: () => number) {
  return Math.round(Math.min(max, base * 2 ** Math.max(0, attempt - 1)) * (0.5 + random() * 0.5));
}

export function connectRunEvents(
  urlForSeq: (sinceSeq: number) => string,
  handlers: SubscribeHandlers,
  opts: ReconnectOptions = {},
): () => void {
  const {
    baseDelayMs = 500,
    maxDelayMs = 15_000,
    maxAttempts = Infinity,
    heartbeatTimeoutMs = 45_000,
    WebSocketImpl = WebSocket,
    random = Math.random,
  } = opts;

  let ws: WebSocket | null = null;
  let lastSeq = 0;
  let attempt = 0;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const emitConn = (s: ConnectionState) => handlers.onConnection(s);

  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => ws?.close(4000, "heartbeat timeout"), heartbeatTimeoutMs);
  };

  const stop = (reason: Extract<ConnectionState, { status: "closed" }>["reason"]) => {
    if (stopped) return;
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (watchdog) clearTimeout(watchdog);
    window.removeEventListener("online", reconnectNow);
    document.removeEventListener("visibilitychange", onVisible);
    ws?.close(1000);
    emitConn({ status: "closed", reason });
  };

  const scheduleRetry = (lastError: string | null) => {
    if (stopped) return;
    attempt++;
    if (attempt > maxAttempts) return stop("gave_up");
    const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs, random);
    emitConn({ status: "reconnecting", attempt, retryAt: Date.now() + delay, lastError });
    retryTimer = setTimeout(open, delay);
  };

  function reconnectNow() {
    if (stopped || ws?.readyState === 1) return;
    if (retryTimer) clearTimeout(retryTimer);
    open();
  }
  function onVisible() {
    if (document.visibilityState === "visible") reconnectNow();
  }

  function open() {
    if (stopped) return;
    emitConn({ status: "connecting", attempt: attempt + 1 });
    const sock = new WebSocketImpl(urlForSeq(lastSeq));
    ws = sock;

    sock.onopen = () => {
      if (ws !== sock) return;
      attempt = 0;
      emitConn({ status: "open" });
      armWatchdog();
    };

    sock.onmessage = (msg) => {
      if (ws !== sock) return;
      armWatchdog();
      let data: PipelineEvent | PingFrame;
      try {
        data = JSON.parse(String(msg.data));
      } catch {
        return; // malformed frame: ignore
      }
      if (data.type === "ping") return;
      if (data.type === "run.snapshot") {
        lastSeq = data.snapshot.seq;
        handlers.onEvent(data); // a terminal run's snapshot is followed by close 1000
        return;
      }
      if (data.seq <= lastSeq) return; // duplicate
      if (data.seq > lastSeq + 1) {
        sock.close(4001, "sequence gap"); // reconnect ⇒ fresh snapshot
        return;
      }
      lastSeq = data.seq;
      handlers.onEvent(data);
      if (TERMINAL_EVENTS.has(data.type)) stop("terminal");
    };

    sock.onclose = (ev) => {
      if (ws !== sock || stopped) return;
      if (watchdog) clearTimeout(watchdog);
      if (ev.code === 4404) return stop("not_found");
      if (ev.code === 1000) return stop("terminal"); // server closes 1000 after a terminal run
      scheduleRetry(`socket closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ""})`);
    };

    sock.onerror = () => {
      /* onclose follows; handled there */
    };
  }

  window.addEventListener("online", reconnectNow);
  document.addEventListener("visibilitychange", onVisible);
  open();

  return () => stop("unsubscribed");
}
