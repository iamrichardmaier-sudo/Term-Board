/**
 * The reader's text pipeline, tested away from the browser.
 *
 * Everything between the PIPELINE markers in docs/read.html is pure by
 * construction — no DOM, no network — so it can be sliced out and run under
 * node. That is the whole reason those functions are kept in one block: the
 * part most likely to be wrong (turning wrapped PDF lines back into sentences)
 * is also the part hardest to check by eye on a phone.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const html = await fs.readFile(new URL("../docs/read.html", import.meta.url), "utf8");
const startMarker = html.indexOf("PIPELINE START");
const endMarker = html.indexOf("PIPELINE END");
assert.ok(startMarker > 0 && endMarker > startMarker, "the PIPELINE markers are missing from docs/read.html");

// The markers sit inside comments; take the code between the comment that
// opens the block and the one that closes it.
const start = html.indexOf("*/", startMarker) + 2;
const end = html.lastIndexOf("/*", endMarker);

const context = vm.createContext({ console });
vm.runInContext(html.slice(start, end) + "\nglobalThis.P = { " + [
  "itemsToLines", "normalizeGlyphs", "looksLikePageNumber", "stripRunningLines",
  "linesToParagraphs", "judgePage", "splitSentences", "speechable",
  "chunkSentences", "rankVoice", "documentKey", "clock", "buildScript",
].join(", ") + " };", context);

const P = context.P;
let checks = 0;
const ok = (label, fn) => { fn(); checks++; console.log("  ✓ " + label); };

// Arrays built inside the vm realm have a different Array prototype, which is
// enough for deepStrictEqual to reject two identical lists. Compare by value.
const plain = (v) => JSON.parse(JSON.stringify(v));
const deep = (actual, expected, msg) => assert.deepEqual(plain(actual), expected, msg);

console.log("lines");

ok("hasEOL is what ends a line", () => {
  const lines = P.itemsToLines([
    { str: "The quick", hasEOL: false },
    { str: " brown fox", hasEOL: true },
    { str: "jumped", hasEOL: true },
  ]);
  deep(lines, ["The quick brown fox", "jumped"]);
});

ok("ligatures and smart quotes are normalised", () => {
  assert.equal(P.normalizeGlyphs("the ﬁrst “big” oﬃce"), 'the first "big" office');
});

ok("page numbers are recognised, real lines are not", () => {
  for (const s of ["7", "— 12 —", "Page 4 of 9", "iv", "[3]"]) {
    assert.equal(P.looksLikePageNumber(s), true, s);
  }
  for (const s of ["7 reasons the war ended", "Chapter 3", "1. Introduction"]) {
    assert.equal(P.looksLikePageNumber(s), false, s);
  }
});

console.log("running heads");

ok("a header repeated across pages is dropped", () => {
  const pages = [];
  for (let n = 1; n <= 6; n++) {
    pages.push([`Islamic Humanities 242 — page ${n}`, `Body of page ${n}.`, `Draft ${n} of 6`]);
  }
  const out = P.stripRunningLines(pages);
  deep(out[0], ["Body of page 1."]);
  deep(out[5], ["Body of page 6."]);
});

ok("a bare page number is left to the paragraph pass, which drops it", () => {
  // Too short to be evidence of a running footer on its own — "3" could be a
  // real line. looksLikePageNumber catches it a step later, with the whole
  // line in hand rather than a masked one.
  const bodies = ["Alpha.", "Beta.", "Gamma.", "Delta.", "Epsilon."];
  const pages = bodies.map((b, i) => [b, String(i + 1)]);
  deep(P.stripRunningLines(pages)[0], ["Alpha.", "1"]);
  deep(P.linesToParagraphs(["Alpha.", "1"]), ["Alpha."]);
});

ok("a two-page handout keeps its first line", () => {
  const pages = [["Worksheet", "Question one."], ["Worksheet", "Question two."]];
  deep(P.stripRunningLines(pages), pages);
});

console.log("paragraphs");

ok("a word split across the wrap is put back together", () => {
  const paras = P.linesToParagraphs(["The conquest was compara-", "tively swift."]);
  deep(paras, ["The conquest was comparatively swift."]);
});

ok("a real compound keeps its hyphen", () => {
  const paras = P.linesToParagraphs(["the Anglo-", "Saxon settlement"]);
  deep(paras, ["the Anglo-Saxon settlement"]);
});

ok("a wrapped line is joined, a finished one starts a paragraph", () => {
  const paras = P.linesToParagraphs([
    "The caliph moved the capital to Baghdad in the year seven sixty two, and the",
    "city grew quickly.",
    "Trade followed the court. Within a generation it was the largest city west of",
    "China.",
  ]);
  assert.equal(paras.length, 2);
  assert.ok(paras[0].startsWith("The caliph moved"));
  assert.ok(paras[0].endsWith("the city grew quickly."));
  assert.ok(paras[1].startsWith("Trade followed"));
});

ok("bullets are their own paragraphs", () => {
  const paras = P.linesToParagraphs(["Three causes:", "• trade routes", "• a new tax", "• the plague"]);
  assert.equal(paras.length, 4);
});

console.log("sentences");

ok("abbreviations and initials do not end a sentence", () => {
  const s = P.splitSentences("Dr. Khalidi cites J. R. R. Tolkien, e.g. in ch. 4. The point stands.");
  assert.equal(s.length, 2, JSON.stringify(s));
  assert.equal(s[1], "The point stands.");
});

ok("question and exclamation marks do end one", () => {
  deep(P.splitSentences("Why? Because it rained! Then we left."),
    ["Why?", "Because it rained!", "Then we left."]);
});

ok("a quote's closing mark rides with its sentence", () => {
  const s = P.splitSentences('He said "we are leaving." Then he left.');
  deep(s, ['He said "we are leaving."', "Then he left."]);
});

ok("a numbered list label rides with its item", () => {
  const s = P.splitSentences("1. Read the chapter. 2. Answer the questions.");
  deep(s, ["1. Read the chapter.", "2. Answer the questions."]);
});

ok("text with no terminator is still one sentence", () => {
  deep(P.splitSentences("a heading with no full stop"), ["a heading with no full stop"]);
});

console.log("speech");

ok("citations and urls are not read out", () => {
  assert.equal(P.speechable("The treaty [14] is online at https://example.com/x and binding."),
    "The treaty is online at link and binding.");
});

ok("em dashes become a pause", () => {
  assert.equal(P.speechable("It was over — finally."), "It was over, finally.");
});

console.log("chunking");

ok("chunks respect the limit and never cross a paragraph", () => {
  const sentences = [];
  for (let i = 0; i < 30; i++) {
    sentences.push({ text: "x".repeat(100), spoken: "x".repeat(100), paraStart: i % 5 === 0 });
  }
  const chunks = P.chunkSentences(sentences, 350);
  for (const c of chunks) {
    let n = 0;
    for (let i = c.from; i <= c.to; i++) n += sentences[i].spoken.length;
    assert.ok(n <= 350 || c.from === c.to, `chunk of ${n} chars`);
    for (let i = c.from + 1; i <= c.to; i++) {
      assert.equal(sentences[i].paraStart, false, "a chunk straddled a paragraph break");
    }
  }
  assert.equal(chunks[0].from, 0);
  assert.equal(chunks[chunks.length - 1].to, sentences.length - 1);
});

ok("every sentence lands in exactly one chunk", () => {
  const sentences = Array.from({ length: 17 }, (_, i) => ({ spoken: "s".repeat(80), paraStart: i === 9 }));
  const chunks = P.chunkSentences(sentences, 350);
  const seen = new Set();
  for (const c of chunks) for (let i = c.from; i <= c.to; i++) {
    assert.ok(!seen.has(i), "sentence " + i + " is in two chunks");
    seen.add(i);
  }
  assert.equal(seen.size, sentences.length);
});

console.log("voices");

ok("a premium voice outranks a compact one", () => {
  const premium = { name: "Ava (Premium)", lang: "en-US", localService: true };
  const compact = { name: "Fred", lang: "en-US", localService: true };
  const novelty = { name: "Zarvox", lang: "en-US", localService: true };
  assert.ok(P.rankVoice(premium, "en") > P.rankVoice(compact, "en"));
  assert.ok(P.rankVoice(compact, "en") > P.rankVoice(novelty, "en"));
});

ok("the right language outranks a better voice in the wrong one", () => {
  assert.ok(P.rankVoice({ name: "Majed", lang: "ar-SA" }, "ar")
          > P.rankVoice({ name: "Ava (Premium)", lang: "en-US" }, "ar"));
});

console.log("end to end");

ok("a title line is not glued to the sentence under it", () => {
  const paras = P.linesToParagraphs([
    "The Abbasid Revolution",
    "It began in Khurasan, far from the Umayyad capital, and it did not stay",
    "there long.",
  ]);
  deep(paras, [
    "The Abbasid Revolution",
    "It began in Khurasan, far from the Umayyad capital, and it did not stay there long.",
  ]);
});

ok("a scanned page and a text page come out as one script", () => {
  const body = [
    ["The Abbasid revolution began in Khurasan, far", "from the Umayyad capital."],
    ["It ended in Damascus. The dynasty fell in 750."],
    ["Baghdad was founded fourteen years later."],
    ["The city grew faster than any before it."],
  ];
  const pages = body.map((lines, i) => ({
    number: i + 1,
    source: i === 1 ? "ocr" : "text",
    lines: ["Islamic Humanities 242 \u2014 reading " + (i + 1), ...lines, String(i + 1)],
  }));

  const { paragraphs, sentences } = P.buildScript(pages);

  assert.equal(sentences.length, 5, JSON.stringify(sentences.map((x) => x.text)));
  assert.equal(sentences[0].text, "The Abbasid revolution began in Khurasan, far from the Umayyad capital.");
  assert.equal(sentences[0].ocr, false);
  assert.equal(sentences[1].ocr, true, "page 2 came from OCR and its sentences should say so");
  assert.equal(sentences[3].ocr, false);
  assert.ok(!sentences.some((x) => /Islamic Humanities/.test(x.text)), "the running header survived");
  assert.ok(!sentences.some((x) => /^\d+$/.test(x.text)), "a page number survived");
  assert.equal(paragraphs.filter((x) => x.pageBreak).length, 4);
  assert.equal(paragraphs.find((x) => x.pageBreak && x.page === 2).ocr, true);
});

ok("every sentence index in a paragraph resolves", () => {
  const pages = [{ number: 1, source: "text", lines: ["One. Two. Three.", "Four? Five!"] }];
  const { paragraphs, sentences } = P.buildScript(pages);
  for (const p of paragraphs) {
    if (p.pageBreak) continue;
    for (const i of p.sentences) assert.ok(sentences[i], "dangling sentence index " + i);
  }
});

ok("a document key is stable and a different document is not", () => {
  assert.equal(P.documentKey("a", 10, "x"), P.documentKey("a", 10, "x"));
  assert.notEqual(P.documentKey("a", 10, "x"), P.documentKey("a", 11, "x"));
});

ok("the clock formats", () => {
  assert.equal(P.clock(247), "4:07");
  assert.equal(P.clock(-1), "0:00");
});

console.log(`\n✓ ${checks} checks passed`);
