// Index page: Wahlperioden overview with switcher + cross-period trends.

import {
  GRAMMAR, TREND_COLORS,
  fmt1, fmtInt, fmtPct, fmtDate, fmtMonth,
  fetchJson, quarterLabel, quoteItem,
  renderBars, renderLineChart, renderMatrix, renderPartyLegend,
} from "./charts.js";

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

  const detail = document.getElementById("wp-detail-link");
  detail.href = `wp/${info.wp}/`;
  detail.hidden = false;

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

  renderPartyLegend("party-legend", matrices);

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

async function main() {
  const [meta, trends, history] = await Promise.all([
    fetchJson("meta.json"),
    fetchJson("trends.json"),
    fetchJson("seit1949.json"),
  ]);
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

  const quarterTick = (q) => (q.endsWith("Q1") ? q.slice(0, 4) : null);
  const quarterTitle = (i) => `${quarterLabel(trends.quartale[i])} · ${fmtInt.format(trends.reden[i])} Reden`;

  renderLineChart("chart-1949", {
    labels: history.jahre,
    xTick: (year) => (year % 10 === 0 ? String(year) : null),
    tooltipTitle: (i) => `${history.jahre[i]} · ${fmtInt.format(history.sitzungen[i])} Sitzungen`,
    format: (v) => fmt1.format(v),
    series: [
      { name: "Beifall", color: TREND_COLORS[0], values: history.beifall },
      { name: "Zurufe", color: TREND_COLORS[1], values: history.zurufe },
      { name: "Lachen", color: TREND_COLORS[2], values: history.lachen },
    ],
  });

  renderLineChart("chart-fremd", {
    labels: trends.quartale,
    xTick: quarterTick,
    tooltipTitle: quarterTitle,
    marks,
    format: (v) => fmtPct.format(v),
    series: [{ name: "fraktionsübergreifend", color: TREND_COLORS[0], values: trends.beifall_fremd_anteil }],
  });

  renderLineChart("chart-reaktionen", {
    labels: trends.quartale,
    xTick: quarterTick,
    tooltipTitle: quarterTitle,
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
