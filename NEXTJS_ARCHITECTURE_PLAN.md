# Kisan4U — Next.js Architecture Plan

Recommended architecture for the rebuild. This is a proposal for review, not a final decision — flag anything you'd rather do differently before Phase 0 of `BUILD_PHASES.md` starts.

## 1. High-level shape

A single monorepo, multiple apps, one shared database/package layer:

```
kisan4u-nextjs/
├── apps/
│   ├── web/          # customer-facing storefront (farmer/dealer/BA-facing)
│   ├── dashboard/     # admin + seller panel, role-gated (see §2 for why combined)
│   └── (optional later) delivery/  # delivery-man PWA, only if a dedicated app is warranted
├── packages/
│   ├── db/            # Prisma schema + client (from DATABASE_MODEL_PLAN.md)
│   ├── auth/           # shared auth config/helpers (NextAuth/Auth.js)
│   ├── ui/             # shared React components (design system)
│   ├── config/          # shared eslint/tsconfig/tailwind config
│   ├── providers/        # mockable service interfaces: SMS, Push, Email, WhatsApp, Payment
│   └── validators/        # shared Zod schemas (cart, checkout, product, etc.)
├── EXISTING_SYSTEM_ANALYSIS.md
├── MODULE_LIST.md
├── USER_FLOW_MAP.md
├── DATABASE_MODEL_PLAN.md
├── NEXTJS_ARCHITECTURE_PLAN.md
└── BUILD_PHASES.md
```

Tooling: **Turborepo + pnpm workspaces** (fast incremental builds, good Next.js support, easy to split apps later).

## 2. Customer site vs. admin panel vs. seller panel: recommendation

**Recommend two apps, not three or one.** Reasoning:

- **`web`** — public, SEO-sensitive, needs SSR/ISR, must be fast for anonymous browsing. Keep it isolated so its bundle/build stays lean and it can be deployed/scaled independently.
- **`dashboard`** — admin and seller are *structurally the same panel* in the legacy system (nearly identical controllers, just scoped by `sellerId`) and this held true in the module analysis (Vendor panel mirrors Admin: orders, refunds, products, wallet, coupons, delivery-man). Combining them into one app with role-gated routes (`/admin/*` vs `/seller/*`, shared layout/components, different data scoping) avoids duplicating a large amount of UI and keeps the seller experience feeling consistent with admin. Dealer and BA don't need a dashboard app at all — they're customer-role variants and belong in `web` (see §3).
- **Delivery Man**: legacy delivery-man UX is a dedicated mobile app (GPS tracking, OTP proof-of-delivery) — genuinely different enough from a web dashboard that it's called out as optional-later rather than folded into `dashboard`. For an early build, a simple `/dashboard/delivery` role view is enough; split it out only if/when a true PWA/mobile need appears.

This is a judgment call with a real trade-off (one big `dashboard` app means seller-facing code ships in the same deploy as admin-only code) — worth confirming you're fine with it before Phase 0.

## 3. Customer site (`apps/web`) role handling

All four customer-facing identities (farmer/customer, dealer, seller-in-onboarding, BA) share this single app, matching what the compiled `v1-frontend` actually does (one SPA, `product_for`/`isDealer`/`isBA` as data flags, not separate deployments):

- `/` , `/listing`, `/products/[slug]` — public catalog, price rendering switches on `session.user.role === 'DEALER'`.
- `/login`, `/login/mobile`, `/login/otp` — customer/farmer OTP auth.
- `/register/dealer/*`, `/dealer/otp` — dealer onboarding + login.
- `/register/ba/*`, `/ba/otp`, `/ba/referees`, `/ba/refer` — BA flow.
- `/seller/join`, `/seller/apply`, `/seller/otp`, `/seller/status` — seller onboarding *funnel only* (once approved, seller is redirected to `apps/dashboard`).
- `/cart`, `/checkout`, `/orders`, `/wishlist`, `/wallet`, `/saved-addresses`, `/support` — account area, any authenticated role.
- `/privacy-policy`, `/terms-and-conditions`, etc. — CMS-backed static pages (`ContentPage` model).

Use **Next.js App Router**, React Server Components for data-heavy read pages (home, listing, product detail — matches the legacy pattern of server-rendered `Web/` controllers), and Server Actions or thin Route Handlers for mutations (cart, checkout, OTP).

## 4. API layer

Recommend **Next.js Route Handlers** (`app/api/**/route.ts`) as the API surface, not a separate backend service — keeps the whole system in one deployable, matches "local dummy data, no production services" constraint, and is the simplest path for both `web` and `dashboard` to share via `packages/db`.

- Structure endpoints to mirror the legacy `api/web/v1.php` naming where it's sensible (`/api/products`, `/api/cart`, `/api/orders`, `/api/checkout`) — this is the *cleanest* legacy API version (per `EXISTING_SYSTEM_ANALYSIS.md` §4) and the one the real frontend already speaks, so parity-checking against it later is easy.
- Validate all input with **Zod** schemas from `packages/validators`.
- No GraphQL/tRPC needed for MVP — the legacy system's API surface is plain REST-shaped and the module list doesn't demand real-time subscriptions beyond chat/notifications (handled separately, §7).
- For `dashboard`, internal admin/seller mutations can use Server Actions directly against `packages/db` (no need to round-trip through a public API for same-app calls).

## 5. Authentication & roles

Recommend **Auth.js (NextAuth v5)** with a custom Credentials provider per login mode, backed by the unified `User` model from `DATABASE_MODEL_PLAN.md`:

- **Phone OTP** (customer/farmer, dealer, BA): `Credentials` provider that verifies an OTP issued by the mocked SMS provider (`packages/providers/sms`), no password.
- **Email/password** (admin, seller web login): standard `Credentials` provider with bcrypt.
- Session strategy: JWT, with `role` and (for sellers/dealers) profile-id claims embedded, so middleware can gate routes without an extra DB hit on every request.
- **Route protection**: `middleware.ts` in each app checks `session.user.role` against the route's required role(s); `dashboard` additionally checks `AdminProfile.modulePermissions` for fine-grained admin RBAC (mirrors legacy `admin_roles.module_access` pattern) once you're past MVP — start with role-only gating, add granular permissions in a later phase (see `BUILD_PHASES.md`).
- Guest browsing: allow unauthenticated cart via a signed cookie (`guestCartId`), matching legacy `/guest-token` behavior; merge into the user's cart on login.

## 6. Database

- **PostgreSQL** (matches the relational, foreign-key-heavy legacy schema much better than a document store) + **Prisma** as ORM, schema per `DATABASE_MODEL_PLAN.md`.
- Local dev: `docker-compose.yml` running Postgres only — **never point at the production database**, per project constraints.
- Migrations via `prisma migrate dev`; seed via `prisma/seed.ts` implementing the plan in `DATABASE_MODEL_PLAN.md` §13 (dummy data only).
- Money fields as `Decimal` (Prisma `Decimal` → Postgres `numeric`), never `Float`.

## 7. File storage

- **Local disk** (`apps/web/public/uploads` or a dedicated `storage/` volume) for dev, behind a small `packages/providers/storage` interface (`upload(file): url`, `delete(url)`).
- Swap implementation to S3-compatible (the legacy system already supports a custom S3 endpoint) when a real environment is available — don't hardcode local-disk assumptions into calling code.
- Never reference the production CDN/staging URLs discovered in the compiled frontend (`staging.kisan4u.com`, `fbtsdigitalmarketing.com`) — use local placeholder images in seed data.

## 8. Role permissions

- **MVP**: enum-based (`UserRole` gates route access, `SellerStatus`/`KycStatus`/`BaStatus` gate feature access within a role).
- **Later**: expand `AdminProfile.modulePermissions` (already a `Json` field in the schema) into a proper permission-check helper mirroring the legacy module list (product/order/promotion/user/report/support/system-settings/POS) so admin can create restricted "employee" accounts, matching legacy Custom Role functionality.

## 9. Seller panel

Lives inside `apps/dashboard` under `/seller/*`, role-gated to `role === 'SELLER'` and further scoped to `session.user.sellerProfileId` on every query (never trust a client-supplied seller id). Feature scope = MODULE_LIST.md §2-9 filtered to "Seller" surfaces — product submission (with admin approval step), order management, refunds (until admin acts), coupons, shipping, warehouses, delivery-man staff, wallet/withdraw, license applications, POS.

## 10. Third-party integrations — all mocked locally

Per project constraints (no real payment/SMS/email/WhatsApp/Firebase/notification services), define thin interfaces in `packages/providers` with a **local mock implementation** for each, swappable later:

```
packages/providers/
├── sms/            // send(to, message) -> logs to console + stores in a dev "sent_messages" table for OTP testing
├── email/          // send(to, subject, html) -> logs to console / writes .eml to disk
├── push/            // send(userId, title, body) -> logs to console, no real FCM call
├── whatsapp/          // sendLink(phone) -> returns a wa.me deep link, no real API needed (matches legacy — it never had real WhatsApp send either)
└── payment/
    ├── razorpay/    // mock: createOrder() returns a fake order id, verify() always succeeds in dev
    ├── cod/          // real logic, no external call needed
    └── wallet/        // real logic against the Wallet model, no external call needed
```
This mirrors the legacy `Payment_Methods/*` controller pattern (one class per gateway, shared `Processor` interface) but keeps every implementation local/dummy until real credentials are provided later — and explicitly never reuses the flagged Delhivery tokens or any other credential found during analysis (`EXISTING_SYSTEM_ANALYSIS.md` §8).

## 11. Notifications framework

One `NotificationDispatcher` service (in `packages/providers` or a dedicated `packages/notifications`) that:
1. Accepts a typed event (`OrderPlaced`, `OrderStatusChanged`, `RefundStatusChanged`, `WalletFunded`, `WithdrawStatusChanged`, `CashCollected` — matching MODULE_LIST.md §14).
2. Looks up the recipient's `NotificationPreference`.
3. Fans out to the mock SMS/Email/Push providers based on preference + a per-event default channel list ported from the legacy event→channel table.
4. Also writes an in-app `Notification` row for the notification center UI.

## 12. Frontend stack details

- **Next.js 15 (App Router)**, TypeScript throughout.
- **Tailwind CSS** for styling (fast to match the existing visual reference via `figmaAssets/`), optionally **shadcn/ui** for form/dialog/table primitives in `dashboard` (admin tables, forms) — lighter custom components for the public `web` storefront to keep it on-brand.
- **TanStack Query** for client-side data fetching where server components aren't a good fit (cart interactions, live checkout state, admin tables with client-side filtering/sorting).
- **React Hook Form + Zod** for all forms (checkout, product forms, KYC uploads).
- **next-intl** (or similar) if genuine multi-language support is wanted later — legacy frontend only used a bolted-on Google Translate widget, so this is a potential *improvement* over the reference, not a requirement for parity.

## 13. Testing

- **Vitest** for unit tests (pricing calculations, order-splitting logic, wallet settlement math — these are exactly the areas where the legacy system had the most complex business logic).
- **Playwright** for e2e golden-path flows (browse → cart → checkout → order; seller product approval; refund lifecycle) once enough of the app exists to test end-to-end.

## 14. Environment & secrets

- `.env.local` (git-ignored) with **dummy values only** — no production credentials, per project constraints. Provide a checked-in `.env.example` listing variable names only (mirroring the pattern the legacy repo already used correctly).
- `DATABASE_URL` → local Postgres only.
- All payment/SMS/push/storage provider "keys" in dev can simply be placeholder strings since the mock providers in §10 don't call out to real services.

## 15. Open questions for your review

1. Confirm the **`web` + `dashboard` two-app split** (§2) rather than three separate apps (admin/seller/customer) or one single app with heavy role-gating.
2. Confirm **Auth.js** is acceptable vs. a simpler hand-rolled JWT session (Auth.js pulls in more surface area but saves real work on OTP/credentials/session plumbing).
3. Confirm whether Business Associate and Dealer are truly launch-scope for the *first* build, or should be deferred to a later phase (`BUILD_PHASES.md` currently sequences them mid-plan, after core commerce is solid).
4. Confirm Postgres is acceptable (vs. e.g. MySQL, to stay closer to the legacy stack) — Postgres is recommended for better Prisma ergonomics and `Decimal`/enum support, but MySQL is a reasonable alternative if there's a hosting-target reason to match legacy.
