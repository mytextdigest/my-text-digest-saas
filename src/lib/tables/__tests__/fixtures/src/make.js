// Generates the HTML sources for the table-extraction fixture corpus, plus
// the expected tables (ground truth) written from the same source data — so
// the golden tests never compare the extractor against its own output.
// Run: node make.js && ./convert.sh   (needs LibreOffice)
const fs = require("fs");
const path = require("path");
const expected = {};
const strip = (s) => String(s).replace(/<sup>(.*?)<\/sup>/g, "$1").replace(/&amp;/g, "&");

const css = `body{font-family:'DejaVu Sans',Arial,sans-serif;font-size:10pt}
table.ruled{border-collapse:collapse} table.ruled td, table.ruled th{border:1px solid #000;padding:3px 8px}
table.plain td, table.plain th{padding:2px 14px} td.n{text-align:right} th{text-align:left}`;

const prose = (n) => Array.from({ length: n }, (_, i) =>
  `<p>The company continued to invest in its core platforms during the year. Management believes the strategy positions the business for sustained growth across all operating segments, and paragraph ${i + 1} expands on market conditions, customer demand and the competitive landscape in plain narrative prose.</p>`).join("\n");

function report({ name, year, prev, regions, unitCaption, opex, stores }) {
  expected[name] = [
    { caption: `Table 1: Revenue by Region ${unitCaption}`, title: "Revenue by Region", headers: ["Region", String(year), String(prev)], rows: regions.map((r) => r.map(strip)), multiPage: false },
    { caption: "Table 2: Operating Expenses (in $ millions)", title: "Operating Expenses", headers: ["Category", String(year), String(prev)], rows: opex.map((r) => r.map(strip)), multiPage: false },
    { caption: "Table 3: Store Locations", title: "Store Locations", headers: ["City", "Country", "Stores", "Floor area (sq ft)"], rows: stores.map((s) => [s.city, s.country, String(s.count), s.sqft]), multiPage: true },
  ];
  const regionRows = regions.map(([name, a, b]) => `<tr><td>${name}</td><td class="n">${a}</td><td class="n">${b}</td></tr>`).join("");
  const opexRows = opex.map(([name, a, b]) => `<tr><td>${name}</td><td class="n">${a}</td><td class="n">${b}</td></tr>`).join("");
  const storeRows = stores.map((s, i) => `<tr><td>${s.city}</td><td>${s.country}</td><td class="n">${s.count}</td><td class="n">${s.sqft}</td></tr>`).join("");
  return `<html><head><meta charset="utf-8"><style>${css}</style></head><body>
<h1>Acme Corp Annual Report ${year}</h1>
${prose(3)}
<h2>Financial highlights</h2>
<p>Table 1: Revenue by Region ${unitCaption}</p>
<table class="plain">
<thead><tr><th></th><th colspan="2" style="text-align:center">Revenue</th></tr>
<tr><th>Region</th><th class="n">${year}</th><th class="n">${prev}</th></tr></thead>
<tbody>${regionRows}</tbody></table>
${prose(2)}
<p>Table 2: Operating Expenses (in $ millions)</p>
<table class="ruled" border="1" cellspacing="0" cellpadding="4" width="85%">
<thead><tr><th>Category</th><th>${year}</th><th>${prev}</th></tr></thead>
<tbody>${opexRows}</tbody></table>
<p>(a) Restated for discontinued operations.</p>
${prose(3)}
<h2>Store network</h2>
<p>Table 3: Store Locations</p>
<table class="ruled" border="1" cellspacing="0" cellpadding="4" width="85%">
<thead><tr><th>City</th><th>Country</th><th>Stores</th><th>Floor area (sq ft)</th></tr></thead>
<tbody>${storeRows}</tbody></table>
${prose(2)}
</body></html>`;
}

const cities = ["Boston", "Chicago", "Denver", "Austin", "Seattle", "Toronto", "Berlin", "Paris", "Madrid", "Rome", "Tokyo", "Osaka", "Sydney", "Lima", "Bogota", "Dublin", "Oslo", "Vienna", "Prague", "Lisbon"];
const countries = ["USA", "USA", "USA", "USA", "USA", "Canada", "Germany", "France", "Spain", "Italy", "Japan", "Japan", "Australia", "Peru", "Colombia", "Ireland", "Norway", "Austria", "Czechia", "Portugal"];
const stores = (seed) => Array.from({ length: 60 }, (_, i) => ({
  city: `${cities[i % 20]} ${Math.floor(i / 20) + 1}`,
  country: countries[i % 20],
  count: ((i * 7 + seed) % 23) + 2,
  sqft: ((((i * 131 + seed * 17) % 900) + 100) * 1000).toLocaleString("en-US"),
}));

fs.writeFileSync("annual_report_2025.html", report({
  name: "annual_report_2025", year: 2025, prev: 2024, unitCaption: "(in $ millions)",
  regions: [["North America", "1,234.5", "1,102.0"], ["Europe", "845.2", "790.4"], ["Asia Pacific", "612.8", "540.3"], ["Latin America", "(12.0)", "8.5"], ["Total", "2,680.5", "2,441.2"]],
  opex: [["Research &amp; development", "410.2", "380.9"], ["Sales and marketing", "298.7", "301.1"], ["General and administrative", "120.4", "115.0<sup>a</sup>"], ["Total operating expenses", "829.3", "797.0"]],
  stores: stores(3),
}));

// 2024 report: abbreviated row label, values in thousands, and a 2023 column;
// its 2024 North America figure differs from the 2025 report's restated one.
fs.writeFileSync("annual_report_2024.html", report({
  name: "annual_report_2024", year: 2024, prev: 2023, unitCaption: "(in $ thousands)",
  regions: [["N. America", "1,098,000", "990,500"], ["Europe", "790,400", "701,200"], ["Asia Pacific", "540,300", "498,100"], ["Latin America", "8,500", "15,900"], ["Total", "2,437,200", "2,205,700"]],
  opex: [["Research &amp; development", "380.9", "350.2"], ["Sales and marketing", "301.1", "280.4"], ["General and administrative", "115.0", "109.8"], ["Total operating expenses", "797.0", "740.4"]],
  stores: stores(5),
}));

// Research-paper style: a results table with % and a text-only comparison
// table, plus a table of contents that must NOT be detected.
fs.writeFileSync("research_paper.html", `<html><head><meta charset="utf-8"><style>${css}</style></head><body>
<h1>Evaluating Retrieval Methods</h1>
<p>Contents</p>
<p>1 Introduction ........................................ 1</p>
<p>2 Method ................................................ 2</p>
<p>3 Results ............................................... 3</p>
<p>4 Discussion ............................................ 4</p>
${prose(2)}
<p>Table 1: Retrieval accuracy by method</p>
<table class="ruled" border="1" cellspacing="0" cellpadding="4" width="85%">
<thead><tr><th>Method</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead>
<tbody>
<tr><td>BM25</td><td>61.2%</td><td>55.0%</td><td>57.9%</td></tr>
<tr><td>Dense</td><td>68.4%</td><td>63.1%</td><td>65.6%</td></tr>
<tr><td>Hybrid</td><td>74.9%</td><td>70.2%</td><td>72.5%</td></tr>
</tbody></table>
${prose(2)}
<p>Table 2: Qualitative comparison</p>
<table class="ruled" border="1" cellspacing="0" cellpadding="4" width="85%">
<thead><tr><th>Aspect</th><th>Sparse</th><th>Dense</th></tr></thead>
<tbody>
<tr><td>Index size</td><td>Small</td><td>Large</td></tr>
<tr><td>Handles synonyms</td><td>No</td><td>Yes</td></tr>
<tr><td>Exact match</td><td>Strong</td><td>Weak</td></tr>
</tbody></table>
<table><tr><td>${prose(1)}</td></tr></table>
${prose(2)}
</body></html>`);
expected.research_paper = [
  { caption: "Table 1: Retrieval accuracy by method", title: "Retrieval accuracy by method", headers: ["Method", "Precision", "Recall", "F1"],
    rows: [["BM25", "61.2%", "55.0%", "57.9%"], ["Dense", "68.4%", "63.1%", "65.6%"], ["Hybrid", "74.9%", "70.2%", "72.5%"]], multiPage: false },
  { caption: "Table 2: Qualitative comparison", title: "Qualitative comparison", headers: ["Aspect", "Sparse", "Dense"],
    rows: [["Index size", "Small", "Large"], ["Handles synonyms", "No", "Yes"], ["Exact match", "Strong", "Weak"]], multiPage: false },
];
fs.writeFileSync(path.join("..", "expected.json"), JSON.stringify(expected, null, 2));
console.log("ok");
