const fileInput = document.getElementById("fileInput");
let chart = document.getElementById("chart");
let legend = document.getElementById("legend");
let axisSummary = document.getElementById("axisSummary");
let seriesControls = document.getElementById("seriesControls");
const dataSourceNote = document.getElementById("dataSourceNote");
let seriesCount = document.getElementById("seriesCount");
let rangeSlider = document.getElementById("rangeSlider");
let rangeTrack = document.getElementById("rangeTrack");
let rangeSelection = document.getElementById("rangeSelection");
const downloadChartBtn = document.getElementById("downloadChart");
const builtinCharts = document.getElementById("builtinCharts");
const uploadGroupContent = document.getElementById("uploadGroupContent");

const WATERMARK_TEXT = "anexus.cn";

let currentDataset = null;
let currentRange = null;
let visibility = new Map();
let hoverState = null;
let dragState = null;
let chartLayout = null;
let sliderPadding = { left: 0, right: 0 };
let seriesStyles = new Map();
let axisOverrides = new Map();
let axisForcedSeries = new Set();
let dropdownListenerAttached = false;
let dataSources = [];
const dataSourceManifest = "./data/sources.json";

let activeInstance = null;
const builtinInstances = [];
let uploadInstance = null;

const defaultColorHexes = [
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

const colorVars = defaultColorHexes.map((_, index) => `--color${index + 1}`);

function getCssColor(varName, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
}

const colorOptions = colorVars.map((varName, index) =>
  getCssColor(varName, defaultColorHexes[index])
);

const seriesDefaultConfig = new Map([
  ["市值/GDP分位", { colorIndex: 0, type: "line" }],
  ["成交量/市值分位", { colorIndex: 4, type: "line" }],
  ["融资融券/市值分位", { colorIndex: 2, type: "line" }],
  ["股权风险溢价分位", { colorIndex: 1, type: "line" }],
  ["全A点位", { colorIndex: 10, type: "area" }],
  ["市场温度", { colorIndex: 5, type: "line" }],
  ["股权风险溢价", { colorIndex: 7, type: "line" }],
  ["十年国债收益率", { colorIndex: 6, type: "line" }],
  ["PE-TTM-S", { colorIndex: 3, type: "line" }],
  ["+2σ", { colorIndex: 10, type: "line" }],
  ["+1σ", { colorIndex: 10, type: "line" }],
  ["中位数", { colorIndex: 10, type: "line" }],
  ["-1σ", { colorIndex: 10, type: "line" }],
  ["-2σ", { colorIndex: 10, type: "line" }],
]);

if (fileInput) {
  fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const text = String(loadEvent.target.result || "");
      if (uploadInstance) {
        withInstance(uploadInstance, () => handleCSV(text));
        setUploadGroupVisible(true);
      } else {
        handleCSV(text);
      }
    };
    reader.readAsText(file);
  });
}

if (downloadChartBtn) {
  downloadChartBtn.addEventListener("click", () => {
    if (uploadInstance) {
      withInstance(uploadInstance, downloadChartImage);
    } else {
      downloadChartImage();
    }
  });
}

function downloadChartImage() {
  if (!currentDataset || !chart) {
    return;
  }
  const exportSvg = buildExportSvg();
  if (!exportSvg) {
    return;
  }
  const { svg, width, height } = exportSvg;
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svg);
  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => {
    const scale = window.devicePixelRatio || 1;
    const legendItems = getLegendItemsForExport();
    const legendStyle = legend ? getComputedStyle(legend) : null;
    const legendFontSize = legendStyle ? parseFloat(legendStyle.fontSize) : 13;
    const legendFontFamily = legendStyle
      ? legendStyle.fontFamily
      : 'Manrope, "SF Pro Display", "PingFang SC", sans-serif';
    const legendLayout = layoutLegendItems(
      legendItems,
      width,
      24,
      24,
      legendFontSize,
      legendFontFamily
    );
    const legendHeight = legendLayout.height;
    const chartOffsetY = legendHeight ? legendHeight + 24 : 0;
    const canvasHeight = height + chartOffsetY + 24;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(canvasHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return;
    }
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, canvasHeight);

    if (legendLayout.height) {
      drawLegendPills(ctx, legendLayout, legendFontSize, legendFontFamily);
    }

    ctx.drawImage(image, 0, chartOffsetY, width, height);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl) {
        const link = document.createElement("a");
        const now = new Date();
        const stamp = now.toISOString().slice(0, 10);
        link.download = `chart-${stamp}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return;
      }
    } catch (error) {
      // ignore and fallback to blob/svg
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        URL.revokeObjectURL(url);
        downloadSvgFallback(svg);
        return;
      }
      const link = document.createElement("a");
      const now = new Date();
      const stamp = now.toISOString().slice(0, 10);
      link.download = `chart-${stamp}.png`;
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      URL.revokeObjectURL(url);
    }, "image/png");
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
  };
  image.src = url;
}

function buildExportSvg() {
  const viewBox = chart.getAttribute("viewBox");
  let width = 1100;
  let height = 540;
  if (viewBox) {
    const parts = viewBox.split(" ").map(Number);
    if (parts.length === 4) {
      width = parts[2];
      height = parts[3];
    }
  } else {
    const rect = chart.getBoundingClientRect();
    width = rect.width || width;
    height = rect.height || height;
  }

  const svg = chart.cloneNode(true);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.querySelectorAll(".hover-line, .hover-dots, .hover-x-bubble").forEach((node) => node.remove());

  const ns = "http://www.w3.org/2000/svg";
  const background = document.createElementNS(ns, "rect");
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", String(width));
  background.setAttribute("height", String(height));
  background.setAttribute("fill", "#ffffff");
  svg.insertBefore(background, svg.firstChild);

  const style = document.createElementNS(ns, "style");
  style.textContent = `
    text { font-family: "Manrope", "SF Pro Display", "PingFang SC", sans-serif; fill: #5b606b; font-size: 12px; }
    .axis-line { stroke: rgba(17, 18, 22, 0.2); stroke-width: 1; }
    .grid-line { stroke: rgba(17, 18, 22, 0.08); stroke-width: 1; }
    .series-line { fill: none; stroke-width: 1.25; }
    .series-area { opacity: 0.2; }
    .series-bar { opacity: 0.75; }
    .hover-dot { fill: #fff; stroke-width: 2; }
    .reference-line { stroke-width: 1; stroke-dasharray: 5 5; opacity: 0.6; }
    .value-bubble rect { fill: #fff; stroke-width: 1; opacity: 0.95; }
    .value-bubble text { font-weight: 600; }
  `;
  svg.insertBefore(style, svg.firstChild);

  const title = document.createElementNS(ns, "text");
  const titleText = activeInstance?.exportTitle
    ? activeInstance.exportTitle
    : document.querySelector("#uploadChartPanel .panel__header h2")?.textContent?.trim() || "曲线图";
  title.textContent = titleText;
  title.setAttribute("x", String(width / 2));
  title.setAttribute("y", "24");
  title.setAttribute("text-anchor", "middle");
  title.setAttribute("font-size", "16");
  title.setAttribute("font-weight", "600");
  title.setAttribute("fill", "#111216");
  svg.appendChild(title);

  const watermark = document.createElementNS(ns, "text");
  const plotRight = chartLayout ? chartLayout.viewWidth - chartLayout.paddingRight : width - 16;
  const plotBottom = chartLayout
    ? chartLayout.viewHeight - chartLayout.paddingBottom
    : height - 12;
  watermark.textContent = WATERMARK_TEXT;
  watermark.setAttribute("x", String(plotRight - 12));
  watermark.setAttribute("y", String(plotBottom - 10));
  watermark.setAttribute("text-anchor", "end");
  watermark.setAttribute("font-size", "12");
  watermark.setAttribute("font-weight", "600");
  watermark.setAttribute("fill", "rgba(17, 18, 22, 0.35)");
  svg.appendChild(watermark);

  return { svg, width, height };
}


function downloadSvgFallback(svg) {
  try {
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const link = document.createElement("a");
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    link.download = `chart-${stamp}.svg`;
    link.href = URL.createObjectURL(svgBlob);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    // no-op
  }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function getLegendItemsForExport() {
  if (legend) {
    const items = Array.from(legend.querySelectorAll(".legend__item"));
    return items
      .filter((item) => !item.classList.contains("legend__item--hidden"))
      .map((item) => {
        const label = item.querySelector("span:last-child");
        const swatch = item.querySelector(".legend__swatch");
        const color = swatch
          ? swatch.style.backgroundColor || getComputedStyle(swatch).backgroundColor
          : "#5b606b";
        return {
          label: label ? label.textContent.trim() : "",
          color,
        };
      })
      .filter((item) => item.label);
  }

  if (!currentDataset) {
    return [];
  }

  return currentDataset.series
    .filter((series) => visibility.get(series.id) !== false && series.hasData)
    .map((series) => ({
      label: series.name || series.id,
      color: getSeriesColor(series),
    }));
}

function layoutLegendItems(items, width, startX, startY, fontSize, fontFamily) {
  if (!items.length) {
    return { items: [], height: 0 };
  }
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) {
    return { items: [], height: 0 };
  }
  ctx.font = `${fontSize}px ${fontFamily}`;
  const gap = 12;
  const pillPaddingX = 14;
  const swatchRadius = 5;
  const pillHeight = Math.max(26, fontSize + 12);
  const maxWidth = width - startX * 2;

  let x = startX;
  let y = startY;
  const laidOut = [];
  items.forEach((item) => {
    const labelWidth = ctx.measureText(item.label).width;
    const pillWidth = pillPaddingX * 2 + swatchRadius * 2 + 8 + labelWidth;
    if (x + pillWidth > startX + maxWidth) {
      x = startX;
      y += pillHeight + gap;
    }
    laidOut.push({
      ...item,
      x,
      y,
      width: pillWidth,
      height: pillHeight,
      swatchRadius,
      paddingX: pillPaddingX,
    });
    x += pillWidth + gap;
  });
  const height = laidOut.length ? y - startY + pillHeight : 0;
  return { items: laidOut, height };
}

function drawLegendPills(ctx, layout, fontSize, fontFamily) {
  if (!layout.items.length) {
    return;
  }
  ctx.save();
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  layout.items.forEach((item) => {
    ctx.fillStyle = "#f5f6fa";
    drawRoundedRect(ctx, item.x, item.y, item.width, item.height, item.height / 2);
    ctx.fill();

    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(
      item.x + item.paddingX + item.swatchRadius,
      item.y + item.height / 2,
      item.swatchRadius,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.fillStyle = "#5b606b";
    ctx.fillText(
      item.label,
      item.x + item.paddingX + item.swatchRadius * 2 + 8,
      item.y + item.height / 2
    );
  });
  ctx.restore();
}

function setDataSourceNote(message) {
  if (!dataSourceNote) {
    return;
  }
  dataSourceNote.textContent = message;
}

function setUploadGroupVisible(visible) {
  if (!uploadGroupContent) {
    return;
  }
  uploadGroupContent.classList.toggle("is-hidden", !visible);
}

function bindInstance(instance) {
  activeInstance = instance;
  if (!dragState || dragState.instance === instance) {
    dragState = instance.dragState;
  }
  chart = instance.chart;
  legend = instance.legend;
  axisSummary = instance.axisSummary;
  seriesControls = instance.seriesControls;
  seriesCount = instance.seriesCount;
  rangeSlider = instance.rangeSlider;
  rangeTrack = instance.rangeTrack;
  rangeSelection = instance.rangeSelection;
  currentDataset = instance.currentDataset;
  currentRange = instance.currentRange;
  visibility = instance.visibility;
  hoverState = instance.hoverState;
  chartLayout = instance.chartLayout;
  sliderPadding = instance.sliderPadding;
  seriesStyles = instance.seriesStyles;
  axisOverrides = instance.axisOverrides;
  axisForcedSeries = instance.axisForcedSeries;
}

function syncInstance(instance) {
  instance.currentDataset = currentDataset;
  instance.currentRange = currentRange;
  instance.hoverState = hoverState;
  instance.dragState = dragState;
  instance.chartLayout = chartLayout;
  instance.sliderPadding = sliderPadding;
}

function withInstance(instance, fn) {
  if (!instance) {
    return null;
  }
  bindInstance(instance);
  const result = fn();
  syncInstance(instance);
  return result;
}

function createChartInstance(options) {
  const instance = {
    id: options.id || "",
    title: options.title || "",
    exportTitle: options.exportTitle || options.title || "",
    axisLabelPrefix: options.axisLabelPrefix || "",
    styleScope: options.styleScope || "upload",
    chart: options.chart,
    legend: options.legend,
    axisSummary: options.axisSummary || null,
    seriesControls: options.seriesControls || null,
    seriesCount: options.seriesCount || null,
    rangeSlider: options.rangeSlider || null,
    rangeTrack: options.rangeTrack || null,
    rangeSelection: options.rangeSelection || null,
    currentDataset: null,
    currentRange: null,
    visibility: new Map(),
    hoverState: null,
    dragState: null,
    chartLayout: null,
    sliderPadding: { left: 0, right: 0 },
    seriesStyles: new Map(),
    axisOverrides: new Map(),
    axisForcedSeries: new Set(),
  };
  attachInstanceEvents(instance);
  return instance;
}

function attachInstanceEvents(instance) {
  if (instance.chart) {
    instance.chart.addEventListener("pointermove", (event) => {
      withInstance(instance, () => handleHoverMove(event));
    });
    instance.chart.addEventListener("pointerleave", () => {
      withInstance(instance, hideHoverLine);
    });
  }
  if (instance.rangeSelection) {
    instance.rangeSelection.addEventListener("pointerdown", (event) => {
      withInstance(instance, () => handleRangePointerDown(event));
    });
  }
}

function getInlineSources() {
  const list = window.__DATA_SOURCES__;
  return Array.isArray(list) ? list : [];
}

function getInlineFiles() {
  const files = window.__DATA_FILES__;
  if (!files || typeof files !== "object") {
    return {};
  }
  return files;
}

function getSourceLabel(source) {
  if (!source) {
    return "内置数据";
  }
  const label = String(source.label || "").trim();
  if (label) {
    return label;
  }
  const file = String(source.file || "").trim();
  if (!file) {
    return "内置数据";
  }
  const withoutExt = file.replace(/\.[^/.]+$/, "");
  return withoutExt || file;
}

function createBuiltinGroup(title) {
  const group = document.createElement("section");
  group.className = "chart-group";

  const header = document.createElement("div");
  header.className = "group-header";
  const heading = document.createElement("h2");
  heading.textContent = `曲线图——${title}`;
  const desc = document.createElement("p");
  desc.textContent = "内置数据自动生成。";
  header.appendChild(heading);
  header.appendChild(desc);

  const content = document.createElement("div");
  content.className = "group-content";

  const settingsGrid = document.createElement("div");
  settingsGrid.className = "settings-grid";

  const axisPanel = document.createElement("section");
  axisPanel.className = "panel settings-panel";
  const axisHead = document.createElement("div");
  axisHead.className = "settings-head";
  const axisTitle = document.createElement("h3");
  axisTitle.textContent = "Y 轴范围";
  const axisDesc = document.createElement("p");
  axisDesc.textContent = "支持按数据分组后为每个 Y 轴设置最小/最大值。";
  axisHead.appendChild(axisTitle);
  axisHead.appendChild(axisDesc);
  const axisSummaryEl = document.createElement("div");
  axisSummaryEl.className = "axis-summary";
  axisPanel.appendChild(axisHead);
  axisPanel.appendChild(axisSummaryEl);

  const stylePanel = document.createElement("section");
  stylePanel.className = "panel settings-panel";
  const styleHead = document.createElement("div");
  styleHead.className = "settings-head";
  const styleTitle = document.createElement("h3");
  styleTitle.textContent = "曲线样式";
  const styleDesc = document.createElement("p");
  styleDesc.textContent = "为每条曲线指定类型，并设置显示当前值。";
  styleHead.appendChild(styleTitle);
  styleHead.appendChild(styleDesc);
  const seriesControlsEl = document.createElement("div");
  seriesControlsEl.className = "series-controls";
  stylePanel.appendChild(styleHead);
  stylePanel.appendChild(seriesControlsEl);

  settingsGrid.appendChild(axisPanel);
  settingsGrid.appendChild(stylePanel);

  const panel = document.createElement("section");
  panel.className = "panel chart-panel chart-panel--static";

  const panelHeader = document.createElement("div");
  panelHeader.className = "panel__header";

  const panelText = document.createElement("div");
  const panelTitle = document.createElement("h2");
  panelTitle.textContent = `曲线图——${title}`;
  const panelDesc = document.createElement("p");
  panelDesc.textContent = "支持多列数据自动绘制，自动生成多个 Y 轴。";
  panelText.appendChild(panelTitle);
  panelText.appendChild(panelDesc);

  const actions = document.createElement("div");
  actions.className = "chart-actions";
  const downloadBtn = document.createElement("button");
  downloadBtn.className = "button";
  downloadBtn.type = "button";
  downloadBtn.textContent = "下载曲线图";
  const legendBlock = document.createElement("div");
  legendBlock.className = "legend";
  actions.appendChild(downloadBtn);
  actions.appendChild(legendBlock);

  panelHeader.appendChild(panelText);
  panelHeader.appendChild(actions);

  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("chart-output");
  svg.setAttribute("viewBox", "0 0 1100 540");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${title}曲线图`);
  wrap.appendChild(svg);

  const slider = document.createElement("div");
  slider.className = "range-slider is-hidden";
  const track = document.createElement("div");
  track.className = "range-track";
  const selection = document.createElement("div");
  selection.className = "range-selection";
  const leftHandle = document.createElement("div");
  leftHandle.className = "range-handle";
  leftHandle.dataset.handle = "left";
  leftHandle.setAttribute("aria-label", "左侧滑块");
  const rightHandle = document.createElement("div");
  rightHandle.className = "range-handle";
  rightHandle.dataset.handle = "right";
  rightHandle.setAttribute("aria-label", "右侧滑块");
  selection.appendChild(leftHandle);
  selection.appendChild(rightHandle);
  track.appendChild(selection);
  slider.appendChild(track);
  wrap.appendChild(slider);

  panel.appendChild(panelHeader);
  panel.appendChild(wrap);

  content.appendChild(settingsGrid);
  content.appendChild(panel);

  group.appendChild(header);
  group.appendChild(content);

  return {
    group,
    panel,
    chart: svg,
    legend: legendBlock,
    downloadBtn,
    axisSummary: axisSummaryEl,
    seriesControls: seriesControlsEl,
    rangeSlider: slider,
    rangeTrack: track,
    rangeSelection: selection,
  };
}

function setBuiltinPanelError(panel, message, axisSummaryEl, seriesControlsEl) {
  if (!panel) {
    return;
  }
  const legendBlock = panel.querySelector(".legend");
  if (legendBlock) {
    legendBlock.innerHTML = "";
  }
  const wrap = panel.querySelector(".chart-wrap");
  if (!wrap) {
    return;
  }
  wrap.innerHTML = "";
  const error = document.createElement("div");
  error.className = "chart-error";
  error.textContent = message;
  wrap.appendChild(error);
  if (axisSummaryEl) {
    axisSummaryEl.innerHTML = "<span>暂无数据</span>";
  }
  if (seriesControlsEl) {
    seriesControlsEl.innerHTML = "<span>暂无数据</span>";
  }
}

async function loadBuiltInCharts() {
  if (!builtinCharts) {
    return;
  }
  builtinCharts.innerHTML = "";
  builtinInstances.length = 0;

  const inlineSources = getInlineSources();
  const inlineFiles = getInlineFiles();
  const hasInline = inlineSources.length > 0 && Object.keys(inlineFiles).length > 0;
  const preferInline = window.location.protocol === "file:" && hasInline;

  let manifestLoaded = true;
  try {
    const response = await fetch(dataSourceManifest, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("failed");
    }
    const payload = await response.json();
    const list = Array.isArray(payload.sources) ? payload.sources : [];
    dataSources = list.filter(
      (item) => item && item.file && String(item.file).toLowerCase().endsWith(".csv")
    );
  } catch (error) {
    manifestLoaded = false;
    dataSources = [];
    if (hasInline) {
      dataSources = inlineSources.filter(
        (item) => item && item.file && String(item.file).toLowerCase().endsWith(".csv")
      );
      manifestLoaded = true;
    }
  }

  if (!dataSources.length) {
    setDataSourceNote(
      manifestLoaded ? "未找到内置 CSV，可继续上传 CSV。" : "未读取到内置 CSV，可继续上传 CSV。"
    );
    return;
  }

  setDataSourceNote(
    preferInline
      ? "已自动加载内置 CSV 曲线图（本地内嵌数据）。"
      : "已自动加载内置 CSV 曲线图，可继续上传 CSV。"
  );

  for (const source of dataSources) {
    const title = getSourceLabel(source);
    const groupParts = createBuiltinGroup(title);
    builtinCharts.appendChild(groupParts.group);
    const axisTitle = `曲线图——${title}`;
    const instance = createChartInstance({
      id: source.file,
      title,
      exportTitle: `曲线图——${title}`,
      axisLabelPrefix: axisTitle,
      styleScope: "builtin",
      chart: groupParts.chart,
      legend: groupParts.legend,
      axisSummary: groupParts.axisSummary,
      seriesControls: groupParts.seriesControls,
      rangeSlider: groupParts.rangeSlider,
      rangeTrack: groupParts.rangeTrack,
      rangeSelection: groupParts.rangeSelection,
    });
    builtinInstances.push(instance);
    if (groupParts.downloadBtn) {
      groupParts.downloadBtn.addEventListener("click", () => {
        withInstance(instance, downloadChartImage);
      });
    }

    if (!source.file) {
      setBuiltinPanelError(
        groupParts.panel,
        "未提供 CSV 文件名称。",
        groupParts.axisSummary,
        groupParts.seriesControls
      );
      continue;
    }

    try {
      let text = null;
      if (inlineFiles[source.file] && preferInline) {
        text = inlineFiles[source.file];
      } else {
        const url = source.file.startsWith("http") ? source.file : `./data/${source.file}`;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          throw new Error("failed");
        }
        text = await response.text();
      }
      const rows = parseCSV(text);
      if (!rows.length || rows.length < 2) {
        setBuiltinPanelError(
          groupParts.panel,
          "CSV 数据不足，请确认包含标题行和至少一行数据。",
          groupParts.axisSummary,
          groupParts.seriesControls
        );
        continue;
      }
      const dataset = buildDataset(rows);
      if (!dataset.series.length) {
        setBuiltinPanelError(
          groupParts.panel,
          "未检测到可绘制的数值列，请检查表格内容。",
          groupParts.axisSummary,
          groupParts.seriesControls
        );
        continue;
      }
      withInstance(instance, () => {
        applyDataset(dataset);
      });
    } catch (error) {
      if (inlineFiles[source.file] && !preferInline) {
        const rows = parseCSV(inlineFiles[source.file]);
        if (rows.length >= 2) {
          const dataset = buildDataset(rows);
          if (dataset.series.length) {
            withInstance(instance, () => {
              applyDataset(dataset);
            });
            continue;
          }
        }
      }
      setBuiltinPanelError(
        groupParts.panel,
        `加载失败：${title}`,
        groupParts.axisSummary,
        groupParts.seriesControls
      );
    }
  }
}

function applyDataset(dataset) {
  currentDataset = dataset;
  currentRange = {
    start: 0,
    end: Math.max(0, dataset.xValues.length - 1),
  };
  visibility.clear();
  seriesStyles.clear();
  axisOverrides.clear();
  axisForcedSeries.clear();
  dataset.series.forEach((series) => {
    visibility.set(series.id, true);
    getSeriesStyle(series);
  });

  renderAll();
}

function handleCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length || rows.length < 2) {
    renderEmpty("CSV 数据不足，请确认包含标题行和至少一行数据。");
    return false;
  }

  const dataset = buildDataset(rows);
  if (!dataset.series.length) {
    renderEmpty("未检测到可绘制的数值列，请检查表格内容。");
    return false;
  }

  applyDataset(dataset);
  return true;
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
    if (axisForcedSeries.has(series.id)) {
      groups.push({
        series: [series],
        maxAbs: series.maxAbs,
        minAbs: series.maxAbs,
        forced: true,
      });
      return;
    }

    let placed = false;

    for (const group of groups) {
      if (group.forced) {
        continue;
      }
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
        forced: false,
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
  axisForcedSeries.clear();
  hoverState = null;
  chartLayout = null;
  sliderPadding = { left: 0, right: 0 };
  if (chart) {
    chart.innerHTML = "";
  }
  if (legend) {
    legend.innerHTML = "";
  }
  if (axisSummary) {
    axisSummary.innerHTML = `<span>${message}</span>`;
  }
  if (seriesControls) {
    seriesControls.innerHTML = "";
  }
  if (seriesCount) {
    seriesCount.textContent = "0 条曲线";
  }
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
  const paddingRight =
    axisCount <= 1 ? paddingLeft : paddingLeft + Math.max(0, axisCount - 2) * axisGap;
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
    return getSeriesStyle(series).type === "bar";
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

    const style = getSeriesStyle(series);
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
    viewHeight: height,
    paddingLeft,
    paddingRight,
    paddingTop,
    paddingBottom,
  };
  updateSliderPadding();
}

function updateLegend() {
  if (!currentDataset) {
    return;
  }
  if (!legend) {
    return;
  }
  legend.innerHTML = "";
  const instance = activeInstance;
  currentDataset.series.forEach((series) => {
    const item = document.createElement("div");
    const isVisible = visibility.get(series.id) !== false;
    item.className = `legend__item${isVisible ? "" : " legend__item--hidden"}`;
    item.addEventListener("click", () => {
      if (instance) {
        withInstance(instance, () => toggleSeries(series.id));
      } else {
        toggleSeries(series.id);
      }
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
  if (!seriesCount) {
    return;
  }
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

function getSeriesStyle(series) {
  const name = (series?.name || "").trim() || series?.id || "series";
  const map = seriesStyles;
  const key = series.id;
  if (!map.has(key)) {
    const preset = seriesDefaultConfig.get(name);
    const index = series.index;
    map.set(key, {
      type: preset ? preset.type : "line",
      showCurrent: false,
      color: preset
        ? colorOptions[preset.colorIndex]
        : colorOptions[index % colorOptions.length],
    });
  }
  return map.get(key);
}

function setSeriesStyle(series, updates) {
  const map = seriesStyles;
  const key = series.id;
  const current = getSeriesStyle(series);
  map.set(key, { ...current, ...updates });
}

function getSeriesColor(series) {
  const style = getSeriesStyle(series);
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
  const instance = activeInstance;
  currentDataset.series.forEach((series) => {
    const style = getSeriesStyle(series);
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
      if (instance) {
        withInstance(instance, () => {
          setSeriesStyle(series, { type: select.value });
          refreshChart();
        });
        return;
      }
      setSeriesStyle(series, { type: select.value });
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
      if (instance) {
        withInstance(instance, () => {
          setSeriesStyle(series, { color: value });
          swatch.style.backgroundColor = value;
          triggerSwatch.style.backgroundColor = value;
          updateLegend();
          refreshChart();
        });
        return;
      }
      setSeriesStyle(series, { color: value });
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

    const axisToggle = document.createElement("label");
    axisToggle.className = "series-toggle";
    const axisCheckbox = document.createElement("input");
    axisCheckbox.type = "checkbox";
    axisCheckbox.checked = axisForcedSeries.has(series.id);
    axisCheckbox.addEventListener("change", () => {
      if (instance) {
        withInstance(instance, () => {
          if (axisCheckbox.checked) {
            axisForcedSeries.add(series.id);
          } else {
            axisForcedSeries.delete(series.id);
          }
          refreshChart();
        });
        return;
      }
      if (axisCheckbox.checked) {
        axisForcedSeries.add(series.id);
      } else {
        axisForcedSeries.delete(series.id);
      }
      refreshChart();
    });
    const axisText = document.createElement("span");
    axisText.textContent = "独立Y轴";
    axisToggle.appendChild(axisCheckbox);
    axisToggle.appendChild(axisText);

    const toggle = document.createElement("label");
    toggle.className = "series-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = style.showCurrent;
    checkbox.addEventListener("change", () => {
      if (instance) {
        withInstance(instance, () => {
          setSeriesStyle(series, { showCurrent: checkbox.checked });
          refreshChart();
        });
        return;
      }
      setSeriesStyle(series, { showCurrent: checkbox.checked });
      refreshChart();
    });
    const toggleText = document.createElement("span");
    toggleText.textContent = "当前值";
    toggle.appendChild(checkbox);
    toggle.appendChild(toggleText);

    options.appendChild(select);
    options.appendChild(dropdown);
    options.appendChild(colorInput);
    options.appendChild(axisToggle);
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

function updateHoverXBubble(hoverPoint) {
  if (!hoverState || !hoverState.xBubble) {
    return;
  }
  const { xBubble, xValues, numericX, left, right, top } = hoverState;
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
  let bubbleY = top - height - 12;
  if (bubbleX < left) {
    bubbleX = left;
  }
  if (bubbleX + width > right) {
    bubbleX = right - width;
  }
  if (bubbleY < 6) {
    bubbleY = 6;
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
  updateHoverXBubble(hoverPoint);
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
    instance: activeInstance,
  };
  if (activeInstance) {
    activeInstance.dragState = dragState;
  }

  event.currentTarget.setPointerCapture(event.pointerId);
  window.addEventListener("pointermove", handleRangePointerMove);
  window.addEventListener("pointerup", handleRangePointerUp);
  window.addEventListener("pointercancel", handleRangePointerUp);
  event.preventDefault();
}

function handleRangePointerMove(event) {
  if (!dragState || !dragState.instance) {
    return;
  }
  withInstance(dragState.instance, () => {
    if (!currentDataset || !currentRange || !rangeTrack) {
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
  });
}

function handleRangePointerUp() {
  if (!dragState) {
    return;
  }
  const targetInstance = dragState.instance;
  if (targetInstance) {
    withInstance(targetInstance, () => {
      dragState = null;
    });
  } else {
    dragState = null;
  }
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
  if (!axisSummary) {
    return;
  }
  axisSummary.innerHTML = "";
  const instance = activeInstance;
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
    if (activeInstance && activeInstance.axisLabelPrefix) {
      title.textContent = `${activeInstance.axisLabelPrefix}——Y轴${index + 1}`;
    } else {
      title.textContent = `Y 轴 ${index + 1}`;
    }
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
      if (instance) {
        withInstance(instance, () => {
          axisOverrides.set(group.key, { min: minValue, max: maxValue });
          refreshChart();
        });
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

uploadInstance = createChartInstance({
  id: "upload",
  title: "曲线图",
  exportTitle: "曲线图",
  styleScope: "upload",
  chart,
  legend,
  axisSummary,
  seriesControls,
  seriesCount,
  rangeSlider,
  rangeTrack,
  rangeSelection,
});

window.addEventListener("resize", () => {
  const instances = [...builtinInstances, uploadInstance].filter(Boolean);
  instances.forEach((instance) => {
    withInstance(instance, () => {
      if (currentDataset && currentRange) {
        refreshChart();
      } else {
        updateSliderPadding();
      }
    });
  });
});

withInstance(uploadInstance, () => {
  renderEmpty("正在读取内置数据…");
});
setUploadGroupVisible(false);
if (fileInput) {
  fileInput.disabled = true;
}
loadBuiltInCharts()
  .catch(() => {
    setDataSourceNote("未读取到内置 CSV，可继续上传 CSV。");
  })
  .finally(() => {
    withInstance(uploadInstance, () => {
      renderEmpty("请上传 CSV 以生成曲线图。");
    });
    if (fileInput) {
      fileInput.disabled = false;
    }
  });
