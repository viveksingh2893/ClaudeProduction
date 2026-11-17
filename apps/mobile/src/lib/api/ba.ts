import { api } from "@/lib/api-client";
import { uploadFile, type PickedDocument } from "./dealer";

export type BaFrontendStatus =
  | "NOT_REGISTERED"
  | "PENDING"
  | "APPROVED_NO_BANK"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";

export type BaProfileDTO = {
  id: string;
  referralCode: string;
  frontendStatus: BaFrontendStatus;
  firstName: string;
  lastName: string;
  contactNumber: string;
  email: string;
  pincode: string;
  state: string;
  city: string;
  rejectedReason: string | null;
  /** Bank-detail (Form 2) status is tracked separately from frontendStatus
   * (see BaBankStatus's schema doc comment) — a BA can be permanently
   * "APPROVED" while a later bank-detail resubmission is rejected. */
  bankStatus: "NOT_SUBMITTED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  bankRejectionReason: string | null;
  bankSubmittedAt: string | null;
  bankReviewedAt: string | null;
  panNumber: string | null;
  bankName: string | null;
  bankBranch: string | null;
  accountHolderName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  panDocKey: string | null;
  chequeDocKey: string | null;
};

export type BaWalletDTO = {
  totalEarned: number;
  lockedPending: number;
  eligible: number;
  settled: number;
  reversed: number;
  recent: { id: string; kind: string; status: string; amount: number; createdAt: string }[];
};

export type BaDashboard =
  | { enabled: false }
  | {
      enabled: true;
      profile: BaProfileDTO | null;
      wallet: BaWalletDTO | null;
      pendingApprovals: { id: string; grandTotal: number; itemCount: number; createdAt: string }[];
    };

export function getBaDashboard() {
  return api.get<BaDashboard>("/api/mobile/v1/ba");
}

/** The signed-in account's own name / verified phone / email — used to pre-fill Form 1. */
export function getAccountContact() {
  return api.get<{
    user: {
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      email: string | null;
    };
  }>("/api/mobile/v1/auth/me");
}

export function submitBaForm1(input: {
  firstName: string;
  lastName: string;
  contactNumber: string;
  email: string;
  pincode: string;
  state: string;
  city: string;
}) {
  return api.post<{ baId: string }>("/api/mobile/v1/ba/form1", input);
}

export function submitBaForm2(input: {
  panNumber: string;
  panDocKey: string;
  bankName: string;
  bankBranch: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  chequeDocKey: string;
}) {
  return api.post<{ baId: string }>("/api/mobile/v1/ba/form2", input);
}

export function uploadBaDocument(doc: PickedDocument) {
  return uploadFile("/api/mobile/v1/ba/documents", doc, { auth: true });
}

export type ProposedOrderDetail = {
  id: string;
  status: string;
  grandTotal: number;
  addressSnapshot: Record<string, string>;
  items: {
    productName: string;
    variantLabel: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    imageUrl: string | null;
  }[];
  isReferee: boolean;
  baName: string;
  refereeName: string;
  refereePhone: string | null;
};

export function getProposedOrder(id: string) {
  return api.get<ProposedOrderDetail>(`/api/mobile/v1/ba/proposed-orders/${id}`);
}

export function decideProposedOrder(id: string, decision: "APPROVE" | "REJECT" | "CUSTOMIZE") {
  return api.post<{ checkoutGroupId: string | null }>(
    `/api/mobile/v1/ba/proposed-orders/${id}`,
    { decision },
  );
}

// --- Place an order for a referred customer ---------------------------------

export type BaReferredCustomer = {
  id: string;
  name: string;
  phone: string | null;
  addresses: { id: string; label: string }[];
};

/** Referred-customer picker — only customers who signed up with this BA's own code, each with their saved addresses. */
export function getBaReferredCustomers() {
  return api.get<{ customers: BaReferredCustomer[] }>("/api/mobile/v1/ba/referred-customers");
}

export type BaReferee = {
  id: string;
  name: string;
  phone: string | null;
  role: string;
  joinedAt: string;
  orderCount: number;
  orderValue: number;
};

export function getBaReferees() {
  return api.get<{ referees: BaReferee[] }>("/api/mobile/v1/ba/referees");
}

export type BaRefereeOrder = {
  id: string;
  orderNumber: string;
  checkoutGroupId: string;
  status: string;
  paymentMethod: string;
  createdAt: string;
  total: number;
  refereeFirstName: string | null;
  refereeLastName: string | null;
  refereePhone: string | null;
  placedByBa: boolean;
  items: {
    id: string;
    productName: string;
    variantLabel: string | null;
    quantity: number;
    imageUrl: string | null;
  }[];
};

export function getBaRefereeOrders() {
  return api.get<{ orders: BaRefereeOrder[] }>("/api/mobile/v1/ba/referee-orders");
}

export type BaProductResult = { productId: string; variantId: string | null; label: string };

export function searchBaProducts(query: string) {
  return api.get<{ results: BaProductResult[] }>(
    `/api/mobile/v1/ba/products?q=${encodeURIComponent(query)}`,
  );
}

export type ProposedOrderAddressInput = {
  fullName: string;
  mobile: string;
  line1: string;
  line2?: string;
  landmark?: string;
  cityTown: string;
  district: string;
  state: string;
  stateId: string;
  pincode: string;
};

/**
 * Either `savedAddressId` (one of the referee's own saved addresses) or a
 * freshly typed `address` — mirrors proposedOrderCreateSchema
 * (@kisan4u/validators), which accepts either. Not enforced here that
 * exactly one is set; the caller's UI is responsible for that.
 */
export function createProposedOrder(input: {
  refereeUserId: string;
  savedAddressId?: string;
  address?: ProposedOrderAddressInput;
  lines: { productId: string; variantId: string | null; quantity: number }[];
  note?: string;
}) {
  return api.post<{ proposedOrderId: string }>("/api/mobile/v1/ba/proposed-orders", input);
}
