# Kisan4U — Module List

Complete inventory of functional modules found in the reference system, grouped by domain. "Surfaces" notes where each module is exposed today (Admin panel, Seller/Vendor panel, Dealer, Customer web/API, Delivery Man app, POS). Use this as the feature checklist when scoping the Next.js rebuild.

## 1. Identity & Access
- Customer/Farmer auth (phone OTP, send/resend/verify) — *Customer web+API*
- Dealer auth (phone OTP) + KYC submission (GST, license, store docs, 2 extra doc slots) + approval pipeline (`null → personal_detail → pending → approved/rejected`) — *Dealer web+API, Admin (approve/manage)*
- Seller/Vendor auth (email+password, register/login/forgot-password) + staged onboarding wizard (register → GST details → address → bank details → license details → SSO login) — *Seller web+API, Admin (approve/manage)*
- Business Associate (BA) auth (phone OTP) + registration + KYC (PAN, bank, IFSC) — *Customer API, Admin (settlement/commission mgmt)*
- Admin/Employee auth (email+password) + Custom Role builder (module-based RBAC: product/order/promotion/user/report/support/system-settings/POS access) — *Admin*
- Delivery Man auth (custom token, no session guard), seller-scoped — *Delivery Man app, Seller (manage own staff), Admin (manage all)*
- Social login (Google/Facebook/Twitter config present) — *Customer*
- Guest identity (guest-token, guest cart) — *Customer web+API*

## 2. Catalog & Merchandising
- Categories (3-level: category/sub-category/sub-sub-category, self-referential tree) — *Admin, Customer*
- Brands, Attributes, Colors, Tags — *Admin, Customer*
- Products — dual farmer/dealer pricing, purchase price, tax, discount, stock, variations/choice-options, digital vs physical, per-state deliverability, regulated-category license gating — *Admin, Seller (submit for approval), Customer, Dealer*
- Product reviews (+ rating histogram) — *Customer, Admin (moderate)*
- Product Price Inquiry (B2B ask-for-quote) — *Customer/Dealer, Admin, Seller*
- Wishlist, Recently Viewed, Product Compare — *Customer*
- Shop follow — *Customer*
- Flash Deals, Deal of the Day, Featured Deals, Most Demanded — *Admin, Customer*
- Banners (platform-wide, product deep-link) + Vendor Banners (per-shop) — *Admin, Seller, Customer*
- Coupons (admin-issued or seller-issued, usage limits, min purchase, max discount) — *Admin, Seller, Customer*
- Bulk product import — *Admin*

## 3. Cart & Checkout
- Cart (grouped by seller via `cart_group_id`, guest cart support) — *Customer*
- Cart shipping calculation per group — *Customer*
- Multi-address book (shipping + billing) — *Customer*
- Coupon apply/remove at checkout — *Customer*
- Checkout summary / checkout-complete — *Customer*

## 4. Order Management
- Order placement (COD, wallet, gateway, offline/manual, partial-COD) — *Customer*
- Multi-vendor order split (1 checkout → N orders by seller, `order_group_id`) — *system*
- Order status transitions + full audit history (`order_status_histories`) — *Admin, Seller*
- Expected delivery date tracking/history — *Admin, Seller*
- Delivery-man assignment — *Admin, Seller*
- Order cancel — *Customer, Admin, Seller*
- Order tracking (in-order-detail, no standalone page in reference frontend) — *Customer*
- Invoice / packing-slip PDF generation — *Admin*
- 3rd-party courier sync: Delhivery (send-to-delhivery, webhook, waybill tracking), Shiprocket (list orders) — *Admin*
- Manual settlement (batch seller payouts from `order_transactions`) — *Admin*
- Digital product OTP-gated download — *Customer*
- POS (in-store order creation) — *Admin, Seller*

## 5. Payments
- Gateways: Razorpay (primary), Stripe, PayPal, Paytm, PayU, SSLCommerz, Flutterwave, Bkash, LiqPay, MercadoPago, Paymob, Paystack, Paytabs, SenangPay — *Customer checkout, Admin (config)*
- Cash on Delivery — *Customer*
- Offline/manual payment (bank transfer + proof upload) — *Customer, Admin (verify)*
- Wallet payment — *Customer*
- Partial-COD (pay % online, rest COD) — *Customer*
- Payment method admin configuration (live/test credentials, enable/disable) — *Admin*

## 6. Refunds & Returns
- Refund request (post-delivery, day-limit gated, dedupe check) — *Customer*
- Refund review/approve/reject — *Admin, Seller (locked out once admin acts)*
- Refund transaction ledger + wallet debit on `refunded` — *system*
- Refund status history/audit — *system*
- Return-order flow — *Customer*

## 7. Wallets & Payouts
- Customer wallet (balance + loyalty/royalty points, ledger) — *Customer*
- Admin wallet (commission earned, delivery-charge earned, tax collected) — *Admin*
- Seller wallet (total earning, withdrawn, pending withdraw, collected cash, tax collected) — *Seller, Admin*
- Delivery-man wallet (balance + cash-in-hand from COD collection, pending withdraw) — *Delivery Man, Seller, Admin*
- Withdraw/payout requests + configurable withdrawal methods — *Seller, Delivery Man, Admin (approve)*
- Add-fund bonus tiers (promotional wallet top-up bonuses) — *Admin*
- Loyalty points (separate from money; e.g. earned by dealers on delivery) — *Customer/Dealer*

## 8. Delivery & Logistics
- Delivery Man management (per-seller staff, CRUD) — *Seller, Admin*
- Delivery Man cash-collection tracking (COD) — *Delivery Man, Seller, Admin*
- Delivery Man GPS tracking + OTP proof-of-delivery — *Delivery Man app*
- Delivery Man emergency contacts, chat — *Delivery Man, Seller*
- Shipping methods (admin- or seller-defined, cost + duration) — *Admin, Seller*
- Shipping types per seller — *Seller*
- Seller logistics fees (weight-banded courier charge matrix) — *Admin*
- Category-level shipping cost overrides — *Admin*
- Delivery restriction by country/zip — *Admin*
- Warehouses (physical stock locations per seller) — *Admin, Seller*
- Selling Licenses (state-wise, regulated categories e.g. pesticide/fertilizer, expiry-tracked, approval workflow) — *Seller (apply), Admin (approve)*

## 9. Referral / BA / Growth
- General "Refer & Earn" (any user, `referral_code`) — *Customer*
- Business Associate program: registration, CSP code, commission tracking, referee list, referee-orders, settlement batches, TDS handling — *Customer (become BA), Admin (settle/manage)*
- SMS contact-invitation ("Invitation" virality feature, v1 API) — *Customer*
- Seller marketing plans (subscription tiers with feature sets, pricing, duration) — *Seller (subscribe), Admin (manage plans/approve)*

## 10. Notifications
- Push notifications (legacy FCM HTTP, per-user tokens on User/Seller/DeliveryMan) — *system → Customer/Seller/Delivery Man*
- SMS (6-provider fallback chain) — *system*
- Email (order lifecycle: placed/confirmed/delivered wired; dispatched/out-for-delivery templates exist but unwired; wallet, verification, password reset, license status) — *system*
- WhatsApp click-to-chat widget (no send API) — *Customer*
- Notification templates (localized, keyed by event) — *Admin (manage)*
- User notification preferences (SMS/WhatsApp/push opt-in) — *Customer*
- In-app notification center + read receipts — *Customer, Seller, Admin*

## 11. Support & CMS
- Support tickets (threaded conversation, priority/status) — *Customer, Admin*
- Contact-us form — *Customer, Admin*
- Help topics / FAQ — *Admin (manage), Customer (view)*
- Live chat (customer ↔ delivery man) — *Customer, Delivery Man*
- CMS content pages (policy pages: privacy/terms/return/cancellation/shipping/user policy, about-us) — *Admin (manage), Customer (view)*
- Site UX review (general site rating, not tied to product/order) — *Customer*
- Blogs — *Admin, Customer*

## 12. Reporting & Analytics
- Order reports, product reports, stock reports, wishlist reports, seller-sales reports, transaction reports, refund-transaction reports — *Admin*
- Admin dashboard KPIs (order-status breakdown, earnings) — *Admin*
- Seller dashboard + seller order reports — *Seller*

## 13. Admin / System Settings
- Business settings (site pages, social media, i18n/language, theme marketplace, shipping method/type config, mail/SMTP, delivery restrictions, email templates) — *Admin*
- Currency management (multi-currency, ~140+ ISO currencies pre-defined) — *Admin*
- System settings (software-update/licensing check, environment config, database tools, file manager, sitemap) — *Admin*
- Third-party config (Google Maps, payment methods, reCAPTCHA, SMS module, social login, social chat) — *Admin*
- In-house shop (platform sells as first-party seller alongside marketplace) — *Admin*
- Theme features / theme-ratio image-spec management — *Admin*

## 14. Cross-cutting Notification Event Map (for reference)
| Event | Recipients | Channels |
|---|---|---|
| `OrderPlacedEvent` | Customer | Email, Push, SMS |
| `OrderReceivedNotifySellerEvent` | Seller | Email |
| `OrderStatusEvent` | Customer, Seller, Delivery Man | Push (all transitions) + Email (Confirmed/Delivered) + SMS |
| `RefundEvent` | Seller, Customer | Push |
| `AddFundToWalletEvent` | Customer | Email |
| `WithdrawStatusUpdateEvent` | Seller/Delivery Man | Push |
| `CashCollectEvent` | Delivery Man/Seller | Push |
