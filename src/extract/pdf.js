/**
 * PDF text extraction, and the judgement call about whether what came out is
 * actually readable.
 *
 * The distinction that matters for the voice feature is born-digital vs
 * scanned. A born-digital PDF hands over its text; a scan is a picture of text
 * and yields almost nothing. Rather than guess from the filename, this measures
 * characters per page and reports what it found, so the widget can be honest
 * about which assignments will not work well out loud.
 */

import { TEXT_QUALITY } from "../config.js";

let pdfjs;
async function loadPdfjs() {
  if (!pdfjs) {
    // The legacy build is the one that runs under plain Node without a DOM.
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = null;
  }
  return pdfjs;
}

/**
 * @param {Buffer|Uint8Array} bytes
 * @returns {Promise<{text: string, pages: number, charsPerPage: number,
 *                    quality: 'clean'|'sparse'|'image-only', reason: string|null}>}
 */
export async function extractPdf(bytes) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({
    data: new Uint8Array(bytes),
    // A scanned PDF often carries no font programme at all; these keep pdf.js
    // from failing outright on the odd files instructors upload.
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const parts = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((i) => (typeof i.str === "string" ? i.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    parts.push(pageText);
    page.cleanup();
  }
  await doc.destroy();

  const text = parts.join("\n\n").trim();
  const pages = doc.numPages || parts.length || 1;
  const charsPerPage = Math.round(text.length / Math.max(1, pages));

  return { text, pages, charsPerPage, ...judge(text, charsPerPage) };
}

function judge(text, charsPerPage) {
  if (charsPerPage < 20) {
    return {
      quality: "image-only",
      reason:
        "The PDF has no extractable text — it is almost certainly a scan or a " +
        "photo of a page. Reading it aloud would need OCR.",
    };
  }
  if (
    charsPerPage < TEXT_QUALITY.minCharsPerPdfPage ||
    text.length < TEXT_QUALITY.minCharsForConversation
  ) {
    return {
      quality: "sparse",
      reason:
        "Only fragments of text came out — likely a scan with a thin text " +
        "layer, or a worksheet that is mostly blank space and images.",
    };
  }
  return { quality: "clean", reason: null };
}
