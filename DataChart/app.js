const fileInput = document.getElementById("fileInput");
const sampleBtn = document.getElementById("sampleBtn");
const chart = document.getElementById("chart");
const legend = document.getElementById("legend");
const axisSummary = document.getElementById("axisSummary");
const seriesCount = document.getElementById("seriesCount");
const rangeSlider = document.getElementById("rangeSlider");
const rangeTrack = document.getElementById("rangeTrack");
const rangeSelection = document.getElementById("rangeSelection");

let currentDataset = null;
let currentRange = null;
const visibility = new Map();
let hoverState = null;
let dragState = null;
let chartLayout = null;
let sliderPadding = { left: 0, right: 0 };

const palette = [
  "#0f6fff",
  "#00bcd4",
  "#ff6b6b",
  "#f59f00",
  "#7f5af0",
  "#2e7d32",
  "#f97316",
  "#0ea5e9",
];

const sampleCSV = `时间,用户访问,订单数,退款金额,服务器负载
周一,120,22,480,0.35
周二,200,28,520,0.38
周三,260,35,450,0.52
周四,310,42,700,0.57
周五,460,60,980,0.62
周六,520,78,1100,0.55
周日,390,55,620,0.41`;

fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    const text = String(loadEvent.target.result || "");
    handleCSV(text);
  };
  reader.readAsText(file);
});

sampleBtn.addEventListener("click", () => {
  handleCSV(sampleCSV);
});

function handleCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length || rows.length < 2) {
    renderEmpty("CSV 数据不足，请确认包含标题行和至少一行数据。");
    return;
  }

  const dataset = buildDataset(rows);
  if (!dataset.series.length) {
    renderEmpty("未检测到可绘制的数值列，请检查表格内容。");
    return;
  }

  currentDataset = dataset;
  currentRange = {
    start: 0,
    end: Math.max(0, dataset.xValues.length - 1),
  };
  visibility.clear();
  dataset.series.forEach((series) => {
    visibility.set(series.id, true);
  });

  renderAll();
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field.trim());
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function buildDataset(rows) {
  const headers = rows[0].map((cell, index) => cell || `列 ${index + 1}`);
  const dataRows = rows.slice(1);
  const xRaw = dataRows.map((row) => (row[0] ?? "").trim());
  const numericXCount = xRaw.filter((value) => value !== "" && !Number.isNaN(Number(value))).length;
  const isNumericX = numericXCount === xRaw.length;
  const xValues = isNumericX ? xRaw.map((value) => Number(value)) : xRaw;

  const series = [];

  for (let col = 1; col < headers.length; col += 1) {
    const name = headers[col] || `列 ${col + 1}`;
    const values = dataRows.map((row) => {
      const value = row[col] ?? "";
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    });

    const numericValues = values.filter((value) => value !== null);
    if (!numericValues.length) {
      continue;
    }

    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    const maxAbs = Math.max(...numericValues.map((value) => Math.abs(value)));

    series.push({
      id: `series-${col}`,
      name,
      values,
      min,
      max,
      maxAbs,
      index: col - 1,
    });
  }

  return {
    headers,
    xHeader: headers[0] || "X",
    xValues,
    isNumericX,
    series,
  };
}

function buildRangeDataset(dataset, range, visibleSeries) {
  const start = range.start;
  const end = range.end;
  const xValues = dataset.xValues.slice(start, end + 1);
  const series = [];

  visibleSeries.forEach((seriesItem) => {
    const values = seriesItem.values.slice(start, end + 1);
    let min = Infinity;
    let max = -Infinity;
    let maxAbs = 0;

    values.forEach((value) => {
      if (value === null || Number.isNaN(value)) {
        return;
      }
      min = Math.min(min, value);
      max = Math.max(max, value);
      maxAbs = Math.max(maxAbs, Math.abs(value));
    });

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return;
    }

    series.push({
      ...seriesItem,
      values,
      min,
      max,
      maxAbs,
    });
  });

  return {
    ...dataset,
    xValues,
    series,
  };
}

function groupSeries(seriesList) {
  const sorted = [...seriesList].sort((a, b) => b.maxAbs - a.maxAbs);
  const groups = [];

  sorted.forEach((series) => {
    let placed = false;

    for (const group of groups) {
      const newMax = Math.max(group.maxAbs, series.maxAbs);
      const newMin = Math.min(group.minAbs, series.maxAbs);
      const ratio = newMin === 0 ? (newMax === 0 ? 1 : Infinity) : newMax / newMin;

      if (ratio <= 10) {
        group.series.push(series);
        group.maxAbs = newMax;
        group.minAbs = newMin;
        placed = true;
        break;
      }
    }

    if (!placed) {
      groups.push({
        series: [series],
        maxAbs: series.maxAbs,
        minAbs: series.maxAbs,
      });
    }
  });

  groups.forEach((group) => {
    let min = Infinity;
    let max = -Infinity;

    group.series.forEach((series) => {
      min = Math.min(min, series.min);
      max = Math.max(max, series.max);
    });

    if (min === max) {
      min -= 1;
      max += 1;
    }

    group.min = min;
    group.max = max;
  });

  return groups;
}

function renderEmpty(message) {
  currentDataset = null;
  currentRange = null;
  visibility.clear();
  hoverState = null;
  chartLayout = null;
  sliderPadding = { left: 0, right: 0 };
  chart.innerHTML = "";
  legend.innerHTML = "";
  axisSummary.innerHTML = `<span>${message}</span>`;
  seriesCount.textContent = "0 条曲线";
  if (rangeSlider) {
    rangeSlider.classList.add("is-hidden");
  }
  if (rangeTrack) {
    rangeTrack.style.left = "0px";
    rangeTrack.style.right = "0px";
  }
}

function renderAll() {
  if (!currentDataset) {
    return;
  }
  updateLegend();
  updateSeriesCount();
  refreshChart();
  updateSlider();
}

function getChartDimensions() {
  const rect = chart.getBoundingClientRect();
  const width = rect.width || 1100;
  const height = rect.height || 540;
  return {
    width: Math.max(360, Math.round(width)),
    height: Math.max(280, Math.round(height)),
  };
}

function refreshChart() {
  if (!currentDataset || !currentRange) {
    return;
  }

  const visibleSeries = currentDataset.series.filter(
    (series) => visibility.get(series.id) !== false
  );

  if (!visibleSeries.length) {
    chart.innerHTML = "";
    axisSummary.innerHTML = "<span>所有曲线已隐藏，请点击图例重新显示。</span>";
    hoverState = null;
    return;
  }

  const rangeDataset = buildRangeDataset(currentDataset, currentRange, visibleSeries);

  if (!rangeDataset.series.length) {
    chart.innerHTML = "";
    axisSummary.innerHTML = "<span>当前区间内暂无可绘制数据。</span>";
    hoverState = null;
    return;
  }

  renderChart(rangeDataset);
}

function renderChart(dataset) {
  const groups = groupSeries(dataset.series);
  const axisCount = groups.length;

  const { width, height } = getChartDimensions();
  const paddingLeft = 90;
  const paddingTop = 40;
  const paddingBottom = 60;
  const axisGap = 56;
  const paddingRight = 90 + Math.max(0, axisCount - 1) * axisGap;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  chart.innerHTML = "";
  chart.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const xValues = dataset.xValues;
  const xCount = xValues.length;
  const numericX = dataset.isNumericX;
  const xMin = numericX ? Math.min(...xValues) : 0;
  const xMax = numericX ? Math.max(...xValues) : Math.max(1, xCount - 1);
  const xRangeMin = xMin === xMax ? xMin - 1 : xMin;
  const xRangeMax = xMin === xMax ? xMax + 1 : xMax;

  const xScale = (value) =>
    paddingLeft + ((value - xRangeMin) / (xRangeMax - xRangeMin)) * chartWidth;

  const yScale = (value, group) =>
    paddingTop + (1 - (value - group.min) / (group.max - group.min)) * chartHeight;

  drawGrid(chart, paddingLeft, paddingTop, chartWidth, chartHeight, groups[0]);
  drawAxes(chart, groups, paddingLeft, paddingTop, chartWidth, chartHeight, axisGap);
  drawXAxis(chart, paddingLeft, paddingTop, chartWidth, chartHeight, dataset, xScale);

  dataset.series.forEach((series) => {
    const group = groups.find((g) => g.series.includes(series));
    if (!group) {
      return;
    }

    let path = "";
    let active = false;

    for (let i = 0; i < xCount; i += 1) {
      const value = series.values[i];
      if (value === null || Number.isNaN(value)) {
        active = false;
        continue;
      }

      const xValue = numericX ? xValues[i] : i;
      const x = xScale(xValue);
      const y = yScale(value, group);

      if (!active) {
        path += `M ${x} ${y}`;
        active = true;
      } else {
        path += ` L ${x} ${y}`;
      }
    }

    if (path) {
      const line = createSvg("path", {
        d: path,
        class: "series-line",
        stroke: palette[series.index % palette.length],
      });
      chart.appendChild(line);
    }
  });

  renderSummary(groups);

  const hoverLine = createSvg("line", {
    x1: paddingLeft,
    x2: paddingLeft,
    y1: paddingTop,
    y2: paddingTop + chartHeight,
    class: "hover-line",
    opacity: "0",
  });
  chart.appendChild(hoverLine);

  hoverState = {
    line: hoverLine,
    left: paddingLeft,
    right: paddingLeft + chartWidth,
    top: paddingTop,
    bottom: paddingTop + chartHeight,
  };

  chartLayout = {
    viewWidth: width,
    paddingLeft,
    paddingRight,
  };
  updateSliderPadding();
}

function updateLegend() {
  if (!currentDataset) {
    return;
  }
  legend.innerHTML = "";
  currentDataset.series.forEach((series) => {
    const item = document.createElement("div");
    const isVisible = visibility.get(series.id) !== false;
    item.className = `legend__item${isVisible ? "" : " legend__item--hidden"}`;
    item.addEventListener("click", () => {
      toggleSeries(series.id);
    });

    const swatch = document.createElement("span");
    swatch.className = "legend__swatch";
    swatch.style.backgroundColor = palette[series.index % palette.length];

    const label = document.createElement("span");
    label.textContent = series.name;

    item.appendChild(swatch);
    item.appendChild(label);
    legend.appendChild(item);
  });
}

function toggleSeries(seriesId) {
  const isVisible = visibility.get(seriesId) !== false;
  visibility.set(seriesId, !isVisible);
  updateLegend();
  updateSeriesCount();
  refreshChart();
}

function updateSeriesCount() {
  if (!currentDataset) {
    seriesCount.textContent = "0 条曲线";
    return;
  }
  const total = currentDataset.series.length;
  const visible = currentDataset.series.filter(
    (series) => visibility.get(series.id) !== false
  ).length;

  if (visible === total) {
    seriesCount.textContent = `${total} 条曲线`;
  } else {
    seriesCount.textContent = `${visible} / ${total} 条曲线`;
  }
}

function updateSlider() {
  if (
    !rangeSlider ||
    !rangeSelection ||
    !rangeTrack ||
    !currentDataset ||
    !currentRange
  ) {
    return;
  }
  const total = Math.max(0, currentDataset.xValues.length - 1);
  if (total <= 0) {
    rangeSlider.classList.add("is-hidden");
    return;
  }
  rangeSlider.classList.remove("is-hidden");
  const trackWidth = rangeTrack.clientWidth;
  if (!trackWidth) {
    return;
  }
  const startRatio = currentRange.start / total;
  const endRatio = currentRange.end / total;
  const startPx = startRatio * trackWidth;
  const endPx = endRatio * trackWidth;
  rangeSelection.style.left = `${startPx}px`;
  rangeSelection.style.right = `${trackWidth - endPx}px`;
}

function drawGrid(svg, left, top, width, height, baseGroup) {
  if (!baseGroup) {
    return;
  }
  const ticks = createTicks(baseGroup.min, baseGroup.max, 5);

  ticks.forEach((tick) => {
    const y = top + (1 - (tick - baseGroup.min) / (baseGroup.max - baseGroup.min)) * height;
    const line = createSvg("line", {
      x1: left,
      x2: left + width,
      y1: y,
      y2: y,
      class: "grid-line",
    });
    svg.appendChild(line);
  });
}

function drawAxes(svg, groups, left, top, width, height, axisGap) {
  groups.forEach((group, index) => {
    const axisX = index === 0 ? left : left + width + axisGap * (index - 1);
    const align = index === 0 ? "end" : "start";
    const labelOffset = index === 0 ? -10 : 10;

    const axisLine = createSvg("line", {
      x1: axisX,
      x2: axisX,
      y1: top,
      y2: top + height,
      class: "axis-line",
    });
    svg.appendChild(axisLine);

    const ticks = createTicks(group.min, group.max, 5);
    ticks.forEach((tick) => {
      const y = top + (1 - (tick - group.min) / (group.max - group.min)) * height;
      const text = createSvg("text", {
        x: axisX + labelOffset,
        y: y + 4,
        "text-anchor": align,
      });
      text.textContent = formatNumber(tick);
      svg.appendChild(text);
    });

    const label = createSvg("text", {
      x: axisX + labelOffset,
      y: top - 12,
      "text-anchor": align,
    });
    label.textContent = `Y 轴 ${index + 1}`;
    svg.appendChild(label);
  });
}

function drawXAxis(svg, left, top, width, height, dataset, xScale) {
  const axisY = top + height;
  const axisLine = createSvg("line", {
    x1: left,
    x2: left + width,
    y1: axisY,
    y2: axisY,
    class: "axis-line",
  });
  svg.appendChild(axisLine);

  const ticks = dataset.isNumericX
    ? createTicks(Math.min(...dataset.xValues), Math.max(...dataset.xValues), 6)
    : createIndexTicks(dataset.xValues.length, 6);

  ticks.forEach((tick) => {
    const value = dataset.isNumericX ? tick : dataset.xValues[tick] ?? "";
    const x = dataset.isNumericX ? xScale(tick) : xScale(tick);
    const text = createSvg("text", {
      x,
      y: axisY + 24,
      "text-anchor": "middle",
    });
    text.textContent = dataset.isNumericX ? formatNumber(value) : String(value);
    svg.appendChild(text);
  });

  const label = createSvg("text", {
    x: left + width / 2,
    y: axisY + 44,
    "text-anchor": "middle",
  });
  label.textContent = dataset.xHeader || "X";
  svg.appendChild(label);
}

function createTicks(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }
  if (min === max) {
    return [min];
  }
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}

function createIndexTicks(length, count) {
  if (length <= 1) {
    return [0];
  }
  const steps = Math.min(count, length);
  return Array.from({ length: steps }, (_, i) => Math.round((i * (length - 1)) / (steps - 1)));
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  const abs = Math.abs(value);
  if (abs >= 1000000) {
    return `${(value / 1000000).toFixed(2).replace(/\.00$/, "")}M`;
  }
  if (abs >= 1000) {
    return `${(value / 1000).toFixed(2).replace(/\.00$/, "")}k`;
  }
  if (abs < 1) {
    return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }
  return value.toFixed(2).replace(/\.00$/, "");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createSvg(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, value);
  });
  return el;
}

function clientPointToSvg(clientX, clientY) {
  if (!chart || typeof chart.getScreenCTM !== "function") {
    return null;
  }
  const ctm = chart.getScreenCTM();
  if (!ctm) {
    return null;
  }
  const point = chart.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const inverse = ctm.inverse();
  return point.matrixTransform(inverse);
}

function updateSliderPadding() {
  if (!rangeSlider || !rangeTrack || !chartLayout) {
    return;
  }
  const rect = chart.getBoundingClientRect();
  if (rect.width === 0) {
    return;
  }
  if (typeof chart.getScreenCTM !== "function") {
    return;
  }
  const ctm = chart.getScreenCTM();
  if (!ctm) {
    return;
  }

  const xLeftSvg = chartLayout.paddingLeft;
  const xRightSvg = chartLayout.viewWidth - chartLayout.paddingRight;

  const point = chart.createSVGPoint();
  point.y = 0;
  point.x = xLeftSvg;
  const leftScreen = point.matrixTransform(ctm).x;
  point.x = xRightSvg;
  const rightScreen = point.matrixTransform(ctm).x;

  const leftPadding = Math.max(0, leftScreen - rect.left);
  const rightPadding = Math.max(0, rect.right - rightScreen);

  rangeTrack.style.left = `${leftPadding}px`;
  rangeTrack.style.right = `${rightPadding}px`;
  sliderPadding = { left: leftPadding, right: rightPadding };
}

function handleHoverMove(event) {
  if (!hoverState || !hoverState.line) {
    return;
  }
  const svgPoint = clientPointToSvg(event.clientX, event.clientY);
  if (!svgPoint) {
    return;
  }
  const x = svgPoint.x;

  if (x < hoverState.left || x > hoverState.right) {
    hoverState.line.setAttribute("opacity", "0");
    return;
  }

  hoverState.line.setAttribute("opacity", "1");
  hoverState.line.setAttribute("x1", x);
  hoverState.line.setAttribute("x2", x);
}

function hideHoverLine() {
  if (hoverState && hoverState.line) {
    hoverState.line.setAttribute("opacity", "0");
  }
}

function handleRangePointerDown(event) {
  if (!currentDataset || !currentRange || !rangeSlider || !rangeSelection) {
    return;
  }
  const target = event.target;
  const handleType = target.dataset.handle;
  const dragType = handleType === "left" || handleType === "right" ? handleType : "range";

  dragState = {
    type: dragType,
    startX: event.clientX,
    startRange: { ...currentRange },
  };

  event.currentTarget.setPointerCapture(event.pointerId);
  window.addEventListener("pointermove", handleRangePointerMove);
  window.addEventListener("pointerup", handleRangePointerUp);
  window.addEventListener("pointercancel", handleRangePointerUp);
  event.preventDefault();
}

function handleRangePointerMove(event) {
  if (!dragState || !currentDataset || !currentRange || !rangeTrack) {
    return;
  }
  const rect = rangeTrack.getBoundingClientRect();
  const trackLeft = rect.left;
  const trackWidth = rect.width;
  if (trackWidth <= 0) {
    return;
  }
  const total = Math.max(0, currentDataset.xValues.length - 1);
  const minSpan = total === 0 ? 0 : 1;
  const ratio = clamp((event.clientX - trackLeft) / trackWidth, 0, 1);
  const indexAtPointer = clamp(Math.round(ratio * total), 0, total);

  if (dragState.type === "left") {
    const newStart = clamp(indexAtPointer, 0, currentRange.end - minSpan);
    setRange(newStart, currentRange.end);
    return;
  }

  if (dragState.type === "right") {
    const newEnd = clamp(indexAtPointer, currentRange.start + minSpan, total);
    setRange(currentRange.start, newEnd);
    return;
  }

  const span = dragState.startRange.end - dragState.startRange.start;
  const deltaRatio = (event.clientX - dragState.startX) / trackWidth;
  const deltaIndex = Math.round(deltaRatio * total);
  const maxStart = Math.max(0, total - span);
  const newStart = clamp(dragState.startRange.start + deltaIndex, 0, maxStart);
  const newEnd = clamp(newStart + span, 0, total);
  setRange(newStart, newEnd);
}

function handleRangePointerUp() {
  if (!dragState) {
    return;
  }
  dragState = null;
  window.removeEventListener("pointermove", handleRangePointerMove);
  window.removeEventListener("pointerup", handleRangePointerUp);
  window.removeEventListener("pointercancel", handleRangePointerUp);
}

function setRange(start, end) {
  if (!currentRange) {
    return;
  }
  if (start === currentRange.start && end === currentRange.end) {
    return;
  }
  currentRange = { start, end };
  updateSlider();
  refreshChart();
}

function renderSummary(groups) {
  axisSummary.innerHTML = "";
  groups.forEach((group, index) => {
    const pill = document.createElement("div");
    pill.className = "axis-pill";
    pill.textContent = `Y 轴 ${index + 1}: ${group.series.map((s) => s.name).join(" / ")}`;
    axisSummary.appendChild(pill);
  });
}

chart.addEventListener("pointermove", handleHoverMove);
chart.addEventListener("pointerleave", hideHoverLine);
if (rangeSelection) {
  rangeSelection.addEventListener("pointerdown", handleRangePointerDown);
}
window.addEventListener("resize", () => {
  if (currentDataset && currentRange) {
    refreshChart();
  } else {
    updateSliderPadding();
  }
});

renderEmpty("请上传 CSV 或加载示例数据。");
