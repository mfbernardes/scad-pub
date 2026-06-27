// Round 2 mockups: dock-side config, big-preset handling, advisories/badges,
// OpenSCAD output console, file import + list, and a configurable light revamp.
// Pure presentation — no app code.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, "mockups");
mkdirSync(OUT, { recursive: true });

/* ---- themes (configurable token sets) ---- */
const DARK = {
  bg: "#15171c", panel: "#1f2229", panel2: "#262a32", line: "#333843",
  text: "#e6e8ec", muted: "#aeb6c2", accent: "#86a9ff", accentSolid: "#2f55ff",
  onAccent: "#ffffff", warn: "#e0a458", onWarn: "#1c1f24", ok: "#5fd08a",
  glassBg: "rgba(31,34,41,.82)", glassBorder: "rgba(255,255,255,.07)",
  vbgA: "#1a1f27", vbgB: "#12151b", vbgC: "#0d1014", grid2: "#20252e",
  model1: "#8aa6ff", model2: "#5b79e6", model3: "#4a64cf", radius: "16px",
};
// "Revamped" light: softer surfaces, a touch more elevation/rounding, same brand hue.
const LIGHT = {
  bg: "#eef1f6", panel: "#ffffff", panel2: "#f1f4f9", line: "#dde2ea",
  text: "#1b1f27", muted: "#586173", accent: "#1d4ed8", accentSolid: "#2348f0",
  onAccent: "#ffffff", warn: "#b4690e", onWarn: "#ffffff", ok: "#1f9d57",
  glassBg: "rgba(255,255,255,.78)", glassBorder: "rgba(20,28,50,.08)",
  vbgA: "#e9edf4", vbgB: "#dee4ee", vbgC: "#d2d9e6", grid2: "#cdd4df",
  model1: "#6f93ff", model2: "#3a5fd0", model3: "#2b4cb8", radius: "18px",
};

const ICON = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  expand: '<path d="M4 14v6h6M20 10V4h-6M14 20l6-6M10 4 4 10"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
  play: '<path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
  install: '<path d="M12 3v10M8 9l4 4 4-4"/><rect x="4" y="15" width="16" height="5" rx="1.5"/>',
  chevL: '<path d="M14 6l-6 6 6 6"/>', chevR: '<path d="M10 6l6 6-6 6"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>', chevU: '<path d="M18 15l-6-6-6 6"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  star: '<path d="m12 3 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9 6.8 19l1-5.8L3.6 9.1l5.8-.8z"/>',
  warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  x: '<path d="M5 5l14 14M19 5 5 19"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
};
const svg = (n, s = 18, sw = 1.7) =>
  `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
const cue = (n, style) => `<span class="cue" style="${style}">${n}</span>`;

const model = (scale = 1) => `
  <div class="stage" style="--s:${scale}">
    <div class="ground-shadow"></div>
    <div class="tag"><span class="tag-text">ScadPub</span></div>
  </div>`;

const slider = (desc, v, val, pct) => `
  <div class="param">
    <div class="p-label"><span class="p-desc">${desc}</span><span class="p-var">${v}</span></div>
    <div class="p-ctl"><div class="track"><div class="fill" style="width:${pct}%"></div><div class="thumb" style="left:${pct}%"></div></div><div class="num">${val}</div></div>
  </div>`;
const textField = (desc, v, val) => `
  <div class="param"><div class="p-label"><span class="p-desc">${desc}</span><span class="p-var">${v}</span></div><div class="field">${val}</div></div>`;
const chip = (l, on = false) => `<button class="chip ${on ? "on" : ""}">${l}</button>`;
const section = (t, open, body, adv = false, cueNode = "") => `
  <div class="group ${open ? "open" : ""}">${cueNode}
    <div class="g-head"><span class="caret">${svg("chevD", 14, 2)}</span><span>${t}</span>${adv ? '<span class="g-tag">advanced</span>' : ""}</div>
    ${open ? `<div class="g-body">${body}</div>` : ""}
  </div>`;
const hud = (bottom, extra = "") => `
  <div class="hud" style="bottom:${bottom}">
    <button class="hbtn">${svg("plus", 18)}</button><button class="hbtn">${svg("minus", 18)}</button>
    <button class="hbtn">${svg("fit", 17)}</button><button class="hbtn">${svg("reset", 17)}</button>${extra}
  </div>`;

// Big-preset handling: searchable picker with Recent / Bundled / Yours.
const presetPicker = (style) => `
  <div class="picker glass" style="${style}">
    <div class="pick-search">${svg("search", 15)}<span>Search 40+ presets…</span></div>
    <div class="pick-sec">Recent</div>
    <div class="pick-row on">${svg("star", 14)}<span>Keychain — small</span><span class="pick-meta">★</span></div>
    <div class="pick-row">${svg("star", 14)}<span>Luggage tag</span><span class="pick-meta">★</span></div>
    <div class="pick-sec">Bundled (12)</div>
    <div class="pick-row"><span class="pick-dot"></span><span>Default</span></div>
    <div class="pick-row"><span class="pick-dot"></span><span>Big &amp; bold</span></div>
    <div class="pick-row"><span class="pick-dot"></span><span>Thin &amp; light</span></div>
    <div class="pick-row"><span class="pick-dot"></span><span>Rounded corners</span></div>
    <div class="pick-sec">Yours (28)</div>
    <div class="pick-row"><span class="pick-dot user"></span><span>Office door v3</span><button class="pick-x">${svg("x", 12)}</button></div>
    <div class="pick-row"><span class="pick-dot user"></span><span>Cat collar</span><button class="pick-x">${svg("x", 12)}</button></div>
    <div class="pick-row"><span class="pick-dot user"></span><span>Toolbox label — 60mm</span><button class="pick-x">${svg("x", 12)}</button></div>
  </div>`;

const filesSection = (cueNode = "") => section("Files", true, `
  <div class="filehint">Fonts, SVGs &amp; data files referenced by this design.</div>
  <div class="filerow">${svg("file", 15)}<span class="fname">emblem.svg</span><span class="fsize">2.1 KB</span><button class="pick-x">${svg("x", 12)}</button></div>
  <div class="filerow">${svg("file", 15)}<span class="fname">Roboto-Bold.ttf</span><span class="fsize">168 KB</span><button class="pick-x">${svg("x", 12)}</button></div>
  <button class="btn ghost" style="width:100%;justify-content:center;margin-top:.5rem">${svg("folder", 15)}Import file…</button>
`, false, cueNode);

// OpenSCAD output console: parsed advisories (badged) + raw log. Reachable, not prominent.
const outputConsole = (style) => `
  <div class="console glass" style="${style}">
    <div class="con-head">
      <span class="con-seg on">Advisories <span class="cbadge warn">2</span></span>
      <span class="con-seg">Log</span>
      <span style="flex:1"></span>
      <button class="ib">${svg("chevD", 16)}</button>
    </div>
    <div class="con-body">
      <div class="adv warn">${svg("warn", 15)}<span>Object may not be a valid 2-manifold at facet 41.</span></div>
      <div class="adv warn">${svg("warn", 15)}<span>Text height 1mm is below recommended 1.5mm for this font.</span></div>
      <div class="adv note">${svg("info", 15)}<span>ECHO: "bounding box = [90, 45, 4]"</span></div>
      <div class="con-log">Compiling design (CSG Tree generation)...
Geometries in cache: 24 / 100MiB
Total rendering time: 0h 0m 0s 412ms
   Top level object is a 3D object: ...</div>
    </div>
  </div>`;

const cssFor = (t) => `
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:${t.bg};--panel:${t.panel};--panel2:${t.panel2};--line:${t.line};--text:${t.text};
--muted:${t.muted};--accent:${t.accent};--accentSolid:${t.accentSolid};--onAccent:${t.onAccent};
--warn:${t.warn};--onWarn:${t.onWarn};--ok:${t.ok};--glassBg:${t.glassBg};--glassBorder:${t.glassBorder};
--grid2:${t.grid2};--radius:${t.radius}}
html,body{height:100%}
body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--text);background:${t.vbgC};overflow:hidden;-webkit-font-smoothing:antialiased}
button{font:inherit;color:var(--text);cursor:pointer;border:none;background:none}
svg{display:block}
.viewer{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 38%,${t.vbgA} 0%,${t.vbgB} 45%,${t.vbgC} 100%);overflow:hidden}
.viewer::before{content:"";position:absolute;inset:0;background-image:linear-gradient(var(--grid2) 1px,transparent 1px),linear-gradient(90deg,var(--grid2) 1px,transparent 1px);background-size:46px 46px;mask-image:radial-gradient(circle at 50% 45%,#000 30%,transparent 78%);opacity:.6}
.stage{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%) scale(var(--s,1));transform-style:preserve-3d}
.ground-shadow{position:absolute;left:50%;top:118px;width:300px;height:90px;transform:translate(-50%,-50%) rotateX(62deg);background:radial-gradient(ellipse,rgba(0,0,0,.5),transparent 68%);filter:blur(6px)}
.tag{position:relative;width:280px;height:150px;border-radius:20px;transform:rotateX(57deg) rotateZ(-30deg);transform-style:preserve-3d;background:linear-gradient(150deg,${t.model1},${t.model2} 60%,${t.model3});
box-shadow:0 1px 0 ${t.model3},0 3px 0 ${t.model3},0 5px 0 ${t.model3},0 7px 0 ${t.model3},0 9px 0 ${t.model3},0 11px 0 ${t.model3},0 13px 0 ${t.model3},0 14px 0 ${t.model3},0 30px 40px rgba(0,0,0,.45)}
.tag-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:38px;letter-spacing:.5px;color:#eef2ff;transform:translateZ(9px);text-shadow:0 1px 0 rgba(255,255,255,.4),0 -1px 0 rgba(20,30,70,.45)}
.glass{background:var(--glassBg);backdrop-filter:blur(14px) saturate(1.2);border:1px solid var(--glassBorder);box-shadow:0 8px 30px rgba(0,0,0,.28)}
.hud{position:absolute;right:14px;display:flex;flex-direction:column;gap:6px;z-index:6}
.hud .hbtn{width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;color:var(--text);background:var(--glassBg);backdrop-filter:blur(12px);border:1px solid var(--glassBorder);box-shadow:0 4px 14px rgba(0,0,0,.25)}
.hud .hbtn:hover{border-color:var(--accent);color:var(--accent)}
.ib{width:36px;height:36px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;color:var(--text)}
.ib:hover{background:var(--glassBorder);color:var(--accent)}
.status{display:inline-flex;align-items:center;gap:.45rem;color:var(--muted);font-size:.82rem}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok)}
.wbadge{display:inline-flex;align-items:center;gap:.3rem;background:var(--warn);color:var(--onWarn);border-radius:999px;padding:.2rem .5rem;font-size:.76rem;font-weight:600}
.chip{border:1px solid var(--line);background:var(--panel2);color:var(--text);border-radius:999px;padding:.35rem .7rem;font-size:.8rem;white-space:nowrap}
.chip.on{background:var(--accentSolid);border-color:var(--accentSolid);color:var(--onAccent);font-weight:600}
.chip:hover:not(.on){border-color:var(--accent)}
.btn{display:inline-flex;align-items:center;gap:.45rem;border:1px solid var(--line);background:var(--panel2);color:var(--text);border-radius:9px;padding:.5rem .8rem;font-size:.85rem}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accentSolid);border-color:var(--accentSolid);color:var(--onAccent);font-weight:600}
.btn.ghost{background:transparent}
.searchbar{display:flex;align-items:center;gap:.5rem;border:1px solid var(--line);background:var(--panel2);border-radius:9px;padding:.45rem .6rem;color:var(--muted);font-size:.85rem}
.group{position:relative;border:1px solid var(--line);border-radius:12px;margin-bottom:.7rem;background:var(--panel2);overflow:visible}
.g-head{display:flex;align-items:center;gap:.5rem;padding:.6rem .75rem;color:var(--accent);font-weight:600;font-size:.9rem}
.g-head .caret{display:inline-flex;color:var(--accent)}
.group:not(.open) .g-head .caret{transform:rotate(-90deg)}
.g-tag{margin-left:auto;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--panel);border:1px solid var(--line);padding:.05rem .4rem;border-radius:6px}
.g-body{padding:.2rem .85rem .7rem}
.param{margin:.7rem 0}
.p-label{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;margin-bottom:.35rem}
.p-desc{color:var(--text);font-size:.85rem}.p-var{color:var(--muted);font:11px ui-monospace,monospace;flex-shrink:0}
.p-ctl{display:flex;align-items:center;gap:.7rem}
.track{position:relative;flex:1;height:6px;border-radius:3px;background:var(--panel);border:1px solid var(--line)}
.fill{position:absolute;left:0;top:-1px;height:6px;border-radius:3px;background:var(--accent)}
.thumb{position:absolute;top:50%;width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid var(--accentSolid);transform:translate(-50%,-50%);box-shadow:0 1px 4px rgba(0,0,0,.4)}
.num{width:48px;text-align:center;border:1px solid var(--line);background:var(--panel);border-radius:7px;padding:.28rem 0;font-size:.82rem}
.field{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:.45rem .6rem;font-size:.85rem}
/* preset picker */
.picker{position:absolute;width:300px;border-radius:14px;padding:.5rem;z-index:20;max-height:430px;overflow:auto}
.pick-search{display:flex;align-items:center;gap:.5rem;border:1px solid var(--line);background:var(--panel2);border-radius:9px;padding:.45rem .6rem;color:var(--muted);font-size:.83rem;margin-bottom:.35rem}
.pick-sec{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:.5rem .5rem .25rem}
.pick-row{display:flex;align-items:center;gap:.55rem;padding:.45rem .5rem;border-radius:8px;font-size:.86rem}
.pick-row:hover{background:var(--panel2)}
.pick-row.on{background:var(--accentSolid);color:var(--onAccent)}
.pick-row.on svg{color:var(--onAccent)}
.pick-row svg{color:var(--warn)}
.pick-meta{margin-left:auto;color:var(--muted);font-size:.8rem}
.pick-row.on .pick-meta{color:var(--onAccent)}
.pick-dot{width:7px;height:7px;border-radius:50%;background:var(--accent)}
.pick-dot.user{background:var(--muted)}
.pick-x{margin-left:auto;width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;color:var(--muted)}
.pick-x:hover{background:var(--line);color:var(--text)}
/* files */
.filehint{color:var(--muted);font-size:.78rem;margin:.3rem 0 .5rem}
.filerow{display:flex;align-items:center;gap:.5rem;padding:.4rem .5rem;border:1px solid var(--line);background:var(--panel);border-radius:8px;margin-bottom:.4rem;font-size:.83rem}
.filerow svg{color:var(--accent);flex:0 0 auto}
.fname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fsize{margin-left:auto;color:var(--muted);font-size:.76rem;flex:0 0 auto}
/* console */
.console{border-radius:14px;overflow:hidden;z-index:8}
.con-head{display:flex;align-items:center;gap:.4rem;padding:.5rem .6rem;border-bottom:1px solid var(--line)}
.con-seg{font-size:.82rem;color:var(--muted);padding:.25rem .55rem;border-radius:7px;display:inline-flex;align-items:center;gap:.4rem}
.con-seg.on{color:var(--text);background:var(--panel2);font-weight:600}
.cbadge{font-size:.72rem;font-weight:700;border-radius:999px;padding:0 .4rem}
.cbadge.warn{background:var(--warn);color:var(--onWarn)}
.con-body{padding:.5rem .6rem;max-height:200px;overflow:auto}
.adv{display:flex;align-items:flex-start;gap:.5rem;padding:.35rem .4rem;font-size:.82rem}
.adv svg{flex:0 0 auto;margin-top:1px}
.adv.warn svg{color:var(--warn)}.adv.note svg{color:var(--accent)}
.con-log{margin-top:.4rem;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:.5rem .6rem;font:11.5px/1.5 ui-monospace,monospace;color:var(--muted);white-space:pre-wrap}
.cue{position:absolute;z-index:30;width:22px;height:22px;border-radius:50%;background:var(--accentSolid);color:var(--onAccent);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px rgba(47,85,255,.28),0 2px 6px rgba(0,0,0,.4)}
.brand,.designsel,.dock-head,.actions,.status,.install,.grip,.sheet-head,.tabbar,.sheet-foot,.design,.preset-line,.statgrp{position:relative}
`;

const page = (t, css, body, head = "") =>
  `<!doctype html><html><head><meta charset="utf-8">${head}<style>${cssFor(t)}${css}</style></head><body>${body}</body></html>`;

/* ---------- Desktop shell (dock side + theme configurable) ---------- */
function desktopShell(t, { side = "left", picker = false, console: showConsole = false, showFiles = false } = {}) {
  const panelLeft = side === "left";
  const dockX = panelLeft ? "left:14px" : "right:14px";
  const railX = panelLeft ? "left:398px" : "right:398px";
  const actionsCenter = panelLeft ? "left:calc(50% + 186px)" : "left:calc(50% - 186px)";
  const railIcon = panelLeft ? "chevL" : "chevR";
  const css = `
  .topbar{position:absolute;top:14px;left:14px;right:14px;display:flex;align-items:center;gap:.7rem;z-index:14}
  .brand{display:flex;align-items:center;gap:.55rem;font-weight:700;font-size:1rem;padding:.5rem .8rem;border-radius:12px}
  .brand .logo{width:22px;height:22px;border-radius:6px;background:linear-gradient(140deg,var(--accent),var(--accentSolid))}
  .designsel{display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;border-radius:12px;font-size:.9rem}
  .presetbtn{display:flex;align-items:center;gap:.4rem;padding:.5rem .7rem;border-radius:12px;font-size:.88rem}
  .spacer{flex:1}
  .statgrp{display:flex;align-items:center;gap:.5rem;padding:.3rem .45rem;border-radius:12px}
  .install{display:inline-flex;align-items:center;gap:.45rem;background:var(--accentSolid);color:var(--onAccent);font-weight:600;font-size:.83rem;border-radius:10px;padding:.45rem .7rem}
  .dock{position:absolute;top:74px;${dockX};bottom:14px;width:372px;border-radius:var(--radius);display:flex;flex-direction:column;overflow:hidden;z-index:12}
  .dock-head{display:flex;align-items:center;gap:.5rem;padding:.7rem .85rem;border-bottom:1px solid var(--line)}
  .dock-head .ttl{font-weight:600}
  .dock-tools{padding:.7rem .85rem;border-bottom:1px solid var(--line);display:flex;gap:.4rem;align-items:center}
  .dock-scroll{flex:1;overflow:auto;padding:.8rem .85rem}
  .dock-foot{border-top:1px solid var(--line);padding:.6rem .85rem;display:flex;gap:.5rem;align-items:center}
  .reset{color:var(--muted);font-size:.82rem;display:inline-flex;align-items:center;gap:.35rem}
  .rail{position:absolute;${railX};top:50%;transform:translateY(-50%);z-index:12}
  .rail .hbtn{width:26px;height:54px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:var(--muted);background:var(--glassBg);backdrop-filter:blur(12px);border:1px solid var(--glassBorder)}
  .actions{position:absolute;bottom:${showConsole ? "246px" : "16px"};${actionsCenter};transform:translateX(-50%);display:flex;align-items:center;gap:.5rem;padding:.5rem;border-radius:14px;z-index:10}
  .seg{display:flex;align-items:center;gap:.4rem;padding-right:.5rem;border-right:1px solid var(--line)}
  .autopill{display:inline-flex;align-items:center;gap:.4rem;color:var(--muted);font-size:.8rem;padding:.3rem .5rem}
  .switch{width:30px;height:18px;border-radius:9px;background:var(--accentSolid);position:relative}
  .switch::after{content:"";position:absolute;right:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff}
  .outbtn{display:inline-flex;align-items:center;gap:.4rem;color:var(--muted);font-size:.82rem;padding:.4rem .55rem;border-radius:8px}
  .outbtn:hover{color:var(--text);background:var(--panel2)}
  `;
  // showFiles collapses the param groups so the Files group (bottom of the panel)
  // is visible above the fold — demonstrates where file import + its list live.
  const form = showFiles
    ? `
    <div class="searchbar">${svg("search", 15)}<span>Search parameters…</span></div>
    <div style="height:.7rem"></div>
    ${section("Tag", true, `${slider("Width of the tag (mm).", "width", "90", 62)}${slider("Height of the tag (mm).", "height", "45", 38)}`)}
    ${section("Text", false, "")}
    ${section("Mounting", false, "", true)}
    ${filesSection(cue(5, "left:-9px;top:-9px"))}
  `
    : `
    <div class="searchbar">${svg("search", 15)}<span>Search parameters…</span></div>
    <div style="height:.7rem"></div>
    ${section("Tag", true, `${slider("Width of the tag (mm).", "width", "90", 62)}${slider("Height of the tag (mm).", "height", "45", 38)}${slider("Thickness of the base plate (mm).", "thickness", "3", 22)}${slider("Corner radius (mm).", "corner_radius", "4", 30)}`)}
    ${section("Text", true, `${textField("Text to emboss on the tag.", "label", "ScadPub")}${slider("Font height (mm).", "text_size", "9", 45)}`)}
    ${section("Mounting", false, "", true)}
    ${filesSection()}
  `;
  const consoleAnchor = panelLeft ? "left:402px;right:14px" : "left:14px;right:402px";
  const body = `
    <div class="viewer">${model(showConsole ? .9 : 1.05)}</div>
    <div class="topbar">
      <div class="brand glass"><span class="logo"></span>ScadPub</div>
      <div class="designsel glass">Design <b>Tag&nbsp;▾</b></div>
      <div class="presetbtn glass">${cue(2, "left:-9px;top:-9px")}${svg("star", 15)} Presets <b>· Keychain</b> ▾</div>
      <div class="spacer"></div>
      <div class="statgrp glass">
        <span class="status" style="padding:0 .4rem"><span class="dot"></span>Rendered 412&nbsp;ms</span>
        ${cue(4, "left:96px;top:-12px")}<button class="wbadge">${svg("warn", 13)} 2</button>
        <button class="ib">${svg("sun", 18)}</button><button class="ib">${svg("help", 18)}</button><button class="ib">${svg("info", 18)}</button>
        <button class="install">${svg("install", 16)}Install</button>
      </div>
    </div>
    <div class="dock glass">
      <div class="dock-head"><span class="ttl">Parameters</span><button class="ib" style="margin-left:auto">${svg(railIcon, 18)}</button></div>
      <div class="dock-tools">${cue(1, "left:-9px;top:-9px")}<button class="presetbtn" style="border:1px solid var(--line);flex:1">${svg("star", 15)} Presets · <b>Keychain</b> <span style="margin-left:auto">▾</span></button><button class="chip">+ Save</button></div>
      <div class="dock-scroll">${form}</div>
      <div class="dock-foot"><button class="reset">${svg("reset", 14)}Reset to defaults</button></div>
    </div>
    <div class="rail"><button class="hbtn">${svg(railIcon, 16)}</button></div>
    ${hud(showConsole ? "246px" : "16px", `<button class="hbtn">${svg("expand", 17)}</button>`)}
    <div class="actions glass">
      <div class="seg"><span class="autopill"><span class="switch"></span>Auto-render</span></div>
      <button class="btn primary">${svg("play", 14)}Render</button>
      <button class="btn">${svg("download", 16)}Export 3MF</button>
      <button class="btn">${svg("image", 16)}PNG</button>
      <button class="btn">${svg("share", 16)}Share</button>
      <button class="outbtn">${cue(6, "left:-2px;top:-12px")}${svg("terminal", 15)}Output <span class="wbadge" style="padding:.05rem .4rem">2</span></button>
    </div>
    ${picker ? presetPicker("left:300px;top:74px") : ""}
    ${picker ? cue(3, "left:292px;top:66px") : ""}
    ${showConsole ? outputConsole(`position:absolute;${consoleAnchor};bottom:14px;height:218px`) : ""}
    ${showConsole ? cue(7, panelLeft ? "left:410px;top:auto;bottom:218px" : "right:410px;top:auto;bottom:218px") : ""}
  `;
  return page(t, css, body);
}

/* ---------- Phone: presets tab (big N) + files tab + output ---------- */
function phoneTab(t, { tab }) {
  const sheetH = 600;
  const css = `
  .topbar{position:absolute;top:calc(10px + env(safe-area-inset-top,0px));left:12px;right:12px;display:flex;align-items:center;gap:.5rem;z-index:10}
  .topbar .brand{display:flex;align-items:center;gap:.5rem;border-radius:999px;padding:.45rem .7rem;font-weight:700;font-size:.92rem}
  .topbar .brand .logo{width:18px;height:18px;border-radius:5px;background:linear-gradient(140deg,var(--accent),var(--accentSolid))}
  .topbar .design{border-radius:999px;padding:.45rem .75rem;font-size:.85rem}
  .spacer{flex:1}.topbar .ib{width:38px;height:38px;border-radius:999px}
  .wbadge.float{border-radius:999px;padding:.4rem .6rem}
  .hud{bottom:${sheetH + 14}px}
  .sheet{position:absolute;left:0;right:0;bottom:0;height:${sheetH}px;border-radius:20px 20px 0 0;z-index:12;display:flex;flex-direction:column;padding-bottom:env(safe-area-inset-bottom,0px)}
  .grip{display:flex;justify-content:center;padding:.55rem 0 .35rem}.grip span{width:42px;height:5px;border-radius:3px;background:var(--muted);opacity:.6}
  .tabbar{display:flex;gap:.2rem;padding:.1rem .8rem .35rem}
  .tab{flex:1;display:flex;align-items:center;justify-content:center;gap:.35rem;font-size:.78rem;color:var(--muted);padding:.4rem 0;border-bottom:2px solid transparent}
  .tab.on{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
  .sheet-body{flex:1;overflow:auto;padding:.4rem 1rem .6rem}
  .sheet-foot{display:flex;gap:.5rem;padding:.6rem 1rem calc(.6rem + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line)}
  .sheet-foot .btn{flex:1;justify-content:center}
  `;
  let bodyInner = "", tabs = "";
  const T_ = (n, icon, on) => `<span class="tab ${on ? "on" : ""}">${svg(icon, 15)} ${n}</span>`;
  tabs = `${T_("Parameters", "sliders", tab === "params")}${T_("Presets", "star", tab === "presets")}${T_("Files", "file", tab === "files")}`;
  if (tab === "presets") {
    bodyInner = `
      <div class="searchbar" style="margin-bottom:.5rem">${svg("search", 15)}<span>Search 40+ presets…</span></div>
      <div class="pick-sec">Recent</div>
      <div class="pick-row on">${svg("star", 14)}<span>Keychain — small</span></div>
      <div class="pick-row">${svg("star", 14)}<span>Luggage tag</span></div>
      <div class="pick-sec">Bundled (12)</div>
      <div class="pick-row"><span class="pick-dot"></span><span>Default</span></div>
      <div class="pick-row"><span class="pick-dot"></span><span>Big &amp; bold</span></div>
      <div class="pick-row"><span class="pick-dot"></span><span>Thin &amp; light</span></div>
      <div class="pick-sec">Yours (28)</div>
      <div class="pick-row"><span class="pick-dot user"></span><span>Office door v3</span><button class="pick-x">${svg("x", 12)}</button></div>
      <div class="pick-row"><span class="pick-dot user"></span><span>Cat collar</span><button class="pick-x">${svg("x", 12)}</button></div>
      <div class="pick-row"><span class="pick-dot user"></span><span>Toolbox label — 60mm</span><button class="pick-x">${svg("x", 12)}</button></div>`;
  } else if (tab === "files") {
    bodyInner = `
      <div class="filehint" style="margin-bottom:.6rem">Fonts, SVGs &amp; data files referenced by this design. Stored on-device and re-applied next visit.</div>
      <div class="filerow">${svg("file", 15)}<span class="fname">emblem.svg</span><span class="fsize">2.1 KB</span><button class="pick-x">${svg("x", 12)}</button></div>
      <div class="filerow">${svg("file", 15)}<span class="fname">Roboto-Bold.ttf</span><span class="fsize">168 KB</span><button class="pick-x">${svg("x", 12)}</button></div>
      <div class="filerow">${svg("file", 15)}<span class="fname">logo-outline.svg</span><span class="fsize">5.4 KB</span><button class="pick-x">${svg("x", 12)}</button></div>
      <button class="btn ghost" style="width:100%;justify-content:center;margin-top:.6rem">${svg("folder", 15)}Import file…</button>
      <button class="btn ghost" style="width:100%;justify-content:center;margin-top:.4rem;color:var(--muted)">Clear all imported files</button>`;
  }
  const body = `
    <div class="viewer">${model(.55)}</div>
    <div class="topbar">
      <div class="brand glass"><span class="logo"></span>ScadPub</div>
      <div class="design glass">Tag ▾</div>
      <div class="spacer"></div>
      <button class="wbadge float">${svg("warn", 13)} 2</button>
      <button class="ib glass">${svg("info", 17)}</button>
    </div>
    ${hud(`${sheetH + 14}px`)}
    <div class="sheet glass">
      <div class="grip"><span></span></div>
      <div class="tabbar">${tabs}</div>
      <div class="sheet-body">${bodyInner}</div>
      <div class="sheet-foot"><button class="btn primary">${svg("play", 14)}Render now</button><button class="btn">${svg("terminal", 15)}Output</button><button class="btn">${svg("share", 15)}Share</button></div>
    </div>`;
  const head = `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`;
  return page(t, css, body, head);
}

/* ---------- Desktop collapsed-to-canvas state ---------- */
function desktopCollapsed(t) {
  const css = `
  .topbar{position:absolute;top:14px;left:14px;right:14px;display:flex;align-items:center;gap:.7rem;z-index:14}
  .brand{display:flex;align-items:center;gap:.55rem;font-weight:700;font-size:1rem;padding:.5rem .8rem;border-radius:12px}
  .brand .logo{width:22px;height:22px;border-radius:6px;background:linear-gradient(140deg,var(--accent),var(--accentSolid))}
  .designsel{padding:.5rem .75rem;border-radius:12px;font-size:.9rem}
  .spacer{flex:1}
  .statgrp{display:flex;align-items:center;gap:.5rem;padding:.3rem .45rem;border-radius:12px}
  .install{display:inline-flex;align-items:center;gap:.45rem;background:var(--accentSolid);color:var(--onAccent);font-weight:600;font-size:.83rem;border-radius:10px;padding:.45rem .7rem}
  .editfab{position:absolute;top:74px;left:14px;display:inline-flex;align-items:center;gap:.5rem;padding:.6rem .9rem;border-radius:12px;font-weight:600;z-index:12}
  .actions{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:.5rem;padding:.5rem;border-radius:14px;z-index:10}
  .autopill{display:inline-flex;align-items:center;gap:.4rem;color:var(--muted);font-size:.8rem;padding:.3rem .5rem}
  .switch{width:30px;height:18px;border-radius:9px;background:var(--accentSolid);position:relative}
  .switch::after{content:"";position:absolute;right:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff}
  .seg{display:flex;align-items:center;gap:.4rem;padding-right:.5rem;border-right:1px solid var(--line)}
  `;
  const body = `
    <div class="viewer">${model(1.25)}</div>
    <div class="topbar">
      <div class="brand glass"><span class="logo"></span>ScadPub</div>
      <div class="designsel glass">Design <b>Tag ▾</b></div>
      <div class="spacer"></div>
      <div class="statgrp glass"><span class="status" style="padding:0 .4rem"><span class="dot"></span>Rendered 412&nbsp;ms</span><button class="ib">${svg("sun", 18)}</button><button class="ib">${svg("help", 18)}</button><button class="ib">${svg("info", 18)}</button><button class="install">${svg("install", 16)}Install</button></div>
    </div>
    <button class="editfab glass">${cue(1, "left:-9px;top:-9px")}${svg("sliders", 17)} Edit parameters</button>
    ${hud("16px", `<button class="hbtn">${svg("expand", 17)}</button>`)}
    <div class="actions glass">
      <div class="seg"><span class="autopill"><span class="switch"></span>Auto-render</span></div>
      <button class="btn primary">${svg("play", 14)}Render</button>
      <button class="btn">${svg("download", 16)}Export 3MF</button>
      <button class="btn">${svg("image", 16)}PNG</button>
      <button class="btn">${svg("share", 16)}Share</button>
    </div>`;
  return page(t, css, body);
}

/* ---------- render ---------- */
const shots = [
  { name: "05-desktop-right-presets", html: desktopShell(DARK, { side: "right", picker: true }), w: 1440, h: 900, dsf: 1 },
  { name: "06-desktop-output-console", html: desktopShell(DARK, { side: "left", console: true }), w: 1440, h: 900, dsf: 1 },
  { name: "07-desktop-collapsed", html: desktopCollapsed(DARK), w: 1440, h: 900, dsf: 1 },
  { name: "08-desktop-light-revamp", html: desktopShell(LIGHT, { side: "left", showFiles: true }), w: 1440, h: 900, dsf: 1 },
  { name: "09-phone-presets", html: phoneTab(DARK, { tab: "presets" }), w: 390, h: 844, dsf: 2 },
  { name: "10-phone-files", html: phoneTab(DARK, { tab: "files" }), w: 390, h: 844, dsf: 2 },
  { name: "11-phone-light", html: phoneTab(LIGHT, { tab: "presets" }), w: 390, h: 844, dsf: 2 },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dsf });
  const pg = await ctx.newPage();
  await pg.setContent(s.html, { waitUntil: "networkidle" });
  await pg.screenshot({ path: join(OUT, s.name + ".png") });
  await ctx.close();
  console.log("wrote", s.name);
}
await browser.close();
console.log("done");
