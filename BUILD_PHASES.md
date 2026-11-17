# Kisan4U — Build Phases

Proposed implementation sequence for the Next.js rebuild, derived from `MODULE_LIST.md`, `USER_FLOW_MAP.md`, `DATABASE_MODEL_PLAN.md`, and `NEXTJS_ARCHITECTURE_PLAN.md`.

**Do not begin any of these phases until this document and the other five planning documents have been reviewed and approved.** This file only sequences future work.

Each phase lists: goal, key deliverables, dependencies, exit criteria (what "done" looks like before moving on).

## Phase 0 — Environment & tooling setup
**Goal**: a working, empty monorepo skeleton.
- Turborepo + pnpm workspace scaffold (`apps/web`, `apps/dashboard`, `packages/db`, `packages/auth`, `packages/ui`, `packages/config`, `packages/providers`, `packages/validators`).
- `docker-compose.yml` for local Postgres only.
- Prisma initialized with the schema from `DATABASE_MODEL_PLAN.md`, first migration run against local DB.
- `.env.example` (names only, dummy values in `.env.local`), lint/format/tsconfig shared config.
- CI-less for now (local dev only, no production connections per project constraints).
**Depends on**: nothing.
**Exit criteria**: `pnpm dev` boots both apps against local Postgres with an empty schema; `prisma studio` shows all tables from the plan.

## Phase 1 — Identity & auth foundation
**Goal**: every role can be created and can log in.
- `User`, `DealerProfile`, `SellerProfile`, `BusinessAssociateProfile`, `AdminProfile`, `DeliveryManProfile`, `Address` models live (already in schema from Phase 0, this phase wires the app layer).
- Auth.js setup with phone-OTP Credentials provider (backed by mock SMS provider) and email/password Credentials provider.
- Seed script creates one user of each role (`DATABASE_MODEL_PLAN.md` §13).
- Route middleware for role-gating in both apps.
**Depends on**: Phase 0.
**Exit criteria**: can register/login as farmer (OTP), seller (email/password), admin (email/password); role-gated routes correctly redirect unauthorized access.

## Phase 2 — Catalog
**Goal**: browsable product catalog with dual farmer/dealer pricing.
- `Category`, `Brand`, `Tag`, `Product`, `ProductPricing`, `ProductVariant` — admin CRUD (dashboard) + public listing/detail (web).
- Home page sections, listing page with filters (matching `filter-options.json` shape from the frontend analysis), product detail page.
- Price rendering switches on viewer role (dealer sees `ProductPricing[audience=DEALER]`).
**Depends on**: Phase 1 (need seller/admin accounts to own products).
**Exit criteria**: can create a product as admin or approved seller, see it on the storefront with correct pricing per role, including variants.

## Phase 3 — Cart & checkout
**Goal**: a farmer can complete a full purchase.
- `CartItem` (guest + authenticated, grouped by seller), `Address` management, `Coupon`/`CouponRedemption` apply/remove.
- Checkout flow: address selection → payment method selection → order creation.
- **Multi-seller order splitting** implemented here (one checkout → N `Order` rows sharing `orderGroupId`) — this is structural per `EXISTING_SYSTEM_ANALYSIS.md` §11, must not be retrofitted later.
**Depends on**: Phase 2.
**Exit criteria**: cart with items from 2 different sellers, at checkout, produces 2 separate orders with correct per-seller totals; coupon discount applies correctly.

## Phase 4 — Order lifecycle & fulfillment
**Goal**: orders can move through their full status lifecycle with proper history.
- `OrderStatusHistory`, admin/seller order management UI (list, detail, status transition).
- Implement the `OrderStatus` state machine exactly as mapped in `USER_FLOW_MAP.md` §G (including terminal states).
- Customer order tracking view (inside order detail, matching legacy — no standalone tracking page needed for parity).
**Depends on**: Phase 3.
**Exit criteria**: admin/seller can move an order pending → confirmed → processing → out_for_delivery → delivered, each transition recorded, customer sees updated status.

## Phase 5 — Payments (mocked)
**Goal**: all payment methods work end-to-end using mock providers only.
- `packages/providers/payment` — COD (real logic), Wallet (real logic against `Wallet` model), Razorpay mock (fake order id + always-succeed verify).
- Partial-COD and Offline/manual payment flows.
- `PaymentStatus` transitions wired to `OrderStatus` initialization (paid → starts at `confirmed`, unpaid → starts at `pending`, matching legacy behavior from `order-manager.php`).
**Depends on**: Phase 3.
**Exit criteria**: an order can be placed and paid via each of the 4 methods in dev, using only mock/local logic — no real gateway calls.

## Phase 6 — Refunds & returns
**Goal**: full refund lifecycle.
- `RefundRequest`, `RefundStatusHistory` — customer request (post-delivery, day-limit gated), admin/seller review, terminal `REFUNDED` state.
- Wallet debit on `REFUNDED` (see Phase 7 for wallet dependency — implement the debit call here once wallets exist).
**Depends on**: Phase 4, Phase 7 (wallet debit needs `Wallet`/`WalletTransaction` — sequence Phase 7 before finishing this phase's wallet-debit step, or build refund status flow first and wire the debit once Phase 7 lands).
**Exit criteria**: refund request pending → approved → refunded correctly debits the paying wallet and blocks further status changes once refunded.

## Phase 7 — Wallets & payouts
**Goal**: money settles correctly across all four owner types.
- `Wallet`, `WalletTransaction`, `WithdrawRequest` (polymorphic `ownerType`/`ownerId` per `DATABASE_MODEL_PLAN.md` §8).
- Implement the settlement logic from `USER_FLOW_MAP.md` §K: on `delivered`, split revenue into admin commission / seller earning / delivery-man charge+COD cash.
- Withdraw request UI for seller/delivery-man, approval flow for admin.
**Depends on**: Phase 4 (needs order delivery events to trigger settlement).
**Exit criteria**: an order marked `delivered` correctly credits all three wallets with the right amounts; a withdraw request reduces the correct wallet's pending balance on approval.

## Phase 8 — Delivery & logistics
**Goal**: delivery-man workflow and shipping configuration.
- `DeliveryManProfile` management (seller creates staff), order assignment, cash-collection tracking (feeds Phase 7 wallet).
- `ShippingMethod`, `Warehouse`, `SellerLicense` (regulated-category gating — `Category.isRegulated` blocks checkout unless the seller has an `APPROVED` license for the buyer's state).
- Courier fields on `Order` (name/tracking/waybill) — no real Delhivery/Shiprocket API calls, just the data model and a manual "mark as synced" admin action.
**Depends on**: Phase 4, Phase 7.
**Exit criteria**: a regulated-category product cannot be ordered into a state where the seller lacks an approved license; delivery-man cash collection correctly feeds their wallet.

## Phase 9 — Dealer flow
**Goal**: dealer KYC, approval, and dealer-scoped shopping.
- `DealerProfile` KYC submission UI (docs upload against local file storage), admin approval queue.
- Confirm dealer pricing/variants (`ProductPricing[audience=DEALER]`) surfaces correctly once `role=DEALER` and `kycStatus=APPROVED`.
**Depends on**: Phase 2 (pricing model), Phase 1 (auth).
**Exit criteria**: a dealer can complete KYC, get approved by admin, log in, and see dealer pricing throughout the storefront and checkout.

## Phase 10 — Seller/vendor panel completeness
**Goal**: seller self-service parity with `MODULE_LIST.md` §2-9 seller surfaces.
- Full seller onboarding wizard (business/GST/address/bank/license), admin approval.
- Seller-scoped coupons, shop branding (vacation mode, banners), seller marketing-plan subscription.
- POS (in-store order creation) — can be deferred to a later pass if time-constrained; flag explicitly if descoped.
**Depends on**: Phases 1-9 (touches almost everything).
**Exit criteria**: a new seller can complete onboarding, get approved, list a product, receive and fulfill an order, request a payout — without any admin intervention beyond the approval steps.

## Phase 11 — Business Associate (BA) / referral program
**Goal**: affiliate registration, commission tracking, settlement.
- `BusinessAssociateProfile`, `BaSettlement`, referral-code capture at signup, referee-order commission accrual.
- General "Refer & Earn" (lighter-weight, every user) can be built alongside or slightly before formal BA if useful as a stepping stone.
**Depends on**: Phase 1, Phase 4 (commission accrues on delivered orders), Phase 7 (payout via wallet/withdraw).
**Exit criteria**: a BA's referral link signs up a new customer, that customer's delivered order generates a tracked commission, and an admin settlement batch correctly totals it.

## Phase 12 — Admin panel completeness
**Goal**: full back-office coverage.
- Reports (order/product/stock/wishlist/seller-sales/transaction/refund), dashboard KPIs.
- Business settings, granular admin RBAC (`AdminProfile.modulePermissions`) beyond the MVP role-only gating from Phase 1.
- Employee/custom-role management UI.
**Depends on**: most prior phases (reports read across all domains).
**Exit criteria**: admin can generate each report type with seeded data, create a restricted "employee" account limited to specific modules.

## Phase 13 — Notifications framework
**Goal**: the full event→channel pipeline from `MODULE_LIST.md` §14, mocked.
- `NotificationDispatcher` service, mock SMS/Email/Push providers (console/log output), in-app `Notification` model + notification center UI.
- Wire every event listed in the event map to its recipients/channels.
**Depends on**: Phases 4, 6, 7 (the events being notified about must exist first) — can be built incrementally alongside those phases rather than strictly after; listed here as a consolidation checkpoint.
**Exit criteria**: placing an order, changing its status, and processing a refund each produce the expected mock notifications, visible in dev logs and the in-app notification center.

## Phase 14 — Support & CMS
**Goal**: remaining customer-support and content surfaces.
- `SupportTicket`/`SupportMessage` (threaded), `ContentPage` (policy pages), help topics/FAQ.
**Depends on**: Phase 1.
**Exit criteria**: customer can open a ticket, admin can reply, thread displays correctly; policy pages are admin-editable and render on `web`.

## Phase 15 — Testing, polish, QA
**Goal**: confidence before calling the rebuild feature-complete against this plan.
- Vitest coverage for pricing/order-splitting/wallet-settlement math (the highest-complexity business logic identified in the analysis).
- Playwright e2e for the golden paths: farmer browse→cart→checkout→order→refund; seller onboarding→product→order→payout; admin approval flows.
- Manual walkthrough of every flow in `USER_FLOW_MAP.md` against the running app.
**Depends on**: all prior phases.
**Exit criteria**: golden-path e2e suite green; manual walkthrough of every flow in `USER_FLOW_MAP.md` completed without gaps.

## Sequencing notes

- Phases 0-5 are strictly sequential (each is a hard dependency of the next) and form the minimum viable "a farmer can buy something" slice.
- Phases 6-8 (refunds, wallets, logistics) are tightly coupled to each other and to Phase 4 — expect some back-and-forth between them rather than a clean linear handoff.
- Phases 9-11 (dealer, seller completeness, BA) can be reordered relative to each other based on business priority — they don't depend on one another, only on the core commerce slice (Phases 0-8).
- Phase 13 (notifications) is written as a late consolidation phase but its provider interfaces should exist from Phase 0 (`packages/providers`) so earlier phases can call into them incrementally instead of retrofitting.
- If timeline pressure requires cutting scope, Phase 11 (BA) and POS within Phase 10 are the most separable from core commerce and the safest to defer.
