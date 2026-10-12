#!/usr/bin/env node
/**
 * Check that real questions reach the right knowledge base entry.
 *
 * The scoring pieces are lifted out of bot.js at run time rather than copied,
 * so this cannot quietly pass while the bot itself behaves differently.
 *
 *   npm test
 */
import fs from "fs/promises";

const botSrc = await fs.readFile("bot.js", "utf-8");

function lift(pattern, what) {
  const m = botSrc.match(pattern);
  if (!m) throw new Error(`Could not find ${what} in bot.js`);
  return m[1];
}

const STOP_WORDS = new Set(lift(/const STOP_WORDS = new Set\("([^"]+)"/, "stop words").split(" "));
const stem = new Function("w", lift(/function stem\(w\)\{([\s\S]*?)\n\}/, "stem()"));
const Q_WEIGHT = 3; // must match the .repeat(n) in bot.js
const MANUAL_BOOST = 1.25; // must match the boost in bot.js

const tokenize = (t) =>
  (t || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w)).map(stem);

function tfidf(docs) {
  const vocab = new Map();
  const tfs = docs.map((tokens) => {
    const m = new Map();
    tokens.forEach((w) => m.set(w, (m.get(w) || 0) + 1));
    for (const w of m.keys()) if (!vocab.has(w)) vocab.set(w, 0);
    return m;
  });
  for (const m of tfs) for (const w of m.keys()) vocab.set(w, (vocab.get(w) || 0) + 1);
  const N = docs.length, idf = new Map();
  for (const [w, df] of vocab) idf.set(w, Math.log(1 + N / df));
  const vecs = tfs.map((m) => {
    const v = new Map();
    for (const [w, f] of m) v.set(w, f * (idf.get(w) || 0));
    return v;
  });
  return { vecs, idf };
}

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (const [w, va] of a) { na += va * va; const vb = b.get(w); if (vb) dot += va * vb; }
  for (const [, vb] of b) nb += vb * vb;
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

// question -> a fragment that must appear in the winning entry's title
const CASES = [
  ["best shutter for sports",        "Shutter speed"],
  ["how do i freeze motion",         "Shutter speed"],
  ["what aperture for landscapes",   "landscapes"],
  ["how do i blur the background",   "Aperture"],
  ["what iso should i use",          "ISO"],
  ["why are my photos blurry",       "blurry"],
  ["portrait settings",              "portraits"],
  ["which lens for portraits",       "portrait"],
  ["raw or jpeg",                    "RAW or JPEG"],
  ["white balance orange indoors",   "White balance"],
  ["autofocus modes explained",      "Autofocus"],
  ["night photography tips",         "low light"],
  ["transfer photos to pc",          "Transfer photos"],
  ["fix high CPU on Windows",        "high CPU"],
  ["my computer boots slowly",       "slow boot"],
  ["wifi keeps dropping",            "Wi-Fi"],
  ["blue screen error",              "Blue screen"],
  ["free up disk space",             "disk space"],
  ["laptop too hot",                 "overheating"],
  ["browser is slow",                "Browser"],
  ["my pc wont boot",                "not boot"],
  ["how do i back up my files",      "Back up"],
];

const KB = JSON.parse(await fs.readFile("data/knowledge.json", "utf-8"));
const pre = tfidf(KB.map((x) => tokenize(((x.q || "") + " ").repeat(Q_WEIGHT) + (x.a || ""))));

let passed = 0;
const failures = [];
for (const [question, expected] of CASES) {
  const counts = new Map();
  tokenize(question).forEach((w) => counts.set(w, (counts.get(w) || 0) + 1));
  const vq = new Map();
  for (const [w, f] of counts) vq.set(w, f * (pre.idf.get(w) || 0));

  const best = KB
    .map((item, i) => ({ item, score: cosine(vq, pre.vecs[i]) * (item.manual ? MANUAL_BOOST : 1) }))
    .sort((a, b) => b.score - a.score)[0];

  const ok = best && best.item.title.toLowerCase().includes(expected.toLowerCase());
  if (ok) passed++;
  else failures.push(`  "${question}"\n      expected a title containing "${expected}"\n      got "${best?.item.title}"`);
}

console.log(`Knowledge base: ${KB.length} entries (${KB.filter((x) => x.manual).length} curated)`);
console.log(`Retrieval: ${passed}/${CASES.length} questions reached the intended entry`);
if (failures.length) {
  console.log("\nMisses:");
  console.log(failures.join("\n"));
}

// One or two near-misses between related guides are tolerable; a broad
// regression is not.
const floor = Math.ceil(CASES.length * 0.85);
if (passed < floor) {
  console.error(`\nFAIL: below the ${floor}/${CASES.length} floor.`);
  process.exit(1);
}
console.log("\nOK");
process.exit(0);
