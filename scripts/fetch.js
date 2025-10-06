// scripts/fetch.js
import fs from "fs/promises";
import Parser from "rss-parser";

const parser = new Parser();

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
  { url: "https://photofocus.com/feed/", topic: "photo" },

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

const seen = new Set();
const collected = [];

for (const { url, topic } of SOURCES) {
  try {
    const feed = await parser.parseURL(url);
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

      const hint = topic === "photo" ? PHOTO_HINTS : IT_HINTS;

      collected.push({
        title: it.title || "Article",
        q: `${(it.title || "").toLowerCase()} ${hint}`,  // ← richer keywords for matching
        a: `<b>${it.title || "Article"}</b><br>${short(it.contentSnippet || it.content)}<br><a href="${it.link}" target="_blank">Read more</a>`,
        link: it.link || "",
        topic,
        date: it.isoDate || it.pubDate || ""
      });
    }
  } catch (e) {
    console.error("Feed error:", url, e.message);
  }
}

// keep any manual entries you marked with "manual": true
let manual = [];
try {
  const raw = await fs.readFile("data/knowledge.json", "utf-8");
  manual = JSON.parse(raw).filter(x => x.manual === true);
} catch {}

const final = [...manual, ...collected];
// optional: cap size so file stays small
const MAX = 120;
const trimmed = final.slice(0, MAX);

await fs.mkdir("data", { recursive: true });
await fs.writeFile("data/knowledge.json", JSON.stringify(trimmed, null, 2), "utf-8");
console.log(`✅ Wrote ${trimmed.length} items to data/knowledge.json`);
