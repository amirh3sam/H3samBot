// H3samBot — tiny client-side RAG (TF-IDF + cosine)

// --- UI refs ---
const chat  = document.getElementById('chat');
const form  = document.getElementById('chatForm');
const input = document.getElementById('userInput');

function addMsg(role, html) {
  const row = document.createElement('div');
  row.className = 'msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = html;
  row.appendChild(bubble);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

// Opening banner
addMsg(
  'bot',
  `<b>H3samBot</b> ready. Ask me about camera settings, lighting, lenses, networking, Windows/Linux tips, and more.<br>
   <small class="hint">Try: “best shutter for sports” or “fix high CPU on Windows”.</small>`
);

// --- Text utils / vector math ---
function tokenize(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}
function tfidfVectors(docs) {
  const vocab = new Map();
  const tfs = docs.map(tokens => {
    const m = new Map();
    tokens.forEach(w => m.set(w, (m.get(w) || 0) + 1));
    for (const w of m.keys()) if (!vocab.has(w)) vocab.set(w, 0);
    return m;
  });
  for (const m of tfs) for (const w of m.keys()) vocab.set(w, vocab.get(w) + 1);
  const N = docs.length, idf = new Map();
  for (const [w, df] of vocab) idf.set(w, Math.log(1 + N / df));
  const vecs = tfs.map(m => {
    const v = new Map();
    for (const [w, f] of m) v.set(w, f * (idf.get(w) || 0));
    return v;
  });
  return { vecs, idf };
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const [w, va] of a) { na += va * va; const vb = b.get(w); if (vb) dot += va * vb; }
  for (const [, vb] of b) nb += vb * vb;
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// --- KB load + index (with cache-buster) ---
let KB = [];
let pre = null; // {vecs, idf}

async function loadKBAndIndex() {
  const res = await fetch('data/knowledge.json?cb=' + Date.now());
  KB = await res.json();
  const docs = KB.map(x => tokenize((x.q || '') + ' ' + (x.a || '')));
  pre = tfidfVectors(docs);
}
async function ensureReady() {
  if (!pre) await loadKBAndIndex();
}

// --- QA ---
async function answer(q) {
  await ensureReady();

  // Greeting first
  if (/^\s*(hi|hello|hey|yo|sup|greetings|good\s*(morning|evening))\s*$/i.test(q)) {
    return "Hey there 👋 I'm H3samBot — your Photo & Tech assistant! Ask me about photography tips, lighting, camera settings, or Windows/Linux fixes.";
  }

  // Build query vector
  const toks = tokenize(q);
  const m = new Map();
  toks.forEach(w => m.set(w, (m.get(w) || 0) + 1));
  const vq = new Map();
  for (const [w, f] of m) vq.set(w, f * (pre.idf.get(w) || 0));

  // Find best match
  let best = { i: -1, score: 0 };
  pre.vecs.forEach((vd, i) => {
    const s = cosine(vq, vd);
    if (s > best.score) best = { i, score: s };
  });

  if (best.i === -1 || best.score < 0.01) {
    return "I’m not sure yet 🤔 Try “best lens for portraits”, “wifi not working windows”, or teach me by editing <code>data/knowledge.json</code>.";
  }
  const item = KB[best.i];
  return `<b>${item.title || 'Tip'}</b><br>${item.a}`;
}

// --- Form handler ---
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = (input.value || '').trim();
  if (!q) return;
  addMsg('user', q);
  input.value = '';

  const thinking = document.createElement('div');
  thinking.className = 'msg bot';
  thinking.innerHTML = '<div class="bubble">…</div>';
  chat.appendChild(thinking); chat.scrollTop = chat.scrollHeight;

  try {
    const a = await answer(q);
    thinking.remove();
    addMsg('bot', a);
  } catch (err) {
    thinking.remove();
    addMsg('bot', 'Error: ' + (err?.message || err));
  }
});

// --- Boot ---
loadKBAndIndex().catch(console.error);
