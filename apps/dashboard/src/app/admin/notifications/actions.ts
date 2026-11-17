"use server";

import { broadcastNotification } from "@kisan4u/orders";
import { requireSession } from "@/lib/session-guard";

type BroadcastResult =
  | { ok: true; recipients: number; pushEnabled: boolean }
  | { ok: false; error: string };

const AUDIENCES = ["ALL_CUSTOMERS", "ALL_DEALERS", "EVERYONE"] as const;
type Audience = (typeof AUDIENCES)[number];

/**
 * Composes a push + in-app notification and fans it out to the chosen
 * audience (see @kisan4u/orders' broadcastNotification). Every recipient
 * gets a row in their in-app feed immediately; the push itself is
 * delivered only once `EXPO_ACCESS_TOKEN` / FCM credentials are
 * configured — until then this still works as an in-app announcement.
 */
export async function sendBroadcastPushAction(input: {
  title: string;
  body: string;
  linkUrl?: string;
  audience: string;
}): Promise<BroadcastResult> {
  await requireSession(["ADMIN"]);

  const title = input.title?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  const linkUrl = input.linkUrl?.trim() || undefined;
  const audience = input.audience as Audience;

  if (title.length < 3) return { ok: false, error: "Title must be at least 3 characters." };
  if (title.length > 100) return { ok: false, error: "Title must be 100 characters or fewer." };
  if (body.length < 3) return { ok: false, error: "Message must be at least 3 characters." };
  if (body.length > 240) return { ok: false, error: "Message must be 240 characters or fewer." };
  if (!AUDIENCES.includes(audience)) return { ok: false, error: "Pick a valid audience." };
  if (linkUrl && !/^(https?:\/\/|\/)/i.test(linkUrl)) {
    return { ok: false, error: "Link must be a full https:// URL or an in-app path starting with /." };
  }

  const { recipients } = await broadcastNotification({ audience, title, body, linkUrl });
  return { ok: true, recipients, pushEnabled: Boolean(process.env.EXPO_ACCESS_TOKEN) };
}
