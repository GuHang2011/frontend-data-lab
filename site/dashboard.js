/* No framework, build step or network request: also runs directly from file://. */
"use strict";
const REGIONS = {east: "华东（模拟）", central: "华中（模拟）", west: "西部（模拟）"};
const METRICS = ["total_orders", "completed_orders", "refunded_orders", "cancelled_orders", "revenue_cents"];
const integer = new Intl.NumberFormat("zh-CN");
const money = cents => new Intl.NumberFormat("zh-CN", {style: "currency", currency: "CNY", maximumFractionDigits: 2}).format(cents / 100);
const escapeText = value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateData(data) {
  if (!data || data.schema_version !== 1 || data.dataset_kind !== "synthetic_educational_demo" || data.currency !== "CNY" || !Array.isArray(data.rows) || !data.rows.length) throw new Error("数据版本或来源类型不符合本示例的数据契约。");
  if (!isDate(data.date_start) || !isDate(data.date_end) || data.date_start > data.date_end) throw new Error("数据日期范围无效。");
  if ((Date.parse(data.date_end) - Date.parse(data.date_start)) / 86400000 > 3660) throw new Error("此教学页面最多展示十年的日期范围。");
  const groups = new Set();
  let total = 0;
  for (const row of data.rows) {
    if (!isDate(row.day) || row.day < data.date_start || row.day > data.date_end || !Object.hasOwn(REGIONS, row.region) || !["web", "app"].includes(row.channel)) throw new Error("发现无效的日期、区域或渠道。");
    if (!METRICS.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0)) throw new Error("指标必须是非负安全整数。");
    if (row.total_orders !== row.completed_orders + row.refunded_orders + row.cancelled_orders) throw new Error("订单状态计数不一致。");
    if (row.completed_orders === 0 && row.revenue_cents !== 0) throw new Error("无完成订单时完成金额应为零。");
    const group = [row.day, row.region, row.channel].join("/");
    if (groups.has(group)) throw new Error("聚合数据中存在重复分组。");
    groups.add(group);
    total += row.total_orders;
  }
  if (!Number.isSafeInteger(total) || total !== data.source_rows) throw new Error("聚合计数与源记录数不一致。");
  return data;
}

function filterRows(rows, state) {
  return rows.filter(row => (state.region === "all" || row.region === state.region) && (state.channel === "all" || row.channel === state.channel) && row.day >= state.from && row.day <= state.to);
}

function summarize(rows) {
  const sums = Object.fromEntries(METRICS.map(key => [key, 0]));
  for (const row of rows) for (const key of METRICS) sums[key] += row[key];
  return {...sums, average_cents: sums.completed_orders ? sums.revenue_cents / sums.completed_orders : null, refund_ratio: sums.total_orders ? sums.refunded_orders / sums.total_orders : null};
}

function dailySeries(rows, from, to) {
  if (!isDate(from) || !isDate(to) || from > to) return [];
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.day) || Object.fromEntries(METRICS.map(key => [key, 0]));
    for (const key of METRICS) current[key] += row[key];
    grouped.set(row.day, current);
  }
  const series = [];
  const end = Date.parse(to + "T00:00:00Z");
  for (let stamp = Date.parse(from + "T00:00:00Z"); stamp <= end; stamp += 86400000) {
    const day = new Date(stamp).toISOString().slice(0, 10);
    series.push({day, ...(grouped.get(day) || Object.fromEntries(METRICS.map(key => [key, 0])))});
  }
  return series;
}

function csvForSeries(series) {
  // All fields are contract-validated ISO dates or generated numbers; no free text.
  return ["date,total_orders,completed_orders,revenue_cny,refunded_orders,cancelled_orders", ...series.map(row => [row.day, row.total_orders, row.completed_orders, (row.revenue_cents / 100).toFixed(2), row.refunded_orders, row.cancelled_orders].join(","))].join("\r\n");
}

function boot() {
  const $ = id => document.getElementById(id);
  let data;
  try { data = validateData(window.DEMO_DATA); }
  catch (error) {
    $("error").hidden = false;
    $("error").textContent = "无法读取演示数据：" + error.message + " 请在仓库根目录运行 python -m src.pipeline 后刷新页面。";
    $("dataset-meta").textContent = "数据暂不可用";
    document.querySelectorAll("#filters input, #filters select, #filters button, #download, #toggle-rows").forEach(element => { element.disabled = true; });
    return;
  }
  let showAll = false;
  let currentSeries = [];
  let currentState;
  for (const id of ["from", "to"]) { $(id).min = data.date_start; $(id).max = data.date_end; }
  $("from").value = data.date_start;
  $("to").value = data.date_end;
  $("dataset-meta").textContent = integer.format(data.source_rows) + " SYNTHETIC ORDERS / " + dailySeries([], data.date_start, data.date_end).length + " DAYS";

  function chart(series, hasRows) {
    if (!hasRows) { $("chart").innerHTML = '<p class="empty">当前筛选范围暂无记录，请调整区域、渠道或日期。</p>'; return; }
    const width = 650, height = 250, left = 56, right = 18, top = 20, bottom = 33;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const largest = Math.max(...series.map(row => row.revenue_cents));
    const maxY = Math.max(10000, Math.ceil(largest / 1000000) * 1000000);
    const x = index => left + (series.length === 1 ? plotWidth / 2 : index * plotWidth / (series.length - 1));
    const y = cents => top + plotHeight * (1 - cents / maxY);
    const points = series.map((row, index) => `${x(index).toFixed(2)},${y(row.revenue_cents).toFixed(2)}`).join(" ");
    const ticks = Array.from({length: 5}, (_, index) => {
      const value = maxY * index / 4;
      return `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" stroke="#e3e8df"/><text x="${left - 10}" y="${y(value) + 4}" text-anchor="end" fill="#62776d" font-size="10">${integer.format(value / 100)}</text>`;
    }).join("");
    const tickIndices = [...new Set([0, Math.floor((series.length - 1) / 3), Math.floor((series.length - 1) * 2 / 3), series.length - 1])];
    const labels = tickIndices.map(index => `<text x="${x(index)}" y="${height - 10}" text-anchor="middle" fill="#62776d" font-size="10">${series[index].day.slice(5)}</text>`).join("");
    $("chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-description"><title id="chart-title">每日完成订单金额趋势</title><desc id="chart-description">${escapeText(series[0].day)} 至 ${escapeText(series.at(-1).day)}。完整数值见每日聚合明细表，或下载当前筛选 CSV。</desc>${ticks}<polygon points="${x(0)},${y(0)} ${points} ${x(series.length - 1)},${y(0)}" fill="#e3efe6" opacity="0.8"/><polyline points="${points}" fill="none" stroke="#007e63" stroke-width="2.2" stroke-linejoin="round"/>${series.length === 1 ? `<circle cx="${x(0)}" cy="${y(series[0].revenue_cents)}" r="4" fill="#007e63"/>` : ""}${labels}</svg>`;
  }

  function renderTable() {
    const descending = [...currentSeries].reverse();
    const visible = showAll ? descending : descending.slice(0, 14);
    $("table-body").innerHTML = visible.map(row => `<tr><td>${row.day}</td><td>${integer.format(row.total_orders)}</td><td>${integer.format(row.completed_orders)}</td><td>${money(row.revenue_cents).replace(/[¥￥]/g, "")}</td><td>${integer.format(row.refunded_orders)}</td></tr>`).join("");
    $("table-note").textContent = `显示 ${visible.length} / ${currentSeries.length} 天 · 日期降序 · 缺失日期补零`;
    $("toggle-rows").textContent = showAll ? "仅显示最近 14 天" : "显示全部日期";
    $("toggle-rows").hidden = currentSeries.length <= 14;
  }

  function render() {
    const state = {region: $("region").value, channel: $("channel").value, from: $("from").value, to: $("to").value};
    const valid = isDate(state.from) && isDate(state.to) && state.from <= state.to && state.from >= data.date_start && state.to <= data.date_end;
    $("filter-error").hidden = valid;
    $("download").disabled = !valid;
    if (!valid) { $("filter-error").textContent = `请选择 ${data.date_start} 至 ${data.date_end} 之间的日期，且开始日期不晚于结束日期。当前仍展示上一次有效筛选结果。`; return; }
    currentState = state;
    const rows = filterRows(data.rows, state);
    const stats = summarize(rows);
    currentSeries = dailySeries(rows, state.from, state.to);
    $("metric-orders").textContent = integer.format(stats.completed_orders);
    $("metric-revenue").textContent = money(stats.revenue_cents);
    $("metric-aov").textContent = stats.average_cents === null ? "—" : money(stats.average_cents);
    $("metric-refunds").textContent = stats.refund_ratio === null ? "—" : (stats.refund_ratio * 100).toFixed(1) + "%";
    chart(currentSeries, rows.length > 0);
    $("regions").innerHTML = Object.entries(REGIONS).map(([key, label]) => {
      const cents = summarize(rows.filter(row => row.region === key)).revenue_cents;
      const percent = stats.revenue_cents ? cents / stats.revenue_cents * 100 : 0;
      return `<div class="region-item"><div><span>${label}</span><b>${percent.toFixed(1)}%</b></div><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${percent.toFixed(2)}%"></div></div><span class="sr-only">完成金额 ${money(cents)}</span></div>`;
    }).join("");
    renderTable();
    $("status").textContent = `筛选已更新：${state.from} 至 ${state.to}，共 ${integer.format(stats.total_orders)} 条订单，其中 ${integer.format(stats.completed_orders)} 条完成订单。`;
  }

  $("filters").addEventListener("submit", event => event.preventDefault());
  $("filters").addEventListener("change", () => { showAll = false; render(); });
  $("filters").addEventListener("reset", event => {
    event.preventDefault(); $("region").value = "all"; $("channel").value = "all";
    $("from").value = data.date_start; $("to").value = data.date_end; showAll = false; render();
  });
  $("toggle-rows").addEventListener("click", () => { showAll = !showAll; renderTable(); });
  $("download").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csvForSeries(currentSeries)], {type: "text/csv;charset=utf-8"}));
    const link = document.createElement("a"); link.href = url;
    link.download = `synthetic-orders_${currentState.region}_${currentState.channel}_${currentState.from}_${currentState.to}.csv`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  render();
}

if (typeof module !== "undefined" && module.exports) module.exports = {validateData, filterRows, summarize, dailySeries, csvForSeries, isDate};
if (typeof document !== "undefined") boot();
