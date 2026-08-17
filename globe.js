/* ============================================================
   HPAIR Alumni Portal: landing page interactions
   - Two 3D globes of HPAIR Asia Conference host cities: a decorative
     one in the hero and an interactive one in the globe section.
     Each is built when it nears the viewport and paused again when
     it leaves, so only the one you are looking at renders.
   - Clickable chronological timeline (flies the globe to a city)
   - Scroll reveals, count-up stats, sticky nav, mobile drawer
   - Degrades gracefully if globe.gl / WebGL is unavailable
   ============================================================ */

// ─── HPAIR Asia Conference history (year → city) ──────────────────────────────
// Sourced from the public HPAIR / Wikipedia conference record (1992–2026).
const TIMELINE = [
  [1992, "Taipei", "Taiwan"],
  [1993, "Hong Kong", "Hong Kong SAR"],
  [1994, "Manila", "Philippines"],
  [1995, "Jakarta", "Indonesia"],
  [1996, "Seoul", "South Korea"],
  [1997, "Bangkok", "Thailand"],
  [1998, "Kuala Lumpur", "Malaysia"],
  [1999, "Hong Kong", "Hong Kong SAR"],
  [2000, "Beijing", "China"],
  [2001, "Singapore", "Singapore"],
  [2002, "Sydney", "Australia"],
  [2003, "Seoul", "South Korea"],
  [2004, "Shanghai", "China"],
  [2005, "Tokyo", "Japan"],
  [2006, "Mumbai", "India"],
  [2006, "Singapore", "Singapore"],
  [2007, "Hong Kong", "Hong Kong SAR"],
  [2007, "Beijing", "China"],
  [2008, "Kuala Lumpur", "Malaysia"],
  [2009, "Tokyo", "Japan"],
  [2009, "Seoul", "South Korea"],
  [2010, "Singapore", "Singapore"],
  [2011, "Seoul", "South Korea"],
  [2012, "Taipei", "Taiwan"],
  [2013, "Dubai", "United Arab Emirates"],
  [2014, "Tokyo", "Japan"],
  [2015, "Manila", "Philippines"],
  [2016, "Hong Kong", "Hong Kong SAR"],
  [2017, "Sydney", "Australia"],
  [2018, "Kuala Lumpur", "Malaysia"],
  [2019, "Nur-Sultan", "Kazakhstan"],
  [2021, "Taipei", "Taiwan"],
  [2022, "New Delhi", "India"],
  [2023, "Hong Kong", "Hong Kong SAR"],
  [2024, "Bangkok", "Thailand"],
  [2025, "Tokyo", "Japan"],
  [2026, "Hanoi", "Vietnam"],
];

const COORDS = {
  "Taipei": [25.0330, 121.5654],
  "Hong Kong": [22.3193, 114.1694],
  "Manila": [14.5995, 120.9842],
  "Jakarta": [-6.2088, 106.8456],
  "Seoul": [37.5665, 126.9780],
  "Bangkok": [13.7563, 100.5018],
  "Kuala Lumpur": [3.1390, 101.6869],
  "Beijing": [39.9042, 116.4074],
  "Singapore": [1.3521, 103.8198],
  "Sydney": [-33.8688, 151.2093],
  "Shanghai": [31.2304, 121.4737],
  "Tokyo": [35.6762, 139.6503],
  "Mumbai": [19.0760, 72.8777],
  "Dubai": [25.2048, 55.2708],
  "Nur-Sultan": [51.1694, 71.4491],
  "New Delhi": [28.6139, 77.2090],
  "Hanoi": [21.0285, 105.8542],
};

const HARVARD = { city: "Harvard University", country: "Cambridge, USA", lat: 42.3770, lng: -71.1167, home: true };
const UPCOMING_FROM = 2026;

// Build a unique list of host cities, each carrying every year it hosted.
const CITIES = (() => {
  const order = [];
  const map = new Map();
  for (const [yr, city, country] of TIMELINE) {
    if (!COORDS[city]) { console.warn("No coordinates for", city); continue; }
    if (!map.has(city)) {
      const [lat, lng] = COORDS[city];
      const o = { city, country, lat, lng, years: [] };
      map.set(city, o);
      order.push(o);
    }
    map.get(city).years.push(yr);
  }
  return order.map(o => ({ ...o, upcoming: o.years.some(y => y >= UPCOMING_FROM) }));
})();

const CITY_BY_NAME = new Map(CITIES.map(c => [c.city, c]));
const HOST_COUNTRIES = new Set(TIMELINE.map(([, , country]) => country)).size;

const POINTS = [HARVARD, ...CITIES];
// Hub-and-spoke arcs: from Harvard out to every Asia Conference host city.
const ARCS = CITIES.map(c => ({ sLat: HARVARD.lat, sLng: HARVARD.lng, eLat: c.lat, eLng: c.lng, upcoming: c.upcoming }));

// Served from our own origin: the upstream unpkg copies were the single
// slowest thing on the page, and the bump map cost another 370 KB for detail
// that is invisible at this size.
const EARTH = "/img/earth.jpg";

const COLOR = {
  home: "210,61,84",   // crimson
  host: "217,164,65",  // gold
  next: "91,214,192",  // teal
};
function rgbFor(d) { return d.home ? COLOR.home : (d.upcoming ? COLOR.next : COLOR.host); }

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Only Harvard and the upcoming host city pulse. Ringing all seventeen cities
// meant seventeen shaders animating every frame for very little extra meaning.
const RING_POINTS = POINTS.filter(p => p.home || p.upcoming);

// ─── Globe factory ────────────────────────────────────────────────────────────
function makeGlobe(container, { interactive = true } = {}) {
  if (typeof Globe === "undefined" || !container) return null;

  let g;
  try {
    g = Globe({ animateIn: true })(container)
      .backgroundColor("rgba(0,0,0,0)")
      .globeImageUrl(EARTH)
      .showAtmosphere(true)
      .atmosphereColor("#A51C30")
      .atmosphereAltitude(0.17)
      // glowing points
      .pointsData(POINTS)
      .pointLat("lat").pointLng("lng")
      .pointColor(d => `rgb(${rgbFor(d)})`)
      .pointAltitude(0.012)
      .pointRadius(d => (d.home ? 0.55 : 0.34))
      .pointResolution(8)
      .pointLabel(d => !interactive ? "" : (d.home
        ? `<div class="globe-tip"><strong>Harvard University</strong><span>Cambridge, USA</span><em>Where it began · 1991</em></div>`
        : `<div class="globe-tip"><strong>${d.city}</strong><span>${d.country}</span><em>${d.upcoming ? "Upcoming · " : ""}${d.years.join(" · ")}</em></div>`))
      // pulsing rings: the decorative hero copy skips them entirely
      .ringsData(interactive ? RING_POINTS : [])
      .ringLat("lat").ringLng("lng")
      .ringColor(d => { const c = rgbFor(d); return t => `rgba(${c},${1 - t})`; })
      .ringMaxRadius(d => (d.home ? 4.2 : 2.6))
      .ringPropagationSpeed(1.6)
      .ringRepeatPeriod(d => (d.home ? 900 : 1500))
      // hub-and-spoke arcs
      .arcsData(ARCS)
      .arcStartLat("sLat").arcStartLng("sLng").arcEndLat("eLat").arcEndLng("eLng")
      .arcColor(d => d.upcoming
        ? ["rgba(91,214,192,.85)", "rgba(217,164,65,.4)"]
        : ["rgba(217,164,65,.8)", "rgba(210,61,84,.5)"])
      .arcStroke(0.45)
      .arcDashLength(0.45)
      .arcDashGap(0.22)
      .arcDashInitialGap(() => Math.random())
      .arcDashAnimateTime(() => 3200 + Math.random() * 2200)
      .arcAltitudeAutoScale(0.5);
  } catch (e) {
    console.warn("Globe init failed:", e);
    return null;
  }

  // Retina panels render four times the pixels for a globe nobody inspects at
  // 1:1, so cap the ratio rather than let the renderer follow the display.
  try { g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); } catch {}

  // controls
  const c = g.controls();
  c.autoRotate = !REDUCED;
  c.autoRotateSpeed = interactive ? 0.6 : 0.95;
  c.enableZoom = false;
  c.enablePan = false;
  c.enableRotate = interactive;

  g.pointOfView({ lat: 20, lng: 108, altitude: interactive ? 2.05 : 2.45 }, 0);

  // Size to the *parent* box, not to `container`. globe.gl sets inline
  // width/height on `container` itself (defaulting to the window), so measuring
  // `container` just reads back its own last value and the CSS-driven size
  // (.hero-orb / .globe-stage) never wins. Both slots are laid out by their
  // parent and are out of flow or fixed-height, so the parent can't inflate.
  const box = container.parentElement || container;
  const fit = () => {
    const r = box.getBoundingClientRect();
    if (r.width && r.height) g.width(r.width).height(r.height);
  };
  fit();
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(box);
  else window.addEventListener("resize", fit);

  return g;
}

// ─── Loading globe.gl ─────────────────────────────────────────────────────────
// The library is fetched by this module rather than by a <script> tag in the
// page. A tag would have to win a race it cannot: the bundler hoists this
// module into <head>, so a deferred tag at the end of <body> executes *after*
// it and `Globe` is still undefined by the time we look. Fetching it here also
// keeps it off the parser's critical path, and both globes share the one
// download.
const GLOBE_LIB = "/vendor/globe.gl.min.js";
let libPromise = null;

function loadGlobeLib() {
  if (typeof Globe !== "undefined") return Promise.resolve(true);
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = GLOBE_LIB;
    s.onload = () => resolve(typeof Globe !== "undefined");
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return libPromise;
}

// ─── Timeline list ────────────────────────────────────────────────────────────
let mainGlobe = null;

function renderTimeline() {
  const el = document.getElementById("conf-timeline");
  if (!el) return;

  const sub = document.getElementById("timeline-sub");
  if (sub) sub.textContent = `${TIMELINE.length} Asia Conferences across ${HOST_COUNTRIES} countries and regions since 1992.`;

  el.innerHTML = TIMELINE.map(([yr, city, country]) => {
    const upcoming = yr >= UPCOMING_FROM;
    return `<div class="tl-row${upcoming ? " upcoming" : ""}" data-city="${city}" role="button" tabindex="0"
                 title="Show ${city} on the globe">
      <span class="yr">${yr}</span>
      <span class="ct">${city}${upcoming ? `<span class="tag">Upcoming</span>` : ""}</span>
      <span class="cn">${country}</span>
    </div>`;
  }).reverse().join("");

  const focusCity = (name) => {
    const city = CITY_BY_NAME.get(name);
    if (!city) return;
    // Scroll first, and unconditionally: on a browser where the globe never
    // came up, bringing the stage into view is still the useful half.
    document.getElementById("globe-viz")?.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "center" });
    if (!mainGlobe) return;
    mainGlobe.controls().autoRotate = false;
    mainGlobe.pointOfView({ lat: city.lat, lng: city.lng, altitude: 1.7 }, 900);
    clearTimeout(focusCity._t);
    focusCity._t = setTimeout(() => {
      if (mainGlobe && !REDUCED) mainGlobe.controls().autoRotate = true;
    }, 5000);
  };

  el.addEventListener("click", (e) => {
    const row = e.target.closest(".tl-row");
    if (row) focusCity(row.dataset.city);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest(".tl-row");
    if (row) { e.preventDefault(); focusCity(row.dataset.city); }
  });
}

// ─── Count-up numbers ─────────────────────────────────────────────────────────
function animateCount(node) {
  const target = Number(node.dataset.count || "0");
  const suffix = node.dataset.suffix || "";
  if (REDUCED) { node.textContent = target.toLocaleString("en-US") + suffix; return; }
  const dur = 1500;
  const start = performance.now();
  const fmt = n => n.toLocaleString("en-US");
  function tick(now) {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = fmt(Math.round(target * eased)) + (p === 1 ? suffix : "");
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ─── Scroll reveals, counters, sticky nav, progress ───────────────────────────
function initScrollFx() {
  // reveals
  const reveals = document.querySelectorAll(".reveal");
  if (REDUCED || !("IntersectionObserver" in window)) {
    reveals.forEach(r => r.classList.add("in"));
  } else {
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("in"); obs.unobserve(en.target); } });
    }, { threshold: 0.15 });
    reveals.forEach(r => io.observe(r));
  }

  // counters
  const counters = document.querySelectorAll("[data-count]");
  if (!("IntersectionObserver" in window)) {
    counters.forEach(animateCount);
  } else {
    const cio = new IntersectionObserver((entries, obs) => {
      entries.forEach(en => { if (en.isIntersecting) { animateCount(en.target); obs.unobserve(en.target); } });
    }, { threshold: 0.6 });
    counters.forEach(c => cio.observe(c));
  }

  // sticky nav shell + scroll progress + back-to-top
  const shell = document.getElementById("nav-shell");
  const bar = document.getElementById("progress");
  const top = document.getElementById("totop");
  const onScroll = () => {
    const y = window.scrollY;
    if (shell) shell.classList.toggle("scrolled", y > 24);
    if (top) top.classList.toggle("show", y > 700);
    if (bar) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = `${max > 0 ? Math.min((y / max) * 100, 100) : 0}%`;
    }
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  top?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" }));

  // smooth anchor scrolling
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener("click", e => {
      const id = a.getAttribute("href").slice(1);
      const t = id && document.getElementById(id);
      if (t) { e.preventDefault(); closeDrawer(); t.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" }); }
    });
  });
}

// ─── Mobile navigation drawer ─────────────────────────────────────────────────
function closeDrawer() {
  const drawer = document.getElementById("drawer");
  const burger = document.getElementById("burger");
  if (!drawer || !burger) return;
  drawer.classList.remove("open");
  burger.setAttribute("aria-expanded", "false");
  burger.setAttribute("aria-label", "Open menu");
  document.body.classList.remove("nav-open");
}

function initNav() {
  const drawer = document.getElementById("drawer");
  const burger = document.getElementById("burger");
  if (!drawer || !burger) return;

  burger.addEventListener("click", () => {
    const open = drawer.classList.toggle("open");
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    document.body.classList.toggle("nav-open", open);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });
  window.addEventListener("resize", () => { if (window.innerWidth > 860) closeDrawer(); });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
function boot() {
  const yr = document.getElementById("year");
  if (yr) yr.textContent = String(new Date().getFullYear());

  initNav();
  renderTimeline();
  initScrollFx();

  const fallback = document.getElementById("globe-fallback");
  const failed = () => {
    const p = fallback?.querySelector("p");
    if (p) p.textContent =
      "The interactive globe couldn't load. Every host city is listed beside it.";
  };

  /**
   * Build a globe in `slot` the first time it nears the viewport, then start
   * and stop its render loop as it enters and leaves. The two globes are a
   * full viewport apart, so in practice only one is ever animating.
   */
  function mountGlobe(slot, { interactive, onReady, onFail }) {
    if (!slot) return;
    let g = null, starting = false, onScreen = true;

    const start = async () => {
      if (g || starting) return;
      starting = true;
      const ready = await loadGlobeLib();
      g = ready ? makeGlobe(slot, { interactive }) : null;
      starting = false;
      if (!g) return onFail?.();
      onReady?.(g);
      // It may have scrolled back off screen while the library downloaded.
      if (!onScreen) g.pauseAnimation();
    };

    if (!("IntersectionObserver" in window)) { start(); return; }
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some(en => en.isIntersecting);
      if (onScreen) start();
      if (!g) return;
      if (onScreen) g.resumeAnimation();
      else g.pauseAnimation();
    }, { rootMargin: "200px" });
    onScreen = false;
    io.observe(slot);
  }

  // Decorative: no tooltips, no rings, no dragging.
  mountGlobe(document.getElementById("hero-globe"), { interactive: false });

  mountGlobe(document.getElementById("globe-viz"), {
    interactive: true,
    onReady: (g) => { mainGlobe = g; if (fallback) fallback.style.display = "none"; },
    onFail: failed,
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
