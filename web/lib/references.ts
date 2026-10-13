import data from "../data/references.json";
import { normalizeNafdac } from "./parse.ts";

export type ReferenceProduct = {
  id: string;
  name: string;
  keywords: string[];
  manufacturer: string;
  nafdacNo: string;
  batchPattern?: string;
  maxShelfLifeMonths?: number;
  packagingNotes?: string;
  referenceImages: string[];
  demo?: boolean;
};

export const referenceProducts: ReferenceProduct[] = data.products;

export function findByNafdac(no: string | undefined): ReferenceProduct | undefined {
  if (!no) return undefined;
  const n = normalizeNafdac(no);
  return referenceProducts.find((p) => normalizeNafdac(p.nafdacNo) === n);
}

/** Reference products whose name keywords appear in the OCR text. */
export function findByText(text: string): ReferenceProduct[] {
  const upper = text.toUpperCase();
  return referenceProducts.filter((p) => p.keywords.some((k) => upper.includes(k)));
}

export const NAFDAC_GREENBOOK_URL = "https://greenbook.nafdac.gov.ng/";
