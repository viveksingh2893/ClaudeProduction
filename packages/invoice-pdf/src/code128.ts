/**
 * Minimal Code 128 encoder (subsets B and C) — just enough to draw a
 * courier AWB as a scannable barcode on the seller shipping label without
 * pulling in a barcode dependency. Output is a list of bar/space widths in
 * modules, starting with a bar, ready to be drawn as rectangles.
 */

// Bar/space widths for symbol values 0..105 (six alternating elements,
// starting with a bar, always 11 modules wide); STOP has seven (13 modules).
export const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232",
] as const;
export const CODE128_STOP = "2331112";

const START_B = 104;
const START_C = 105;

/** Symbol values for `text` — subset C (digit pairs) when it is all digits of even length, otherwise subset B (printable ASCII). */
export function code128Values(text: string): number[] {
  if (text.length === 0) throw new Error("Cannot encode an empty barcode value.");
  const values: number[] = [];
  if (/^\d+$/.test(text) && text.length % 2 === 0) {
    values.push(START_C);
    for (let i = 0; i < text.length; i += 2) values.push(Number(text.slice(i, i + 2)));
  } else {
    values.push(START_B);
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) throw new Error(`Character ${JSON.stringify(ch)} is not encodable in Code 128 B.`);
      values.push(code - 32);
    }
  }
  return values;
}

/** Weighted mod-103 checksum over the start symbol and every data symbol (weight = position, the start symbol counting as weight 1). */
export function code128Checksum(values: number[]): number {
  let sum = values[0]!;
  for (let i = 1; i < values.length; i++) sum += values[i]! * i;
  return sum % 103;
}

/** Bar/space widths in modules (bar first), including start, checksum and stop symbols. Quiet zones are the caller's job. */
export function encodeCode128(text: string): number[] {
  const values = code128Values(text);
  values.push(code128Checksum(values));
  const widths: number[] = [];
  for (const value of values) {
    for (const ch of CODE128_PATTERNS[value]!) widths.push(Number(ch));
  }
  for (const ch of CODE128_STOP) widths.push(Number(ch));
  return widths;
}

/** Total width in modules of an encoded barcode (bars + spaces). */
export function code128ModuleCount(widths: number[]): number {
  return widths.reduce((a, b) => a + b, 0);
}
