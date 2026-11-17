/**
 * SMS delivery. Two implementations behind one interface:
 *
 *   - `smsHubProvider` — real SMS via SMS Hub Solutions
 *     (net.smshubsolutions.com), a DLT-registered Indian gateway. Active
 *     whenever the SMSHUB_* env vars are all set.
 *   - `mockSmsProvider` — logs the message to the server console and
 *     nothing else. The fallback for local dev and any environment where
 *     SMSHUB_* isn't configured.
 *
 * `getSmsProvider()` chooses between them at call time from the
 * environment, so the single OTP chokepoint (packages/auth/src/otp.ts)
 * never has to care which is live.
 *
 * DLT note: an Indian gateway will only deliver a message that matches a
 * pre-registered template. `send()` takes an optional `dltTemplateId`;
 * the caller must make `message` equal that template's approved text with
 * its variable(s) substituted, or the gateway rejects it (codes 250/260).
 */

export type SmsSendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string };

export interface SmsProvider {
  send(
    to: string,
    message: string,
    opts?: { dltTemplateId?: string },
  ): Promise<SmsSendResult>;
}

export const mockSmsProvider: SmsProvider = {
  async send(to, message) {
    console.log(`[mock-sms] to=${to} message="${message}"`);
    return { ok: true, providerMessageId: null };
  },
};

const SMSHUB_BASE_URL = "http://net.smshubsolutions.com/api";
const SMSHUB_TIMEOUT_MS = 10_000;

type SmsHubConfig = {
  user: string;
  authkey: string;
  sender: string;
  /**
   * DLT Entity / PE ID. Optional here: SMS Hub already has it on file
   * against the account, and in practice the `templateid` (which is
   * globally unique on DLT) is enough. Sent as `entityid=` only when set,
   * so a deployment that can't retrieve the unmasked number can still go
   * live — add it later if the gateway ever demands it.
   */
  entityId: string | undefined;
};

/** `user` + `authkey` + `sender` are the minimum for the real provider to be usable; without all three it falls back to the mock. */
function readSmsHubConfig(): SmsHubConfig | null {
  const user = process.env.SMSHUB_USER;
  const authkey = process.env.SMSHUB_AUTHKEY;
  const sender = process.env.SMSHUB_SENDER;
  const entityId = process.env.SMSHUB_ENTITY_ID?.trim() || undefined;
  if (!user || !authkey || !sender) return null;
  return { user, authkey, sender, entityId };
}

/** True when the real gateway is fully configured (used by callers that want to log which path is active). */
export function isRealSmsConfigured(): boolean {
  return readSmsHubConfig() !== null;
}

/**
 * The gateway expects the recipient as "91XXXXXXXXXX". Phone numbers are
 * stored canonically as "+91XXXXXXXXXX" (packages/validators/src/phone.ts),
 * so drop the leading "+". Anything already in another shape is passed
 * through untouched — validation happens upstream.
 */
function toGatewayMobile(to: string): string {
  const trimmed = to.trim();
  return trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
}

/** First token of the gateway's response body → meaning (see the SMS Hub error-code table). */
const SMSHUB_CODE_MEANING: Record<string, string> = {
  "100": "message submitted (tracking id issued)",
  "150": "message submitted",
  "200": "authentication failure",
  "250": "no approved template found",
  "255": "blank template id",
  "260": "invalid message template",
  "350": "no more credits or account expired",
  "400": "unicode message but type value not set",
  "500": "blank message",
  "600": "invalid sender id",
  "610": "blank header id",
  "700": "no valid recipient number received",
  "999": "access denied — contact the service provider",
};
const SMSHUB_SUCCESS_CODES = new Set(["100", "150"]);

/**
 * Normalises the gateway's reply to `{ code, messageId }`. SMS Hub returns
 * one of two shapes depending on the account/endpoint:
 *   - JSON: {"RESPONSE":{"CODE":"100","INFO":"SUBMITTED","UID":"..."},"STATUS":"OK"}
 *     (RESPONSE may also be an array, one entry per recipient)
 *   - plain: `100|<uid>`, `100,<uid>`, `100 <uid>`, or bare `100`
 */
function parseSmsHubResponse(body: string): { code: string; messageId: string | null } {
  const trimmed = body.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed) as unknown;
      const root =
        Array.isArray(json) && json.length > 0
          ? (json[0] as Record<string, unknown>)
          : (json as Record<string, unknown>);
      const respRaw = root?.RESPONSE ?? root?.response ?? root;
      const resp = (
        Array.isArray(respRaw) ? respRaw[0] : respRaw
      ) as Record<string, unknown> | undefined;
      const code = String(resp?.CODE ?? resp?.code ?? root?.CODE ?? root?.code ?? "").trim();
      const uid = resp?.UID ?? resp?.uid ?? resp?.MSGID ?? resp?.msgid ?? null;
      return { code, messageId: uid ? String(uid) : null };
    } catch {
      // fall through to plain parsing
    }
  }

  const code = trimmed.split(/[|,\s]/, 1)[0]?.trim() ?? "";
  const rest = trimmed.slice(code.length).replace(/^[|,\s]+/, "").trim();
  return { code, messageId: rest || null };
}

async function smsHubGet(path: string, params: URLSearchParams): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMSHUB_TIMEOUT_MS);
  try {
    const res = await fetch(`${SMSHUB_BASE_URL}/${path}?${params.toString()}`, {
      signal: controller.signal,
    });
    return (await res.text()).trim();
  } finally {
    clearTimeout(timer);
  }
}

export const smsHubProvider: SmsProvider = {
  async send(to, message, opts) {
    const config = readSmsHubConfig();
    if (!config) {
      return { ok: false, error: "SMSHUB_* env vars are not configured." };
    }

    const params = new URLSearchParams({
      user: config.user,
      authkey: config.authkey,
      sender: config.sender,
      mobile: toGatewayMobile(to),
      text: message, // URLSearchParams encodes this — the API requires an encoded text param.
      rpt: "1",
    });
    if (config.entityId) params.set("entityid", config.entityId);
    if (opts?.dltTemplateId) params.set("templateid", opts.dltTemplateId);

    let body: string;
    try {
      body = await smsHubGet("pushsms", params);
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return {
        ok: false,
        error: aborted ? "SMS gateway timed out." : "Could not reach the SMS gateway.",
      };
    }

    const { code, messageId } = parseSmsHubResponse(body);
    if (SMSHUB_SUCCESS_CODES.has(code)) {
      return { ok: true, providerMessageId: messageId };
    }
    const meaning = SMSHUB_CODE_MEANING[code];
    return {
      ok: false,
      error: meaning
        ? `SMS gateway error ${code}: ${meaning}`
        : `SMS gateway returned an unexpected response: ${body.slice(0, 160)}`,
    };
  },
};

/** Real provider when SMSHUB_* is fully configured, mock (console log) otherwise. */
export function getSmsProvider(): SmsProvider {
  return readSmsHubConfig() ? smsHubProvider : mockSmsProvider;
}

export type SmsHubBalanceResult =
  | { ok: true; balance: string }
  | { ok: false; error: string };

/** Ops helper — hits the gateway's balance endpoint. Not used in any request path; handy for a post-deploy sanity check. */
export async function smsHubCheckBalance(): Promise<SmsHubBalanceResult> {
  const config = readSmsHubConfig();
  if (!config) return { ok: false, error: "SMSHUB_* env vars are not configured." };
  const params = new URLSearchParams({ user: config.user, authkey: config.authkey });
  try {
    const body = await smsHubGet("balance", params);
    return { ok: true, balance: body };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "SMS gateway timed out." : "Could not reach the SMS gateway.",
    };
  }
}
