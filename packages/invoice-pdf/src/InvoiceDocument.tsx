import type { InvoiceData } from "@kisan4u/orders";
import type { ReactElement } from "react";
import type * as ReactPDF from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";

// @react-pdf/renderer has no built-in font with a rupee glyph that renders
// reliably across its PDF text layout engine — Helvetica (the default)
// drops ₹ silently. Using the literal string "Rs. " avoids depending on a
// remote font fetch (this renders server-side, offline-safe) while still
// reading unambiguously as currency.
const CURRENCY = "Rs. ";

function money(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const [whole, frac] = rounded.toFixed(2).split(".");
  // Indian digit grouping (##,##,###) for the integer part.
  const lastThree = whole!.slice(-3);
  const rest = whole!.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}` : lastThree;
  return `${CURRENCY}${grouped}.${frac}`;
}

function formatDate(date: Date): string {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

// Column widths (percent) for the line-item table, matching the reference
// invoice's layout: Sr | Description | HSN | Qty | Rate | Taxable Value |
// Tax Rate | Tax Amount | Total.
const COLS = {
  sr: 5,
  desc: 28,
  hsn: 10,
  qty: 6,
  rate: 10,
  taxable: 11,
  taxRate: 8,
  taxAmt: 11,
  total: 11,
};

/**
 * Takes the already-imported `@react-pdf/renderer` module as a parameter
 * rather than importing it at this file's top level — see render.ts's
 * comment for why. Every component/style below is built fresh per call
 * (StyleSheet.create is cheap; this isn't a hot path outside PDF
 * generation) since `reactPdf` isn't known until render.ts's dynamic
 * import resolves.
 */
export function buildInvoiceDocument(
  reactPdf: typeof ReactPDF,
  invoice: InvoiceData,
): ReactElement<DocumentProps> {
  const { Document, Page, View, Text, StyleSheet } = reactPdf;

  const styles = StyleSheet.create({
    page: {
      padding: 24,
      fontSize: 8.5,
      fontFamily: "Helvetica",
      color: "#1a1a1a",
    },
    border: {
      borderWidth: 1,
      borderColor: "#000",
    },
    titleBar: {
      borderWidth: 1,
      borderColor: "#000",
      borderBottomWidth: 0,
      paddingVertical: 8,
      alignItems: "center",
    },
    title: { fontSize: 14, fontFamily: "Helvetica-Bold" },
    row: { flexDirection: "row" },
    cell: { padding: 6 },
    bold: { fontFamily: "Helvetica-Bold" },
    label: { color: "#444" },
    sectionHeading: { fontFamily: "Helvetica-Bold", fontSize: 9.5, marginBottom: 3 },
    hr: { borderBottomWidth: 1, borderBottomColor: "#000" },
    vr: { borderRightWidth: 1, borderRightColor: "#000" },
    small: { fontSize: 7.5 },
    disclaimerHeading: { fontFamily: "Helvetica-Bold", fontSize: 8.5, marginBottom: 3 },
  });

  function LineItemsTable() {
    return (
      <View style={[styles.border, { marginTop: 8 }]}>
        <View style={[styles.row, styles.hr, { backgroundColor: "#f2f2f2" }]}>
          <Text style={[styles.cell, styles.bold, styles.vr, { width: `${COLS.sr}%` }]}>
            Sr No
          </Text>
          <Text style={[styles.cell, styles.bold, styles.vr, { width: `${COLS.desc}%` }]}>
            Product Description
          </Text>
          <Text style={[styles.cell, styles.bold, styles.vr, { width: `${COLS.hsn}%` }]}>
            HSN Code
          </Text>
          <Text style={[styles.cell, styles.bold, styles.vr, { width: `${COLS.qty}%` }]}>
            Qty
          </Text>
          <Text style={[styles.cell, styles.bold, styles.vr, { width: `${COLS.rate}%` }]}>
            Rate
          </Text>
          <Text style={[styles.cell, styles.bold, styles.vr, { width: `${COLS.taxable}%` }]}>
            Taxable Value
          </Text>
          <Text style={[styles.cell, styles.bold, styles.vr, { width: `${COLS.taxRate}%` }]}>
            Tax Rate
          </Text>
          <Text style={[styles.cell, styles.bold, styles.vr, { width: `${COLS.taxAmt}%` }]}>
            Tax Amount
          </Text>
          <Text style={[styles.cell, styles.bold, { width: `${COLS.total}%` }]}>Total</Text>
        </View>
        {invoice.lineItems.map((item, i) => (
          <View
            key={item.srNo}
            style={[styles.row, i < invoice.lineItems.length - 1 ? styles.hr : {}]}
          >
            <Text style={[styles.cell, styles.vr, { width: `${COLS.sr}%` }]}>{item.srNo}</Text>
            <View style={[styles.cell, styles.vr, { width: `${COLS.desc}%` }]}>
              <Text>{item.productName}</Text>
              {item.variantLabel ? (
                <Text style={styles.small}>Variation : {item.variantLabel}</Text>
              ) : null}
            </View>
            <Text style={[styles.cell, styles.vr, { width: `${COLS.hsn}%` }]}>
              {item.hsnCode}
            </Text>
            <Text style={[styles.cell, styles.vr, { width: `${COLS.qty}%` }]}>
              {item.quantity}
            </Text>
            <Text style={[styles.cell, styles.vr, { width: `${COLS.rate}%` }]}>
              {money(item.rate)}
            </Text>
            <Text style={[styles.cell, styles.vr, { width: `${COLS.taxable}%` }]}>
              {money(item.taxableValue)}
            </Text>
            <Text style={[styles.cell, styles.vr, { width: `${COLS.taxRate}%` }]}>
              {item.taxRatePercent}%
            </Text>
            <Text style={[styles.cell, styles.vr, { width: `${COLS.taxAmt}%` }]}>
              {money(item.taxAmount)}
            </Text>
            <Text style={[styles.cell, { width: `${COLS.total}%` }]}>{money(item.lineTotal)}</Text>
          </View>
        ))}
      </View>
    );
  }

  function AddressBlock({
    heading,
    address,
    gstNumber,
  }: {
    heading: string;
    address: InvoiceData["shippingAddress"];
    gstNumber?: string | null;
  }) {
    return (
      <View style={[styles.cell, { width: "50%" }]}>
        <Text style={styles.sectionHeading}>{heading}</Text>
        <Text>{address.fullName}</Text>
        <Text>{address.mobile}</Text>
        <Text>
          {[address.line1, address.line2, address.landmark].filter(Boolean).join(", ")}
        </Text>
        <Text>
          {address.cityTown}, {address.district}, {address.state}, India - {address.pincode}
        </Text>
        {gstNumber !== undefined ? <Text>GSTIN: {gstNumber ?? "NA"}</Text> : null}
      </View>
    );
  }

  function TotalsRow({
    label,
    value,
    emphasized,
  }: {
    label: string;
    value: string;
    emphasized?: boolean;
  }) {
    return (
      <View style={[styles.row, styles.hr]}>
        <Text style={[styles.cell, { width: "65%" }, emphasized ? styles.bold : {}]}>{label}</Text>
        <Text style={[styles.cell, { width: "35%" }, emphasized ? styles.bold : {}]}>{value}</Text>
      </View>
    );
  }

  return (
    <Document title={`Invoice ${invoice.invoiceNumber}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.titleBar}>
          <Text style={styles.title}>TAX INVOICE</Text>
        </View>

        <View style={[styles.row, styles.border, styles.hr]}>
          <Text style={[styles.cell, styles.vr, { width: "60%" }]}>
            Place of Supply: <Text style={styles.bold}>{invoice.placeOfSupply}</Text>
          </Text>
          <Text style={[styles.cell, { width: "40%" }]}>
            Nature of Supply: <Text style={styles.bold}>{invoice.natureOfSupply}</Text>
          </Text>
        </View>

        <View style={[styles.row, styles.border, styles.hr]}>
          <View style={[styles.cell, styles.vr, { width: "60%" }]}>
            <Text style={styles.sectionHeading}>Sold By</Text>
            <Text>{invoice.seller.shopName}</Text>
            {invoice.seller.addressLines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
            <Text>GSTIN: {invoice.seller.gstNumber ?? "NA"}</Text>
          </View>
          <View style={{ width: "40%" }}>
            <View style={[styles.row, styles.hr]}>
              <Text style={styles.cell}>
                Order Date: <Text style={styles.bold}>{formatDate(invoice.orderDate)}</Text>
              </Text>
            </View>
            <View style={[styles.row, styles.hr]}>
              <Text style={styles.cell}>
                Order No.: <Text style={styles.bold}>#{invoice.orderNumber}</Text>
              </Text>
            </View>
            <View style={[styles.row, styles.hr]}>
              <Text style={styles.cell}>
                Invoice Date: <Text style={styles.bold}>{formatDate(invoice.invoiceDate)}</Text>
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.cell}>
                Invoice No.: <Text style={styles.bold}>#{invoice.invoiceNumber}</Text>
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.row, styles.border, styles.hr]}>
          <AddressBlock heading="Shipping Address" address={invoice.shippingAddress} />
          <View style={styles.vr} />
          <AddressBlock
            heading="Billing Address"
            address={invoice.billingAddress}
            gstNumber={invoice.buyerGstNumber}
          />
        </View>

        <LineItemsTable />

        <View style={[styles.row, styles.border, { marginTop: 8 }]}>
          <View style={[styles.cell, styles.vr, { width: "60%" }]}>
            <Text style={styles.bold}>Total amount in words</Text>
            <Text style={{ marginTop: 10 }}>
              In words: {invoice.totals.afterTaxInWords} Rupees Only
            </Text>
            <Text style={{ marginTop: 10 }}>Payment Method: {invoice.paymentMethod}</Text>
          </View>
          <View style={{ width: "40%" }}>
            <TotalsRow label="Total amount before tax" value={money(invoice.totals.beforeTax)} />
            <TotalsRow
              label={invoice.couponCode ? `Coupon (${invoice.couponCode}) (-)` : "Discounts (-)"}
              value={money(invoice.totals.discounts)}
            />
            <TotalsRow
              label="Extra Discount / Wallet (-)"
              value={money(invoice.totals.extraDiscounts + invoice.totals.walletApplied)}
            />
            <TotalsRow label="Add: SGST / CGST / IGST" value={money(invoice.totals.taxTotal)} />
            <TotalsRow label="Shipping Charges" value={money(invoice.totals.shippingCharges)} />
            <TotalsRow
              label="Total Amount after Tax"
              value={money(invoice.totals.afterTax)}
              emphasized
            />
            <TotalsRow label="Paid Amount" value={money(invoice.totals.paidAmount)} />
            <View style={styles.row}>
              <Text style={[styles.cell, { width: "65%" }]}>Balance Amount</Text>
              <Text style={[styles.cell, { width: "35%" }]}>
                {money(invoice.totals.balanceAmount)}
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.border, { marginTop: 8, padding: 6, alignItems: "center" }]}>
          <Text>This is a computer generated invoice and does not require a signature.</Text>
          <Text style={styles.bold}>SUBJECT TO SELLER JURISDICTION</Text>
          <Text>
            Order online: www.Kisan4u.com | Download Mobile app from Play Store, App Store
          </Text>
        </View>

        <View style={[styles.border, { marginTop: 8, padding: 6 }]}>
          <Text style={styles.disclaimerHeading}>INVOICE DISCLAIMERS</Text>
          <Text style={styles.small}>
            1. Product(s) sold by the respective seller. Performance depends on proper storage and
            use strictly as per manufacturer&apos;s label/leaflet. Read instructions carefully
            before use.
          </Text>
          <Text style={styles.small}>
            2. Kisan4u.com is an e-commerce marketplace only. All licences, statutory compliance,
            quality, warranty, and guarantees relating to the product(s) are the sole
            responsibility of the manufacturer/seller.
          </Text>
          <Text style={styles.small}>
            3. Goods purchased are strictly for agricultural/commercial/resale or in-house use
            only. Use strictly as per manufacturer&apos;s instructions and applicable laws.
          </Text>
        </View>

        <View style={[styles.row, styles.border, { marginTop: 8 }]}>
          <Text style={[styles.cell, styles.vr, styles.small, { width: "65%" }]}>
            Regd. Office: 1304, Floor-13, Marathon Icon Off, Ganpatrao Kadam Marg, Opp Peninsula
            Corporate Park, Lower Parel (W), Mumbai, Maharashtra, 400013
          </Text>
          <View style={[styles.cell, styles.small, { width: "35%" }]}>
            <Text>Email: care@kisan4u.com</Text>
            <Text>Customer care: 9826575663</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
