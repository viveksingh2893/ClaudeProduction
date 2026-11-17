import type { ReactNode } from "react";
import { Fragment } from "react";
import Link from "next/link";
import { PageContainer, Breadcrumbs } from "@kisan4u/ui";
import { LEGAL_DOCS, type LegalSlug } from "@kisan4u/validators";

/**
 * Shared shell for the static legal / policy pages (Terms, Privacy,
 * Return, Cancellation, Shipping, Contact). Public — no auth (middleware
 * only guards /account). Kept deliberately plain: headings + prose, so the
 * content is easy for a reviewer (and a customer) to read end to end.
 */
export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated?: string;
  children: ReactNode;
}) {
  return (
    <PageContainer className="py-8" maxWidth="820px">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: title },
        ]}
      />
      <h1 className="mt-3 text-2xl font-extrabold text-green-900 sm:text-3xl">{title}</h1>
      {lastUpdated && (
        <p className="mt-1 text-sm text-gray-500">Last updated: {lastUpdated}</p>
      )}
      <article className="legal-prose mt-6 text-[15px] leading-relaxed text-ink">{children}</article>

      <div className="mt-10 border-t border-border pt-4 text-sm text-gray-600">
        See also:{" "}
        <LegalNav />
      </div>
    </PageContainer>
  );
}

export const LEGAL_LINKS: { label: string; href: string }[] = [
  { label: "About Us", href: "/about" },
  { label: "Terms & Conditions", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Delete Account", href: "/delete-account" },
  { label: "Return Policy", href: "/return-policy" },
  { label: "Cancellation Policy", href: "/cancellation-policy" },
  { label: "Shipping Policy", href: "/shipping-policy" },
  { label: "Contact Us", href: "/contact" },
];

function LegalNav() {
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
      {LEGAL_LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="font-semibold text-green-700 hover:underline">
          {l.label}
        </Link>
      ))}
    </span>
  );
}

/** Section heading inside a legal page. */
export function LegalSection({ children }: { children: ReactNode }) {
  return <h2 className="mt-7 text-lg font-bold text-green-900 first:mt-0">{children}</h2>;
}

/** Paragraph inside a legal page. */
export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3">{children}</p>;
}

// Turn bare emails / phone numbers / www.kisan4u.com in the shared plain-text
// content into links, and honour "\n" as a line break.
const LINKIFY = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\+91[-\s]?\d[\d\s-]{7,}\d|www\.kisan4u\.com)/gi;

function linkify(text: string): ReactNode[] {
  return text.split("\n").flatMap((line, li, lines) => {
    const parts = line.split(LINKIFY).map((part, i) => {
      if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
      const cls = "font-semibold text-green-700 hover:underline";
      if (part.includes("@")) {
        return (
          <a key={i} href={`mailto:${part}`} className={cls}>
            {part}
          </a>
        );
      }
      if (part.startsWith("+")) {
        return (
          <a key={i} href={`tel:${part.replace(/[\s-]/g, "")}`} className={cls}>
            {part}
          </a>
        );
      }
      return (
        <a key={i} href="https://www.kisan4u.com" className={cls}>
          {part}
        </a>
      );
    });
    return li < lines.length - 1 ? [...parts, <br key={`br-${li}`} />] : parts;
  });
}

/**
 * Renders a legal / policy document from the shared @kisan4u/validators
 * content so the website and the mobile app never drift apart. Each
 * apps/web/src/app/{terms,privacy,...}/page.tsx is now just
 * `<LegalDocView slug="terms" />`.
 */
export function LegalDocView({ slug }: { slug: LegalSlug }) {
  const doc = LEGAL_DOCS[slug];
  return (
    <LegalPage title={doc.title} lastUpdated={doc.lastUpdated}>
      {doc.sections.map((section, si) => (
        <section key={si}>
          {section.heading ? <LegalSection>{section.heading}</LegalSection> : null}
          {section.paragraphs.map((para, pi) => (
            <P key={pi}>{linkify(para)}</P>
          ))}
          {section.list ? (
            <ul className="mt-3 list-disc space-y-1 pl-6">
              {section.list.map((li, i) => (
                <li key={i}>{li}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </LegalPage>
  );
}
