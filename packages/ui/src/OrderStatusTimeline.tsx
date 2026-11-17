export type OrderStatusTimelineEntry = {
  id: string;
  status: string;
  label: string;
  createdAt: Date | string;
  note?: string | null;
};

/** Renders a status-history array (oldest first, as every order query already orders it) as a vertical timeline. */
export function OrderStatusTimeline({ entries }: { entries: OrderStatusTimelineEntry[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {entries.map((entry, i) => (
        <li key={entry.id} className="relative flex gap-3 pl-1">
          <div className="flex flex-col items-center">
            <span className={`z-10 h-2.5 w-2.5 rounded-full ${i === entries.length - 1 ? "bg-green-600" : "bg-border"}`} />
            {i < entries.length - 1 && <span className="w-px flex-1 bg-border" />}
          </div>
          <div className="-mt-1 pb-1">
            <div className="text-sm font-bold text-ink">{entry.label}</div>
            <div className="text-xs text-gray-400">{new Date(entry.createdAt).toLocaleString()}</div>
            {entry.note && <div className="mt-0.5 text-sm text-gray-600">{entry.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
