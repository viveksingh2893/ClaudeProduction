# Kisan4U — Database Model Plan (Next.js rebuild)

This is a **proposed** normalized schema for the rebuild, not a copy of the legacy schema. It's informed by the legacy structure (see `EXISTING_SYSTEM_ANALYSIS.md` §5-6 and the models research) but deliberately fixes known legacy issues:

- Collapses the guard-per-table identity pattern into one `User` table + role-specific profile tables.
- Replaces the duplicated `dealer_*` columns on `products` with a normalized per-segment pricing table.
- Merges `shipping_addresses`/`billing_addresses` (legacy near-duplicates) into one `Address` table with a `type` field.
- Turns ad hoc string statuses (`order_status`, `payment_status`, `refund status`) into real enums.
- Unifies the four parallel wallet+ledger table pairs into one generic `Wallet` + `WalletTransaction` pattern with an `ownerType`/`ownerId` polymorphic reference.

Presented as illustrative Prisma-style models — adjust exact syntax during implementation; the point is the shape and relations, not final DDL.

## 1. Identity & Roles

```prisma
enum UserRole {
  CUSTOMER   // "farmer" in legacy marketing language — default segment
  DEALER
  SELLER
  BUSINESS_ASSOCIATE
  ADMIN
  DELIVERY_MAN
}

model User {
  id            String   @id @default(cuid())
  phone         String?  @unique
  email         String?  @unique
  passwordHash  String?          // null for OTP-only roles
  name          String
  role          UserRole @default(CUSTOMER)
  isPhoneVerified Boolean @default(false)
  isEmailVerified Boolean @default(false)
  referralCode  String   @unique
  referredById  String?
  referredBy    User?    @relation("Referral", fields: [referredById], references: [id])
  referrals     User[]   @relation("Referral")
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())

  dealerProfile   DealerProfile?
  sellerProfile   SellerProfile?
  baProfile       BusinessAssociateProfile?
  adminProfile    AdminProfile?
  deliveryProfile DeliveryManProfile?

  addresses     Address[]
  wallet        Wallet?
  cartItems     CartItem[]
  wishlistItems WishlistItem[]
  orders        Order[]
  reviews       Review[]
  notificationPrefs NotificationPreference?
}

model DealerProfile {
  id            String   @id @default(cuid())
  userId        String   @unique
  user          User     @relation(fields: [userId], references: [id])
  kycStatus     KycStatus @default(NOT_SUBMITTED)
  gstNumber     String?
  gstDocUrl     String?
  licenseNumber String?
  licenseDocUrl String?
  storeName     String?
  storeAddress  String?
  city          String?
  state         String?
  pincode       String?
  isUnregistered Boolean @default(false)
  rejectionReason String?
}

enum KycStatus { NOT_SUBMITTED DOCUMENTS_UPLOADED PENDING_REVIEW APPROVED REJECTED }

model SellerProfile {
  id             String   @id @default(cuid())
  userId         String   @unique
  user           User     @relation(fields: [userId], references: [id])
  shopName       String
  slug           String   @unique
  gstNumber      String?
  gstDocUrl      String?
  bankName       String?
  accountHolder  String?
  accountNumber  String?
  panDocUrl      String?
  status         SellerStatus @default(PENDING)
  commissionPercent    Decimal @default(0)
  dealerCommissionPercent Decimal @default(0)
  minOrderAmount Decimal  @default(0)
  freeDeliveryOverAmount Decimal?
  vacationStart  DateTime?
  vacationEnd    DateTime?
  vacationNote   String?
  isTemporarilyClosed Boolean @default(false)
  bannerUrl      String?
  offerBannerUrl String?

  products       Product[]
  shippingMethods ShippingMethod[]
  deliveryMen    DeliveryManProfile[]
  warehouses     Warehouse[]
  licenses       SellerLicense[]
  coupons        Coupon[]
  marketingPlan  SellerMarketingPlan?
}

enum SellerStatus { PENDING APPROVED REJECTED SUSPENDED }

model BusinessAssociateProfile {
  id          String  @id @default(cuid())
  userId      String  @unique
  user        User    @relation(fields: [userId], references: [id])
  cspCode     String  @unique   // e.g. CSP-20260722-0001
  pan         String?
  bankName    String?
  accountNumber String?
  ifscCode    String?
  status      BaStatus @default(PENDING)
  settlements BaSettlement[]
}

enum BaStatus { PENDING APPROVED REJECTED }

model BaSettlement {
  id        String   @id @default(cuid())
  baId      String
  ba        BusinessAssociateProfile @relation(fields: [baId], references: [id])
  fromDate  DateTime
  toDate    DateTime
  totalAmount   Decimal
  tdsAmount     Decimal
  paidAmount    Decimal
  createdAt DateTime @default(now())
}

model AdminProfile {
  id       String  @id @default(cuid())
  userId   String  @unique
  user     User    @relation(fields: [userId], references: [id])
  roleName String  // e.g. "Super Admin", "Support Staff"
  modulePermissions Json  // e.g. { orders: true, products: true, reports: false }
}

model DeliveryManProfile {
  id           String   @id @default(cuid())
  userId       String   @unique
  user         User     @relation(fields: [userId], references: [id])
  sellerId     String
  seller       SellerProfile @relation(fields: [sellerId], references: [id])
  identityDocUrl String?
  isOnline     Boolean  @default(false)
  orders       Order[]
}
```

## 2. Address (merges legacy `shipping_addresses` + `billing_addresses`)

```prisma
enum AddressType { SHIPPING BILLING }

model Address {
  id            String      @id @default(cuid())
  userId        String
  user          User        @relation(fields: [userId], references: [id])
  type          AddressType
  contactName   String
  phone         String
  line1         String
  city          String
  state         String
  country       String
  zip           String
  latitude      Float?
  longitude     Float?
  isDefault     Boolean     @default(false)
}
```

## 3. Catalog (dual farmer/dealer pricing normalized)

```prisma
model Category {
  id         String     @id @default(cuid())
  name       String
  slug       String     @unique
  icon       String?
  parentId   String?
  parent     Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children   Category[] @relation("CategoryTree")
  position   Int        @default(0)
  showOnHome Boolean    @default(false)
  isRegulated Boolean   @default(false)  // gates SellerLicense requirement (legacy hardcoded category IDs 25/26)
}

model Brand {
  id     String @id @default(cuid())
  name   String
  imageUrl String?
  isActive Boolean @default(true)
}

model Product {
  id            String   @id @default(cuid())
  sellerId      String?  // null = in-house/admin product
  seller        SellerProfile? @relation(fields: [sellerId], references: [id])
  name          String
  slug          String   @unique
  categoryId    String
  category      Category @relation(fields: [categoryId], references: [id])
  brandId       String?
  brand         Brand?   @relation(fields: [brandId], references: [id])
  productFor    ProductAudience @default(FARMER)
  description   String
  ingredients   String?
  howToUse      String?
  thumbnailUrl  String
  imageUrls     String[]
  unit          String   // e.g. "kg", "litre", "packet"
  status        ProductStatus @default(DRAFT)
  approvalStatus ApprovalStatus @default(PENDING) // seller-submitted products
  metaTitle     String?
  metaDescription String?

  pricing       ProductPricing[]   // one row per audience segment (FARMER / DEALER)
  variants      ProductVariant[]
  reviews       Review[]
  tags          Tag[]              @relation("ProductTags")
  states        String[]           // shippable states
}

enum ProductAudience { FARMER DEALER BOTH }
enum ProductStatus { DRAFT ACTIVE INACTIVE }
enum ApprovalStatus { PENDING APPROVED REJECTED }

// Replaces legacy duplicated dealer_* columns on products with one row per segment.
model ProductPricing {
  id             String   @id @default(cuid())
  productId      String
  product        Product  @relation(fields: [productId], references: [id])
  audience       ProductAudience   // FARMER or DEALER row
  purchasePrice  Decimal
  unitPrice      Decimal
  discount       Decimal  @default(0)
  discountType   DiscountType @default(FLAT)
  taxPercent     Decimal  @default(0)
  minOrderQty    Int      @default(1)
  multiplyQty    Int      @default(1)
  currentStock   Int      @default(0)

  @@unique([productId, audience])
}

enum DiscountType { FLAT PERCENT }

model ProductVariant {
  id            String   @id @default(cuid())
  productId     String
  product       Product  @relation(fields: [productId], references: [id])
  audience      ProductAudience
  optionLabel   String   // e.g. "5kg", "10kg"
  purchasePrice Decimal
  price         Decimal
  stock         Int      @default(0)
}

model Tag {
  id       String    @id @default(cuid())
  name     String    @unique
  products Product[] @relation("ProductTags")
}

model Review {
  id            String   @id @default(cuid())
  productId     String?
  product       Product? @relation(fields: [productId], references: [id])
  deliveryManId String?  // reviews table is shared for product + delivery-man ratings in legacy; kept separate here for clarity — see note below
  customerId    String
  customer      User     @relation(fields: [customerId], references: [id])
  orderId       String?
  rating        Int
  comment       String?
  attachmentUrl String?
  isApproved    Boolean  @default(false)
}
```
Note: legacy reuses one `reviews` table for both product reviews and delivery-man ratings via nullable FKs. Recommend splitting into `ProductReview` and `DeliveryManRating` in the rebuild for clarity — shown combined above only for reference parity; split before implementation.

## 4. Cart & Wishlist

```prisma
model CartItem {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id])
  cartGroupId    String   // groups items by seller for checkout splitting
  productId      String
  variantId      String?
  quantity       Int
  priceSnapshot  Decimal  // price at time of add, audience-aware
  createdAt      DateTime @default(now())
}

model WishlistItem {
  id        String @id @default(cuid())
  userId    String
  user      User   @relation(fields: [userId], references: [id])
  productId String
  @@unique([userId, productId])
}
```

## 5. Orders

```prisma
enum OrderStatus { PENDING CONFIRMED PROCESSING OUT_FOR_DELIVERY DELIVERED RETURNED FAILED CANCELED }
enum PaymentStatus { UNPAID PARTIALLY_PAID PAID }
enum PaymentMethod { COD RAZORPAY WALLET PARTIAL_COD OFFLINE }

model Order {
  id              String   @id @default(cuid())
  orderNumber     String   @unique
  orderGroupId    String   // shared across sibling orders from one checkout (multi-seller split)
  customerId      String
  customer        User     @relation(fields: [customerId], references: [id])
  sellerId        String?  // null = in-house
  seller          SellerProfile? @relation(fields: [sellerId], references: [id])
  deliveryManId   String?
  deliveryMan     DeliveryManProfile? @relation(fields: [deliveryManId], references: [id])

  status          OrderStatus @default(PENDING)
  paymentStatus   PaymentStatus @default(UNPAID)
  paymentMethod   PaymentMethod
  partialPaidAmount Decimal?

  shippingAddressId String
  shippingAddress   Address @relation("ShippingAddr", fields: [shippingAddressId], references: [id])
  billingAddressId  String
  billingAddress    Address @relation("BillingAddr", fields: [billingAddressId], references: [id])

  subtotal        Decimal
  shippingCost    Decimal  @default(0)
  taxAmount       Decimal  @default(0)
  discountAmount  Decimal  @default(0)
  couponCode      String?
  couponDiscountBearer CouponBearer?
  adminCommission Decimal  @default(0)
  totalAmount     Decimal

  courierName     String?  // "delhivery" | "shiprocket" | null
  courierTrackingId String?
  waybill         String?

  items           OrderItem[]
  statusHistory   OrderStatusHistory[]
  refundRequests  RefundRequest[]

  createdAt       DateTime @default(now())
}

enum CouponBearer { ADMIN SELLER }

model OrderItem {
  id            String   @id @default(cuid())
  orderId       String
  order         Order    @relation(fields: [orderId], references: [id])
  productId     String
  productSnapshot Json   // name/image/price at time of order
  variantId     String?
  quantity      Int
  unitPrice     Decimal
  taxAmount     Decimal  @default(0)
  discountAmount Decimal @default(0)
  refundStatus  RefundStatus @default(NONE)
}

model OrderStatusHistory {
  id        String   @id @default(cuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id])
  status    OrderStatus
  changedById String
  changedByRole UserRole
  note      String?
  createdAt DateTime @default(now())
}
```

## 6. Coupons

```prisma
model Coupon {
  id            String   @id @default(cuid())
  code          String   @unique
  bearer        CouponBearer
  sellerId      String?
  seller        SellerProfile? @relation(fields: [sellerId], references: [id])
  discountType  DiscountType
  discountValue Decimal
  minPurchase   Decimal  @default(0)
  maxDiscount   Decimal?
  usageLimit    Int?
  perUserLimit  Int?
  startDate     DateTime
  endDate       DateTime
  redemptions   CouponRedemption[]
}

model CouponRedemption {
  id        String @id @default(cuid())
  couponId  String
  coupon    Coupon @relation(fields: [couponId], references: [id])
  userId    String
  orderId   String
  discountAmount Decimal
  createdAt DateTime @default(now())
}
```

## 7. Refunds

```prisma
enum RefundStatus { NONE PENDING APPROVED REJECTED REFUNDED }

model RefundRequest {
  id            String   @id @default(cuid())
  orderId       String
  order         Order    @relation(fields: [orderId], references: [id])
  orderItemId   String
  customerId    String
  status        RefundStatus @default(PENDING)
  reason        String
  imageUrls     String[]
  amount        Decimal
  reviewNote    String?
  reviewedById  String?
  history       RefundStatusHistory[]
  createdAt     DateTime @default(now())
}

model RefundStatusHistory {
  id              String  @id @default(cuid())
  refundRequestId String
  refundRequest   RefundRequest @relation(fields: [refundRequestId], references: [id])
  status          RefundStatus
  changedById     String
  changedByRole   UserRole
  message         String?
  createdAt       DateTime @default(now())
}
```

## 8. Wallets (unifies 4 legacy wallet pairs into one polymorphic pattern)

```prisma
enum WalletOwnerType { CUSTOMER SELLER ADMIN DELIVERY_MAN }
enum TransactionType { CREDIT DEBIT }
enum TransactionReason {
  ORDER_COMMISSION ORDER_EARNING DELIVERY_CHARGE COD_COLLECTION
  REFUND_DEBIT REFUND_CREDIT WALLET_TOPUP WITHDRAWAL LOYALTY_BONUS REFERRAL_COMMISSION
}

model Wallet {
  id           String   @id @default(cuid())
  ownerType    WalletOwnerType
  ownerId      String   @unique
  balance      Decimal  @default(0)
  cashInHand   Decimal  @default(0)   // delivery-man COD cash, unused for other owner types
  loyaltyPoints Int     @default(0)   // customer/dealer only
  pendingWithdraw Decimal @default(0)
  transactions WalletTransaction[]
}

model WalletTransaction {
  id        String   @id @default(cuid())
  walletId  String
  wallet    Wallet   @relation(fields: [walletId], references: [id])
  type      TransactionType
  reason    TransactionReason
  amount    Decimal
  balanceAfter Decimal
  referenceType String?  // "order" | "refund" | "withdraw_request"
  referenceId   String?
  createdAt DateTime @default(now())
}

model WithdrawRequest {
  id        String   @id @default(cuid())
  ownerType WalletOwnerType
  ownerId   String
  amount    Decimal
  status    WithdrawStatus @default(PENDING)
  methodDetails Json
  reviewedById String?
  createdAt DateTime @default(now())
}

enum WithdrawStatus { PENDING APPROVED REJECTED PAID }
```

## 9. Shipping & Logistics

```prisma
model ShippingMethod {
  id         String   @id @default(cuid())
  sellerId   String?  // null = admin-defined, platform-wide
  seller     SellerProfile? @relation(fields: [sellerId], references: [id])
  title      String
  cost       Decimal
  durationDays Int
  isActive   Boolean  @default(true)
}

model Warehouse {
  id       String @id @default(cuid())
  sellerId String
  seller   SellerProfile @relation(fields: [sellerId], references: [id])
  name     String
  address  String
  city     String
  state    String
  pincode  String
}

model SellerLicense {
  id          String   @id @default(cuid())
  sellerId    String
  seller      SellerProfile @relation(fields: [sellerId], references: [id])
  scope       LicenseScope
  state       String?
  licenseType String
  licenseNumber String
  docUrl      String
  expiryDate  DateTime
  status      LicenseStatus @default(PENDING)
  rejectionReason String?
}

enum LicenseScope { STATE COMMON }
enum LicenseStatus { PENDING APPROVED REJECTED EXPIRED }
```

## 10. Notifications

```prisma
model NotificationPreference {
  id       String  @id @default(cuid())
  userId   String  @unique
  user     User    @relation(fields: [userId], references: [id])
  smsEnabled   Boolean @default(true)
  whatsappEnabled Boolean @default(false)
  pushEnabled  Boolean @default(true)
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  title     String
  body      String
  imageUrl  String?
  isRead    Boolean  @default(false)
  createdAt DateTime @default(now())
}
```

## 11. Support & CMS

```prisma
model SupportTicket {
  id         String  @id @default(cuid())
  customerId String
  subject    String
  category   String
  priority   TicketPriority @default(MEDIUM)
  status     TicketStatus @default(OPEN)
  messages   SupportMessage[]
}

enum TicketPriority { LOW MEDIUM HIGH }
enum TicketStatus { OPEN IN_PROGRESS RESOLVED CLOSED }

model SupportMessage {
  id         String  @id @default(cuid())
  ticketId   String
  ticket     SupportTicket @relation(fields: [ticketId], references: [id])
  senderRole UserRole
  senderId   String
  message    String
  attachmentUrl String?
  createdAt  DateTime @default(now())
}

model ContentPage {
  id        String  @id @default(cuid())
  slug      String  @unique  // "privacy-policy" | "terms" | "about-us" | ...
  title     String
  bodyHtml  String
  updatedAt DateTime @updatedAt
}
```

## 12. Migration notes vs. legacy

| Legacy pattern | Rebuild decision | Why |
|---|---|---|
| 6 guards / 3-4 tables (`users`, `admins`, `sellers`, implicit dealer) | 1 `User` table + role enum + per-role profile tables | Simpler auth, one identity, easier RBAC |
| `products.dealer_*` duplicated columns (15+ columns) | `ProductPricing` table, one row per audience | Normalized, extensible to future segments |
| `shipping_addresses` + `billing_addresses` (near-duplicate) | Single `Address` + `type` enum | Removes legacy duplication bug |
| String `order_status`/`payment_status`, no DB enum | Real Prisma enums | Type safety, matches actual observed value set exactly |
| 4 separate wallet+ledger table pairs (customer/admin/seller/delivery-man) | 1 `Wallet` + `WalletTransaction`, polymorphic `ownerType` | One settlement code path instead of four near-identical ones |
| `refund_requests.status` string + numeric mirror on `order_details.refund_request` | Single `RefundStatus` enum, referenced directly on `OrderItem` | Removes the dual-representation bug |
| Delhivery/Shiprocket fields inlined on `orders` | Kept minimal (courier name/tracking/waybill) on `Order`; provider-specific payloads go in a `CourierSyncLog` table (add if needed in Phase 8) | Keep `Order` lean; courier detail is operational, not core |

## 13. Seed data plan (local dev only — no production data)

Seed script should create, per project rule #4 ("Use only dummy local data initially"):
- 1 admin user, 2-3 sellers (approved), 1 pending dealer + 1 approved dealer, a handful of farmer/customer accounts, 1 delivery man per seller, 1 BA.
- ~5 categories (matching the frontend's visible tiles: farm-machinery, plant nutrients, plant protection, irrigation, seeds), a few brands.
- 15-20 products with both FARMER and DEALER `ProductPricing` rows and 2-3 variants each, images pointed at local placeholder assets (not the production CDN URLs found in the compiled frontend).
- A few coupons, a flash deal, sample orders across every `OrderStatus` value (so the admin/seller UI has data to render for each state), one refund request in each `RefundStatus`.
