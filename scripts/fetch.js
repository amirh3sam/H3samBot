// scripts/fetch.js
import fs from "fs/promises";
import Parser from "rss-parser";

// 15s per feed. Without a timeout a host that accepts the connection
// but never answers hangs the whole job, which is what happened.
const parser = new Parser({ timeout: 15000 });

// -----------------------------
// 🌐 Feeds to fetch & learn from
// -----------------------------
const SOURCES = [
  // --- Photography ---
  { url: "https://petapixel.com/feed/", topic: "photo" },
  { url: "https://www.dpreview.com/feeds/news.xml", topic: "photo" },
  { url: "https://fstoppers.com/feed", topic: "photo" },
  { url: "https://www.digitalcameraworld.com/feeds/all", topic: "photo" },
  { url: "https://www.slrlounge.com/feed/", topic: "photo" },
  { url: "https://iso1200.com/feeds/posts/default", topic: "photo" },

  // --- Tech & IT ---
  { url: "https://www.theverge.com/rss/index.xml", topic: "it" },
  { url: "https://www.techradar.com/rss", topic: "it" },
  { url: "https://www.cnet.com/rss/news/", topic: "it" },
  { url: "https://www.tomshardware.com/feeds/all", topic: "it" },
  { url: "https://www.zdnet.com/news/rss.xml", topic: "it" },
  { url: "https://www.windowscentral.com/rss", topic: "it" },
  { url: "https://www.bleepingcomputer.com/feed/", topic: "it" },
  { url: "https://www.howtogeek.com/feed/", topic: "it" },
  { url: "https://www.xda-developers.com/feed/", topic: "it" },
];


const PHOTO_HINTS = "camera cameras lens lenses mirrorless dslr sensor megapixel iso shutter aperture bokeh photo photography light lighting flash studio portrait landscape review specs price release firmware raw";
const IT_HINTS    = "windows linux mac osx macos apple microsoft update driver bug fix troubleshoot how to tutorial command terminal powershell network wifi gpu cpu security performance tips tricks";

function short(txt, max = 240) {
  if (!txt) return "";
  const t = txt.replace(/(<([^>]+)>)/gi, "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

// Terms actually worth indexing for one article: its own title and summary,
// minus stop words. Shared boilerplate is deliberately left out -- a term
// present in every document tells the ranker nothing.
const STOP = new Set(("a an the and or but if then than that this these those is are was were be been being to of in on at by for with from as it its into about over after before under new news your you we our i s t can will just dont should now".split(" ")));

function keywords(title, body) {
  const words = `${title || ""} ${body || ""}`
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && w.length < 24 && !STOP.has(w));
  return [...new Set(words)].slice(0, 60).join(" ");
}

const seen = new Set();
const collected = [];

const fetched = await Promise.allSettled(
  SOURCES.map(({ url, topic }) =>
    parser.parseURL(url).then((feed) => ({ url, topic, feed }))
  )
);

console.log(
  `Feeds: ${fetched.filter((r) => r.status === "fulfilled").length}/${SOURCES.length} ok`
);

for (const result of fetched) {
  if (result.status === "rejected") {
    console.error("Feed error:", result.reason?.message || result.reason);
    continue;
  }
  {
    const { topic, feed } = result.value;
    const items = (feed.items || []).slice(0, 10);
    for (const it of items) {
      const key = (it.link || it.title || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);

      // basic relevance filter per topic
      const t = (it.title || "") + " " + (it.contentSnippet || it.content || "");
      const lower = t.toLowerCase();
      const isPhoto = /camera|lens|photo|photograph|mirrorless|dslr|aperture|shutter/.test(lower);
      const isIT    = /windows|linux|mac|apple|microsoft|driver|update|bug|security/.test(lower);
      if (topic === "photo" && !isPhoto) continue;
      if (topic === "it"    && !isIT)    continue;

      collected.push({
        title: it.title || "Article",
        q: keywords(it.title, it.contentSnippet || it.content),
        a: `<b>${it.title || "Article"}</b><br>${short(it.contentSnippet || it.content)}<br><a href="${it.link}" target="_blank">Read more</a>`,
        link: it.link || "",
        topic,
        date: it.isoDate || it.pubDate || ""
      });
    }
  }
}

// Curated evergreen entries live in their own file, so they survive a reset
// of knowledge.json. Previously they were read back out of the very file this
// script overwrites, which meant one bad run could lose them for good.
let manual = [];
try {
  manual = JSON.parse(await fs.readFile("data/manual.json", "utf-8"));
  console.log(`Manual entries: ${manual.length}`);
} catch (e) {
  console.error("No data/manual.json:", e.message);
  try {
    const raw = await fs.readFile("data/knowledge.json", "utf-8");
    manual = JSON.parse(raw).filter((x) => x.manual === true);
  } catch {}
}

const final = [...manual, ...collected];
// optional: cap size so file stays small
const MAX = 160;
const trimmed = final.slice(0, MAX);

await fs.mkdir("data", { recursive: true });
await fs.writeFile("data/knowledge.json", JSON.stringify(trimmed, null, 2), "utf-8");
console.log(`✅ Wrote ${trimmed.length} items to data/knowledge.json`);

// The work is done here, but keep-alive sockets from the feed requests can
// hold the event loop open afterwards. That is what left the job running
// until its timeout even on runs that had already written the file.
process.exit(0);
