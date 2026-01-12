const fileInput = document.getElementById("fileInput");
const sampleBtn = document.getElementById("sampleBtn");
const chart = document.getElementById("chart");
const legend = document.getElementById("legend");
const axisSummary = document.getElementById("axisSummary");
const seriesControls = document.getElementById("seriesControls");
const dataSourceSelect = document.getElementById("dataSourceSelect");
const dataSourceNote = document.getElementById("dataSourceNote");
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
const seriesStyles = new Map();
const axisOverrides = new Map();
let dropdownListenerAttached = false;
let dataSources = [];
const dataSourceManifest = "./data/sources.json";

const colorOptions = [
  "#00b894",
  "#74b9ff",
  "#0984e3",
  "#a29bfe",
  "#fdcb6e",
  "#f19066",
  "#f78fb3",
  "#d63031",
  "#dfe6e9",
  "#b2bec3",
  "#636e72",
  "#2d3436",
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
  if (dataSources.length) {
    loadDataSource(dataSources[0].file);
    return;
  }
  handleCSV(sampleCSV);
});

if (dataSourceSelect) {
  dataSourceSelect.addEventListener("change", () => {
    const file = dataSourceSelect.value;
    if (!file) {
      return;
    }
    loadDataSource(file);
  });
}

function setDataSourceNote(message) {
  if (!dataSourceNote) {
    return;
  }
  dataSourceNote.textContent = message;
}

async function loadDataSourceList() {
  if (!dataSourceSelect) {
    return;
  }
  dataSourceSelect.innerHTML = "<option value=\"\">请选择 CSV 文件</option>";
  try {
    const response = await fetch(dataSourceManifest, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("failed");
    }
    const payload = await response.json();
    const list = Array.isArray(payload.sources) ? payload.sources : [];
    dataSources = list.filter((item) => item && item.file);
    if (!dataSources.length) {
      setDataSourceNote("未找到可用数据源，可继续上传 CSV。");
      return;
    }
    dataSources.forEach((source) => {
      const option = document.createElement("option");
      option.value = source.file;
      option.textContent = source.label || source.file;
      dataSourceSelect.appendChild(option);
    });
    setDataSourceNote("可从 data 目录选择 CSV。");
  } catch (error) {
    dataSources = [];
    setDataSourceNote("未读取到数据源清单，仍可上传 CSV。");
  }
}

async function loadDataSource(file) {
  const source = dataSources.find((item) => item.file === file);
  const label = source?.label || file;
  const url = file.startsWith("http") ? file : `./data/${file}`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("failed");
    }
    const text = await response.text();
    handleCSV(text);
    if (dataSourceSelect) {
      dataSourceSelect.value = file;
    }
    setDataSourceNote(`已加载：${label}`);
  } catch (error) {
    setDataSourceNote(`加载失败：${label}`);
  }
}

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
  seriesStyles.clear();
  axisOverrides.clear();
  dataset.series.forEach((series) => {
    visibility.set(series.id, true);
    seriesStyles.set(series.id, {
      type: "line",
      showCurrent: false,
      color: colorOptions[series.index % colorOptions.length],
    });
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
    const hasData = values.some((value) => value !== null && !Number.isNaN(value));

    series.push({
      ...seriesItem,
      values,
      hasData,
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

function roundDownToMagnitude(value) {
  if (value === 0) {
    return 0;
  }
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(value)));
  if (value > 0) {
    return Math.floor(value / magnitude) * magnitude;
  }
  return -Math.ceil(Math.abs(value) / magnitude) * magnitude;
}

function roundUpToMagnitude(value) {
  if (value === 0) {
    return 0;
  }
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(value)));
  if (value > 0) {
    return Math.ceil(value / magnitude) * magnitude;
  }
  return -Math.floor(Math.abs(value) / magnitude) * magnitude;
}

function getDefaultAxisBounds(min, max) {
  let roundedMin = roundDownToMagnitude(min);
  let roundedMax = roundUpToMagnitude(max);
  if (roundedMin === roundedMax) {
    roundedMin -= 1;
    roundedMax += 1;
  }
  if (roundedMin > roundedMax) {
    const temp = roundedMin;
    roundedMin = roundedMax;
    roundedMax = temp;
  }
  return { min: roundedMin, max: roundedMax };
}

function getGroupKey(group) {
  return group.series
    .map((series) => series.id)
    .sort()
    .join("|");
}

function applyAxisOverrides(groups) {
  groups.forEach((group) => {
    const key = getGroupKey(group);
    group.key = key;
    if (!axisOverrides.has(key)) {
      axisOverrides.set(key, getDefaultAxisBounds(group.min, group.max));
    }
    const override = axisOverrides.get(key);
    if (
      override &&
      Number.isFinite(override.min) &&
      Number.isFinite(override.max) &&
      override.min < override.max
    ) {
      group.min = override.min;
      group.max = override.max;
    }
  });
}

function renderEmpty(message) {
  currentDataset = null;
  currentRange = null;
  visibility.clear();
  seriesStyles.clear();
  axisOverrides.clear();
  hoverState = null;
  chartLayout = null;
  sliderPadding = { left: 0, right: 0 };
  chart.innerHTML = "";
  legend.innerHTML = "";
  axisSummary.innerHTML = `<span>${message}</span>`;
  if (seriesControls) {
    seriesControls.innerHTML = "";
  }
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
  updateSeriesControls();
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

  const rangeDataset = buildRangeDataset(currentDataset, currentRange, currentDataset.series);
  const hasData = rangeDataset.series.some((series) => series.hasData);
  if (!hasData) {
    chart.innerHTML = "";
    axisSummary.innerHTML = "<span>当前区间内暂无可绘制数据。</span>";
    hoverState = null;
    return;
  }

  renderChart(rangeDataset, visibleSeries);
}

function renderChart(dataset, visibleSeries) {
  const groups = groupSeries(dataset.series);
  applyAxisOverrides(groups);
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

  const tickCount = 11;
  drawGrid(chart, paddingLeft, paddingTop, chartWidth, chartHeight, groups[0], tickCount);
  drawAxes(chart, groups, paddingLeft, paddingTop, chartWidth, chartHeight, axisGap, tickCount);
  drawXAxis(chart, paddingLeft, paddingTop, chartWidth, chartHeight, dataset, xScale);

  const visibleSet = new Set(visibleSeries.map((series) => series.id));
  const barSeries = dataset.series.filter((series) => {
    if (!visibleSet.has(series.id)) {
      return false;
    }
    if (!series.hasData) {
      return false;
    }
    return getSeriesStyle(series.id).type === "bar";
  });
  const barCount = barSeries.length;
  const barIndexMap = new Map();
  barSeries.forEach((series, index) => {
    barIndexMap.set(series.id, index);
  });
  const barSlot = chartWidth / Math.max(1, xCount);
  const barGroupWidth = Math.min(barSlot * 0.7, 36);
  const barWidth = barCount > 0 ? barGroupWidth / barCount : 0;

  dataset.series.forEach((series) => {
    if (!visibleSet.has(series.id)) {
      return;
    }
    const group = groups.find((g) => g.series.includes(series));
    if (!group || !series.hasData) {
      return;
    }

    const style = getSeriesStyle(series.id);
    const color = getSeriesColor(series);

    if (style.type === "bar") {
      const barIndex = barIndexMap.get(series.id) ?? 0;
      const baselineValue = getBaselineValue(group);
      const baselineY = yScale(baselineValue, group);

      for (let i = 0; i < xCount; i += 1) {
        const value = series.values[i];
        if (value === null || Number.isNaN(value)) {
          continue;
        }
        const xValue = numericX ? xValues[i] : i;
        const xCenter = xScale(xValue);
        const x = xCenter - barGroupWidth / 2 + barIndex * barWidth;
        const y = yScale(value, group);
        const heightValue = Math.abs(baselineY - y);
        const rect = createSvg("rect", {
          x,
          y: Math.min(y, baselineY),
          width: Math.max(2, barWidth - 2),
          height: Math.max(0, heightValue),
          class: "series-bar",
          fill: color,
        });
        chart.appendChild(rect);
      }
    } else {
      const segments = getSeriesSegments(series.values);
      segments.forEach((segment) => {
        const linePath = buildLinePath(
          segment,
          xValues,
          numericX,
          xScale,
          yScale,
          group
        );
        if (!linePath) {
          return;
        }

        if (style.type === "area") {
          const areaPath = buildAreaPath(
            segment,
            xValues,
            numericX,
            xScale,
            yScale,
            group
          );
          if (areaPath) {
            const area = createSvg("path", {
              d: areaPath,
              class: "series-area",
              fill: color,
            });
            chart.appendChild(area);
          }
        }

        const line = createSvg("path", {
          d: linePath,
          class: "series-line",
          stroke: color,
        });
        chart.appendChild(line);
      });
    }

    if (style.showCurrent) {
      drawCurrentValue(series, group, xValues, numericX, xScale, yScale, {
        left: paddingLeft,
        right: paddingLeft + chartWidth,
        top: paddingTop,
        bottom: paddingTop + chartHeight,
      });
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

  const hoverDots = createSvg("g", {
    class: "hover-dots",
    opacity: "0",
  });
  chart.appendChild(hoverDots);

  const hoverXBubble = createSvg("g", {
    class: "hover-x-bubble",
    opacity: "0",
  });
  chart.appendChild(hoverXBubble);

  hoverState = {
    line: hoverLine,
    dots: hoverDots,
    xBubble: hoverXBubble,
    axisY: paddingTop + chartHeight,
    left: paddingLeft,
    right: paddingLeft + chartWidth,
    top: paddingTop,
    bottom: paddingTop + chartHeight,
    xValues,
    numericX,
    xRangeMin,
    xRangeMax,
    chartWidth,
    paddingLeft,
    xScale,
    yScale,
    series: dataset.series.filter((series) => visibleSet.has(series.id) && series.hasData),
    seriesGroup: new Map(dataset.series.map((series) => [
      series.id,
      groups.find((group) => group.series.includes(series)) || null,
    ])),
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
    swatch.style.backgroundColor = getSeriesColor(series);

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
  updateSeriesControls();
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

function getSeriesStyle(seriesId) {
  if (!seriesStyles.has(seriesId)) {
    seriesStyles.set(seriesId, {
      type: "line",
      showCurrent: false,
      color: colorOptions[0],
    });
  }
  return seriesStyles.get(seriesId);
}

function setSeriesStyle(seriesId, updates) {
  const current = getSeriesStyle(seriesId);
  seriesStyles.set(seriesId, { ...current, ...updates });
}

function getSeriesColor(series) {
  const style = getSeriesStyle(series.id);
  if (style.color) {
    return style.color;
  }
  return colorOptions[series.index % colorOptions.length];
}

function isValidHexColor(value) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

function normalizeHexColor(value) {
  let input = value.trim();
  if (!input) {
    return "";
  }
  if (!input.startsWith("#")) {
    input = `#${input}`;
  }
  return input.toLowerCase();
}

function updateSeriesControls() {
  if (!seriesControls) {
    return;
  }
  seriesControls.innerHTML = "";
  if (!currentDataset) {
    seriesControls.innerHTML = "<span>暂无数据</span>";
    return;
  }
  currentDataset.series.forEach((series) => {
    const style = getSeriesStyle(series.id);
    const color = getSeriesColor(series);
    const row = document.createElement("div");
    const isVisible = visibility.get(series.id) !== false;
    row.className = `series-row${isVisible ? "" : " series-row--hidden"}`;

    const label = document.createElement("div");
    label.className = "series-label";
    const swatch = document.createElement("span");
    swatch.className = "legend__swatch";
    swatch.style.backgroundColor = color;
    const name = document.createElement("span");
    name.textContent = series.name;
    label.appendChild(swatch);
    label.appendChild(name);

    const options = document.createElement("div");
    options.className = "series-options";

    const select = document.createElement("select");
    const types = [
      { value: "line", label: "线形" },
      { value: "bar", label: "柱状" },
      { value: "area", label: "面积" },
    ];
    types.forEach((type) => {
      const option = document.createElement("option");
      option.value = type.value;
      option.textContent = type.label;
      select.appendChild(option);
    });
    select.value = style.type;
    select.addEventListener("change", () => {
      setSeriesStyle(series.id, { type: select.value });
      refreshChart();
    });

    const dropdown = document.createElement("div");
    dropdown.className = "color-dropdown";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "color-trigger";
    trigger.setAttribute("aria-expanded", "false");

    const triggerSwatch = document.createElement("span");
    triggerSwatch.className = "color-trigger__swatch";
    triggerSwatch.style.backgroundColor = color;
    const triggerLabel = document.createElement("span");
    triggerLabel.textContent = "颜色";
    trigger.appendChild(triggerSwatch);
    trigger.appendChild(triggerLabel);

    const menu = document.createElement("div");
    menu.className = "color-menu";

    const colorInput = document.createElement("input");
    colorInput.type = "text";
    colorInput.className = "color-input";
    colorInput.value = color;
    colorInput.placeholder = "#rrggbb";

    const applyColor = (value) => {
      setSeriesStyle(series.id, { color: value });
      swatch.style.backgroundColor = value;
      triggerSwatch.style.backgroundColor = value;
      updateLegend();
      refreshChart();
    };

    const paletteButtons = [];
    const updatePaletteSelection = (value) => {
      paletteButtons.forEach((button) => {
        button.classList.toggle("is-selected", button.dataset.color === value);
      });
    };

    colorOptions.forEach((colorOption) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-swatch";
      button.dataset.color = colorOption;
      button.style.backgroundColor = colorOption;
      button.setAttribute("aria-label", `选择颜色 ${colorOption}`);
      button.addEventListener("click", () => {
        colorInput.value = colorOption;
        updatePaletteSelection(colorOption);
        applyColor(colorOption);
        dropdown.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
      });
      paletteButtons.push(button);
      menu.appendChild(button);
    });

    updatePaletteSelection(color);

    colorInput.addEventListener("change", () => {
      const normalized = normalizeHexColor(colorInput.value);
      if (!isValidHexColor(normalized)) {
        const currentColor = getSeriesColor(series);
        colorInput.value = currentColor;
        updatePaletteSelection(currentColor);
        return;
      }
      colorInput.value = normalized;
      updatePaletteSelection(normalized);
      applyColor(normalized);
    });

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = dropdown.classList.toggle("is-open");
      trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    dropdown.appendChild(trigger);
    dropdown.appendChild(menu);

    if (!dropdownListenerAttached) {
      dropdownListenerAttached = true;
      document.addEventListener("click", () => {
        document.querySelectorAll(".color-dropdown.is-open").forEach((node) => {
          node.classList.remove("is-open");
          const button = node.querySelector(".color-trigger");
          if (button) {
            button.setAttribute("aria-expanded", "false");
          }
        });
      });
    }

    const toggle = document.createElement("label");
    toggle.className = "series-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = style.showCurrent;
    checkbox.addEventListener("change", () => {
      setSeriesStyle(series.id, { showCurrent: checkbox.checked });
      refreshChart();
    });
    const toggleText = document.createElement("span");
    toggleText.textContent = "当前值";
    toggle.appendChild(checkbox);
    toggle.appendChild(toggleText);

    options.appendChild(select);
    options.appendChild(dropdown);
    options.appendChild(colorInput);
    options.appendChild(toggle);
    row.appendChild(label);
    row.appendChild(options);
    seriesControls.appendChild(row);
  });
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

function drawGrid(svg, left, top, width, height, baseGroup, tickCount) {
  if (!baseGroup) {
    return;
  }
  const ticks = createTicks(baseGroup.min, baseGroup.max, tickCount);

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

function drawAxes(svg, groups, left, top, width, height, axisGap, tickCount) {
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

    const ticks = createTicks(group.min, group.max, tickCount);
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

function getSeriesSegments(values) {
  const segments = [];
  let current = [];
  values.forEach((value, index) => {
    if (value === null || Number.isNaN(value)) {
      if (current.length) {
        segments.push(current);
        current = [];
      }
      return;
    }
    current.push({ index, value });
  });
  if (current.length) {
    segments.push(current);
  }
  return segments;
}

function buildLinePath(segment, xValues, numericX, xScale, yScale, group) {
  if (!segment.length) {
    return "";
  }
  return segment
    .map((point, idx) => {
      const xValue = numericX ? xValues[point.index] : point.index;
      const x = xScale(xValue);
      const y = yScale(point.value, group);
      return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function buildAreaPath(segment, xValues, numericX, xScale, yScale, group) {
  if (!segment.length) {
    return "";
  }
  const linePath = buildLinePath(segment, xValues, numericX, xScale, yScale, group);
  const baseline = getBaselineValue(group);
  const baseY = yScale(baseline, group);
  const first = segment[0];
  const last = segment[segment.length - 1];
  const firstX = xScale(numericX ? xValues[first.index] : first.index);
  const lastX = xScale(numericX ? xValues[last.index] : last.index);
  return `${linePath} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
}

function getBaselineValue(group) {
  if (group.min <= 0 && group.max >= 0) {
    return 0;
  }
  return group.min;
}

function getLastValue(values) {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (value !== null && !Number.isNaN(value)) {
      return { index: i, value };
    }
  }
  return null;
}

function findNearestIndex(values, target) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === null || Number.isNaN(value)) {
      continue;
    }
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  const rounded = Math.round(value * 100) / 100;
  const formatter = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(rounded);
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

function drawCurrentValue(series, group, xValues, numericX, xScale, yScale, bounds) {
  const last = getLastValue(series.values);
  if (!last) {
    return;
  }
  const xValue = numericX ? xValues[last.index] : last.index;
  const x = xScale(xValue);
  const y = yScale(last.value, group);
  const color = getSeriesColor(series);
  const reference = createSvg("line", {
    x1: bounds.left,
    x2: bounds.right,
    y1: y,
    y2: y,
    class: "reference-line",
    stroke: color,
  });
  chart.appendChild(reference);

  const dot = createSvg("circle", {
    cx: x,
    cy: y,
    r: 4,
    fill: color,
  });
  chart.appendChild(dot);

  const label = formatNumber(last.value) || String(last.value);
  drawValueBubble(x, y, label, color, bounds);
}

function drawValueBubble(x, y, textValue, color, bounds) {
  const paddingX = 8;
  const paddingY = 4;
  const group = createSvg("g", { class: "value-bubble" });
  const text = createSvg("text", { x: 0, y: 0 });
  text.textContent = textValue;
  group.appendChild(text);
  chart.appendChild(group);

  const box = text.getBBox();
  const width = box.width + paddingX * 2;
  const height = box.height + paddingY * 2;
  let bubbleX = x + 10;
  let bubbleY = y - height / 2;

  if (bubbleX + width > bounds.right) {
    bubbleX = x - width - 10;
  }
  if (bubbleX < bounds.left) {
    bubbleX = bounds.left;
  }
  if (bubbleY < bounds.top) {
    bubbleY = bounds.top;
  }
  if (bubbleY + height > bounds.bottom) {
    bubbleY = bounds.bottom - height;
  }

  const rect = createSvg("rect", {
    x: bubbleX,
    y: bubbleY,
    width,
    height,
    rx: 8,
    ry: 8,
    stroke: color,
  });
  group.insertBefore(rect, text);

  text.setAttribute("x", bubbleX + paddingX);
  text.setAttribute("y", bubbleY + height / 2);
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("fill", color);
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

function getHoverPoint(svgX) {
  if (!hoverState) {
    return null;
  }
  const {
    xValues,
    numericX,
    xRangeMin,
    xRangeMax,
    chartWidth,
    paddingLeft,
    xScale,
  } = hoverState;
  if (!xValues.length) {
    return null;
  }
  const ratio = (svgX - paddingLeft) / chartWidth;
  if (!Number.isFinite(ratio)) {
    return null;
  }
  if (numericX) {
    const valueAtX = xRangeMin + ratio * (xRangeMax - xRangeMin);
    const index = findNearestIndex(xValues, valueAtX);
    const xValue = xValues[index];
    return {
      index,
      x: xScale(xValue),
    };
  }
  const index = clamp(Math.round(ratio * (xValues.length - 1)), 0, xValues.length - 1);
  return {
    index,
    x: xScale(index),
  };
}

function updateHoverDots(hoverPoint) {
  if (!hoverState || !hoverState.dots) {
    return;
  }
  const { dots, series, seriesGroup, yScale } = hoverState;
  while (dots.firstChild) {
    dots.removeChild(dots.firstChild);
  }
  series.forEach((seriesItem) => {
    const value = seriesItem.values[hoverPoint.index];
    if (value === null || Number.isNaN(value)) {
      return;
    }
    const group = seriesGroup.get(seriesItem.id);
    if (!group) {
      return;
    }
    const y = yScale(value, group);
    const dot = createSvg("circle", {
      cx: hoverPoint.x,
      cy: y,
      r: 4,
      class: "hover-dot",
      stroke: getSeriesColor(seriesItem),
    });
    dots.appendChild(dot);
  });
  dots.setAttribute("opacity", "1");
}

function updateHoverXBubble(hoverPoint, cursorY) {
  if (!hoverState || !hoverState.xBubble) {
    return;
  }
  const { xBubble, xValues, numericX, left, right, top, bottom } = hoverState;
  while (xBubble.firstChild) {
    xBubble.removeChild(xBubble.firstChild);
  }
  const xValue = xValues[hoverPoint.index];
  const label = numericX ? formatNumber(xValue) : String(xValue);
  const paddingX = 8;
  const paddingY = 4;
  const text = createSvg("text", { x: 0, y: 0 });
  text.textContent = label;
  xBubble.appendChild(text);
  const box = text.getBBox();
  const width = box.width + paddingX * 2;
  const height = box.height + paddingY * 2;
  let bubbleX = hoverPoint.x - width / 2;
  let bubbleY = cursorY - height - 12;
  if (bubbleX < left) {
    bubbleX = left;
  }
  if (bubbleX + width > right) {
    bubbleX = right - width;
  }
  if (bubbleY < top) {
    bubbleY = cursorY + 12;
  }
  if (bubbleY + height > bottom) {
    bubbleY = bottom - height;
  }
  const rect = createSvg("rect", {
    x: bubbleX,
    y: bubbleY,
    width,
    height,
    rx: 8,
    ry: 8,
  });
  xBubble.insertBefore(rect, text);
  text.setAttribute("x", bubbleX + width / 2);
  text.setAttribute("y", bubbleY + height / 2);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  xBubble.setAttribute("opacity", "1");
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
    if (hoverState.dots) {
      hoverState.dots.setAttribute("opacity", "0");
    }
    if (hoverState.xBubble) {
      hoverState.xBubble.setAttribute("opacity", "0");
    }
    return;
  }

  const hoverPoint = getHoverPoint(x);
  if (!hoverPoint) {
    return;
  }

  hoverState.line.setAttribute("opacity", "1");
  hoverState.line.setAttribute("x1", hoverPoint.x);
  hoverState.line.setAttribute("x2", hoverPoint.x);
  updateHoverDots(hoverPoint);
  updateHoverXBubble(hoverPoint, svgPoint.y);
}

function hideHoverLine() {
  if (hoverState && hoverState.line) {
    hoverState.line.setAttribute("opacity", "0");
  }
  if (hoverState && hoverState.dots) {
    hoverState.dots.setAttribute("opacity", "0");
  }
  if (hoverState && hoverState.xBubble) {
    hoverState.xBubble.setAttribute("opacity", "0");
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
  if (!groups.length) {
    axisSummary.innerHTML = "<span>暂无数据</span>";
    return;
  }
  groups.forEach((group, index) => {
    const override = axisOverrides.get(group.key) || { min: group.min, max: group.max };
    const row = document.createElement("div");
    row.className = "axis-control";

    const info = document.createElement("div");
    info.className = "axis-info";
    const title = document.createElement("div");
    title.className = "axis-title";
    title.textContent = `Y 轴 ${index + 1}`;
    const names = document.createElement("div");
    names.className = "axis-series";
    names.textContent = group.series.map((series) => series.name).join(" / ");
    info.appendChild(title);
    info.appendChild(names);

    const inputs = document.createElement("div");
    inputs.className = "axis-inputs";

    const minLabel = document.createElement("label");
    minLabel.textContent = "最小值";
    const minInput = document.createElement("input");
    minInput.type = "number";
    minInput.step = "any";
    minInput.value = String(override.min);
    minLabel.appendChild(minInput);

    const maxLabel = document.createElement("label");
    maxLabel.textContent = "最大值";
    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.step = "any";
    maxInput.value = String(override.max);
    maxLabel.appendChild(maxInput);

    const handleChange = () => {
      const minValue = Number(minInput.value);
      const maxValue = Number(maxInput.value);
      if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue >= maxValue) {
        return;
      }
      axisOverrides.set(group.key, { min: minValue, max: maxValue });
      refreshChart();
    };

    minInput.addEventListener("change", handleChange);
    maxInput.addEventListener("change", handleChange);

    inputs.appendChild(minLabel);
    inputs.appendChild(maxLabel);
    row.appendChild(info);
    row.appendChild(inputs);
    axisSummary.appendChild(row);
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

loadDataSourceList();
renderEmpty("请上传 CSV 或加载示例数据。");
