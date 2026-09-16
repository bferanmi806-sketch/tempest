// Expo push token registry + sender. Mobile peers call push.register after
// the handshake; we persist the token so `waiting` transitions can wake the
// phone even if the RPC socket is closed (backgrounded, offline).
//
// ponytail: broadcasts to every registered token. Per-pairing targeting can
// come when we have >2 phones on one desktop.

const STORAGE_KEY = "tempest.pushTokens.v1";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type PushToken = { token: string; platform: string; lastSeen: number };

// mobile-sessionId → token. mobile-sessionId is the pairing's RPC session
// (stable across reconnects on the same pairing).
const tokens = new Map<string, PushToken>();

const persist = () => {
  try {
    const obj: Record<string, PushToken> = {};
    for (const [k, v] of tokens) obj[k] = v;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {}
};

const load = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, PushToken>;
    for (const [k, v] of Object.entries(obj)) tokens.set(k, v);
  } catch {}
};
load();

export function registerToken(sessionId: string, token: string, platform: string): void {
  if (!token || !token.startsWith("ExponentPushToken")) return;
  tokens.set(sessionId, { token, platform, lastSeen: Date.now() });
  persist();
}

export function forgetToken(sessionId: string): void {
  if (tokens.delete(sessionId)) persist();
}

interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// Fire-and-forget. Failures log and drop the token if Expo says it's
// permanently invalid — same behavior as the Expo Push docs recommend.
export async function sendPush(msg: PushMessage): Promise<void> {
  if (tokens.size === 0) return;
  const messages = [...tokens.entries()].map(([sid, t]) => ({
    to: t.token,
    sound: "default",
    title: msg.title,
    body: msg.body,
    data: { ...(msg.data || {}), sid },
  }));
  try {
    const r = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!r.ok) { console.log("[push] expo http", r.status); return; }
    const body = await r.json().catch(() => null) as { data?: Array<{ status: string; details?: { error?: string } }> } | null;
    const results = body?.data || [];
    const entries = [...tokens.entries()];
    for (let i = 0; i < results.length; i++) {
      const err = results[i]?.details?.error;
      if (err === "DeviceNotRegistered") {
        const sid = entries[i]?.[0];
        if (sid) tokens.delete(sid);
      }
    }
    persist();
  } catch (e) {
    console.log("[push] send failed", (e as Error)?.message);
  }
}
