// Renders the precomputed JSON aggregates. No external dependencies:
// the only nontrivial piece is OKLab interpolation for the heatmap ramp.

const SURFACE = "#fcfcfb";
const INK = "#1b1a17";
const MUTED = "#898781";
const RAMP = ["#efeee8", "#2c2b26"]; // sequential: light = wenig, dunkel = viel
const BAR_MAX_PCT = 78; // longest bar leaves room for its value label at the tip

const fmt1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtInt = new Intl.NumberFormat("de-DE");
const fmtDate = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });
const fmtMonth = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

// Grammatik pro Fraktion: Subjekt/Verb für Aussagesätze, von-/Genitiv-Formen
const GRAMMAR = {
  "CDU/CSU": { subj: "Die CDU/CSU", verb: "applaudiert", von: "von der CDU/CSU", gen: "der CDU/CSU" },
  SPD: { subj: "Die SPD", verb: "applaudiert", von: "von der SPD", gen: "der SPD" },
  AfD: { subj: "Die AfD", verb: "applaudiert", von: "von der AfD", gen: "der AfD" },
  "Grüne": { subj: "Die Grünen", verb: "applaudieren", von: "von den Grünen", gen: "der Grünen" },
  Linke: { subj: "Die Linke", verb: "applaudiert", von: "von der Linken", gen: "der Linken" },
};

// --- OKLab (Björn Ottosson) — perceptually smooth ramp with monotone lightness

function srgbToOklab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToSrgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
}

const rampEnds = RAMP.map(srgbToOklab);

function rampColor(t) {
  const lab = rampEnds[0].map((v, i) => v + (rampEnds[1][i] - v) * t);
  const [r, g, b] = oklabToSrgb(lab);
  return { css: `rgb(${r} ${g} ${b})`, dark: lab[0] < 0.62 };
}

// --- tooltip (one shared element; content set via textContent only)

const tooltip = document.getElementById("tooltip");

function showTooltip(value, label, x, y) {
  tooltip.replaceChildren();
  const v = document.createElement("div");
  v.className = "tip-value";
  v.textContent = value;
  const l = document.createElement("div");
  l.textContent = label;
  tooltip.append(v, l);
  tooltip.classList.add("visible");
  const { width, height } = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.min(x + 14, window.innerWidth - width - 8)}px`;
  tooltip.style.top = `${Math.max(8, Math.min(y + 14, window.innerHeight - height - 8))}px`;
}

const hideTooltip = () => tooltip.classList.remove("visible");

function attachTooltip(el, getContent) {
  el.addEventListener("pointermove", (e) => showTooltip(...getContent(), e.clientX, e.clientY));
  el.addEventListener("pointerleave", hideTooltip);
  el.addEventListener("focus", () => {
    const r = el.getBoundingClientRect();
    showTooltip(...getContent(), r.right, r.top);
  });
  el.addEventListener("blur", hideTooltip);
}

// --- matrix heatmap (CSS grid; every cell direct-labeled)

function sentence(kind, from, to, value) {
  const g = GRAMMAR[from];
  const target = from === to ? "bei eigenen Reden" : `bei Reden ${GRAMMAR[to].gen}`;
  if (kind === "beifall") {
    return `${g.subj} ${g.verb} ${target} im Schnitt ${fmt1.format(value)}-mal pro Rede.`;
  }
  const von = g.von[0].toUpperCase() + g.von.slice(1);
  return `${von} kommen ${target} im Schnitt ${fmt1.format(value)} protokollierte Zwischenrufe pro Rede.`;
}

function renderMatrix(kind, matrices) {
  const container = document.getElementById(`matrix-${kind}`);
  const reading = document.getElementById(`reading-${kind}`);
  const parties = matrices.fraktionen;
  const rows = matrices[kind];
  const max = Math.max(...rows.flat());
  const defaultReading =
    "Zelle berühren oder fokussieren, um den Wert im Klartext zu lesen. " +
    "Werte sind gewichtete Ereignisse pro gehaltener Rede.";

  container.style.gridTemplateColumns = `max-content repeat(${parties.length}, 1fr)`;
  container.append(document.createElement("span"));
  for (const p of parties) {
    const head = document.createElement("span");
    head.className = "col-head";
    head.textContent = p;
    container.append(head);
  }
  rows.forEach((row, i) => {
    const head = document.createElement("span");
    head.className = "row-head";
    head.textContent = parties[i];
    container.append(head);
    row.forEach((value, j) => {
      const text = sentence(kind, parties[j], parties[i], value);
      const { css, dark } = rampColor(max ? value / max : 0);
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.type = "button";
      cell.style.background = css;
      cell.style.color = dark ? SURFACE : INK;
      cell.textContent = fmt1.format(value);
      cell.setAttribute("aria-label", text);
      const show = () => (reading.textContent = text);
      cell.addEventListener("pointerenter", show);
      cell.addEventListener("focus", show);
      attachTooltip(cell, () => [
        `${fmt1.format(value)} pro Rede`,
        kind === "beifall" ? `Beifall ${GRAMMAR[parties[j]].von} bei Reden ${GRAMMAR[parties[i]].gen}` : `Zwischenrufe ${GRAMMAR[parties[j]].von} bei Reden ${GRAMMAR[parties[i]].gen}`,
      ]);
      container.append(cell);
    });
  });
  container.addEventListener("pointerleave", () => (reading.textContent = defaultReading));
  reading.textContent = defaultReading;
}

// --- HTML bar lists

function renderBars(id, items, colors, { max, value, short, label, party, tip }) {
  const list = document.getElementById(id);
  for (const item of items) {
    const dt = document.createElement("dt");
    dt.textContent = label(item);
    if (party(item)) {
      const tag = document.createElement("span");
      tag.className = "party-tag";
      tag.textContent = ` (${party(item)})`;
      dt.append(tag);
    }
    const dd = document.createElement("dd");
    const bar = document.createElement("span");
    bar.className = "bar";
    bar.style.width = `${(value(item) / max) * BAR_MAX_PCT}%`;
    bar.style.background = colors[party(item)] ?? MUTED;
    const val = document.createElement("span");
    val.className = "bar-value";
    val.textContent = short(item);
    dd.append(bar, val);
    const row = document.createElement("div");
    row.className = "bar-row";
    row.append(dt, dd);
    attachTooltip(row, () => [tip(item).value, tip(item).label]);
    list.append(row);
  }
}

// --- quotes

function quoteItem(quote, attribution) {
  const li = document.createElement("li");
  const q = document.createElement("div");
  q.className = "quote";
  q.textContent = `„${quote}“`;
  const a = document.createElement("div");
  a.className = "attrib";
  a.textContent = attribution;
  li.append(q, a);
  return li;
}

// --- load & render

async function main() {
  const [matrices, speakers, eigen, zitate, meta] = await Promise.all(
    ["matrices", "speakers", "selbstapplaus", "zitate", "meta"].map((name) =>
      fetch(`data/${name}.json`).then((r) => {
        if (!r.ok) throw new Error(`${name}.json: HTTP ${r.status}`);
        return r.json();
      })
    )
  );

  document.getElementById("hero-eyebrow").textContent =
    `Plenarprotokolle · ${meta.wahlperiode}. Wahlperiode · ${fmtMonth.format(new Date(meta.von))} bis ${fmtMonth.format(new Date(meta.bis))}`;
  document.getElementById("stat-sitzungen").textContent = fmtInt.format(meta.sitzungen);
  document.getElementById("stat-reden").textContent = fmtInt.format(meta.reden);
  document.getElementById("stat-ereignisse").textContent = fmtInt.format(meta.ereignisse);
  document.getElementById("stats").hidden = false;

  renderMatrix("beifall", matrices);
  renderMatrix("zuruf", matrices);

  renderBars("bars-beifall", speakers.beifall, matrices.colors, {
    max: Math.max(...speakers.beifall.map((s) => s.rate)),
    value: (s) => s.rate,
    short: (s) => fmt1.format(s.rate),
    label: (s) => s.speaker,
    party: (s) => s.party,
    tip: (s) => ({
      value: `${fmt1.format(s.rate)} Beifall pro Rede`,
      label: `${s.speaker} (${s.party}), ${fmtInt.format(s.n_reden)} Reden`,
    }),
  });

  renderBars("bars-zurufe", speakers.zurufe, matrices.colors, {
    max: Math.max(...speakers.zurufe.map((s) => s.n)),
    value: (s) => s.n,
    short: (s) => fmtInt.format(s.n),
    label: (s) => s.person,
    party: (s) => s.party,
    tip: (s) => ({
      value: `${fmtInt.format(s.n)} Zwischenrufe`,
      label: `${s.person} (${s.party}), namentlich protokolliert`,
    }),
  });

  renderBars("bars-eigen", eigen, matrices.colors, {
    max: Math.max(...eigen.map((e) => e.share)),
    value: (e) => e.share,
    short: (e) => `${Math.round(e.share * 100)} %`,
    label: (e) => e.party,
    party: () => "",
    tip: (e) => ({
      value: `${Math.round(e.share * 100)} %`,
      label: `des Beifalls für Reden ${GRAMMAR[e.party].gen} kommt aus der eigenen Fraktion`,
    }),
  });
  // Eigenapplaus-Balken tragen die Fraktionsfarbe; die Zeile nennt die Partei im Text
  document.querySelectorAll("#bars-eigen .bar").forEach((bar, i) => {
    bar.style.background = matrices.colors[eigen[i].party] ?? MUTED;
  });

  const legend = document.getElementById("party-legend");
  for (const p of matrices.fraktionen) {
    const li = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = matrices.colors[p];
    li.append(swatch, document.createTextNode(p));
    legend.append(li);
  }

  document.getElementById("zitate-sub").textContent =
    `${fmtInt.format(zitate.gesamt)} Zwischenrufe stehen wörtlich im Protokoll. Links die Klassiker, rechts die jüngsten.`;
  const frequent = document.getElementById("quotes-frequent");
  for (const q of zitate.haeufig) {
    frequent.append(quoteItem(q.quote, `${fmtInt.format(q.n)}-mal protokolliert`));
  }
  const recent = document.getElementById("quotes-recent");
  for (const q of zitate.zuletzt.slice(0, 10)) {
    recent.append(quoteItem(q.quote, `${q.person} (${q.party}) · ${fmtDate.format(new Date(q.date))}`));
  }

  document.getElementById("stand").textContent =
    `Datenstand: ${fmtDate.format(new Date(meta.bis))} (letzte ausgewertete Sitzung) · ` +
    `zuletzt aktualisiert am ${fmtDate.format(new Date(meta.generated_at))} · ` +
    `${fmtInt.format(meta.sitzungen)} Plenarprotokolle ausgewertet`;
}

main().catch((err) => {
  console.error(err);
  document.getElementById("stand").textContent = "Daten konnten nicht geladen werden.";
});
