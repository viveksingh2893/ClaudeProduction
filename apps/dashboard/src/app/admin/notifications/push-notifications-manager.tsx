"use client";

import { useState, useTransition } from "react";
import { Button, Card, AlertBox } from "@kisan4u/ui";
import { sendBroadcastPushAction } from "./actions";

const AUDIENCE_OPTIONS = [
  { value: "ALL_CUSTOMERS", label: "All customers" },
  { value: "ALL_DEALERS", label: "All dealers" },
  { value: "EVERYONE", label: "Everyone (customers + dealers)" },
] as const;

export function PushNotificationsManager({
  pushEnabled,
  deviceCount,
  reachableUserCount,
}: {
  pushEnabled: boolean;
  deviceCount: number;
  reachableUserCount: number;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [audience, setAudience] = useState<string>("ALL_CUSTOMERS");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();

  const canSend = title.trim().length >= 3 && body.trim().length >= 3 && !isSending;

  function handleSend() {
    setError(null);
    setResult(null);
    startSending(async () => {
      const res = await sendBroadcastPushAction({
        title: title.trim(),
        body: body.trim(),
        linkUrl: linkUrl.trim() || undefined,
        audience,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(
        res.pushEnabled
          ? `Sent to ${res.recipients.toLocaleString("en-IN")} ${audienceNoun(audience)} — in-app + push.`
          : `Recorded an in-app notification for ${res.recipients.toLocaleString(
              "en-IN",
            )} ${audienceNoun(audience)}. Device push is held until Expo/FCM credentials are configured.`,
      );
      setTitle("");
      setBody("");
      setLinkUrl("");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {!pushEnabled && (
        <AlertBox tone="warning">
          Device push isn&rsquo;t live yet — <code>EXPO_ACCESS_TOKEN</code> and the FCM
          <code> google-services</code> config aren&rsquo;t set. Messages you send now are still
          written to each recipient&rsquo;s in-app notification feed; they&rsquo;ll start reaching
          phones as push the moment the credentials are added, with no app update needed.
        </AlertBox>
      )}

      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-base font-bold text-ink">Compose a notification</h2>
          <p className="mt-1 text-sm text-gray-600">
            Goes to every matching account&rsquo;s in-app feed and — once push is live — their
            registered devices. {deviceCount.toLocaleString("en-IN")} device
            {deviceCount === 1 ? "" : "s"} registered across{" "}
            {reachableUserCount.toLocaleString("en-IN")} user
            {reachableUserCount === 1 ? "" : "s"}.
          </p>
        </div>

        {error && <AlertBox tone="danger">{error}</AlertBox>}
        {result && <AlertBox tone="success">{result}</AlertBox>}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">Title</span>
          <input
            type="text"
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Monsoon sale is live"
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">Message</span>
          <textarea
            value={body}
            maxLength={240}
            rows={3}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Up to 30% off seeds and crop protection until Sunday."
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
          <span className="text-xs text-gray-500">{body.length}/240</span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">Link (optional)</span>
          <input
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="/products or https://katra4u.com/offers"
            className="rounded-md border border-border px-3 py-2 text-sm"
          />
          <span className="text-xs text-gray-500">
            An in-app path (starts with /) or a full https:// URL. Opened when the user taps the
            notification.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">Audience</span>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            {AUDIENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div>
          <Button variant="primary" disabled={!canSend} onClick={handleSend}>
            {isSending ? "Sending…" : "Send notification"}
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <h2 className="text-base font-bold text-ink">Automatic notifications</h2>
        <p className="text-sm text-gray-600">
          These are sent on their own — you don&rsquo;t need to do anything here:
        </p>
        <ul className="list-disc pl-5 text-sm text-gray-600">
          <li>Order placed, accepted, confirmed, packed, picked up, in transit, delivered</li>
          <li>Order cancelled, cancellation decided, return requested, refund completed</li>
          <li>
            Abandoned cart — a buyer who added to cart and didn&rsquo;t check out gets one reminder
            after an hour (at most once every 3 days)
          </li>
        </ul>
      </Card>
    </div>
  );
}

function audienceNoun(a: string): string {
  if (a === "ALL_DEALERS") return "dealers";
  if (a === "EVERYONE") return "users";
  return "customers";
}
