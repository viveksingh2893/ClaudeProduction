# Kisan4U — User Flow Map

End-to-end flows for every role, plus the core state machines, reconstructed from routes + controllers + the compiled frontend's route table and data fixtures.

## A. Customer / Farmer shopping flow

```
Browse (guest, /guest-token issued)
  → Product Listing (/listing?category=) / Search / Home sections
    → Product Detail (/products/:slug)  [farmer pricing shown by default]
      → Add to Cart (grouped by seller: cart_group_id)
        → Login required at checkout: /login → /login/mobile → /login/otp (phone OTP, no password)
          → Cart review (multi-seller groups, per-group shipping)
            → Apply coupon (optional)
              → Choose address (saved or new; shipping + billing)
                → Choose payment method: COD | Razorpay | Wallet | Partial-COD | Offline/manual
                  → Place order → ONE order row created PER SELLER (shared order_group_id)
                    → Order confirmation / checkout-complete
                      → Track status inside Order Detail (pending→confirmed→processing→out_for_delivery→delivered)
                        → [optional] Refund/Return request (only after delivered, within refund_day_limit)
```
Also available at any point: Wishlist, Recently Viewed, Product Compare, Reviews, general Refer & Earn, Wallet/Bank Details, Support/Chat, CMS policy pages.

## B. Dealer flow

```
/register/dealer
  → submit personal + business details
    → /register/dealer/documents — upload GST doc, license doc, 2 extra doc slots, store info
      → /register/dealer/pending (dealer_kyc_status = 'pending')
        → Admin reviews (Admin > Customer > Dealer list/view) → approved | rejected
          → [approved] /dealer/otp login (phone OTP, same guard mechanics as customer)
            → isDealer=1 now drives:
                - product pricing/variants switch to dealer_* columns
                - dealer-only minimum order qty, dealer discount tiers
                - loyalty points credited on delivered orders
            → shops normal checkout flow (§A) but with dealer pricing throughout
```
Non-dealer users attempting the dealer login path receive `registered_farmer` — i.e. dealer and farmer share the same login mechanics, differentiated only by the `isDealer` flag and KYC gate.

## C. Seller / Vendor onboarding & selling flow

```
/seller/join → /seller/apply
  → collect: business info, GST details, address details, bank details, license details (staged wizard)
    → /seller/login → /seller/otp (or email+password for the web panel)
      → /seller/status (pending admin approval)
        → Admin approves (Admin > Vendors) → seller.status = 'approved'
          → Seller panel access unlocked:
              - Product submission (request_status: pending → approved/denied by Admin)
              - Shop branding (banner, offer banner, vacation mode, temporary close)
              - Coupons (seller-scoped), Shipping methods, Warehouses
              - Own Delivery Man staff (create, assign, pay)
              - License applications (state-wise, regulated categories)
              - POS (in-store sales)
              - Order management: view → update status → (on delivered) wallet credited
              - Refund handling: review request → approve/reject (locked out once admin acts)
              - Withdraw requests against seller_wallet.total_earning
              - Marketing plan subscription (tiered feature access)
```

## D. Business Associate (BA) referral flow

```
/register/ba → /register/ba/otp  (or promoted from an existing user's referral activity)
  → KYC: PAN, bank details, IFSC → bas row created, auto CSP-YYYYMMDD-#### code assigned
    → BA shares referral link/code (/ba/refer)
      → Referred users sign up (temp_refering captures pre-signup referral intent)
        → Referred users place orders
          → Commission accrues to BA (tracked via referee-orders, /ba/referee-orders)
            → Admin runs settlement batches (ba_settlements: total/paid/TDS amounts, date range)
              → BA requests payout (transfer_requests, auto TR-... id) → Admin approves
```
Distinct from the general "Refer & Earn" (`/refer`) available to every customer — BA is a formal, KYC'd affiliate tier with structured commission/settlement; general refer-and-earn is lighter-weight.

## E. Delivery Man flow

```
Seller creates Delivery Man account (seller-scoped, no independent signup)
  → Delivery Man logs in via custom auth_token (mobile app, RestAPI v2/v3)
    → Receives assigned orders (Admin or Seller assigns via addDeliveryMan)
      → Updates delivery status (GPS tracking, OTP proof-of-delivery on handoff)
        → On COD orders: collects cash → CashCollectEvent → deliveryman_wallet.cash_in_hand credited
          → On order delivered: deliveryman_wallet.current_balance credited (delivery charge)
            → Delivery Man requests withdrawal → Seller/Admin approves → WithdrawStatusUpdateEvent
```

## F. Admin operational flow (back-office)

```
Dashboard (KPIs: order-status breakdown, earnings)
  → Approve/reject: Sellers, Dealers, Products (seller-submitted), Licenses, Marketing plan subscriptions
  → Manage: Catalog (categories/brands/products/attributes), Promotions (coupons/deals/banners),
            Orders (status transitions, delivery-man assignment, courier sync), Refunds,
            Wallets (add funds, view ledgers), Reports, Support tickets, Employees & Custom Roles (RBAC),
            Business/System Settings, Payment gateway config, SMS/Push config
  → Settle: manual seller settlements (batch order_transactions → withdraw payouts)
```

## G. Order status state machine

```
                 ┌────────────┐
   place order → │  pending   │──────────────┐
                 └─────┬──────┘              │
         (payment paid)│                     │ (any status)
                        ▼                     ▼
                 ┌────────────┐        ┌────────────┐
                 │ confirmed  │        │  canceled  │  (terminal)
                 └─────┬──────┘        └────────────┘
                        ▼
                 ┌────────────┐
                 │ processing │
                 └─────┬──────┘
                        ▼
                 ┌──────────────────┐
                 │ out_for_delivery │
                 └─────┬─────────────┘
                        ▼
                 ┌────────────┐        ┌────────────┐
                 │ delivered  │──────▶ │  returned  │  (terminal)
                 └─────┬──────┘        └────────────┘
                        │
                        ▼
                 ┌────────────┐
                 │  failed    │  (terminal — delivery failed)
                 └────────────┘
```
Every transition writes `order_status_histories` and fires notification events (email/push/SMS per the table in MODULE_LIST.md §14). `delivered` is the trigger point for wallet settlement (`manageWalletOnOrderStatusChange`).

## H. Refund state machine

```
(no refund) ──customer requests──▶ pending ──admin/seller reviews──▶ approved ──┐
                                        │                                       │
                                        └────────────────────▶ rejected        │
                                                             (terminal)         ▼
                                                                            refunded
                                                                           (terminal —
                                                                        wallet debited,
                                                                     RefundTransaction logged)
```
Refund can only be requested after `delivered`, within a configurable `refund_day_limit`, and only once per order line (dedupe check). Vendor loses write access once Admin has acted on a request.

## I. Payment flow by method

- **COD**: order created with `payment_status=unpaid`, status starts `pending`; captured as cash at delivery, no gateway involved.
- **Online gateway (e.g. Razorpay)**: create gateway order → customer completes payment on gateway UI → verify/capture webhook or client callback → on success, `payment_status=paid`, order status set to `confirmed` immediately.
- **Wallet**: `customer_wallets.balance` debited synchronously at order placement; if insufficient, order rejected before creation.
- **Partial-COD**: configurable % paid online at checkout (via gateway), remainder collected as COD at delivery; often paired with a discount incentive.
- **Offline/manual**: customer uploads payment proof (`offline_payments.payment_info`); Admin manually verifies and flips `payment_status`.

## J. Notification flow

Every domain event (order placed, status changed, refund updated, wallet funded, withdrawal status changed, COD cash collected) is dispatched as a Laravel Event, caught by one or more Listeners, which fan out to Email / Push (FCM) / SMS based on business-setting toggles and the recipient's `users_notification_preferences`. See MODULE_LIST.md §14 for the full event→channel table. In the Next.js rebuild this whole pipeline should become one internal `NotificationDispatcher` service with pluggable channel providers (mocked locally).

## K. Money movement / settlement flow

```
Customer payment (any method) ──▶ Order + OrderDetail (per seller)
                                        │
                              status → delivered
                                        ▼
                     manageWalletOnOrderStatusChange()
                     ┌──────────────┬──────────────┬────────────────────┐
                     ▼              ▼              ▼                    ▼
              Admin wallet    Seller wallet   Delivery-man wallet   (coupon discount
             (commission)    (total_earning)  (charge + COD cash)   borne by inhouse
                                                                     or seller per
                                                                  coupon_discount_bearer)
                     │              │                  │
                     ▼              ▼                  ▼
              Admin can        Seller requests    Delivery-man requests
              withdraw         WithdrawRequest    WithdrawRequest
              anytime          → Admin approves   → Admin/Seller approves

  [Refund path, reverse leg]
  refund_requests → refunded ──▶ debit Admin or Seller wallet (whichever received it)
                              ──▶ RefundTransaction logged
                              ──▶ optionally credit Customer wallet (if wallet_add_refund setting on)
```
