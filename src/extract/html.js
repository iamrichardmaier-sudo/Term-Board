/**
 * HTML to readable text.
 *
 * Deliberately small and dependency-free: the input is a single Learning Suite
 * content pane that has already been narrowed by a selector, not an arbitrary
 * web page, so a full readability implementation would be more machinery than
 * the job needs.
 */

import { TEXT_QUALITY } from "../config.js";

const BLOCK = /^(p|div|section|article|br|li|tr|h[1-6]|blockquote|pre|table)$/i;

/** Strip markup, keeping block boundaries as newlines. */
export function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?([a-z0-9]+)[^>]*>/gi, (m, tag) => (BLOCK.test(tag) ? "\n" : " "))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** Same verdict vocabulary as the PDF extractor, so callers can treat them alike. */
export function judgeText(text) {
  const clean = (text || "").trim();
  if (clean.length === 0) {
    return {
      quality: "image-only",
      reason: "The page had no text at all — its content is images or an embedded viewer.",
    };
  }
  if (clean.length < TEXT_QUALITY.minCharsForConversation) {
    return {
      quality: "sparse",
      reason:
        `Only ${clean.length} characters of text — too little to walk through ` +
        `in conversation. The real material is probably in an attachment.`,
    };
  }
  return { quality: "clean", reason: null };
}
