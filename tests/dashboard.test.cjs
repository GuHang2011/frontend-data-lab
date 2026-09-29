const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {validateData, filterRows, summarize, dailySeries, csvForSeries, isDate} = require("../site/dashboard.js");
const row = (day, region, channel, completed, refunded, cents) => ({day, region, channel, total_orders: completed + refunded, completed_orders: completed, refunded_orders: refunded, cancelled_orders: 0, revenue_cents: cents});
const rows = [row("2026-01-01", "east", "web", 2, 1, 3000), row("2026-01-03", "west", "app", 1, 0, 10000)];

test("region, channel, and inclusive date filters compose", () => {
  assert.deepEqual(filterRows(rows, {region:"east",channel:"web",from:"2026-01-01",to:"2026-01-01"}), [rows[0]]);
  assert.equal(filterRows(rows, {region:"east",channel:"app",from:"2026-01-01",to:"2026-01-03"}).length, 0);
});
test("averages and ratios use weighted denominators", () => {
  const sums = summarize(rows);
  assert.equal(sums.average_cents, 13000 / 3);
  assert.equal(sums.refund_ratio, 1 / 4);
  assert.equal(summarize([]).average_cents, null);
  assert.equal(summarize([]).refund_ratio, null);
});
test("daily series zero-fills missing calendar days and supports one day", () => {
  const result = dailySeries(rows, "2026-01-01", "2026-01-03");
  assert.equal(result.length, 3);
  assert.equal(result[1].revenue_cents, 0);
  assert.equal(result[2].revenue_cents, 10000);
  assert.equal(dailySeries(rows, "2026-01-01", "2026-01-01").length, 1);
  assert.deepEqual(dailySeries(rows, "2026-01-03", "2026-01-01"), []);
});
test("invalid dates are rejected", () => {
  assert.equal(isDate("2026-02-30"), false);
  assert.equal(isDate("2026-2-1"), false);
  assert.equal(isDate("2026-02-01"), true);
});
test("CSV exports current daily values with decimal currency", () => {
  const result = csvForSeries(dailySeries([rows[0]], "2026-01-01", "2026-01-01"));
  assert.match(result, /2026-01-01,3,2,30\.00,1,0$/);
});
test("committed demo data satisfies schema and offline bundle equals JSON", () => {
  const base = path.join(__dirname, "../site/data");
  const json = JSON.parse(fs.readFileSync(path.join(base, "summary.json"), "utf8"));
  assert.equal(validateData(json), json);
  const script = fs.readFileSync(path.join(base, "summary.js"), "utf8");
  assert.deepEqual(JSON.parse(script.replace(/^window\.DEMO_DATA = /, "").replace(/;\r?\n$/, "")), json);
  const invalid = {...json, source_rows: json.source_rows + 1};
  assert.throws(() => validateData(invalid), /源记录数/);
  assert.equal(summarize(json.rows).total_orders, json.source_rows);
});
