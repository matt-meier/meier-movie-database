const DATA_TIMEOUT_MS = 20000;
const CACHE_KEY = "mmdb_payload_v2";

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

function formatNumber(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "--";
  return Number(n).toLocaleString("en-US");
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

function showEmptyNote(box, message) {
  box.innerHTML = "";
  const div = document.createElement("div");
  div.className = "empty-note";
  div.textContent = message;
  box.appendChild(div);
}

async function loadPayload() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DATA_TIMEOUT_MS);
  try {
    const res = await fetch("./data.json", { signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} loading ./data.json`);
    }
    const payload = await res.json();
    if (!payload || !payload.kpis || !Array.isArray(payload.viewings)) {
      throw new Error("Invalid data.json payload structure");
    }
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (_) {
      // Ignore storage quota errors
    }
    return payload;
  } catch (err) {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.kpis && Array.isArray(parsed.viewings)) {
          return parsed;
        }
      } catch (_) {
        sessionStorage.removeItem(CACHE_KEY);
      }
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function renderHorizontalBars(containerId, items, labelKey, valueKey, titleText, maxBars = 10, emptyMsg = "No data available yet.", compact = false) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  const slice = (items || []).slice(0, maxBars);
  if (!slice.length) {
    showEmptyNote(box, emptyMsg);
    return;
  }

  const maxVal = Math.max(...slice.map((d) => Number(d[valueKey]) || 0), 1);
  const rowH = 26;
  const width = compact ? 420 : 760;
  const height = slice.length * rowH + 34;
  const labelW = compact ? 135 : 180;
  const barAreaW = Math.max(80, width - labelW - 68);

  const svg = createSvgEl(
    "svg",
    {
      viewBox: `0 0 ${width} ${height}`,
      style: "width: 100%; height: auto; display: block; font-family: Lato, sans-serif;",
    },
    box
  );

  createSvgEl("text", { x: 0, y: 15, fill: "#6E7781", "font-size": 12, "font-weight": 700 }, svg).textContent = titleText;

  slice.forEach((d, i) => {
    const y = 28 + i * rowH;
    const val = Number(d[valueKey]) || 0;
    const barW = Math.max(2, (val / maxVal) * barAreaW);
    const fill = i === 0 ? "#F5C518" : "#6E7781";
    const labelStr = String(d[labelKey] ?? "");
    const displayLabel = compact && labelStr.length > 18 ? `${labelStr.slice(0, 17)}...` : labelStr;

    const g = createSvgEl("g", {}, svg);
    const titleEl = createSvgEl("title", {}, g);
    titleEl.textContent = `${labelStr}: ${formatNumber(val)}`;

    createSvgEl("text", { x: labelW - 10, y: y + 14, "text-anchor": "end", fill: "#1F2328", "font-size": 12 }, g).textContent = displayLabel;
    createSvgEl("rect", { x: labelW, y: y + 2, width: barW, height: 16, rx: 4, fill }, g);
    createSvgEl("text", { x: labelW + barW + 8, y: y + 14, fill: "#1F2328", "font-size": 12, "font-weight": 700 }, g).textContent =
      formatNumber(val);
  });
}

function renderGenreMatrix(containerId, genreData) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  const topGenres = (genreData?.counts || []).slice(0, 8).map((d) => d.genre);
  const pairs = genreData?.coOccurrence || [];
  if (topGenres.length < 2 || !pairs.length) {
    showEmptyNote(box, "Genre overlap matrix will populate once IMDb title.basics.tsv.gz is synced via GitHub Actions.");
    return;
  }

  const pairMap = new Map();
  let maxPair = 1;
  pairs.forEach((p) => {
    pairMap.set(`${p.genreA}|${p.genreB}`, p.viewings);
    pairMap.set(`${p.genreB}|${p.genreA}`, p.viewings);
    if (p.viewings > maxPair) maxPair = p.viewings;
  });

  const cell = 44;
  const padLeft = 104;
  const padTop = 84;
  const width = padLeft + topGenres.length * cell + 20;
  const height = padTop + topGenres.length * cell + 16;

  const svg = createSvgEl(
    "svg",
    {
      viewBox: `0 0 ${width} ${height}`,
      style: "width: 100%; max-width: 520px; height: auto; display: block; font-family: Lato, sans-serif;",
    },
    box
  );

  createSvgEl("text", { x: 0, y: 15, fill: "#6E7781", "font-size": 12, "font-weight": 700 }, svg).textContent =
    "Genre Co-Occurrence Matrix (Top 8 Genres)";

  topGenres.forEach((g, idx) => {
    const cx = padLeft + idx * cell + cell / 2;
    const cy = padTop + idx * cell + cell / 2 + 4;
    createSvgEl("text", {
      x: cx,
      y: padTop - 8,
      fill: "#1F2328",
      "font-size": 11,
      "text-anchor": "start",
      transform: `rotate(-35 ${cx} ${padTop - 8})`,
    }, svg).textContent = g;

    createSvgEl("text", {
      x: padLeft - 8,
      y: cy,
      fill: "#1F2328",
      "font-size": 11,
      "text-anchor": "end",
    }, svg).textContent = g;
  });

  topGenres.forEach((rowG, r) => {
    topGenres.forEach((colG, c) => {
      const x = padLeft + c * cell;
      const y = padTop + r * cell;
      if (r === c) {
        createSvgEl("rect", { x: x + 2, y: y + 2, width: cell - 4, height: cell - 4, rx: 4, fill: "#ECEFF2" }, svg);
        return;
      }
      const val = pairMap.get(`${rowG}|${colG}`) || 0;
      const alpha = val > 0 ? 0.18 + 0.82 * (val / maxPair) : 0.05;
      const cellGroup = createSvgEl("g", {}, svg);
      createSvgEl("title", {}, cellGroup).textContent = `${rowG} + ${colG}: ${formatNumber(val)} viewings`;
      createSvgEl("rect", {
        x: x + 2,
        y: y + 2,
        width: cell - 4,
        height: cell - 4,
        rx: 4,
        fill: val > 0 ? "#F5C518" : "#6E7781",
        opacity: Number(alpha.toFixed(2)),
      }, cellGroup);
      if (val > 0) {
        createSvgEl("text", {
          x: x + cell / 2,
          y: y + cell / 2 + 4,
          fill: "#111111",
          "font-size": 11,
          "font-weight": 700,
          "text-anchor": "middle",
        }, cellGroup).textContent = String(val);
      }
    });
  });
}

function renderRecencyScatter(containerId, viewings) {
  const box = document.getElementById(containerId);
  box.innerHTML = "";
  const pts = (viewings || []).filter(
    (v) => Number.isFinite(Number(v.releaseYear)) && Number.isFinite(Number(v.watchYear))
  );
  if (!pts.length) {
    showEmptyNote(box, "Release year vs. watch year recency scatter will populate once IMDb title.basics.tsv.gz is synced.");
    return;
  }

  const width = 760;
  const height = 240;
  const pad = { top: 28, right: 24, bottom: 36, left: 50 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const minRel = Math.min(...pts.map((p) => Number(p.releaseYear)));
  const maxRel = Math.max(...pts.map((p) => Number(p.releaseYear)));
  const minWat = Math.min(...pts.map((p) => Number(p.watchYear)));
  const maxWat = Math.max(...pts.map((p) => Number(p.watchYear)));

  const xScale = (yr) => pad.left + ((yr - minRel) / Math.max(maxRel - minRel, 1)) * plotW;
  const yScale = (yr) => pad.top + plotH - ((yr - minWat) / Math.max(maxWat - minWat, 1)) * plotH;

  const svg = createSvgEl(
    "svg",
    {
      viewBox: `0 0 ${width} ${height}`,
      style: "width: 100%; height: auto; display: block; font-family: Lato, sans-serif;",
    },
    box
  );

  createSvgEl("text", { x: 0, y: 15, fill: "#6E7781", "font-size": 12, "font-weight": 700 }, svg).textContent =
    "Release Year (X) vs. Watch Year (Y): Gold = Watched Within 2 Years of Release";

  createSvgEl("line", { x1: pad.left, y1: pad.top + plotH, x2: pad.left + plotW, y2: pad.top + plotH, stroke: "#CBD2D9" }, svg);
  createSvgEl("line", { x1: pad.left, y1: pad.top, x2: pad.left, y2: pad.top + plotH, stroke: "#CBD2D9" }, svg);

  createSvgEl("text", { x: pad.left, y: height - 10, fill: "#6E7781", "font-size": 11 }, svg).textContent = String(minRel);
  createSvgEl("text", { x: pad.left + plotW / 2, y: height - 10, "text-anchor": "middle", fill: "#6E7781", "font-size": 11 }, svg).textContent =
    "Release Year";
  createSvgEl("text", { x: pad.left + plotW, y: height - 10, "text-anchor": "end", fill: "#6E7781", "font-size": 11 }, svg).textContent =
    String(maxRel);
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
        r: isRecent ? 3.5 : 2.8,
        fill: isRecent ? "#F5C518" : "#6E7781",
        opacity: isRecent ? 0.85 : 0.45,
      },
      svg
    );
    createSvgEl("title", {}, dot).textContent = `${p.title} (${p.releaseYear}) watched ${p.watchDate}`;
  });
}

function renderRecentWatch(recent) {
  document.getElementById("recentTitle").textContent = recent.title || "--";
  const parts = [`Watched ${recent.watchDate || "--"}`];
  if (recent.releaseYear) parts.push(`Released ${recent.releaseYear}`);
  if (recent.imdbRating !== null && recent.imdbRating !== undefined) {
    parts.push(`IMDb ${recent.imdbRating}/10`);
  }
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

  if (recent.daysSincePrevWatch !== null && recent.daysSincePrevWatch !== undefined) {
    const p2 = document.createElement("span");
    p2.className = "pill pill-muted";
    p2.textContent = `${formatNumber(recent.daysSincePrevWatch)} days since prior watch (${recent.prevWatchDate})`;
    pills.appendChild(p2);
  }
}

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

  document.getElementById("logCountLabel").textContent =
    `Showing ${formatNumber(filtered.length)} of ${formatNumber((viewings || []).length)} logged viewings, newest first.`;

  const tbody = document.getElementById("viewingLogBody");
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();

  filtered.forEach((v) => {
    const tr = document.createElement("tr");
    const cells = [
      v.watchDate,
      v.title,
      v.releaseYear ?? "--",
      (v.genres || []).join(", ") || "--",
      v.imdbRating !== null && v.imdbRating !== undefined ? String(v.imdbRating) : "--",
      v.runtimeMinutes !== null && v.runtimeMinutes !== undefined ? `${Math.round(v.runtimeMinutes)}m` : "--",
      `#${v.viewingNumber}`,
    ];
    cells.forEach((val, idx) => {
      const td = document.createElement("td");
      if (idx === 2 || idx === 4 || idx === 5 || idx === 6) {
        td.className = "num-col";
      }
      td.textContent = String(val);
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

function populateInsights(payload) {
  const topGenre = payload.genres?.counts?.[0];
  const topPair = payload.genres?.coOccurrence?.[0];
  if (topGenre) {
    const pairText = topPair ? ` Top pairing is ${topPair.genreA} + ${topPair.genreB} (${formatNumber(topPair.viewings)} viewings).` : "";
    document.getElementById("insightGenres").textContent =
      `${topGenre.genre} leads your log with ${formatNumber(topGenre.viewings)} viewings.${pairText}`;
  }

  const withLag = (payload.viewings || []).filter((v) => Number.isFinite(Number(v.recencyLagYears)));
  if (withLag.length) {
    const recentCount = withLag.filter((v) => Number(v.recencyLagYears) <= 2).length;
    const recentPct = ((recentCount / withLag.length) * 100).toFixed(1);
    const sortedLags = withLag.map((v) => Number(v.recencyLagYears)).sort((a, b) => a - b);
    const medianLag = sortedLags[Math.floor(sortedLags.length / 2)];
    const topEra = [...(payload.releaseEras || [])].sort((a, b) => b.uniqueFilms - a.uniqueFilms)[0];
    const eraText = topEra ? ` The ${topEra.era} contribute the most unique films (${formatNumber(topEra.uniqueFilms)}).` : "";
    document.getElementById("insightRecency").textContent =
      `${recentPct}% of your viewings happen within 2 years of release, with a median film age of ${medianLag} years at watch time.${eraText}`;
  }

  const rated = (payload.viewings || []).filter((v) => Number.isFinite(Number(v.imdbRating)));
  if (rated.length) {
    const avgRating = (rated.reduce((sum, v) => sum + Number(v.imdbRating), 0) / rated.length).toFixed(2);
    const peakBin = [...(payload.ratingDistribution || [])].sort((a, b) => b.viewings - a.viewings)[0];
    const peakText = peakBin ? ` Viewings cluster most heavily around IMDb ${peakBin.rating} (${formatNumber(peakBin.viewings)} viewings).` : "";
    document.getElementById("insightRatings").textContent =
      `Your logged viewings average an IMDb score of ${avgRating}/10.${peakText}`;
  }

  const peakMonth = [...(payload.seasonality?.monthly || [])].sort((a, b) => b.viewings - a.viewings)[0];
  const peakDow = [...(payload.seasonality?.dayOfWeek || [])].sort((a, b) => b.viewings - a.viewings)[0];
  if (peakMonth && peakDow) {
    document.getElementById("insightBehavior").textContent =
      `Viewing peaks in ${peakMonth.label} (${formatNumber(peakMonth.viewings)} viewings) and on ${peakDow.day}s (${formatNumber(peakDow.viewings)} viewings), with an average rewatch gap of ${payload.rewatchLatency?.avgDays ?? "--"} days.`;
  }

  const topRewatch = payload.topRewatched?.[0];
  const topActor = payload.credits?.actors?.[0];
  if (topRewatch) {
    const actorText = topActor ? ` ${topActor.name} is your most watched actor (${formatNumber(topActor.viewings)} viewings).` : "";
    document.getElementById("insightCredits").textContent =
      `${topRewatch.title} leads repeat viewings at ${topRewatch.views} total watches.${actorText}`;
  }
}

async function init() {
  const banner = document.getElementById("statusBanner");
  try {
    const payload = await loadPayload();
    const k = payload.kpis;

    document.getElementById("dateRangeLabel").textContent =
      `${payload.meta?.dateRange?.start || "--"} to ${payload.meta?.dateRange?.end || "--"}`;
    document.getElementById("kpiUnique").textContent = formatNumber(k.uniqueFilms);
    document.getElementById("kpiViewings").textContent = formatNumber(k.totalViewings);
    document.getElementById("kpiRewatch").textContent = `${k.rewatchPct}%`;

    if (k.totalMinutes > 0) {
      document.getElementById("kpiRuntime").textContent = `${formatNumber(k.totalHours)} hrs`;
      document.getElementById("kpiRuntimeSub").textContent = `${formatNumber(k.totalDays)} days (${formatNumber(k.totalMinutes)} mins)`;
    } else {
      document.getElementById("kpiRuntime").textContent = "Pending IMDb Sync";
      document.getElementById("kpiRuntimeSub").textContent = "Run GitHub Action to join runtimes";
    }

    renderRecentWatch(payload.mostRecentWatch || {});
    renderHorizontalBars(
      "genreBarsChart",
      payload.genres?.counts || [],
      "genre",
      "viewings",
      "Viewings by Genre",
      10,
      "Genre breakdown will populate once IMDb title.basics.tsv.gz is synced via GitHub Actions."
    );
    renderGenreMatrix("genreMatrixChart", payload.genres || {});
    renderRecencyScatter("recencyScatterChart", payload.viewings || []);

    let activeEraMetric = "uniqueFilms";
    const drawEras = () => {
      const label = activeEraMetric === "uniqueFilms" ? "Unique Films by Release Decade" : "Cumulative Watch Hours by Release Decade";
      renderHorizontalBars(
        "eraDistributionChart",
        payload.releaseEras || [],
        "era",
        activeEraMetric,
        label,
        12,
        "Release decade distribution will populate once IMDb title.basics.tsv.gz is synced."
      );
    };
    drawEras();
    document.querySelectorAll(".era-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".era-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeEraMetric = btn.dataset.metric;
        drawEras();
      });
    });

    renderHorizontalBars(
      "ratingDistChart",
      payload.ratingDistribution || [],
      "rating",
      "viewings",
      "Viewings by IMDb Rating Tier",
      20,
      "IMDb rating distribution will populate once IMDb title.ratings.tsv.gz is synced."
    );

    let activeRole = "actors";
    const drawCredits = () => {
      renderHorizontalBars(
        "creditsChart",
        payload.credits?.[activeRole] || [],
        "name",
        "viewings",
        `Top ${activeRole.charAt(0).toUpperCase() + activeRole.slice(1)} by Logged Viewings`,
        10,
        "Cast and crew rankings will populate once IMDb title.principals.tsv.gz and name.basics.tsv.gz are synced."
      );
    };
    drawCredits();
    document.querySelectorAll(".role-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".role-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeRole = btn.dataset.role;
        drawCredits();
      });
    });

    const rewatchBox = document.getElementById("topRewatchedList");
    rewatchBox.innerHTML = "";
    (payload.topRewatched || []).slice(0, 10).forEach((item, idx) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `#${idx + 1} ${item.title} (${item.views} views)`;
      rewatchBox.appendChild(chip);
    });

    renderHorizontalBars("latencyChart", payload.rewatchLatency?.buckets || [], "bucket", "count", "Rewatch Gap Buckets", 6, "No rewatch gaps found.", true);

    let activeSeason = "monthly";
    const drawSeasonality = () => {
      if (activeSeason === "monthly") {
        renderHorizontalBars("seasonalityChart", payload.seasonality?.monthly || [], "label", "viewings", "Viewings by Calendar Month", 12, "No monthly data.", true);
      } else {
        renderHorizontalBars("seasonalityChart", payload.seasonality?.dayOfWeek || [], "day", "viewings", "Viewings by Day of Week", 7, "No weekday data.", true);
      }
    };
    drawSeasonality();
    document.querySelectorAll(".season-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".season-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeSeason = btn.dataset.season;
        drawSeasonality();
      });
    });

    renderHorizontalBars(
      "runtimeTrendChart",
      payload.runtimeByWatchYear || [],
      "watchYear",
      "avgRuntimeMinutes",
      "Average Runtime (Minutes) by Watch Year",
      20,
      "Runtime trend by watch year will populate once IMDb title.basics.tsv.gz is synced.",
      true
    );
    renderHorizontalBars("voteDepthChart", payload.voteDepth || [], "tier", "viewings", "Viewings by IMDb Vote Depth", 6, "No vote depth data.", true);

    populateInsights(payload);

    ["searchMovie", "searchGenre", "searchYear"].forEach((id) => {
      document.getElementById(id).addEventListener("input", () => renderViewingLog(payload.viewings || []));
    });
    renderViewingLog(payload.viewings || []);

    banner.textContent = payload.meta?.imdbDatasetsIncluded
      ? "Synced with IMDb non-commercial datasets."
      : "Loaded starter film log data. Run scripts/build_data.py or the GitHub Action to join live IMDb metadata.";
  } catch (err) {
    banner.textContent = `Unable to load ./data.json: ${err.message}. Serve over HTTP (python -m http.server 8000) or run the GitHub Action first.`;
  }
}

init();
