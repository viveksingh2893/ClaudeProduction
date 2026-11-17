# Kisan4U — Existing System Analysis

Analysis of the reference codebase in `kisan4u-code-export/` (read-only), performed to plan a Next.js rebuild. Nothing in `kisan4u-code-export` was modified to produce this document.

## 1. What Kisan4U is

Kisan4U is a multi-vendor agri-commerce marketplace serving four distinct customer/partner types on one product catalog:

- **Farmers** — the default retail customer segment (not a distinct table/role — see §5).
- **Dealers** — B2B buyers who get separate (usually bulk/wholesale) pricing, variations and stock, gated behind a KYC approval process.
- **Sellers / Vendors** — marketplace merchants who list and fulfill products, plus an in-house "admin as seller" channel.
- **Business Associates (BA)** — an affiliate/referral program layer with its own registration, KYC, commission and settlement workflow.

On top of this, there's a full admin back-office, a per-seller delivery-man workforce, POS (in-store sales), and India-specific compliance/logistics (GST, state-wise selling licenses for regulated categories, Delhivery courier integration).

## 2. Origin / tech stack

`backend-admin` is a **Laravel** application (PHP), built on the repository pattern (69 repository interfaces + implementations) with an event/listener notification pipeline. Internal code contains the string `'sixvalley'` as a default FCM topic name, and `composer.json` requires `nwidart/laravel-modules` with an empty `Modules/` directory — strong evidence this is a customized/rebranded fork of the **"6valley" multi-vendor CodeCanyon script** (confirmed further by `SOFTWARE_VERSION = '14.2'` and `PURCHASE_CODE`/`BUYER_USERNAME`/`SOFTWARE_ID` license-validation env vars). Kisan4U's dealer/BA/agri-compliance layer was built on top of that base.

`v1-frontend` is a **compiled React SPA** (Vite build, `react-router`-style client routing, JSX runtime detected in the minified bundle). Source is not available — only the built `assets/*.js`/`*.css`, `index.html`, sample `data/*.json` fixtures, and `figmaAssets/` images. All ~30 JS chunk files are byte-identical copies of one bundle (no real code-splitting), so any one of them is representative.

## 3. Scale snapshot

| Metric | Count |
|---|---|
| Route files | 15 (admin, dealer(stub), web, api/web/v1, rest_api v1/v1_old(dead)/v2/v3/v4, shared, channels, console, install, test, update) |
| Controllers | 326 (`Admin` 99, `Vendor` 36, `RestAPI` ~85 across v1-v4, `Api/Web/V1` 28, `Web` 22, `Customer` 13 legacy, `Auth` 6, `Payment_Methods` 16, `Dealer` 1) |
| Models | 102 |
| Migrations | 249 (incremental only — base `Schema::create()` for core tables like `users`/`orders`/`products` were not included in this export; schema was reconstructed from Eloquent models + migration diffs) |
| Services | 61 |
| Repositories | 69 (+69 interfaces) |
| Events / Listeners | 13 / 14 |
| Payment gateway controllers | 13 wired (of 32 keys defined) |

## 4. API surface & versions

All REST API groups mount under `/api/*` with the `api` guard (Laravel Passport OAuth2), per `RouteServiceProvider`:

| Version | Mount | Status | Purpose |
|---|---|---|---|
| `rest_api/v1/api.php` | `/api/v1` | **live** | General customer/mobile API — broadest feature set (auth, catalog, cart, orders, chat, wallet, loyalty, Invitation/virality, BA referees) |
| `rest_api/v1/api_old.php` | — | **dead** (never `require`d) | Historical snapshot of v1 minus Invitation + BA-referee groups |
| `rest_api/v2/api.php` | `/api/v2` | **live** | Legacy seller mobile API (superseded by v3) **+ the only live delivery-man API** (GPS tracking, OTP proof-of-delivery, cash collection, withdrawals) |
| `rest_api/v3/seller.php` | `/api/v3/seller` | **live** | Current seller mobile app — adds shop vacation mode, in-app POS, self-service coupons, seller-managed delivery-man staff |
| `rest_api/v4/api.php` | `/api/v4` | **live**, gated by custom `react` middleware | "React API Routes" — trims v1's BA/dealer/Invitation growth features, adds email-based auth, `common-track-order`, `visit-again-shops` |
| `api/web/v1.php` | `/api/web/v1` | **live, newest** | Clean RESTful customer/app API — this is the one the compiled `v1-frontend` actually calls (confirmed by base URL `https://admin.kisan4u.com` + full endpoint match) |

Evolution order inferred: v1 → v2 (seller+delivery) → v3 (seller replacement) → v4 (React) → `api/web/v1.php` (current, cleanest — best rebuild reference).

Session-based (non-API) surfaces: `admin/routes.php` (`admin` guard), `web/routes.php` (`web`/`customer`/`dealer` guards — `dealer/routes.php` itself is an empty stub), `vendor` panel views (via `Vendor` controllers, `seller` guard).

## 5. Identity & role model

Auth is **guard + table per role**, not one polymorphic table:

| Guard | Model | Table | Notes |
|---|---|---|---|
| `api` (Passport) | `User` | `users` | mobile/customer + dealer API |
| `web` / `customer` | `User` | `users` | storefront session |
| `dealer` | `User` | `users` | **same table as customer**, split by `isDealer` flag |
| `admin` | `Admin` | `admins` | back-office staff, RBAC via `admin_roles.module_access` |
| `seller` | `Seller` | `sellers` | vendor/shop owner (1:1 with `shops`) |
| *(none)* | `DeliveryMan` | `delivery_men` | custom `auth_token`, no Laravel guard; scoped to one `seller_id` each |

**There is no `farmers` table or role.** "Farmer" is marketing terminology for the default (non-dealer) segment of `users`. Confirmed directly in `Dealer/Auth/DealerLoginController`: a login attempt by a non-dealer user through the dealer flow returns message key `registered_farmer`. This split cascades into `products`, which carries a `product_for` enum (`farmer`/`dealer`/`both_farmer_dealer`) plus a full parallel set of `dealer_*` pricing/tax/stock/variation columns — effectively **two catalogs (B2C + B2B) on one products table**.

A fifth identity, **Business Associate (BA)**, is layered on top via `users.isBA` + a `bas` profile table (KYC, bank details, auto-generated `CSP-YYYYMMDD-####` code) — an affiliate/referral role, not a guard.

`App\Models\Customer` exists in code but is dead/unused — `User` is the real customer+dealer entity.

## 6. Order & refund lifecycle (ground truth for the rebuild)

**Order status** (plain string, no DB enum): `pending → confirmed → processing → out_for_delivery → delivered`, with branches to `returned`, `failed`, or `canceled` at any point. Initial status is `confirmed` if payment succeeded at checkout, else `pending`. Every transition writes an `order_status_histories` row and fires `OrderStatusEvent` (drives email/SMS/push).

**Payment status**: binary `unpaid`/`paid`. A `partial_paid_amount` column exists on `orders`, suggesting partial-payment support at the data level (partial-COD is a real checkout option) without a distinct status string.

**Refund status** (`refund_requests.status`, mirrored numerically 0-4 on `order_details.refund_request`): `(none) → pending → approved|rejected → refunded` (terminal — no further changes once refunded). On `refunded`, the paying wallet (admin `inhouse_earning` or seller `total_earning`) is debited and a `RefundTransaction` logged.

**Money movement on `delivered`**: `OrderRepository::manageWalletOnOrderStatusChange()` splits revenue into Admin wallet (commission), Seller wallet (earnings), and Delivery-man wallet (delivery charge + COD cash-in-hand). Sellers/delivery-men later request payout via `WithdrawRequest`, approved by admin.

Checkout is **multi-vendor split**: one cart/checkout produces **one `orders` row per seller**, linked by a shared `order_group_id`.

## 7. Third-party integrations found

| Category | Findings |
|---|---|
| **Payment** | 13 gateways wired (Razorpay primary/most-iterated, Stripe, PayPal, Paytm, PayU, SSLCommerz [hand-rolled, MD5-signed callbacks], Flutterwave, Bkash, LiqPay, MercadoPago, Paymob, Paystack, Paytabs, SenangPay) + COD, offline/manual, wallet, partial-COD. 19 more gateway keys defined but unwired. **No PhonePe or Cashfree.** |
| **SMS/OTP** | 6 providers, DB-configured priority fallback: Twilio, Nexmo/Vonage, 2Factor, Nimbus (India DLT-compliant), Msg91, Releans. |
| **WhatsApp** | No real API — just a click-to-chat widget (phone + `wa.me` link). One unused customer preference flag. `api/web/v1.php` also references an Interakt (WhatsApp Business API) webhook. |
| **Push** | Legacy FCM HTTP API (`fcm.googleapis.com/fcm/send`, server-key auth stored in DB, not `.env`). `FIREBASE_PROJECT_ID`/`FIREBASE_CREDENTIALS` env vars exist but appear unused (no FCM v1/OAuth2 code found). |
| **Shipping/logistics** | Delhivery (primary — webhook handler, tracking on `orders`) + Shiprocket (thin, list-orders only, login unimplemented). |
| **File storage** | Local disk + real AWS S3 support (S3-compatible custom endpoint). |
| **Realtime** | Pusher config present (chat / live notifications), also Redis/log/null broadcast drivers. |
| **Frontend analytics** | Google Analytics (`gtag`) + Facebook Pixel confirmed in the compiled bundle. Google Translate widget used for multilingual support (not native i18n on the frontend). |

## 8. Security note (do not port/reuse)

`config/delhivery.php` hardcodes what appear to be **real Delhivery API bearer tokens** as `env()` fallback defaults, under env-variable names that contain spaces (`'KISAN4U500g SURFACE'`) — invalid `.env` syntax, meaning the fallback hardcoded value is *always* what gets used, in every environment. These look like live production credentials baked into source. **Do not copy these values anywhere in the new project**; flag to the client for rotation. Everything else reviewed (`.env.example`, `DemoConstant.php` seed credentials, Shiprocket config defaults) is clearly placeholder/fake and safe to reference.

## 9. Known dead code / gaps (don't try to replicate these as designed)

- `rest_api/v1/api_old.php` — never mounted, dead file.
- `routes/dealer/routes.php` — empty stub; real dealer web routes live under `web/routes.php` prefix `dealer`.
- `Modules/` — empty; `nwidart/laravel-modules` scaffolding present but no addon module code shipped.
- `App\Models\Customer` — unused; `User` is the real customer/dealer model.
- `shipping_addresses` vs `billing_addresses` — two separate, near-duplicate tables (the former already has an `is_billing` flag) — legacy duplication, not an intentional design to replicate.
- `delivery_histories` model — empty stub, no recoverable columns.
- Many controller folders contain dated backup files (`*-DDMMYYYY.php`, `*_old.php`, `*_live_backup.php`) — always the un-suffixed file is live.

## 10. Compiled frontend (v1-frontend) findings

- API base: `https://admin.kisan4u.com`, all endpoints under `/api/web/v1/*` — matches the newest backend API group above.
- Client route table (react-router): home `/`, listing `/listing?category=`, product detail `/products/:slug`, checkout, 3 distinct OTP login flows (`/login/mobile`+`/login/otp` customer, `/dealer/otp` dealer, `/ba/otp` BA), 2 registration wizards (`/register/dealer/*` with KYC docs + pending state, `/seller/join`→`/apply`→`/otp`→`/status` with GST/address/bank/license), account area (profile/orders/wishlist/wallet/bank-details/saved-addresses), support/chat, BA area (`/ba/referees`, `/ba/referee-orders`, `/ba/refer`), general `/refer`, and CMS policy pages.
- No dedicated order-tracking route — tracking appears to live inside order-detail, not a standalone page.
- Sample `data/*.json` fixtures give ground-truth response shapes for header/footer, homepage sections, product listing, filters, and product detail (including the dual farmer/dealer pricing fields, variants, reviews with rating histogram, coupons, "more details" HTML blocks). These were used directly in `DATABASE_MODEL_PLAN.md`.

## 11. Key takeaways for the rebuild

1. **Role model to simplify**: collapse the legacy guard-per-table pattern into one `users` table with a `role`/`customerType` and per-role profile tables (dealer profile, seller profile, BA profile) — see `DATABASE_MODEL_PLAN.md`.
2. **Dual pricing is the core domain concept** — every product surface (listing, detail, cart, order line) needs a farmer-price and a dealer-price side by side; model this as a normalized per-segment pricing/variant table, not duplicated columns.
3. **Multi-vendor order splitting** (one checkout → N orders by seller, `order_group_id`) is structural, not incidental — the new order model must support it from day one.
4. **Order/payment/refund state machines** are well-defined and should be ported as real enums (they were ad hoc strings in Laravel).
5. **All third-party integrations must be mocked locally** per project constraints — build thin provider interfaces (SMS, push, payment, WhatsApp) with console/log implementations, swappable later.
6. Treat `api/web/v1.php` + the compiled frontend's data shapes as the **primary reference** for the customer-facing API contract; treat the Admin/Vendor controllers as the reference for back-office feature scope.
