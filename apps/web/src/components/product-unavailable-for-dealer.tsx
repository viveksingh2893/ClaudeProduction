import { LinkButton, PageContainer } from "@kisan4u/ui";

export function ProductUnavailableForDealer() {
  return (
    <PageContainer maxWidth="760px" className="py-16">
      <div className="rounded-2xl border border-border bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          This product isn&apos;t available to you
        </h1>
        <p className="mt-3 text-sm text-muted">
          This product is available only in the customer catalogue.
        </p>
        <div className="mt-6 flex justify-center">
          <LinkButton href="/">Go to Home</LinkButton>
        </div>
      </div>
    </PageContainer>
  );
}
