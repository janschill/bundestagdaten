// Renders the precomputed JSON aggregates: per-Wahlperiode sections behind a
// switcher, plus cross-period trend lines. No external dependencies: the only
// nontrivial pieces are OKLab interpolation (heatmap ramp) and a small SVG
// line chart.

const SURFACE = "#fcfcfb";
const INK = "#1b1a17";
const MUTED = "#898781";
const RAMP = ["#efeee8", "#2c2b26"]; // sequential: light = wenig, dunkel = viel
const BAR_MAX_PCT = 78; // longest bar leaves room for its value label at the tip
// validated categorical trio for the trend lines (not party colors)
const TREND_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];

const fmt1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtInt = new Intl.NumberFormat("de-DE");
const fmtPct = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 });
const fmtDate = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });
const fmtMonth = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

// Grammatik pro Fraktion: Subjekt/Verb für Aussagesätze, von-/Genitiv-Formen
const GRAMMAR = {
  "CDU/CSU": { subj: "Die CDU/CSU", verb: "applaudiert", von: "von der CDU/CSU", gen: "der CDU/CSU" },
  SPD: { subj: "Die SPD", verb: "applaudiert", von: "von der SPD", gen: "der SPD" },
  AfD: { subj: "Die AfD", verb: "applaudiert", von: "von der AfD", gen: "der AfD" },
  FDP: { subj: "Die FDP", verb: "applaudiert", von: "von der FDP", gen: "der FDP" },
  "Grüne": { subj: "Die Grünen", verb: "applaudieren", von: "von den Grünen", gen: "der Grünen" },
  Linke: { subj: "Die Linke", verb: "applaudiert", von: "von der Linken", gen: "der Linken" },
  BSW: { subj: "Das BSW", verb: "applaudiert", von: "vom BSW", gen: "des BSW" },
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

function showTooltipRows(rows, x, y) {
  tooltip.replaceChildren();
  for (const row of rows) {
    const div = document.createElement("div");
    if (row.strong) div.className = "tip-value";
    if (row.swatch) {
      const key = document.createElement("span");
      key.style.cssText = `display:inline-block;width:10px;height:2px;margin:0 6px 3px 0;background:${row.swatch}`;
      div.append(key);
    }
    div.append(document.createTextNode(row.text));
    tooltip.append(div);
  }
  tooltip.classList.add("visible");
  const { width, height } = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.min(x + 14, window.innerWidth - width - 8)}px`;
  tooltip.style.top = `${Math.max(8, Math.min(y + 14, window.innerHeight - height - 8))}px`;
}

const showTooltip = (value, label, x, y) =>
  showTooltipRows([{ text: value, strong: true }, { text: label }], x, y);

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

  container.replaceChildren();
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
        `${kind === "beifall" ? "Beifall" : "Zwischenrufe"} ${GRAMMAR[parties[j]].von} bei Reden ${GRAMMAR[parties[i]].gen}`,
      ]);
      container.append(cell);
    });
  });
  container.onpointerleave = () => (reading.textContent = defaultReading);
  reading.textContent = defaultReading;
}

// --- HTML bar lists

function renderBars(id, items, colors, { max, value, short, label, party, barColor, tip }) {
  const list = document.getElementById(id);
  list.replaceChildren();
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
    bar.style.background = colors[barColor(item)] ?? MUTED;
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

// --- SVG line chart (quarterly series, crosshair + tooltip, WP markers)

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(name, attrs, textContent) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

function niceStep(max) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
}

const quarterLabel = (q) => `Q${q.slice(5)} ${q.slice(0, 4)}`;

function renderLineChart(containerId, { quarters, series, marks, reden, format }) {
  const W = 680, H = 280, L = 46, R = 86, T = 16, B = 26;
  const container = document.getElementById(containerId);
  container.replaceChildren();
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, tabindex: "0", role: "img" });

  const allValues = series.flatMap((s) => s.values.filter((v) => v != null));
  const step = niceStep(Math.max(...allValues));
  const yMax = step * Math.ceil(Math.max(...allValues) / step + 0.25);
  const x = (i) => L + (i / (quarters.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);

  for (let v = 0; v <= yMax + 1e-9; v += step) {
    svg.append(svgEl("line", { class: "gridline", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    svg.append(svgEl("text", { class: "tick-label", x: L - 8, y: y(v) + 3.5, "text-anchor": "end" }, format(v)));
  }
  quarters.forEach((q, i) => {
    if (q.endsWith("Q1")) {
      svg.append(svgEl("text", { class: "tick-label", x: x(i), y: H - 8, "text-anchor": "middle" }, q.slice(0, 4)));
    }
  });
  for (const mark of marks) {
    if (mark.index <= 0) continue;
    svg.append(svgEl("line", { class: "wp-mark", x1: x(mark.index), x2: x(mark.index), y1: T, y2: H - B }));
    svg.append(svgEl("text", { class: "wp-label", x: x(mark.index) + 4, y: T + 9 }, `WP ${mark.wp}`));
  }

  for (const s of series) {
    let d = "";
    s.values.forEach((v, i) => {
      if (v == null) return;
      d += `${d && s.values[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    svg.append(svgEl("path", { class: "series", d, stroke: s.color }));
  }

  // direct end labels (multi-series only — a single series is named by the
  // heading), nudged apart when series converge
  const ends = (series.length > 1 ? series : [])
    .map((s) => {
      const i = s.values.findLastIndex((v) => v != null);
      return { name: s.name, yPos: y(s.values[i]) };
    })
    .sort((a, b) => a.yPos - b.yPos);
  ends.forEach((e, k) => {
    if (k > 0) e.yPos = Math.max(e.yPos, ends[k - 1].yPos + 14);
    svg.append(svgEl("text", { class: "end-label", x: W - R + 8, y: e.yPos + 3.5 }, e.name));
  });

  const crosshair = svgEl("line", { class: "crosshair", y1: T, y2: H - B });
  svg.append(crosshair);
  const dots = series.map((s) => {
    const dot = svgEl("circle", { class: "cross-dot", r: 4, fill: s.color });
    svg.append(dot);
    return dot;
  });

  const showIndex = (i, clientX, clientY) => {
    crosshair.setAttribute("x1", x(i));
    crosshair.setAttribute("x2", x(i));
    crosshair.style.visibility = "visible";
    series.forEach((s, k) => {
      const v = s.values[i];
      dots[k].style.visibility = v == null ? "hidden" : "visible";
      if (v != null) {
        dots[k].setAttribute("cx", x(i));
        dots[k].setAttribute("cy", y(v));
      }
    });
    showTooltipRows(
      [
        { text: `${quarterLabel(quarters[i])} · ${fmtInt.format(reden[i])} Reden`, strong: true },
        ...series.map((s) => ({
          text: s.values[i] == null ? `${s.name}: –` : `${format(s.values[i])} ${s.name}`,
          swatch: s.color,
        })),
      ],
      clientX,
      clientY
    );
  };

  let activeIndex = quarters.length - 1;
  const hide = () => {
    crosshair.style.visibility = "hidden";
    dots.forEach((d) => (d.style.visibility = "hidden"));
    hideTooltip();
  };
  svg.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    activeIndex = Math.max(0, Math.min(quarters.length - 1, Math.round(((px - L) / (W - L - R)) * (quarters.length - 1))));
    showIndex(activeIndex, e.clientX, e.clientY);
  });
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    activeIndex = Math.max(0, Math.min(quarters.length - 1, activeIndex + (e.key === "ArrowRight" ? 1 : -1)));
    const rect = svg.getBoundingClientRect();
    showIndex(activeIndex, rect.left + (x(activeIndex) / W) * rect.width, rect.top + rect.height / 2);
  });
  svg.addEventListener("blur", hide);

  if (series.length > 1) {
    const legend = document.createElement("ul");
    legend.className = "legend";
    for (const s of series) {
      const li = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = s.color;
      li.append(swatch, document.createTextNode(s.name));
      legend.append(li);
    }
    container.append(legend);
  }
  container.prepend(svg);
}

// --- per-Wahlperiode sections

const fetchJson = (path) =>
  fetch(`data/${path}`).then((r) => {
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  });

async function loadWahlperiode(info) {
  const [matrices, speakers, eigen, zitate] = await Promise.all(
    ["matrices", "speakers", "selbstapplaus", "zitate"].map((n) => fetchJson(`wp${info.wp}/${n}.json`))
  );

  document.getElementById("hero-eyebrow").textContent =
    `Plenarprotokolle · ${info.wp}. Wahlperiode · ${fmtMonth.format(new Date(info.von))} bis ${fmtMonth.format(new Date(info.bis))}`;
  document.getElementById("stat-sitzungen").textContent = fmtInt.format(info.sitzungen);
  document.getElementById("stat-reden").textContent = fmtInt.format(info.reden);
  document.getElementById("stat-ereignisse").textContent = fmtInt.format(info.ereignisse);
  document.getElementById("stats").hidden = false;

  renderMatrix("beifall", matrices);
  renderMatrix("zuruf", matrices);

  renderBars("bars-beifall", speakers.beifall, matrices.colors, {
    max: Math.max(...speakers.beifall.map((s) => s.rate)),
    value: (s) => s.rate,
    short: (s) => fmt1.format(s.rate),
    label: (s) => s.speaker,
    party: (s) => s.party,
    barColor: (s) => s.party,
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
    barColor: (s) => s.party,
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
    barColor: (e) => e.party,
    tip: (e) => ({
      value: `${Math.round(e.share * 100)} %`,
      label: `des Beifalls für Reden ${GRAMMAR[e.party].gen} kommt aus der eigenen Fraktion`,
    }),
  });

  const legend = document.getElementById("party-legend");
  legend.replaceChildren();
  for (const p of matrices.fraktionen) {
    const li = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = matrices.colors[p];
    li.append(swatch, document.createTextNode(p));
    legend.append(li);
  }

  document.getElementById("zitate-sub").textContent =
    `${fmtInt.format(zitate.gesamt)} Zwischenrufe der ${info.wp}. Wahlperiode stehen wörtlich im Protokoll. Links die Klassiker, rechts die jüngsten.`;
  const frequent = document.getElementById("quotes-frequent");
  frequent.replaceChildren();
  for (const q of zitate.haeufig) {
    frequent.append(quoteItem(q.quote, `${fmtInt.format(q.n)}-mal protokolliert`));
  }
  const recent = document.getElementById("quotes-recent");
  recent.replaceChildren();
  for (const q of zitate.zuletzt.slice(0, 10)) {
    recent.append(quoteItem(q.quote, `${q.person} (${q.party}) · ${fmtDate.format(new Date(q.date))}`));
  }
}

// --- boot

async function main() {
  const [meta, trends] = await Promise.all([fetchJson("meta.json"), fetchJson("trends.json")]);
  const perioden = meta.wahlperioden;
  const current = perioden[perioden.length - 1];

  const switcher = document.getElementById("wp-switch");
  for (const info of perioden) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "wp";
    input.value = info.wp;
    input.checked = info.wp === current.wp;
    input.addEventListener("change", () => {
      loadWahlperiode(info).catch(console.error);
    });
    label.append(input, document.createTextNode(`WP ${info.wp}`));
    label.title = `${fmtMonth.format(new Date(info.von))} bis ${fmtMonth.format(new Date(info.bis))}`;
    switcher.append(label);
  }
  switcher.hidden = perioden.length < 2;

  await loadWahlperiode(current);

  const marks = trends.wp_marken.map((m) => ({
    wp: m.wp,
    index: trends.quartale.indexOf(`${m.von.slice(0, 4)}Q${Math.floor((+m.von.slice(5, 7) - 1) / 3) + 1}`),
  }));

  renderLineChart("chart-fremd", {
    quarters: trends.quartale,
    reden: trends.reden,
    marks,
    format: (v) => fmtPct.format(v),
    series: [{ name: "fraktionsübergreifend", color: TREND_COLORS[0], values: trends.beifall_fremd_anteil }],
  });

  renderLineChart("chart-reaktionen", {
    quarters: trends.quartale,
    reden: trends.reden,
    marks,
    format: (v) => fmt1.format(v),
    series: [
      { name: "Beifall", color: TREND_COLORS[0], values: trends.beifall_pro_rede },
      { name: "Zurufe", color: TREND_COLORS[1], values: trends.zurufe_pro_rede },
      { name: "Lachen", color: TREND_COLORS[2], values: trends.lachen_pro_rede },
    ],
  });

  document.getElementById("stand").textContent =
    `Datenstand: ${fmtDate.format(new Date(current.bis))} (letzte ausgewertete Sitzung) · ` +
    `zuletzt aktualisiert am ${fmtDate.format(new Date(meta.generated_at))} · ` +
    `${fmtInt.format(perioden.reduce((sum, p) => sum + p.sitzungen, 0))} Plenarprotokolle ausgewertet`;
}

main().catch((err) => {
  console.error(err);
  document.getElementById("stand").textContent = "Daten konnten nicht geladen werden.";
});
