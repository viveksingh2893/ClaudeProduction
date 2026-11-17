"use client";

import { useEffect } from "react";
import { AlertBox, Button, PageContainer } from "@kisan4u/ui";

/**
 * Next.js route-segment error boundary — catches a render/data-fetch throw
 * anywhere under /admin/* and shows a retry instead of a blank crashed
 * page. `reset()` is Next's own re-render trigger (re-runs the failed
 * Server Component), not a page reload. See
 * https://nextjs.org/docs/app/api-reference/file-conventions/error.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageContainer className="py-8" maxWidth="700px">
      <AlertBox tone="danger" title="Something went wrong loading this page">
        <div className="flex flex-col gap-3">
          <span>{error.message || "An unexpected error occurred."}</span>
          <div>
            <Button variant="primary" size="sm" onClick={reset}>
              Try again
            </Button>
          </div>
        </div>
      </AlertBox>
    </PageContainer>
  );
}
