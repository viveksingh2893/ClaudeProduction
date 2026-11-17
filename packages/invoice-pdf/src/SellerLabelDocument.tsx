import type { SellerLabelData } from "@kisan4u/orders";
import type { ReactElement } from "react";
import type * as ReactPDF from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { encodeCode128, code128ModuleCount } from "./code128";

// A6 portrait — the size every thermal / sticker label printer takes.
const PAGE_WIDTH = 297.64;
const PAGE_PADDING = 12;
const BARCODE_HEIGHT = 56;
const BARCODE_WIDTH = PAGE_WIDTH - PAGE_PADDING * 2 - 24;

function money(amount: number): string {
  const [whole, frac] = (Math.round(amount * 100) / 100).toFixed(2).split(".");
  const lastThree = whole!.slice(-3);
  const rest = whole!.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}` : lastThree;
  return `Rs. ${grouped}.${frac}`;
}

/**
 * The seller's shipping label — see seller-label.ts for why sellers get this
 * instead of the courier's own PDF. Same react-pdf-as-a-parameter pattern as
 * buildInvoiceDocument (see render.ts).
 */
export function buildSellerLabelDocument(
  reactPdf: typeof ReactPDF,
  label: SellerLabelData,
): ReactElement<DocumentProps> {
  const { Document, Page, View, Text, Svg, Rect, StyleSheet } = reactPdf;

  const styles = StyleSheet.create({
    page: { padding: PAGE_PADDING, fontSize: 9, fontFamily: "Helvetica", color: "#000" },
    box: { borderWidth: 1.5, borderColor: "#000" },
    row: { flexDirection: "row" },
    cell: { padding: 6 },
    heading: { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: "#444", marginBottom: 2 },
    bold: { fontFamily: "Helvetica-Bold" },
    hr: { borderBottomWidth: 1, borderBottomColor: "#000" },
    vr: { borderRightWidth: 1, borderRightColor: "#000" },
  });

  const widths = encodeCode128(label.awbNumber);
  const moduleWidth = BARCODE_WIDTH / code128ModuleCount(widths);
  const bars: { x: number; width: number }[] = [];
  let cursor = 0;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x: cursor * moduleWidth, width: w * moduleWidth });
    cursor += w;
  });

  const isCod = label.paymentMode === "COD";

  return (
    <Document title={`Shipping label ${label.orderNumber}`}>
      <Page size={[PAGE_WIDTH, 419.53]} style={styles.page}>
        <View style={styles.box}>
          <View style={[styles.row, styles.hr]}>
            <View style={[styles.cell, styles.vr, { width: "50%" }]}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 14 }}>KISAN4U</Text>
              <Text style={{ marginTop: 2 }}>{label.courierName ?? "Courier"}</Text>
            </View>
            <View style={[styles.cell, { width: "50%", alignItems: "center", justifyContent: "center" }]}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 15 }}>
                {isCod ? "COD" : "PREPAID"}
              </Text>
              {isCod ? <Text style={styles.bold}>Collect {money(label.codAmount)}</Text> : null}
            </View>
          </View>

          <View style={[styles.hr, { padding: 6, alignItems: "center" }]}>
            <Svg width={BARCODE_WIDTH} height={BARCODE_HEIGHT}>
              {bars.map((bar, i) => (
                <Rect key={i} x={bar.x} y={0} width={bar.width} height={BARCODE_HEIGHT} fill="#000" />
              ))}
            </Svg>
            <Text style={{ marginTop: 3, fontFamily: "Helvetica-Bold", fontSize: 11, letterSpacing: 1 }}>
              {label.awbNumber}
            </Text>
          </View>

          <View style={[styles.cell, styles.hr]}>
            <Text style={styles.heading}>SHIP TO</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{label.shipTo.fullName}</Text>
            {label.shipTo.addressLines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
            <Text>{label.shipTo.cityStateLine}</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 14, marginTop: 3 }}>
              PIN {label.shipTo.pincode}
            </Text>
          </View>

          <View style={[styles.cell, styles.hr]}>
            <Text style={styles.heading}>SHIP FROM (SELLER)</Text>
            <Text style={styles.bold}>{label.shipFrom.name}</Text>
            {label.shipFrom.addressLines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </View>

          <View style={[styles.row, styles.hr]}>
            <View style={[styles.cell, styles.vr, { width: "50%" }]}>
              <Text style={styles.heading}>ORDER</Text>
              <Text style={styles.bold}>{label.orderNumber}</Text>
            </View>
            <View style={[styles.cell, { width: "50%" }]}>
              <Text style={styles.heading}>WEIGHT / PACKAGES</Text>
              <Text style={styles.bold}>
                {label.totalWeightGrams} g
                {label.packageCount != null ? ` / ${label.packageCount} pkg` : ""}
              </Text>
            </View>
          </View>

          <View style={styles.cell}>
            <Text style={styles.heading}>CONTENTS</Text>
            <Text style={{ fontSize: 8 }}>{label.productSummary.slice(0, 220)}</Text>
          </View>
        </View>

        <Text style={{ marginTop: 6, fontSize: 7, color: "#555", textAlign: "center" }}>
          Customer contact details are held by Kisan4U. Please do not contact the consignee directly.
        </Text>
      </Page>
    </Document>
  );
}
