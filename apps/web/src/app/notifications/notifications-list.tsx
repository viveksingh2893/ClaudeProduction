"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { listNotificationsForUser } from "@kisan4u/orders";
import { Badge, Button, Card, ProductImage, formatDate } from "@kisan4u/ui";
import { X } from "lucide-react";
import { clearNotificationAction, clearAllNotificationsAction } from "./actions";

type NotificationRow = Awaited<ReturnType<typeof listNotificationsForUser>>[number];

export function NotificationsList({ notifications }: { notifications: NotificationRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(notifications);
  const [isPending, startTransition] = useTransition();

  function clearOne(id: string) {
    setRows((prev) => prev.filter((n) => n.id !== id));
    startTransition(async () => {
      const result = await clearNotificationAction(id);
      if (!result.ok) router.refresh();
    });
  }

  function clearAll() {
    if (!confirm("Clear all notifications? This cannot be undone.")) return;
    setRows([]);
    startTransition(async () => {
      await clearAllNotificationsAction();
      router.refresh();
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={clearAll} disabled={isPending}>
          Clear all
        </Button>
      </div>
      {rows.map((n) => {
        const content = (
          <>
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-bold text-ink">{n.title}</span>
              {!n.isRead && <Badge tone="info">New</Badge>}
            </div>
            <p className="mt-1 text-sm text-gray-600">{n.body}</p>
            <p className="mt-2 text-xs text-gray-400">{formatDate(n.createdAt, true)}</p>
          </>
        );
        return (
          <Card key={n.id} className="relative p-4">
            <button
              type="button"
              onClick={() => clearOne(n.id)}
              disabled={isPending}
              aria-label="Clear this notification"
              className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-ink disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {n.imageUrl ? (
              <div className="flex gap-3 pr-6">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-green-50">
                  <ProductImage src={n.imageUrl} alt={n.title} />
                </div>
                <div className="min-w-0 flex-1">
                  {n.linkUrl ? (
                    <Link href={n.linkUrl} className="block hover:opacity-90">
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </div>
              </div>
            ) : (
              <div className="pr-6">
                {n.linkUrl ? (
                  <Link href={n.linkUrl} className="block hover:opacity-90">
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
