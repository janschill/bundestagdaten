// Shared chart components for index and the per-Wahlperiode pages.
// No external dependencies: the only nontrivial pieces are OKLab
// interpolation (heatmap ramp) and a small SVG line chart.

export const SURFACE = "#fcfcfb";
export const INK = "#1b1a17";
export const MUTED = "#898781";
const RAMP = ["#efeee8", "#2c2b26"]; // sequential: light = wenig, dunkel = viel
const BAR_MAX_PCT = 78; // longest bar leaves room for its value label at the tip
// validated categorical trio for the trend lines (not party colors)
export const TREND_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];

export const fmt1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtInt = new Intl.NumberFormat("de-DE");
export const fmtPct = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 });
export const fmtDate = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });
export const fmtMonth = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

// Grammatik pro Fraktion: Subjekt/Verb für Aussagesätze, von-/Genitiv-Formen
export const GRAMMAR = {
  "CDU/CSU": { subj: "Die CDU/CSU", verb: "applaudiert", von: "von der CDU/CSU", gen: "der CDU/CSU" },
  SPD: { subj: "Die SPD", verb: "applaudiert", von: "von der SPD", gen: "der SPD" },
  AfD: { subj: "Die AfD", verb: "applaudiert", von: "von der AfD", gen: "der AfD" },
  FDP: { subj: "Die FDP", verb: "applaudiert", von: "von der FDP", gen: "der FDP" },
  "Grüne": { subj: "Die Grünen", verb: "applaudieren", von: "von den Grünen", gen: "der Grünen" },
  Linke: { subj: "Die Linke", verb: "applaudiert", von: "von der Linken", gen: "der Linken" },
  BSW: { subj: "Das BSW", verb: "applaudiert", von: "vom BSW", gen: "des BSW" },
};

// --- data loading (base differs between index and /wp/<N>/ pages)

let dataBase = "data/";

export function setDataBase(base) {
  dataBase = base;
}

export const fetchJson = (path) =>
  fetch(`${dataBase}${path}`).then((r) => {
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  });

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

export function rampColor(t) {
  const lab = rampEnds[0].map((v, i) => v + (rampEnds[1][i] - v) * t);
  const [r, g, b] = oklabToSrgb(lab);
  return { css: `rgb(${r} ${g} ${b})`, dark: lab[0] < 0.62 };
}

// --- tooltip (one shared element; content set via textContent only)

const tooltip = document.getElementById("tooltip");

export function showTooltipRows(rows, x, y) {
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

export const showTooltip = (value, label, x, y) =>
  showTooltipRows([{ text: value, strong: true }, { text: label }], x, y);

export const hideTooltip = () => tooltip.classList.remove("visible");

export function attachTooltip(el, getContent) {
  el.addEventListener("pointermove", (e) => showTooltip(...getContent(), e.clientX, e.clientY));
  el.addEventListener("pointerleave", hideTooltip);
  el.addEventListener("focus", () => {
    const r = el.getBoundingClientRect();
    showTooltip(...getContent(), r.right, r.top);
  });
  el.addEventListener("blur", hideTooltip);
}

// --- matrix heatmap (CSS grid; every cell direct-labeled)

export function sentence(kind, from, to, value) {
  const g = GRAMMAR[from];
  const target = from === to ? "bei eigenen Reden" : `bei Reden ${GRAMMAR[to].gen}`;
  if (kind === "beifall") {
    return `${g.subj} ${g.verb} ${target} im Schnitt ${fmt1.format(value)}-mal pro Rede.`;
  }
  const von = g.von[0].toUpperCase() + g.von.slice(1);
  return `${von} kommen ${target} im Schnitt ${fmt1.format(value)} protokollierte Zwischenrufe pro Rede.`;
}

export function renderMatrix(kind, matrices) {
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

export function renderBars(id, items, colors, { max, value, short, label, party, barColor, tip }) {
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

export function quoteItem(quote, attribution) {
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

// --- SVG line chart (crosshair + tooltip, optional markers)

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

export const quarterLabel = (q) => `Q${q.slice(5)} ${q.slice(0, 4)}`;

export function renderLineChart(containerId, { labels, series, marks, xTick, tooltipTitle, format }) {
  const W = 680, H = 280, L = 46, R = 86, T = 16, B = 26;
  const container = document.getElementById(containerId);
  container.replaceChildren();
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, tabindex: "0", role: "img" });

  const allValues = series.flatMap((s) => s.values.filter((v) => v != null));
  const step = niceStep(Math.max(...allValues));
  const yMax = step * Math.ceil(Math.max(...allValues) / step + 0.25);
  const x = (i) => L + (i / (labels.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);

  for (let v = 0; v <= yMax + 1e-9; v += step) {
    svg.append(svgEl("line", { class: "gridline", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    svg.append(svgEl("text", { class: "tick-label", x: L - 8, y: y(v) + 3.5, "text-anchor": "end" }, format(v)));
  }
  labels.forEach((label, i) => {
    const tick = xTick(label, i);
    if (tick != null) {
      svg.append(svgEl("text", { class: "tick-label", x: x(i), y: H - 8, "text-anchor": "middle" }, tick));
    }
  });
  for (const mark of marks ?? []) {
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
        { text: tooltipTitle(i), strong: true },
        ...series.map((s) => ({
          text: s.values[i] == null ? `${s.name}: –` : `${format(s.values[i])} ${s.name}`,
          swatch: s.color,
        })),
      ],
      clientX,
      clientY
    );
  };

  let activeIndex = labels.length - 1;
  const hide = () => {
    crosshair.style.visibility = "hidden";
    dots.forEach((d) => (d.style.visibility = "hidden"));
    hideTooltip();
  };
  svg.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    activeIndex = Math.max(0, Math.min(labels.length - 1, Math.round(((px - L) / (W - L - R)) * (labels.length - 1))));
    showIndex(activeIndex, e.clientX, e.clientY);
  });
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    activeIndex = Math.max(0, Math.min(labels.length - 1, activeIndex + (e.key === "ArrowRight" ? 1 : -1)));
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

// --- shared party legend

export function renderPartyLegend(id, matrices) {
  const legend = document.getElementById(id);
  legend.replaceChildren();
  for (const p of matrices.fraktionen) {
    const li = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = matrices.colors[p];
    li.append(swatch, document.createTextNode(p));
    legend.append(li);
  }
}
