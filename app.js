const DATA_TIMEOUT_MS = 20000;
const CACHE_KEY = "mmdb_payload_v4";
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function createSvgEl(tag, attrs = {}, parent = null) {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === "NaN") continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    el.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(el);
  return el;
}

function formatNumber(n, decimals = 0) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "--";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatDisplayDate(isoStr) {
  if (!isoStr || typeof isoStr !== "string") return "--";
  const parts = isoStr.trim().split("-");
  if (parts.length !== 3) return isoStr;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12) {
    return isoStr;
  }
  const dd = String(d).padStart(2, "0");
  return `${MONTHS_SHORT[m - 1]} ${dd}, ${y}`;
}

function formatDurationDHM(totalMinutes, style = "compact") {
  if (totalMinutes === null || totalMinutes === undefined || !Number.isFinite(Number(totalMinutes))) return "--";
  const totalM = Math.max(0, Math.round(Number(totalMinutes)));
  const days = Math.floor(totalM / 1440);
  const hrs = Math.floor((totalM % 1440) / 60);
  const mins = totalM % 60;

  if (style === "long") {
    const dLbl = days === 1 ? "day" : "days";
    const hLbl = hrs === 1 ? "hr" : "hrs";
    const mLbl = mins === 1 ? "min" : "mins";
    if (days > 0) {
      return `${formatNumber(days)} ${dLbl}, ${hrs} ${hLbl}, ${mins} ${mLbl}`;
    }
    return `${hrs} ${hLbl}, ${mins} ${mLbl}`;
  }

  if (style === "always-days") {
    return `${formatNumber(days)}d ${hrs}h ${String(mins).padStart(2, "0")}m`;
  }

  if (days > 0) {
    return `${formatNumber(days)}d ${hrs}h ${String(mins).padStart(2, "0")}m`;
  }
  if (hrs > 0) {
    return `${hrs}h ${String(mins).padStart(2, "0")}m`;
  }
  return `${mins}m`;
}

function imdbTitleUrl(imdbId) {
  if (!imdbId) return "https://www.imdb.com/";
  return `https://www.imdb.com/title/${encodeURIComponent(String(imdbId).trim())}/`;
}

function ordinalSuffix(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  switch (num % 10) {
    case 1: return `${num}st`;
    case 2: return `${num}nd`;
    case 3: return `${num}rd`;
    default: return `${num}th`;
  }
}

function getInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function showEmptyNote(box, message) {
  box.innerHTML = "";
  const div = document.createElement("div");
  div.className = "empty-note";
  div.textContent = message;
  box.appendChild(div);
}

/* Shared Interactive Tooltip (Hover + Mobile Tap-to-Pin with Close Button) */
const tooltipEl = document.getElementById("mmdbTooltip");
let tooltipPinned = false;

function buildTooltipContent(title, rows, extraSection) {
  tooltipEl.innerHTML = "";
  const headerRow = document.createElement("div");
  headerRow.className = "tt-header-row";

  const t = document.createElement("div");
  t.className = "tt-title";
  t.textContent = title || "";
  headerRow.appendChild(t);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tt-close-btn";
  closeBtn.textContent = "X";
  closeBtn.setAttribute("aria-label", "Close tooltip");
  closeBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    hideTooltip(true);
  });
  headerRow.appendChild(closeBtn);
  tooltipEl.appendChild(headerRow);

  (rows || []).forEach(([k, v]) => {
    const r = document.createElement("div");
    r.className = "tt-row";
    const kEl = document.createElement("span");
    kEl.className = "tt-k";
    kEl.textContent = k;
    const vEl = document.createElement("span");
    vEl.className = "tt-v";
    vEl.textContent = String(v);
    r.appendChild(kEl);
    r.appendChild(vEl);
    tooltipEl.appendChild(r);
  });

  if (extraSection && extraSection.items && extraSection.items.length) {
    const div = document.createElement("div");
    div.className = "tt-divider";
    tooltipEl.appendChild(div);

    if (extraSection.heading) {
      const sh = document.createElement("div");
      sh.className = "tt-subhead";
      sh.textContent = extraSection.heading;
      tooltipEl.appendChild(sh);
    }

    extraSection.items.forEach(([leftText, rightText]) => {
      const r = document.createElement("div");
      r.className = "tt-row";
      const lEl = document.createElement("span");
      lEl.className = "tt-film-name";
      lEl.textContent = leftText;
      const rEl = document.createElement("span");
      rEl.className = "tt-v";
      rEl.textContent = rightText;
      r.appendChild(lEl);
      r.appendChild(rEl);
      tooltipEl.appendChild(r);
    });

    if (extraSection.footnote) {
      const fn = document.createElement("div");
      fn.className = "tt-footnote";
      fn.textContent = extraSection.footnote;
      tooltipEl.appendChild(fn);
    }
  }
}

function showTooltip(evt, title, rows, extraSection = null, pin = false) {
  buildTooltipContent(title, rows, extraSection);
  tooltipPinned = Boolean(pin);
  tooltipEl.classList.toggle("pinned", tooltipPinned);
  tooltipEl.classList.add("visible");
  tooltipEl.setAttribute("aria-hidden", "false");
  positionTooltip(evt);
}

function positionTooltip(evt) {
  if (!evt) return;
  const pad = 14;
  const rect = tooltipEl.getBoundingClientRect();
  const clientX = evt.clientX ?? (evt.touches && evt.touches[0] ? evt.touches[0].clientX : window.innerWidth / 2);
  const clientY = evt.clientY ?? (evt.touches && evt.touches[0] ? evt.touches[0].clientY : window.innerHeight / 2);
  let x = clientX + pad;
  let y = clientY + pad;
  if (x + rect.width > window.innerWidth - 10) {
    x = clientX - rect.width - pad;
  }
  if (y + rect.height > window.innerHeight - 10) {
    y = clientY - rect.height - pad;
  }
  tooltipEl.style.left = `${Math.max(8, x)}px`;
  tooltipEl.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip(force = false) {
  if (tooltipPinned && !force) return;
  tooltipPinned = false;
  tooltipEl.classList.remove("visible", "pinned");
  tooltipEl.setAttribute("aria-hidden", "true");
}

function bindTooltip(el, title, rows, extraSection = null, allowClickPin = true) {
  el.addEventListener("mouseenter", (e) => {
    if (!tooltipPinned) showTooltip(e, title, rows, extraSection, false);
  });
  el.addEventListener("mousemove", (e) => {
    if (!tooltipPinned) positionTooltip(e);
  });
  el.addEventListener("mouseleave", () => hideTooltip(false));
  if (allowClickPin) {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      showTooltip(e, title, rows, extraSection, true);
    });
  }
}

document.addEventListener("click", () => hideTooltip(true));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideTooltip(true);
});

/* Data Loader */
async function loadPayload() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DATA_TIMEOUT_MS);
  try {
    const res = await fetch("./data.json", { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ./data.json`);
    const payload = await res.json();
    if (!payload || !payload.kpis || !Array.isArray(payload.viewings)) {
      throw new Error("Invalid data.json structure");
    }
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (_) {
      // Ignore quota limits
    }
    return payload;
  } catch (err) {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.kpis && Array.isArray(parsed.viewings)) return parsed;
      } catch (_) {
        sessionStorage.removeItem(CACHE_KEY);
      }
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* 1. KPI Sparklines */
function renderSparkline(containerId, series, valueKey, unitLabel, mode = "count") {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  if (!series || series.length < 2) return;

  const vals = series.map((d) => Number(d[valueKey]) || 0);
  const maxVal = Math.max(...vals, 1);
  const minVal = Math.min(...vals, 0);
  const span = Math.max(maxVal - minVal, 1);

  const w = 220;
  const h = 42;
  const padX = 6;
  const padY = 6;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  const svg = createSvgEl(
    "svg",
    { viewBox: `0 0 ${w} ${h}`, style: "width: 100%; height: 42px; display: block;" },
    box
  );

  const coords = series.map((d, i) => {
    const x = padX + (i / Math.max(series.length - 1, 1)) * plotW;
    const v = Number(d[valueKey]) || 0;
    const y = padY + plotH - ((v - minVal) / span) * plotH;
    return { x, y, d, v };
  });

  const linePath = coords.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${(padY + plotH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padY + plotH).toFixed(1)} Z`;

  createSvgEl("path", { d: areaPath, fill: "#F5C518", opacity: 0.16 }, svg);
  createSvgEl("path", { d: linePath, fill: "none", stroke: "#C99A00", "stroke-width": 1.8, "stroke-linejoin": "round" }, svg);

  const peakIdx = vals.indexOf(maxVal);
  coords.forEach((p, i) => {
    const isEnd = i === coords.length - 1;
    const isPeak = i === peakIdx;
    const dot = createSvgEl(
      "circle",
      {
        cx: p.x,
        cy: p.y,
        r: isPeak || isEnd ? 3 : 2,
        fill: isPeak ? "#F5C518" : "#1F2328",
        opacity: isPeak || isEnd ? 1 : 0.01,
        style: "cursor: pointer;",
      },
      svg
    );
    let valStr;
    if (mode === "pct") {
      valStr = `${p.v}%`;
    } else if (mode === "dhm") {
      const mins = p.d.totalMinutes ?? p.v * 60;
      valStr = formatDurationDHM(mins, "long");
    } else {
      valStr = `${formatNumber(p.v)} ${unitLabel}`;
    }
    bindTooltip(dot, `Year ${p.d.year}`, [[unitLabel, valStr]]);
    dot.addEventListener("mouseenter", () => dot.setAttribute("opacity", "1"));
    dot.addEventListener("mouseleave", () => dot.setAttribute("opacity", isPeak || isEnd ? "1" : "0.01"));
  });
}

/* 2. Most Recent Watch with Poster & IMDb Link */
function renderPosterElement(container, posterUrl, title, releaseYear) {
  container.innerHTML = "";
  if (posterUrl) {
    const img = document.createElement("img");
    img.src = posterUrl;
    img.alt = `${title} poster`;
    img.loading = "lazy";
    img.onerror = () => {
      container.innerHTML = "";
      renderPosterFallback(container, releaseYear);
    };
    container.appendChild(img);
  } else {
    renderPosterFallback(container, releaseYear);
  }
}

function renderPosterFallback(container, releaseYear) {
  const fb = document.createElement("div");
  fb.className = "poster-fallback";
  const yr = document.createElement("div");
  yr.className = "poster-fallback-yr";
  yr.textContent = releaseYear ? String(releaseYear) : "MMDb";
  const tag = document.createElement("div");
  tag.className = "poster-fallback-tag";
  tag.textContent = "Poster";
  fb.appendChild(yr);
  fb.appendChild(tag);
  container.appendChild(fb);
}

function renderRecentWatch(recent) {
  const url = imdbTitleUrl(recent.imdbId);
  const posterLink = document.getElementById("recentPosterWrap");
  posterLink.href = url;
  renderPosterElement(posterLink, recent.posterUrl, recent.title, recent.releaseYear);

  const titleText = recent.releaseYear ? `${recent.title} (${recent.releaseYear})` : recent.title || "--";
  const titleLink = document.getElementById("recentTitle");
  titleLink.textContent = titleText;
  titleLink.href = url;

  const parts = [`Watched ${formatDisplayDate(recent.watchDate)}`];
  if (recent.imdbRating !== null && recent.imdbRating !== undefined) parts.push(`IMDb ${recent.imdbRating}/10`);
  if (recent.runtimeMinutes) parts.push(`${Math.round(recent.runtimeMinutes)} min`);
  if (recent.genres && recent.genres.length) parts.push(recent.genres.join(", "));
  document.getElementById("recentMeta").textContent = parts.join("  |  ");

  const pills = document.getElementById("recentPills");
  pills.innerHTML = "";
  const ordText =
    recent.viewingNumber === 1
      ? "1st time watching this movie"
      : `${ordinalSuffix(recent.viewingNumber)} time watching this movie`;
  const p1 = document.createElement("span");
  p1.className = "pill";
  p1.textContent = ordText;
  pills.appendChild(p1);

  if (recent.totalFilmMinutes) {
    const pRt = document.createElement("span");
    pRt.className = "pill pill-muted";
    pRt.textContent = `Total time on this film: ${formatDurationDHM(recent.totalFilmMinutes, "long")}`;
    pills.appendChild(pRt);
  }

  if (recent.daysSincePrevWatch !== null && recent.daysSincePrevWatch !== undefined) {
    const p2 = document.createElement("span");
    p2.className = "pill pill-muted";
    p2.textContent = `${formatNumber(recent.daysSincePrevWatch)} days since prior watch (${formatDisplayDate(recent.prevWatchDate)})`;
    pills.appendChild(p2);
  }

  if (recent.imdbId) {
    const imdbPill = document.createElement("a");
    imdbPill.className = "pill pill-imdb-link";
    imdbPill.href = url;
    imdbPill.target = "_blank";
    imdbPill.rel = "noopener noreferrer";
    imdbPill.textContent = "Open on IMDb ↗";
    pills.appendChild(imdbPill);
  }
}

/* 3. Viewing Timeline + Synchronized Life Eras Gantt */
function parseDateMs(s) {
  return new Date(`${s}T00:00:00Z`).getTime();
}

function renderTimelineAndGantt(timeline, lifeEras, metricKey) {
  const tBox = document.getElementById("timelineChart");
  const gBox = document.getElementById("lifeErasGantt");
  tBox.innerHTML = "";
  gBox.innerHTML = "";

  if (!timeline || !timeline.length) {
    showEmptyNote(tBox, "No timeline data available.");
    return;
  }

  const metricMeta = {
    viewings: { label: "Viewings per Quarter" },
    totalHours: { label: "Watch Time per Quarter" },
    rewatchPct: { label: "Rewatch Rate per Quarter (%)" },
    firstWatches: { label: "First-Time Watches per Quarter" },
  }[metricKey];

  const minMs = parseDateMs(timeline[0].startDate);
  const maxMs = parseDateMs(timeline[timeline.length - 1].endDate);
  const timeSpan = Math.max(maxMs - minMs, 1);

  const width = 1100;
  const padL = 56;
  const padR = 24;
  const plotW = width - padL - padR;
  const xDate = (ms) => padL + ((ms - minMs) / timeSpan) * plotW;

  const tHeight = 220;
  const padT = 24;
  const padB = 26;
  const plotH = tHeight - padT - padB;

  const vals = timeline.map((d) => Number(d[metricKey]) || 0);
  const maxVal = Math.max(...vals, 1);
  const peakIdx = vals.indexOf(maxVal);

  const svgT = createSvgEl(
    "svg",
    { viewBox: `0 0 ${width} ${tHeight}`, style: "width: 100%; height: auto; display: block; font-family: Lato, sans-serif;" },
    tBox
  );

  [0, 0.5, 1].forEach((f) => {
    const y = padT + plotH - f * plotH;
    createSvgEl("line", { x1: padL, y1: y, x2: padL + plotW, y2: y, stroke: f === 0 ? "#CBD2D9" : "#ECEFF2" }, svgT);
    let lbl;
    if (metricKey === "rewatchPct") {
      lbl = `${Math.round(f * maxVal)}%`;
    } else if (metricKey === "totalHours") {
      lbl = `${(f * maxVal / 24).toFixed(1)}d`;
    } else {
      lbl = formatNumber(Math.round(f * maxVal));
    }
    createSvgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", fill: "#6E7781", "font-size": 11 }, svgT).textContent = lbl;
  });

  const startYr = new Date(minMs).getUTCFullYear();
  const endYr = new Date(maxMs).getUTCFullYear();
  for (let yr = startYr; yr <= endYr; yr += 2) {
    const x = xDate(parseDateMs(`${yr}-01-01`));
    if (x >= padL && x <= padL + plotW) {
      createSvgEl("line", { x1: x, y1: padT, x2: x, y2: padT + plotH, stroke: "#F0F2F5" }, svgT);
      createSvgEl("text", { x, y: tHeight - 6, "text-anchor": "middle", fill: "#6E7781", "font-size": 11 }, svgT).textContent = String(yr);
    }
  }

  const pts = timeline.map((d) => {
    const x = xDate(parseDateMs(d.midDate));
    const v = Number(d[metricKey]) || 0;
    const y = padT + plotH - (v / maxVal) * plotH;
    return { x, y, v, d };
  });

  const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = `${lineD} L${pts[pts.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L${pts[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  createSvgEl("path", { d: areaD, fill: "#F5C518", opacity: 0.2 }, svgT);
  createSvgEl("path", { d: lineD, fill: "none", stroke: "#1F2328", "stroke-width": 2.2, "stroke-linejoin": "round" }, svgT);

  pts.forEach((p, i) => {
    const isPeak = i === peakIdx;
    const dot = createSvgEl(
      "circle",
      {
        cx: p.x,
        cy: p.y,
        r: isPeak ? 5 : 3.2,
        fill: isPeak ? "#F5C518" : "#1F2328",
        stroke: "#FFFFFF",
        "stroke-width": 1.4,
        style: "cursor: pointer;",
      },
      svgT
    );
    const qMins = p.d.totalMinutes ?? p.d.totalHours * 60;
    const rows = [
      ["Viewings", formatNumber(p.d.viewings)],
      ["Total Watch Time", qMins > 0 ? formatDurationDHM(qMins, "compact") : "--"],
      ["First Watches", formatNumber(p.d.firstWatches)],
      ["Rewatch Rate", `${p.d.rewatchPct}%`],
    ];
    if (p.d.topMovie) rows.push(["Top Title", p.d.topMovie]);
    bindTooltip(dot, `${p.d.quarter} (${metricMeta.label})`, rows);
  });

  if (!lifeEras || !lifeEras.length) return;
  const maxTrack = Math.max(...lifeEras.map((e) => Number(e.track) || 0), 0);
  const trackH = 30;
  const gHeight = (maxTrack + 1) * trackH + 26;

  const svgG = createSvgEl(
    "svg",
    { viewBox: `0 0 ${width} ${gHeight}`, style: "width: 100%; height: auto; display: block; font-family: Lato, sans-serif;" },
    gBox
  );

  createSvgEl("text", { x: padL, y: 12, fill: "#6E7781", "font-size": 11, "font-weight": 700 }, svgG).textContent =
    "LIFE ERAS (ALIGNED TO TIMELINE)";

  lifeEras.forEach((era) => {
    const sMs = Math.max(minMs, parseDateMs(era.start));
    const eMs = Math.min(maxMs, parseDateMs(era.end));
    if (eMs <= sMs) return;
    const x1 = xDate(sMs);
    const x2 = xDate(eMs);
    const barW = Math.max(8, x2 - x1);
    const y = 22 + (Number(era.track) || 0) * trackH;

    const grp = createSvgEl("g", { style: "cursor: pointer;" }, svgG);
    createSvgEl("rect", {
      x: x1,
      y,
      width: barW,
      height: 22,
      rx: 6,
      fill: era.color || "#6E7781",
      opacity: 0.88,
    }, grp);

    if (barW > 64) {
      createSvgEl("text", {
        x: x1 + 8,
        y: y + 14.5,
        fill: "#FFFFFF",
        "font-size": 11,
        "font-weight": 700,
      }, grp).textContent = era.label;
    }

    const eraMins = era.totalMinutes ?? era.totalHours * 60;
    const rows = [
      ["Period", `${formatDisplayDate(era.start)} to ${formatDisplayDate(era.end)}`],
      ["Viewings", formatNumber(era.viewings)],
      ["Pace", `${era.avgPerMonth} films / mo`],
      ["Watch Time", eraMins > 0 ? formatDurationDHM(eraMins, "compact") : "--"],
      ["Rewatch Rate", `${era.rewatchPct}%`],
    ];
    if (era.topMovie) rows.push(["Most Watched", era.topMovie]);
    bindTooltip(grp, era.label, rows);
  });
}

/* 4. Genres: Horizontal Lollipop + Lower-Triangle Co-Occurrence Matrix */
function renderGenreLollipop(containerId, counts) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  const slice = (counts || []).slice(0, 12);
  if (!slice.length) {
    showEmptyNote(box, "Genre lollipop chart populates once IMDb title.basics.tsv.gz is synced.");
    return;
  }

  const maxVal = Math.max(...slice.map((d) => d.viewings), 1);
  const rowH = 27;
  const w = 480;
  const h = slice.length * rowH + 34;
  const labelW = 104;
  const plotW = w - labelW - 60;

  const svg = createSvgEl(
    "svg",
    { viewBox: `0 0 ${w} ${h}`, style: "width: 100%; height: auto; display: block; font-family: Lato, sans-serif;" },
    box
  );

  createSvgEl("text", { x: 0, y: 14, fill: "#6E7781", "font-size": 12, "font-weight": 700 }, svg).textContent =
    "Top 12 Genres by Logged Viewings";

  slice.forEach((d, i) => {
    const y = 32 + i * rowH;
    const xEnd = labelW + (d.viewings / maxVal) * plotW;
    const isTop = d.viewings === maxVal;
    const accent = isTop ? "#F5C518" : "#6E7781";

    const grp = createSvgEl("g", { style: "cursor: pointer;" }, svg);
    createSvgEl("text", { x: labelW - 10, y: y + 4, "text-anchor": "end", fill: "#1F2328", "font-size": 12 }, grp).textContent = d.genre;
    createSvgEl("line", { x1: labelW, y1: y, x2: xEnd, y2: y, stroke: isTop ? "#D9AD0D" : "#B8C0C8", "stroke-width": 2.5 }, grp);
    createSvgEl("circle", { cx: xEnd, cy: y, r: isTop ? 6.5 : 5, fill: accent, stroke: "#FFFFFF", "stroke-width": 1.2 }, grp);
    createSvgEl("text", { x: xEnd + 11, y: y + 4, fill: "#1F2328", "font-size": 12, "font-weight": 700 }, grp).textContent = formatNumber(d.viewings);

    bindTooltip(grp, d.genre, [["Logged Viewings", formatNumber(d.viewings)], ["Rank", `#${i + 1}`]]);
  });
}

function renderGenreMatrix(containerId, genreData) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  const topGenres = (genreData?.counts || []).slice(0, 8).map((d) => d.genre);
  const pairs = genreData?.coOccurrence || [];
  if (topGenres.length < 2 || !pairs.length) {
    showEmptyNote(box, "Genre overlap matrix populates once IMDb title.basics.tsv.gz is synced.");
    return;
  }

  const pairMap = new Map();
  let maxPair = 1;
  pairs.forEach((p) => {
    pairMap.set(`${p.genreA}|${p.genreB}`, p.viewings);
    pairMap.set(`${p.genreB}|${p.genreA}`, p.viewings);
    if (p.viewings > maxPair) maxPair = p.viewings;
  });

  const cell = 42;
  const padL = 94;
  const padT = 30;
  const padB = 64;
  const w = padL + topGenres.length * cell + 14;
  const h = padT + topGenres.length * cell + padB;

  const svg = createSvgEl(
    "svg",
    { viewBox: `0 0 ${w} ${h}`, style: "width: 100%; max-width: 500px; height: auto; display: block; font-family: Lato, sans-serif;" },
    box
  );

  createSvgEl("text", { x: 0, y: 14, fill: "#6E7781", "font-size": 12, "font-weight": 700 }, svg).textContent =
    "Lower-Triangle Genre Overlap Matrix";

  topGenres.forEach((g, idx) => {
    const cy = padT + idx * cell + cell / 2 + 4;
    if (idx > 0) {
      createSvgEl("text", { x: padL - 8, y: cy, "text-anchor": "end", fill: "#1F2328", "font-size": 11 }, svg).textContent = g;
    }
    if (idx < topGenres.length - 1) {
      const cx = padL + idx * cell + cell / 2;
      const by = padT + topGenres.length * cell + 14;
      createSvgEl("text", {
        x: cx,
        y: by,
        fill: "#1F2328",
        "font-size": 11,
        "text-anchor": "end",
        transform: `rotate(-35 ${cx} ${by})`,
      }, svg).textContent = g;
    }
  });

  for (let r = 1; r < topGenres.length; r++) {
    for (let c = 0; c < r; c++) {
      const rowG = topGenres[r];
      const colG = topGenres[c];
      const val = pairMap.get(`${rowG}|${colG}`) || 0;
      const x = padL + c * cell;
      const y = padT + r * cell;
      const intensity = val > 0 ? 0.16 + 0.84 * (val / maxPair) : 0.05;

      const grp = createSvgEl("g", { style: "cursor: pointer;" }, svg);
      createSvgEl("rect", {
        x: x + 2,
        y: y + 2,
        width: cell - 4,
        height: cell - 4,
        rx: 6,
        fill: val > 0 ? "#F5C518" : "#6E7781",
        opacity: Number(intensity.toFixed(2)),
      }, grp);
      if (val > 0) {
        createSvgEl("text", {
          x: x + cell / 2,
          y: y + cell / 2 + 4,
          fill: "#111111",
          "font-size": 11,
          "font-weight": 700,
          "text-anchor": "middle",
        }, grp).textContent = String(val);
      }
      bindTooltip(grp, `${rowG} + ${colG}`, [["Shared Viewings", formatNumber(val)]]);
    }
  }
}

/* 5. Recency Bias Scatter + Release Decade Vertical Column Chart */
function renderRecencyScatter(containerId, viewings) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  const pts = (viewings || []).filter(
    (v) => Number.isFinite(Number(v.releaseYear)) && Number.isFinite(Number(v.watchYear))
  );
  if (!pts.length) {
    showEmptyNote(box, "Recency scatterplot populates once IMDb title.basics.tsv.gz is synced.");
    return;
  }

  const w = 540;
  const h = 280;
  const pad = { top: 26, right: 20, bottom: 38, left: 46 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const minRel = Math.min(...pts.map((p) => Number(p.releaseYear)));
  const maxRel = Math.max(...pts.map((p) => Number(p.releaseYear)));
  const minWat = Math.min(...pts.map((p) => Number(p.watchYear)));
  const maxWat = Math.max(...pts.map((p) => Number(p.watchYear)));

  const xScale = (yr) => pad.left + ((yr - minRel) / Math.max(maxRel - minRel, 1)) * plotW;
  const yScale = (yr) => pad.top + plotH - ((yr - minWat) / Math.max(maxWat - minWat, 1)) * plotH;

  const svg = createSvgEl(
    "svg",
    { viewBox: `0 0 ${w} ${h}`, style: "width: 100%; height: auto; display: block; font-family: Lato, sans-serif;" },
    box
  );

  createSvgEl("text", { x: 0, y: 14, fill: "#6E7781", "font-size": 12, "font-weight": 700 }, svg).textContent =
    "Release Year vs. Watch Year (Recency Bias)";

  createSvgEl("line", { x1: pad.left, y1: pad.top + plotH, x2: pad.left + plotW, y2: pad.top + plotH, stroke: "#CBD2D9" }, svg);
  createSvgEl("line", { x1: pad.left, y1: pad.top, x2: pad.left, y2: pad.top + plotH, stroke: "#CBD2D9" }, svg);

  const diagStart = Math.max(minRel, minWat);
  const diagEnd = Math.min(maxRel, maxWat);
  if (diagEnd > diagStart) {
    createSvgEl("line", {
      x1: xScale(diagStart),
      y1: yScale(diagStart),
      x2: xScale(diagEnd),
      y2: yScale(diagEnd),
      stroke: "#D4A70F",
      "stroke-dasharray": "4,4",
      "stroke-width": 1.5,
    }, svg);
  }

  createSvgEl("text", { x: pad.left, y: h - 10, fill: "#6E7781", "font-size": 11 }, svg).textContent = String(minRel);
  createSvgEl("text", { x: pad.left + plotW / 2, y: h - 10, "text-anchor": "middle", fill: "#6E7781", "font-size": 11 }, svg).textContent = "Release Year";
  createSvgEl("text", { x: pad.left + plotW, y: h - 10, "text-anchor": "end", fill: "#6E7781", "font-size": 11 }, svg).textContent = String(maxRel);
  createSvgEl("text", { x: 4, y: pad.top + 8, fill: "#6E7781", "font-size": 11 }, svg).textContent = String(maxWat);
  createSvgEl("text", { x: 4, y: pad.top + plotH, fill: "#6E7781", "font-size": 11 }, svg).textContent = String(minWat);

  pts.forEach((p) => {
    const cx = xScale(Number(p.releaseYear));
    const cy = yScale(Number(p.watchYear));
    const lag = Number(p.recencyLagYears);
    const isRecent = Number.isFinite(lag) && lag <= 2;
    const dot = createSvgEl(
      "circle",
      {
        cx,
        cy,
        r: isRecent ? 3.5 : 2.6,
        fill: isRecent ? "#F5C518" : "#6E7781",
        opacity: isRecent ? 0.85 : 0.42,
        style: "cursor: pointer;",
      },
      svg
    );
    bindTooltip(dot, `${p.title} (${p.releaseYear})`, [
      ["Watched", formatDisplayDate(p.watchDate)],
      ["Film Age at Watch", `${lag} yrs`],
      ["IMDb Rating", p.imdbRating ?? "--"],
    ]);
  });
}

function renderEraColumns(containerId, eras, metricKey) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  if (!eras || !eras.length) {
    showEmptyNote(box, "Release decade breakdown populates once IMDb title.basics.tsv.gz is synced.");
    return;
  }

  const isHours = metricKey === "cumulativeHours";
  const vals = eras.map((d) => Number(d[metricKey]) || 0);
  const maxVal = Math.max(...vals, 1);

  const w = 540;
  const h = 280;
  const pad = { top: 30, right: 16, bottom: 38, left: 46 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const slotW = plotW / eras.length;
  const barW = Math.max(12, Math.min(34, slotW * 0.68));

  const svg = createSvgEl(
    "svg",
    { viewBox: `0 0 ${w} ${h}`, style: "width: 100%; height: auto; display: block; font-family: Lato, sans-serif;" },
    box
  );

  createSvgEl("text", { x: 0, y: 14, fill: "#6E7781", "font-size": 12, "font-weight": 700 }, svg).textContent =
    isHours ? "Cumulative Watch Time by Release Decade (Days, Gold = Peak)" : "Unique Films by Release Decade (Gold = Peak)";

  createSvgEl("line", { x1: pad.left, y1: pad.top + plotH, x2: pad.left + plotW, y2: pad.top + plotH, stroke: "#CBD2D9" }, svg);

  eras.forEach((d, i) => {
    const val = Number(d[metricKey]) || 0;
    const isPeak = val === maxVal && val > 0;
    const bh = Math.max(2, (val / maxVal) * plotH);
    const x = pad.left + i * slotW + (slotW - barW) / 2;
    const y = pad.top + plotH - bh;
    const eraMins = d.cumulativeMinutes ?? d.cumulativeHours * 60;

    const grp = createSvgEl("g", { style: "cursor: pointer;" }, svg);
    createSvgEl("rect", {
      x,
      y,
      width: barW,
      height: bh,
      rx: 4,
      fill: isPeak ? "#F5C518" : "#6E7781",
    }, grp);

    const lblText = isHours
      ? (eraMins >= 1440 ? `${(eraMins / 1440).toFixed(1)}d` : `${Math.round(eraMins / 60)}h`)
      : formatNumber(val);

    createSvgEl("text", {
      x: x + barW / 2,
      y: y - 5,
      "text-anchor": "middle",
      fill: "#1F2328",
      "font-size": 10,
      "font-weight": isPeak ? 900 : 700,
    }, grp).textContent = lblText;

    createSvgEl("text", {
      x: x + barW / 2,
      y: h - 14,
      "text-anchor": "middle",
      fill: "#6E7781",
      "font-size": 10,
    }, grp).textContent = d.era;

    bindTooltip(grp, `${d.era} Releases`, [
      ["Unique Films", formatNumber(d.uniqueFilms)],
      ["Cumulative Watch Time", formatDurationDHM(eraMins, "compact")],
    ]);
  });
}

/* 6. IMDb Rating Histogram + Vote Depth Donut */
function renderRatingHistogram(containerId, bins, viewings) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  if (!bins || !bins.length) {
    showEmptyNote(box, "IMDb rating histogram populates once title.ratings.tsv.gz is synced.");
    return;
  }

  const maxV = Math.max(...bins.map((b) => b.viewings), 1);
  const ratedVals = (viewings || []).map((v) => v.imdbRating).filter((r) => Number.isFinite(Number(r))).map(Number);
  const meanRating = ratedVals.length ? ratedVals.reduce((a, b) => a + b, 0) / ratedVals.length : null;

  const w = 640;
  const h = 250;
  const pad = { top: 30, right: 20, bottom: 36, left: 42 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const slotW = plotW / bins.length;
  const barW = Math.max(10, slotW * 0.72);

  const svg = createSvgEl(
    "svg",
    { viewBox: `0 0 ${w} ${h}`, style: "width: 100%; height: auto; display: block; font-family: Lato, sans-serif;" },
    box
  );

  createSvgEl("text", { x: 0, y: 14, fill: "#6E7781", "font-size": 12, "font-weight": 700 }, svg).textContent =
    "Viewings by IMDb Rating (0.5-Point Buckets, Gold = Modal Peak)";

  createSvgEl("line", { x1: pad.left, y1: pad.top + plotH, x2: pad.left + plotW, y2: pad.top + plotH, stroke: "#CBD2D9" }, svg);

  bins.forEach((b, i) => {
    const isPeak = b.viewings === maxV;
    const bh = Math.max(2, (b.viewings / maxV) * plotH);
    const x = pad.left + i * slotW + (slotW - barW) / 2;
    const y = pad.top + plotH - bh;

    const grp = createSvgEl("g", { style: "cursor: pointer;" }, svg);
    createSvgEl("rect", { x, y, width: barW, height: bh, rx: 4, fill: isPeak ? "#F5C518" : "#6E7781" }, grp);
    if (isPeak || b.viewings >= maxV * 0.25) {
      createSvgEl("text", {
        x: x + barW / 2,
        y: y - 5,
        "text-anchor": "middle",
        fill: "#1F2328",
        "font-size": 10,
        "font-weight": 700,
      }, grp).textContent = formatNumber(b.viewings);
    }
    createSvgEl("text", {
      x: x + barW / 2,
      y: h - 12,
      "text-anchor": "middle",
      fill: "#6E7781",
      "font-size": 10,
    }, grp).textContent = String(b.rating);

    bindTooltip(grp, `IMDb Rating ${b.rating}`, [["Logged Viewings", formatNumber(b.viewings)]]);
  });

  if (meanRating !== null) {
    const minR = Number(bins[0].rating);
    const maxR = Number(bins[bins.length - 1].rating);
    const frac = (meanRating - minR) / Math.max(maxR - minR, 0.5);
    const mx = pad.left + slotW / 2 + frac * (plotW - slotW);
    createSvgEl("line", { x1: mx, y1: pad.top, x2: mx, y2: pad.top + plotH, stroke: "#1F2328", "stroke-dasharray": "4,3", "stroke-width": 1.6 }, svg);
    createSvgEl("text", { x: mx + 6, y: pad.top + 12, fill: "#1F2328", "font-size": 11, "font-weight": 700 }, svg).textContent =
      `Mean: ${meanRating.toFixed(2)}`;
  }
}

function renderVoteDepthDonut(containerId, tiers) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  const valid = (tiers || []).filter((t) => t.viewings > 0);
  if (!valid.length) {
    showEmptyNote(box, "Vote depth breakdown populates after IMDb sync.");
    return;
  }

  const total = valid.reduce((sum, t) => sum + t.viewings, 0);
  const colors = {
    "Blockbuster (250k+)": "#F5C518",
    "Mainstream (50k-250k)": "#2F4858",
    "Cult / Mid-Tier (10k-50k)": "#6E7781",
    "Niche (<10k)": "#B8C0C8",
    "Unknown": "#DCE1E6",
  };

  const w = 380;
  const h = 230;
  const cx = 104;
  const cy = 122;
  const r = 74;
  const strokeW = 24;
  const circ = 2 * Math.PI * r;

  const svg = createSvgEl(
    "svg",
    { viewBox: `0 0 ${w} ${h}`, style: "width: 100%; height: auto; display: block; font-family: Lato, sans-serif;" },
    box
  );

  createSvgEl("text", { x: 0, y: 14, fill: "#6E7781", "font-size": 12, "font-weight": 700 }, svg).textContent =
    "Vote Depth (Mainstream vs. Niche)";

  let offset = 0;
  valid.forEach((t, idx) => {
    const share = t.viewings / total;
    const segLen = share * circ;
    const col = colors[t.tier] || "#6E7781";

    const arc = createSvgEl(
      "circle",
      {
        cx,
        cy,
        r,
        fill: "none",
        stroke: col,
        "stroke-width": strokeW,
        "stroke-dasharray": `${segLen.toFixed(2)} ${(circ - segLen).toFixed(2)}`,
        "stroke-dashoffset": (-offset).toFixed(2),
        transform: `rotate(-90 ${cx} ${cy})`,
        style: "cursor: pointer;",
      },
      svg
    );
    bindTooltip(arc, t.tier, [
      ["Viewings", formatNumber(t.viewings)],
      ["Share", `${(share * 100).toFixed(1)}%`],
    ]);
    offset += segLen;

    const ly = 56 + idx * 32;
    const lg = createSvgEl("g", { style: "cursor: pointer;" }, svg);
    createSvgEl("rect", { x: 204, y: ly - 9, width: 12, height: 12, rx: 3, fill: col }, lg);
    createSvgEl("text", { x: 222, y: ly + 1, fill: "#1F2328", "font-size": 11, "font-weight": 700 }, lg).textContent = t.tier;
    createSvgEl("text", { x: 222, y: ly + 14, fill: "#6E7781", "font-size": 11 }, lg).textContent =
      `${formatNumber(t.viewings)} (${(share * 100).toFixed(1)}%)`;
    bindTooltip(lg, t.tier, [["Viewings", formatNumber(t.viewings)], ["Share", `${(share * 100).toFixed(1)}%`]]);
  });

  createSvgEl("text", { x: cx, y: cy - 2, "text-anchor": "middle", fill: "#1F2328", "font-size": 18, "font-weight": 900 }, svg).textContent =
    formatNumber(total);
  createSvgEl("text", { x: cx, y: cy + 15, "text-anchor": "middle", fill: "#6E7781", "font-size": 10 }, svg).textContent = "VIEWINGS";
}

/* 7. Cast & Crew Portrait Leaderboard with Top Films Tooltip */
function renderCreditsGrid(containerId, list, roleLabel) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  const slice = (list || []).slice(0, 10);
  if (!slice.length) {
    showEmptyNote(box, `Top ${roleLabel} populate once IMDb title.principals.tsv.gz and name.basics.tsv.gz are synced.`);
    return;
  }

  const maxV = Math.max(...slice.map((p) => p.viewings), 1);

  slice.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = `credit-card${idx === 0 ? " rank-one" : ""}`;

    const av = document.createElement("div");
    av.className = "avatar-wrap";
    if (p.profileUrl) {
      const img = document.createElement("img");
      img.src = p.profileUrl;
      img.alt = p.name;
      img.loading = "lazy";
      img.onerror = () => {
        av.innerHTML = "";
        const init = document.createElement("span");
        init.className = "avatar-initials";
        init.textContent = getInitials(p.name);
        av.appendChild(init);
      };
      av.appendChild(img);
    } else {
      const init = document.createElement("span");
      init.className = "avatar-initials";
      init.textContent = getInitials(p.name);
      av.appendChild(init);
    }

    const info = document.createElement("div");
    info.className = "credit-info";

    const top = document.createElement("div");
    top.className = "credit-top";
    const nm = document.createElement("span");
    nm.className = "credit-name";
    nm.textContent = `#${idx + 1} ${p.name}`;
    const st = document.createElement("span");
    st.className = "credit-stat";
    st.textContent = `${formatNumber(p.viewings)} views`;
    top.appendChild(nm);
    top.appendChild(st);

    const sub = document.createElement("div");
    sub.className = "credit-sub";
    sub.textContent = `${formatNumber(p.uniqueFilms)} unique films`;

    const track = document.createElement("div");
    track.className = "credit-bar-track";
    const fill = document.createElement("div");
    fill.className = "credit-bar-fill";
    fill.style.width = `${Math.max(4, (p.viewings / maxV) * 100)}%`;
    track.appendChild(fill);

    info.appendChild(top);
    info.appendChild(sub);
    info.appendChild(track);
    card.appendChild(av);
    card.appendChild(info);

    const films = p.topFilms || [];
    const remaining = Math.max(0, (Number(p.uniqueFilms) || 0) - films.length);
    const filmSection = films.length
      ? {
          heading: "Top Watched Films",
          items: films.map((f) => [
            f.releaseYear ? `${f.title} (${f.releaseYear})` : f.title,
            `${f.views} ${f.views === 1 ? "view" : "views"}`,
          ]),
          footnote: remaining > 0 ? `+ ${remaining} more ${remaining === 1 ? "film" : "films"} in log` : null,
        }
      : null;

    bindTooltip(
      card,
      p.name,
      [
        ["Role", roleLabel],
        ["Logged Viewings", formatNumber(p.viewings)],
        ["Unique Films", formatNumber(p.uniqueFilms)],
      ],
      filmSection
    );
    box.appendChild(card);
  });
}

/* 8. Most Watched Movies Poster Gallery (Clickable to IMDb) */
function renderTopRewatchedGallery(containerId, list) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  const slice = (list || []).slice(0, 10);
  if (!slice.length) {
    showEmptyNote(box, "No repeat viewings found.");
    return;
  }

  slice.forEach((item, idx) => {
    const card = document.createElement("a");
    card.className = "movie-card";
    card.href = imdbTitleUrl(item.imdbId);
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.setAttribute("aria-label", `Open ${item.title} on IMDb`);

    const pBox = document.createElement("div");
    pBox.className = "movie-poster-box";
    renderPosterElement(pBox, item.posterUrl, item.title, item.releaseYear);

    const badge = document.createElement("span");
    badge.className = "movie-rank-badge";
    badge.textContent = `#${idx + 1}`;
    pBox.appendChild(badge);

    const imdbTag = document.createElement("span");
    imdbTag.className = "movie-imdb-tag";
    imdbTag.textContent = "IMDb ↗";
    pBox.appendChild(imdbTag);

    const body = document.createElement("div");
    body.className = "movie-card-body";

    const titleEl = document.createElement("div");
    titleEl.className = "movie-card-title";
    titleEl.textContent = item.title;
    if (item.releaseYear) {
      const yrSpan = document.createElement("span");
      yrSpan.className = "movie-card-year";
      yrSpan.textContent = ` (${item.releaseYear})`;
      titleEl.appendChild(yrSpan);
    }

    const metrics = document.createElement("div");
    metrics.className = "movie-card-metrics";
    const vPill = document.createElement("span");
    vPill.className = "movie-views-pill";
    vPill.textContent = `${item.views} views`;
    const hPill = document.createElement("span");
    hPill.className = "movie-hours-pill";
    hPill.textContent = item.totalMinutes ? formatDurationDHM(item.totalMinutes, "compact") : "--";
    metrics.appendChild(vPill);
    metrics.appendChild(hPill);

    body.appendChild(titleEl);
    body.appendChild(metrics);
    card.appendChild(pBox);
    card.appendChild(body);

    const ttTitle = item.releaseYear ? `${item.title} (${item.releaseYear})` : item.title;
    bindTooltip(
      card,
      ttTitle,
      [
        ["Total Views", formatNumber(item.views)],
        ["Cumulative Watch Time", item.totalMinutes ? formatDurationDHM(item.totalMinutes, "compact") : "--"],
        ["Single Runtime", item.runtimeMinutes ? `${Math.round(item.runtimeMinutes)} min` : "--"],
        ["IMDb Rating", item.imdbRating ?? "--"],
        ["First Watch", formatDisplayDate(item.firstWatched)],
        ["Last Watch", formatDisplayDate(item.lastWatched)],
      ],
      { heading: "Link", items: [["Click card to open IMDb page", "↗"]] },
      false
    );
    box.appendChild(card);
  });
}

/* 9. Seasonality Heatmap, Runtime Line, Rewatch Latency Strip */
function renderSeasonHeatmap(containerId, matrix) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  if (!matrix || !matrix.length) {
    showEmptyNote(box, "No seasonal calendar data available.");
    return;
  }

  const maxV = Math.max(...matrix.map((d) => d.viewings), 1);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const cellW = 36;
  const cellH = 28;
  const padL = 42;
  const padT = 36;
  const w = padL + months.length * cellW + 12;
  const h = padT + days.length * cellH + 14;

  const svg = createSvgEl(
    "svg",
    { viewBox: `0 0 ${w} ${h}`, style: "width: 100%; height: auto; display: block; font-family: Lato, sans-serif;" },
    box
  );

  createSvgEl("text", { x: 0, y: 14, fill: "#6E7781", "font-size": 12, "font-weight": 700 }, svg).textContent =
    "Month x Weekday Viewing Heatmap (Gold = Highest Traffic)";

  months.forEach((m, i) => {
    createSvgEl("text", { x: padL + i * cellW + cellW / 2, y: padT - 6, "text-anchor": "middle", fill: "#6E7781", "font-size": 10 }, svg).textContent = m;
  });
  days.forEach((d, i) => {
    createSvgEl("text", { x: padL - 6, y: padT + i * cellH + cellH / 2 + 4, "text-anchor": "end", fill: "#6E7781", "font-size": 10 }, svg).textContent = d;
  });

  matrix.forEach((cell) => {
    const x = padL + (cell.month - 1) * cellW;
    const y = padT + cell.dayIndex * cellH;
    const ratio = cell.viewings / maxV;
    const isHot = ratio >= 0.65;
    const fill = isHot ? "#F5C518" : "#2F4858";
    const alpha = cell.viewings === 0 ? 0.05 : isHot ? 0.45 + ratio * 0.55 : 0.12 + ratio * 0.65;

    const grp = createSvgEl("g", { style: "cursor: pointer;" }, svg);
    createSvgEl("rect", {
      x: x + 2,
      y: y + 2,
      width: cellW - 4,
      height: cellH - 4,
      rx: 5,
      fill,
      opacity: Number(alpha.toFixed(2)),
    }, grp);
    createSvgEl("text", {
      x: x + cellW / 2,
      y: y + cellH / 2 + 4,
      "text-anchor": "middle",
      fill: isHot ? "#111111" : ratio > 0.45 ? "#FFFFFF" : "#1F2328",
      "font-size": 10,
      "font-weight": 700,
    }, grp).textContent = String(cell.viewings);

    const cellMins = cell.totalMinutes ?? cell.totalHours * 60;
    bindTooltip(grp, `${cell.monthLabel} (${cell.day}s)`, [
      ["Viewings", formatNumber(cell.viewings)],
      ["Total Watch Time", cellMins > 0 ? formatDurationDHM(cellMins, "compact") : "--"],
    ]);
  });
}

function renderRuntimeLine(containerId, rows) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  if (!rows || !rows.length) {
    showEmptyNote(box, "Runtime trajectory line populates once IMDb title.basics.tsv.gz is synced.");
    return;
  }

  const vals = rows.map((r) => Number(r.avgRuntimeMinutes));
  const minV = Math.floor(Math.min(...vals) / 5) * 5 - 5;
  const maxV = Math.ceil(Math.max(...vals) / 5) * 5 + 5;
  const meanV = vals.reduce((a, b) => a + b, 0) / vals.length;

  const w = 520;
  const h = 246;
  const pad = { top: 34, right: 20, bottom: 32, left: 46 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const xPos = (i) => pad.left + (i / Math.max(rows.length - 1, 1)) * plotW;
  const yPos = (v) => pad.top + plotH - ((v - minV) / Math.max(maxV - minV, 1)) * plotH;

  const svg = createSvgEl(
    "svg",
    { viewBox: `0 0 ${w} ${h}`, style: "width: 100%; height: auto; display: block; font-family: Lato, sans-serif;" },
    box
  );

  createSvgEl("text", { x: 0, y: 14, fill: "#6E7781", "font-size": 12, "font-weight": 700 }, svg).textContent =
    "Average Film Runtime (Minutes) by Watch Year";

  [minV, Math.round((minV + maxV) / 2), maxV].forEach((tick) => {
    const y = yPos(tick);
    createSvgEl("line", { x1: pad.left, y1: y, x2: pad.left + plotW, y2: y, stroke: "#ECEFF2" }, svg);
    createSvgEl("text", { x: pad.left - 8, y: y + 4, "text-anchor": "end", fill: "#6E7781", "font-size": 10 }, svg).textContent = `${tick}m`;
  });

  const meanY = yPos(meanV);
  createSvgEl("line", { x1: pad.left, y1: meanY, x2: pad.left + plotW, y2: meanY, stroke: "#D4A70F", "stroke-dasharray": "4,3", "stroke-width": 1.5 }, svg);
  createSvgEl("text", { x: pad.left + plotW, y: meanY - 5, "text-anchor": "end", fill: "#9E7A00", "font-size": 10, "font-weight": 700 }, svg).textContent =
    `Avg ${meanV.toFixed(1)}m`;

  const pathD = rows.map((r, i) => `${i === 0 ? "M" : "L"}${xPos(i).toFixed(1)},${yPos(r.avgRuntimeMinutes).toFixed(1)}`).join(" ");
  createSvgEl("path", { d: pathD, fill: "none", stroke: "#1F2328", "stroke-width": 2.2 }, svg);

  const peakVal = Math.max(...vals);
  rows.forEach((r, i) => {
    const cx = xPos(i);
    const cy = yPos(r.avgRuntimeMinutes);
    const isPeak = r.avgRuntimeMinutes === peakVal;
    const dot = createSvgEl(
      "circle",
      { cx, cy, r: isPeak ? 4.8 : 3.2, fill: isPeak ? "#F5C518" : "#1F2328", stroke: "#FFFFFF", "stroke-width": 1.2, style: "cursor: pointer;" },
      svg
    );
    const yrMins = r.totalMinutes ?? r.totalHours * 60;
    bindTooltip(dot, `Watch Year ${r.watchYear}`, [
      ["Avg Runtime", `${r.avgRuntimeMinutes} mins`],
      ["Total Watch Time", formatDurationDHM(yrMins, "compact")],
    ]);

    if (i === 0 || i === rows.length - 1 || i % 3 === 0) {
      createSvgEl("text", { x: cx, y: h - 10, "text-anchor": "middle", fill: "#6E7781", "font-size": 10 }, svg).textContent = String(r.watchYear);
    }
  });
}

function renderLatencyStrip(containerId, latency) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  const buckets = latency?.buckets || [];
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  if (!total) {
    showEmptyNote(box, "No rewatch latency gaps available.");
    return;
  }

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const w = 1100;
  const h = 84;
  const svg = createSvgEl(
    "svg",
    { viewBox: `0 0 ${w} ${h}`, style: "width: 100%; height: auto; display: block; font-family: Lato, sans-serif;" },
    box
  );

  createSvgEl("text", { x: 0, y: 14, fill: "#6E7781", "font-size": 12, "font-weight": 700 }, svg).textContent =
    `Rewatch Latency Share (Median Gap: ${formatNumber(Math.round(latency.medianDays))} days | Mean Gap: ${formatNumber(Math.round(latency.avgDays))} days | Gold = Largest Bucket)`;

  const palette = ["#2F4858", "#4A6572", "#6E7781", "#8C959F", "#B0B8C1"];
  let curX = 0;
  buckets.forEach((b, i) => {
    const share = b.count / total;
    const segW = Math.max(4, share * w - 4);
    const isPeak = b.count === maxCount;
    const fill = isPeak ? "#F5C518" : palette[i % palette.length];

    const grp = createSvgEl("g", { style: "cursor: pointer;" }, svg);
    createSvgEl("rect", { x: curX, y: 26, width: segW, height: 28, rx: 5, fill }, grp);
    if (segW > 75) {
      createSvgEl("text", {
        x: curX + segW / 2,
        y: 44,
        "text-anchor": "middle",
        fill: isPeak ? "#111111" : "#FFFFFF",
        "font-size": 11,
        "font-weight": 700,
      }, grp).textContent = `${b.bucket} (${(share * 100).toFixed(0)}%)`;
    }
    createSvgEl("text", {
      x: curX + segW / 2,
      y: 70,
      "text-anchor": "middle",
      fill: "#6E7781",
      "font-size": 10,
    }, grp).textContent = `${formatNumber(b.count)} rewatches`;

    bindTooltip(grp, `Rewatch Gap: ${b.bucket}`, [
      ["Rewatches", formatNumber(b.count)],
      ["Share of Rewatches", `${(share * 100).toFixed(1)}%`],
    ]);
    curX += segW + 4;
  });
}

/* 10. Complete Scrollable Viewing Log (MMM DD, YYYY + D,H,M + Clickable IMDb Links) */
function renderViewingLog(viewings) {
  const qMovie = document.getElementById("searchMovie").value.trim().toLowerCase();
  const qGenre = document.getElementById("searchGenre").value.trim().toLowerCase();
  const qYear = document.getElementById("searchYear").value.trim().toLowerCase();

  const filtered = (viewings || []).filter((v) => {
    const movieMatch =
      !qMovie ||
      String(v.title || "").toLowerCase().includes(qMovie) ||
      String(v.imdbId || "").toLowerCase().includes(qMovie);
    const genreMatch =
      !qGenre || (v.genres || []).some((g) => String(g).toLowerCase().includes(qGenre));
    const yearMatch =
      !qYear ||
      String(v.watchYear || "").includes(qYear) ||
      String(v.releaseYear || "").includes(qYear);
    return movieMatch && genreMatch && yearMatch;
  });

  const filteredMins = filtered.reduce((sum, v) => sum + (Number.isFinite(Number(v.runtimeMinutes)) ? Number(v.runtimeMinutes) : 0), 0);
  const rtSummary = filteredMins > 0 ? ` | Filtered Total Watch Time: ${formatDurationDHM(filteredMins, "long")}` : "";
  document.getElementById("logCountLabel").textContent =
    `Showing ${formatNumber(filtered.length)} of ${formatNumber((viewings || []).length)} viewings (newest first)${rtSummary}`;

  const tbody = document.getElementById("viewingLogBody");
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();

  filtered.forEach((v) => {
    const tr = document.createElement("tr");

    // 0: Date Watched (MMM DD, YYYY)
    const tdDate = document.createElement("td");
    tdDate.className = "date-col";
    tdDate.textContent = formatDisplayDate(v.watchDate);
    tr.appendChild(tdDate);

    // 1: Film Title (Clickable IMDb link)
    const tdFilm = document.createElement("td");
    const link = document.createElement("a");
    link.className = "imdb-film-link";
    link.href = imdbTitleUrl(v.imdbId);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = v.title || v.imdbId;
    const arrow = document.createElement("span");
    arrow.className = "ext-arrow";
    arrow.textContent = "↗";
    link.appendChild(arrow);
    tdFilm.appendChild(link);
    tr.appendChild(tdFilm);

    // 2..7: Release, Genres, IMDb, Runtime, Viewing #, Total Runtime Watched
    const rest = [
      { val: v.releaseYear ?? "--", cls: "num-col" },
      { val: (v.genres || []).join(", ") || "--", cls: "" },
      { val: v.imdbRating !== null && v.imdbRating !== undefined ? String(v.imdbRating) : "--", cls: "num-col" },
      { val: v.runtimeMinutes !== null && v.runtimeMinutes !== undefined ? `${Math.round(v.runtimeMinutes)}m` : "--", cls: "num-col" },
      { val: `#${v.viewingNumber} of ${v.totalViewsForTitle || v.viewingNumber}`, cls: "num-col" },
      { val: v.totalFilmMinutes ? formatDurationDHM(v.totalFilmMinutes, "compact") : "--", cls: "num-col" },
    ];
    rest.forEach((item) => {
      const td = document.createElement("td");
      if (item.cls) td.className = item.cls;
      td.textContent = String(item.val);
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

/* Insight Popovers */
function initInsightButtons(insights) {
  Object.entries(insights || {}).forEach(([key, text]) => {
    const pop = document.getElementById(`popover-${key}`);
    if (pop) pop.textContent = text;
  });

  document.querySelectorAll(".insight-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wrap = btn.closest(".insight-wrap");
      const wasOpen = wrap.classList.contains("open");
      document.querySelectorAll(".insight-wrap.open").forEach((w) => {
        w.classList.remove("open");
        const b = w.querySelector(".insight-btn");
        if (b) b.setAttribute("aria-expanded", "false");
      });
      if (!wasOpen) {
        wrap.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });

  document.addEventListener("click", () => {
    document.querySelectorAll(".insight-wrap.open").forEach((w) => {
      w.classList.remove("open");
      const b = w.querySelector(".insight-btn");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".insight-wrap.open").forEach((w) => w.classList.remove("open"));
    }
  });
}

/* Main Bootstrap */
async function init() {
  const banner = document.getElementById("statusBanner");
  try {
    const payload = await loadPayload();
    const k = payload.kpis;

    const startLbl = formatDisplayDate(payload.meta?.dateRange?.start);
    const endLbl = formatDisplayDate(payload.meta?.dateRange?.end);
    document.getElementById("dateRangeLabel").textContent = `${startLbl} to ${endLbl}`;

    document.getElementById("kpiUnique").textContent = formatNumber(k.uniqueFilms);
    document.getElementById("kpiViewings").textContent = formatNumber(k.totalViewings);
    document.getElementById("kpiRewatch").textContent = `${k.rewatchPct}%`;

    if (k.totalMinutes > 0) {
      document.getElementById("kpiRuntime").textContent = formatDurationDHM(k.totalMinutes, "always-days");
      document.getElementById("kpiRuntimeSub").textContent =
        `${formatDurationDHM(k.totalMinutes, "long")} (${formatNumber(k.totalHours, 1)} hrs)`;
    } else {
      document.getElementById("kpiRuntime").textContent = "Pending IMDb Sync";
      document.getElementById("kpiRuntimeSub").textContent = "Run GitHub Action to join runtimes";
    }

    const sp = payload.sparklines || [];
    renderSparkline("sparkUnique", sp, "firstWatches", "new films", "count");
    renderSparkline("sparkViewings", sp, "viewings", "viewings", "count");
    renderSparkline("sparkRewatch", sp, "rewatchPct", "rewatch rate", "pct");
    renderSparkline("sparkRuntime", sp, "totalHours", "Watch Time", "dhm");

    renderRecentWatch(payload.mostRecentWatch || {});

    let activeTimelineMetric = "viewings";
    const drawTimeline = () => renderTimelineAndGantt(payload.timeline || [], payload.lifeEras || [], activeTimelineMetric);
    drawTimeline();
    document.querySelectorAll(".timeline-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".timeline-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeTimelineMetric = btn.dataset.metric;
        drawTimeline();
      });
    });

    renderGenreLollipop("genreLollipopChart", payload.genres?.counts || []);
    renderGenreMatrix("genreMatrixChart", payload.genres || {});
    renderRecencyScatter("recencyScatterChart", payload.viewings || []);

    let activeEraMetric = "uniqueFilms";
    const drawEras = () => renderEraColumns("eraColumnChart", payload.releaseEras || [], activeEraMetric);
    drawEras();
    document.querySelectorAll(".era-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".era-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeEraMetric = btn.dataset.metric;
        drawEras();
      });
    });

    renderRatingHistogram("ratingHistogramChart", payload.ratingDistribution || [], payload.viewings || []);
    renderVoteDepthDonut("voteDepthDonut", payload.voteDepth || []);

    let activeRole = "actors";
    const roleLabels = { actors: "Actors", directors: "Directors", writers: "Writers", producers: "Producers" };
    const drawCredits = () => renderCreditsGrid("creditsGrid", payload.credits?.[activeRole] || [], roleLabels[activeRole]);
    drawCredits();
    document.querySelectorAll(".role-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".role-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeRole = btn.dataset.role;
        drawCredits();
      });
    });

    renderTopRewatchedGallery("topRewatchedGallery", payload.topRewatched || []);
    renderSeasonHeatmap("seasonHeatmapChart", payload.seasonality?.matrix || []);
    renderRuntimeLine("runtimeLineChart", payload.runtimeByWatchYear || []);
    renderLatencyStrip("latencyStripChart", payload.rewatchLatency || {});

    initInsightButtons(payload.insights || {});

    ["searchMovie", "searchGenre", "searchYear"].forEach((id) => {
      document.getElementById(id).addEventListener("input", () => renderViewingLog(payload.viewings || []));
    });
    renderViewingLog(payload.viewings || []);

    if (payload.meta?.imdbDatasetsIncluded) {
      banner.textContent = payload.meta?.tmdbMediaIncluded
        ? "Synced with IMDb non-commercial datasets and TMDb posters/portraits."
        : "Synced with IMDb non-commercial datasets. Add optional TMDB_API_KEY secret in GitHub to display posters and portraits.";
    } else {
      banner.textContent = "Loaded local starter film log. Run Update MMDb Data in GitHub Actions to sync live IMDb data.";
    }
  } catch (err) {
    banner.textContent = `Unable to load ./data.json: ${err.message}. Serve over HTTP (python -m http.server 8000) or run the GitHub Action first.`;
  }
}

init();
