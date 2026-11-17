import { classifyVideoUrl } from "@kisan4u/validators";

/**
 * Renders a stored product/variant video URL safely — a YouTube/Vimeo URL
 * becomes a sandboxed iframe embed built from an extracted video id
 * (never raw HTML from user input); anything else (a direct .mp4 link, or
 * a host we don't specifically recognize) renders as a plain outbound
 * link instead of guessing at an embed. See classifyVideoUrl's doc
 * comment in packages/validators/src/primitives.ts — the schema's notion
 * of "safe video host" and this renderer's embed choice are kept in sync
 * by sharing that one classifier.
 */
export function VideoEmbed({ url, title }: { url: string; title: string }) {
  const { kind, embedId } = classifyVideoUrl(url);

  if (kind === "youtube" && embedId) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
        <iframe
          src={`https://www.youtube.com/embed/${embedId}`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    );
  }
  if (kind === "vimeo" && embedId) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
        <iframe
          src={`https://player.vimeo.com/video/${embedId}`}
          title={title}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex w-fit items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-50"
    >
      Watch video
    </a>
  );
}
