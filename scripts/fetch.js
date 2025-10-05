// scripts/fetch.js
import fs from "fs/promises";
import Parser from "rss-parser";

const parser = new Parser();
const SOURCES = [
  // Photography feeds
  "https://petapixel.com/feed/",
  "https://www.dpreview.com/feeds/news.xml",
  // Tech / IT feeds
  "https://devblogs.microsoft.com/windowsserver/feed/",
  "https://linuxfoundation.org/feed/"
];

function short(txt, max = 220) {
  if (!txt) return "";
  const t = txt.replace(/(<([^>]+)>)/gi, "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

const collected = [];
for (const url of SOURCES) {
  try {
    const feed = await parser.parseURL(url);
    for (const item of feed.items.slice(0, 5)) {
      collected.push({
        title: item.title || "Article",
        q: `${item.title} ${feed.title}`,
        a: `<b>${item.title}</b><br>${short(item.contentSnippet || item.content)}<br><a href="${item.link}" target="_blank">Read more</a>`
      });
    }
  } catch (e) {
    console.error("Feed error:", url, e.message);
  }
}

// Merge with any manual entries you want to keep
let manual = [];
try {
  const raw = await fs.readFile("data/knowledge.json", "utf-8");
  manual = JSON.parse(raw).filter(x => x.manual === true);
} catch {}

const final = [...manual, ...collected];
await fs.mkdir("data", { recursive: true });
await fs.writeFile("data/knowledge.json", JSON.stringify(final, null, 2), "utf-8");
console.log("✅ Wrote", final.length, "items to data/knowledge.json");
