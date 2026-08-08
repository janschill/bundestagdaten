// Per-Wahlperiode drill-down page (/wp/<N>/). The WP number comes from
// <body data-wp>; data is fetched from the shared site/data/ tree.

import {
  GRAMMAR, TREND_COLORS,
  fmt1, fmtInt, fmtPct, fmtDate, fmtMonth,
  fetchJson, setDataBase, quoteItem,
  renderBars, renderLineChart, renderMatrix,
} from "./charts.js";

setDataBase("../../data/");
const WP = document.body.dataset.wp;

// --- sortable table

function renderTable(id, { columns, rows, defaultSort }) {
  const table = document.getElementById(id);
  const state = { key: defaultSort, descending: true };

  const render = () => {
    table.replaceChildren();
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of columns) {
      const th = document.createElement("th");
      th.textContent = col.title;
      th.scope = "col";
      if (col.numeric) th.className = "num";
      if (col.key === state.key) th.setAttribute("aria-sort", state.descending ? "descending" : "ascending");
      th.addEventListener("click", () => {
        state.descending = col.key === state.key ? !state.descending : true;
        state.key = col.key;
        render();
      });
      headRow.append(th);
    }
    thead.append(headRow);

    const sorted = [...rows].sort((a, b) => {
      const va = a[state.key], vb = b[state.key];
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "de");
      return state.descending ? -cmp : cmp;
    });
    const tbody = document.createElement("tbody");
    for (const row of sorted) {
      const tr = document.createElement("tr");
      for (const col of columns) {
        const td = document.createElement("td");
        if (col.numeric) td.className = "num";
        td.textContent = col.format ? col.format(row[col.key]) : row[col.key];
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
  };
  render();
}

// --- quote archive with year/party/text filters

function setupArchive(zitate, fraktionen) {
  const yearSelect = document.getElementById("archiv-jahr");
  const partySelect = document.getElementById("archiv-partei");
  const searchInput = document.getElementById("archiv-suche");
  const list = document.getElementById("archiv-liste");
  const count = document.getElementById("archiv-count");
  const years = [...zitate.jahre].reverse();
  const cache = new Map();

  document.getElementById("archiv-sub").textContent =
    `${fmtInt.format(zitate.gesamt)} wörtlich protokollierte Zwischenrufe der ${WP}. Wahlperiode.`;

  for (const year of years) {
    yearSelect.append(new Option(String(year), String(year)));
  }
  partySelect.append(new Option("Alle Fraktionen", ""));
  for (const p of fraktionen) partySelect.append(new Option(p, p));

  const update = async () => {
    const year = yearSelect.value;
    if (!cache.has(year)) {
      cache.set(year, await fetchJson(`wp${WP}/zitate-${year}.json`));
    }
    const needle = searchInput.value.trim().toLowerCase();
    const party = partySelect.value;
    // rows are [quote, person, party, to_speaker, date]
    const matches = cache.get(year).filter(
      ([quote, , rowParty]) => (!party || rowParty === party) && (!needle || quote.toLowerCase().includes(needle))
    );
    count.textContent =
      matches.length > 100
        ? `${fmtInt.format(matches.length)} Treffer in ${year} — die 100 jüngsten werden angezeigt.`
        : `${fmtInt.format(matches.length)} Treffer in ${year}.`;
    list.replaceChildren();
    for (const [quote, person, rowParty, toSpeaker, date] of matches.slice(0, 100)) {
      list.append(
        quoteItem(quote, `${person} (${rowParty}) · ${fmtDate.format(new Date(date))} · bei ${toSpeaker}`)
      );
    }
  };

  yearSelect.addEventListener("change", () => update().catch(console.error));
  partySelect.addEventListener("change", () => update().catch(console.error));
  searchInput.addEventListener("input", () => update().catch(console.error));
  return update();
}

// --- sittings: highlights + table

function renderSitzungen(sitzungen) {
  const highlights = document.getElementById("sitzung-highlights");
  const rate = (s, kind) => (s.reden ? s[kind] / s.reden : 0);
  const superlatives = [
    ["zurufe", "lauteste Sitzung", "Zurufe pro Rede"],
    ["beifall", "applausreichste Sitzung", "Beifall pro Rede"],
    ["lachen", "heiterste Sitzung", "Lachen pro Rede"],
  ];
  for (const [kind, title, unit] of superlatives) {
    const top = sitzungen.reduce((a, b) => (rate(b, kind) > rate(a, kind) ? b : a));
    const div = document.createElement("div");
    div.className = "highlight";
    const value = document.createElement("div");
    value.className = "value";
    value.textContent = `${top.nr}. Sitzung · ${fmt1.format(rate(top, kind))}`;
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = `${title} — ${unit}, ${fmtDate.format(new Date(top.datum))}`;
    div.append(value, label);
    highlights.append(div);
  }

  renderTable("table-sitzungen", {
    defaultSort: "nr",
    columns: [
      { key: "nr", title: "Nr.", numeric: true },
      { key: "datum", title: "Datum", format: (d) => fmtDate.format(new Date(d)) },
      { key: "reden", title: "Reden", numeric: true, format: (v) => fmtInt.format(v) },
      { key: "beifall", title: "Beifall", numeric: true, format: (v) => fmtInt.format(v) },
      { key: "zurufe", title: "Zurufe", numeric: true, format: (v) => fmtInt.format(v) },
      { key: "lachen", title: "Lachen", numeric: true, format: (v) => fmtInt.format(v) },
    ],
    rows: sitzungen,
  });
}

// --- boot

async function main() {
  const [meta, matrices, verlauf, personen, eigen, zitate, sitzungen] = await Promise.all([
    fetchJson("meta.json"),
    ...["matrices", "verlauf", "personen", "selbstapplaus", "zitate", "sitzungen"].map((n) =>
      fetchJson(`wp${WP}/${n}.json`)
    ),
  ]);
  const info = meta.wahlperioden.find((p) => String(p.wp) === WP);

  document.getElementById("hero-eyebrow").textContent =
    `Plenarprotokolle · ${fmtMonth.format(new Date(info.von))} bis ${fmtMonth.format(new Date(info.bis))}`;
  document.getElementById("stat-sitzungen").textContent = fmtInt.format(info.sitzungen);
  document.getElementById("stat-reden").textContent = fmtInt.format(info.reden);
  document.getElementById("stat-ereignisse").textContent = fmtInt.format(info.ereignisse);
  document.getElementById("stats").hidden = false;

  renderMatrix("beifall", matrices);
  renderMatrix("zuruf", matrices);

  // labels are "YYYY-MM"; tick the first month and every January
  const monthTick = (m, i) => (i === 0 || m.endsWith("-01") ? m.slice(0, 4) : null);
  const monthTitle = (i) =>
    `${fmtMonth.format(new Date(`${verlauf.monate[i]}-01`))} · ${fmtInt.format(verlauf.reden[i])} Reden`;

  renderLineChart("chart-fremd", {
    labels: verlauf.monate,
    xTick: monthTick,
    tooltipTitle: monthTitle,
    format: (v) => fmtPct.format(v),
    series: [{ name: "fraktionsübergreifend", color: TREND_COLORS[0], values: verlauf.beifall_fremd_anteil }],
  });

  renderLineChart("chart-reaktionen", {
    labels: verlauf.monate,
    xTick: monthTick,
    tooltipTitle: monthTitle,
    format: (v) => fmt1.format(v),
    series: [
      { name: "Beifall", color: TREND_COLORS[0], values: verlauf.beifall_pro_rede },
      { name: "Zurufe", color: TREND_COLORS[1], values: verlauf.zurufe_pro_rede },
      { name: "Lachen", color: TREND_COLORS[2], values: verlauf.lachen_pro_rede },
    ],
  });

  renderLineChart("chart-fraktion", {
    labels: verlauf.monate,
    xTick: monthTick,
    tooltipTitle: monthTitle,
    format: (v) => fmt1.format(v),
    series: verlauf.fraktionen.map((p) => ({
      name: p,
      color: matrices.colors[p],
      values: verlauf.zurufe_je_fraktion[p],
    })),
  });

  renderTable("table-redner", {
    defaultSort: "rate",
    columns: [
      { key: "name", title: "Name" },
      { key: "party", title: "Fraktion/Rolle" },
      { key: "reden", title: "Reden", numeric: true, format: (v) => fmtInt.format(v) },
      { key: "rate", title: "Beifall/Rede", numeric: true, format: (v) => fmt1.format(v) },
    ],
    rows: personen.redner,
  });

  renderTable("table-zwischenrufer", {
    defaultSort: "n",
    columns: [
      { key: "person", title: "Name" },
      { key: "party", title: "Fraktion" },
      { key: "n", title: "Zurufe", numeric: true, format: (v) => fmtInt.format(v) },
    ],
    rows: personen.zwischenrufer,
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

  await setupArchive(zitate, matrices.fraktionen);
  renderSitzungen(sitzungen);
}

main().catch((err) => {
  console.error(err);
  document.getElementById("archiv-count").textContent = "Daten konnten nicht geladen werden.";
});
