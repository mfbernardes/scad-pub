// Generates high-fidelity UX-proposal mockups for ScadPub and screenshots them.
// Pure presentation — no app code. Visual tokens mirror src/index.css (dark theme).
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, "mockups");
mkdirSync(OUT, { recursive: true });

/* ---- design tokens (from src/index.css, dark theme) ---- */
const T = {
  bg: "#15171c", panel: "#1f2229", panel2: "#262a32", line: "#333843",
  text: "#e6e8ec", muted: "#aeb6c2", accent: "#86a9ff", accentSolid: "#2f55ff",
  onAccent: "#ffffff", focus: "#6db0ff", warn: "#e0a458",
  viewerBg: "#0f1115", model: "#6f93ff", grid: "#565f6e", grid2: "#20252e",
};

/* ---- icons (inline SVG path bodies) ---- */
const ICON = {
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
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
  chevL: '<path d="M14 6l-6 6 6 6"/>',
  chevR: '<path d="M10 6l6 6-6 6"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 16.5 12 21l9-4.5"/>',
  bolt: '<path d="M13 3 4 14h6l-1 7 9-11h-6z"/>',
};
const svg = (name, size = 18, sw = 1.7) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

/* numbered callout badge for annotating proposals */
const cue = (n, style) =>
  `<span class="cue" style="${style}">${n}</span>`;

/* the rendered model: an isometric extruded name-tag plate */
function model({ scale = 1 } = {}) {
  return `
  <div class="stage" style="--s:${scale}">
    <div class="floor"></div>
    <div class="ground-shadow"></div>
    <div class="tag"><span class="tag-text">ScadPub</span></div>
  </div>`;
}

/* a parameter slider row */
function slider(desc, varname, value, pct, { mono = true } = {}) {
  return `
  <div class="param">
    <div class="p-label"><span class="p-desc">${desc}</span><span class="p-var">${varname}</span></div>
    <div class="p-ctl">
      <div class="track"><div class="fill" style="width:${pct}%"></div><div class="thumb" style="left:${pct}%"></div></div>
      <div class="num">${value}</div>
    </div>
  </div>`;
}
function textField(desc, varname, value) {
  return `
  <div class="param">
    <div class="p-label"><span class="p-desc">${desc}</span><span class="p-var">${varname}</span></div>
    <div class="field">${value}</div>
  </div>`;
}
function chip(label, active = false) {
  return `<button class="chip ${active ? "on" : ""}">${label}</button>`;
}
function section(title, open, body, { advanced = false } = {}) {
  return `
  <div class="group ${open ? "open" : ""}">
    <div class="g-head"><span class="caret">${svg("chevD", 14, 2)}</span><span>${title}</span>${advanced ? '<span class="g-tag">advanced</span>' : ""}</div>
    ${open ? `<div class="g-body">${body}</div>` : ""}
  </div>`;
}
function hud(extra = "") {
  return `
  <div class="hud">
    <button class="hbtn">${svg("plus", 18)}</button>
    <button class="hbtn">${svg("minus", 18)}</button>
    <button class="hbtn">${svg("fit", 17)}</button>
    <button class="hbtn">${svg("reset", 17)}</button>
    ${extra}
  </div>`;
}

/* shared CSS */
const baseCSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:${T.bg};--panel:${T.panel};--panel2:${T.panel2};--line:${T.line};
  --text:${T.text};--muted:${T.muted};--accent:${T.accent};--accentSolid:${T.accentSolid};
  --onAccent:${T.onAccent};--warn:${T.warn};--viewerBg:${T.viewerBg};--model:${T.model};
}
html,body{height:100%}
body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--text);background:var(--viewerBg);overflow:hidden;-webkit-font-smoothing:antialiased}
button{font:inherit;color:var(--text);cursor:pointer;border:none;background:none}
svg{display:block}

/* full-bleed 3D viewer canvas */
.viewer{position:absolute;inset:0;background:
  radial-gradient(120% 90% at 50% 38%, #1a1f27 0%, #12151b 45%, #0d1014 100%);
  overflow:hidden}
.viewer::before{content:"";position:absolute;inset:0;
  background-image:linear-gradient(${T.grid2} 1px,transparent 1px),linear-gradient(90deg,${T.grid2} 1px,transparent 1px);
  background-size:46px 46px;mask-image:radial-gradient(circle at 50% 45%,#000 30%,transparent 78%);opacity:.55}

.stage{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%) scale(var(--s,1));transform-style:preserve-3d}
.ground-shadow{position:absolute;left:50%;top:118px;width:300px;height:90px;transform:translate(-50%,-50%) rotateX(62deg);
  background:radial-gradient(ellipse,rgba(0,0,0,.55),transparent 68%);filter:blur(6px)}
.tag{position:relative;width:280px;height:150px;border-radius:20px;transform:rotateX(57deg) rotateZ(-30deg);transform-style:preserve-3d;
  background:linear-gradient(150deg,#8aa6ff,#5b79e6 60%,#4a64cf);
  box-shadow:
    0 1px 0 #4f6cd0,0 2px 0 #4a66c8,0 3px 0 #4763c4,0 4px 0 #4360bf,0 5px 0 #405cba,
    0 6px 0 #3d59b5,0 7px 0 #3a55b0,0 8px 0 #3852ab,0 9px 0 #354fa6,0 10px 0 #324ca1,
    0 11px 0 #30499c,0 12px 0 #2d4697,0 13px 0 #2b4493,0 14px 0 #28418e,
    0 30px 40px rgba(0,0,0,.5)}
.tag-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-weight:800;font-size:38px;letter-spacing:.5px;color:#e7edff;transform:translateZ(9px);
  text-shadow:0 1px 0 rgba(255,255,255,.45),0 -1px 0 rgba(20,30,70,.5)}

/* glass / floating surfaces */
.glass{background:rgba(31,34,41,.82);backdrop-filter:blur(14px) saturate(1.2);border:1px solid rgba(255,255,255,.07);
  box-shadow:0 8px 30px rgba(0,0,0,.45)}
.pill{display:inline-flex;align-items:center;gap:.5rem;border-radius:999px;padding:.45rem .7rem}

/* HUD (view controls) */
.hud{position:absolute;right:14px;bottom:calc(14px + var(--safe-b,0px));display:flex;flex-direction:column;gap:6px;z-index:6}
.hud .hbtn{width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;color:var(--text);
  background:rgba(31,34,41,.82);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.08);box-shadow:0 4px 14px rgba(0,0,0,.4)}
.hud .hbtn:hover{border-color:var(--accent);color:var(--accent)}

/* icon button */
.ib{width:36px;height:36px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;color:var(--text)}
.ib:hover{background:rgba(255,255,255,.06);color:var(--accent)}

/* status pill */
.status{display:inline-flex;align-items:center;gap:.45rem;color:var(--muted);font-size:.82rem}
.dot{width:8px;height:8px;border-radius:50%;background:#5fd08a;box-shadow:0 0 8px #5fd08a}
.dot.busy{background:var(--accent);box-shadow:0 0 8px var(--accent)}

/* chips */
.chip{border:1px solid var(--line);background:var(--panel2);color:var(--text);border-radius:999px;padding:.35rem .7rem;font-size:.8rem;white-space:nowrap}
.chip.on{background:var(--accentSolid);border-color:var(--accentSolid);color:#fff;font-weight:600}
.chip:hover:not(.on){border-color:var(--accent)}

/* primary button */
.btn{display:inline-flex;align-items:center;gap:.45rem;border:1px solid var(--line);background:var(--panel2);color:var(--text);border-radius:9px;padding:.5rem .8rem;font-size:.85rem}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accentSolid);border-color:var(--accentSolid);color:#fff;font-weight:600}
.btn.ghost{background:transparent}

/* parameter form bits */
.searchbar{display:flex;align-items:center;gap:.5rem;border:1px solid var(--line);background:var(--panel2);border-radius:9px;padding:.45rem .6rem;color:var(--muted);font-size:.85rem}
.group{border:1px solid var(--line);border-radius:12px;margin-bottom:.7rem;background:rgba(38,42,50,.4);overflow:hidden}
.group.open{background:rgba(38,42,50,.6)}
.g-head{display:flex;align-items:center;gap:.5rem;padding:.6rem .75rem;color:var(--accent);font-weight:600;font-size:.9rem}
.g-head .caret{display:inline-flex;transition:transform .15s;color:var(--accent)}
.group.open .g-head .caret{transform:none}
.group:not(.open) .g-head .caret{transform:rotate(-90deg)}
.g-tag{margin-left:auto;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--panel2);border:1px solid var(--line);padding:.05rem .4rem;border-radius:6px}
.g-body{padding:.2rem .85rem .7rem}
.param{margin:.7rem 0}
.p-label{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;margin-bottom:.35rem}
.p-desc{color:var(--text);font-size:.85rem}
.p-var{color:var(--muted);font:11px ui-monospace,monospace;flex-shrink:0}
.p-ctl{display:flex;align-items:center;gap:.7rem}
.track{position:relative;flex:1;height:6px;border-radius:3px;background:var(--panel2);border:1px solid var(--line)}
.fill{position:absolute;left:0;top:-1px;height:6px;border-radius:3px;background:var(--accent)}
.thumb{position:absolute;top:50%;width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid var(--accentSolid);transform:translate(-50%,-50%);box-shadow:0 1px 4px rgba(0,0,0,.5)}
.num{width:48px;flex:0 0 auto;text-align:center;border:1px solid var(--line);background:var(--panel2);border-radius:7px;padding:.28rem 0;font-size:.82rem}
.field{border:1px solid var(--line);background:var(--panel2);border-radius:8px;padding:.45rem .6rem;font-size:.85rem}

/* annotation cue badges — each lands relative to its host element */
.brand,.designsel,.dock-head,.actions,.status,.install,.grip,.sheet-head,
.tabbar,.sheet-foot,.design,.preset-line,.peek-actions{position:relative}
.cue{position:absolute;z-index:30;width:22px;height:22px;border-radius:50%;background:var(--accentSolid);color:#fff;
  font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 0 3px rgba(47,85,255,.28),0 2px 6px rgba(0,0,0,.5)}
`;

function page(css, body, extraHead = "") {
  return `<!doctype html><html><head><meta charset="utf-8">${extraHead}<style>${baseCSS}${css}</style></head><body>${body}</body></html>`;
}

/* ============================ DESKTOP ============================ */
function desktop() {
  const css = `
  .app{position:absolute;inset:0}
  /* floating top command bar */
  .topbar{position:absolute;top:14px;left:14px;right:14px;display:flex;align-items:center;gap:.7rem;z-index:10}
  .brand{display:flex;align-items:center;gap:.55rem;font-weight:700;font-size:1rem;padding:.5rem .8rem;border-radius:12px}
  .brand .logo{width:22px;height:22px;border-radius:6px;background:linear-gradient(140deg,var(--accent),var(--accentSolid))}
  .designsel{display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;border-radius:12px;font-size:.9rem}
  .designsel .cur{font-weight:600}
  .presetrow{display:flex;gap:.4rem;align-items:center;padding:.4rem .5rem;border-radius:12px}
  .spacer{flex:1}
  .topright{display:flex;align-items:center;gap:.3rem;padding:.3rem .4rem;border-radius:12px}
  .install{display:inline-flex;align-items:center;gap:.45rem;background:var(--accentSolid);color:#fff;font-weight:600;font-size:.83rem;border-radius:10px;padding:.45rem .7rem}

  /* docked, collapsible parameter panel (floating card over full-bleed canvas) */
  .dock{position:absolute;top:74px;left:14px;bottom:14px;width:372px;border-radius:16px;display:flex;flex-direction:column;z-index:9;overflow:hidden}
  .dock-head{display:flex;align-items:center;gap:.5rem;padding:.7rem .85rem;border-bottom:1px solid var(--line)}
  .dock-head .ttl{font-weight:600}
  .dock-head .collapse{margin-left:auto}
  .dock-tools{padding:.7rem .85rem;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:.55rem}
  .preset-line{display:flex;gap:.4rem;flex-wrap:wrap}
  .dock-scroll{flex:1;overflow:auto;padding:.8rem .85rem}
  .dock-foot{border-top:1px solid var(--line);padding:.6rem .85rem;display:flex;gap:.5rem;align-items:center}
  .reset{color:var(--muted);font-size:.82rem;display:inline-flex;align-items:center;gap:.35rem}
  .reset:hover{color:var(--text)}

  /* collapse rail handle */
  .rail{position:absolute;left:398px;top:50%;transform:translateY(-50%);z-index:9}
  .rail .hbtn{width:26px;height:54px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:var(--muted);
    background:rgba(31,34,41,.82);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.08)}

  /* bottom action cluster, floating bottom-center over canvas */
  .actions{position:absolute;bottom:16px;left:calc(50% + 186px);transform:translateX(-50%);display:flex;align-items:center;gap:.5rem;padding:.5rem;border-radius:14px;z-index:8}
  .seg{display:flex;align-items:center;gap:.4rem;padding-right:.5rem;border-right:1px solid var(--line)}
  .autopill{display:inline-flex;align-items:center;gap:.4rem;color:var(--muted);font-size:.8rem;padding:.3rem .5rem}
  .switch{width:30px;height:18px;border-radius:9px;background:var(--accentSolid);position:relative}
  .switch::after{content:"";position:absolute;right:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff}
  .advisory{position:absolute;bottom:16px;left:406px;max-width:340px;z-index:7;padding:.5rem .7rem;border-radius:11px;border-left:3px solid var(--warn);font-size:.8rem;color:var(--muted)}
  `;
  const presets = `${chip("Default", true)}${chip("Keychain")}${chip("Luggage")}${chip("Big")}`;
  const form = `
    <div class="searchbar">${svg("search", 15)}<span>Search parameters…</span></div>
    <div style="height:.7rem"></div>
    ${section("Tag", true, `
      ${slider("Width of the tag (mm).", "width", "90", 62)}
      ${slider("Height of the tag (mm).", "height", "45", 38)}
      ${slider("Thickness of the base plate (mm).", "thickness", "3", 22)}
      ${slider("Corner radius (mm).", "corner_radius", "4", 30)}
    `)}
    ${section("Text", true, `
      ${textField("Text to emboss on the tag.", "label", "ScadPub")}
      ${slider("Font height (mm).", "text_size", "9", 45)}
      ${slider("How far the text stands out (mm).", "text_depth", "1", 18)}
    `)}
    ${section("Mounting", false, "", { advanced: true })}
  `;
  const body = `
  <div class="app">
    <div class="viewer">${model({ scale: 1.05 })}</div>

    <div class="topbar">
      <div class="brand glass">${cue(1, "left:-9px;top:-9px")}<span class="logo"></span>ScadPub</div>
      <div class="designsel glass">${cue(2, "left:-9px;top:-9px")}Design <span class="cur">Tag ▾</span></div>
      <div class="presetrow glass">${presets}</div>
      <div class="spacer"></div>
      <div class="topright glass">
        <span class="status" style="padding:0 .5rem">${cue(3, "left:-2px;top:-12px")}<span class="dot"></span>Rendered 412&nbsp;ms</span>
        <button class="ib">${svg("sun", 18)}</button>
        <button class="ib">${svg("help", 18)}</button>
        <button class="ib">${svg("info", 18)}</button>
        <button class="install">${cue(4, "right:-8px;top:-9px")}${svg("install", 16)}Install</button>
      </div>
    </div>

    <div class="dock glass">
      <div class="dock-head">${cue(5, "left:-9px;top:-9px")}<span class="ttl">Parameters</span><button class="ib collapse">${svg("chevL", 18)}</button></div>
      <div class="dock-tools">
        <div class="preset-line">${presets}<button class="chip">+ Save</button></div>
      </div>
      <div class="dock-scroll">${form}</div>
      <div class="dock-foot"><button class="reset">${svg("reset", 14)}Reset to defaults</button><div class="spacer"></div><button class="btn ghost">Import file…</button></div>
    </div>
    <div class="rail"><button class="hbtn">${svg("chevL", 16)}</button></div>

    ${hud(`<button class="hbtn">${svg("expand", 17)}</button>`)}

    <div class="actions glass">${cue(6, "left:-9px;top:-9px")}
      <div class="seg"><span class="autopill"><span class="switch"></span>Auto-render</span></div>
      <button class="btn primary">${svg("play", 14)}Render</button>
      <button class="btn">${svg("download", 16)}Export 3MF</button>
      <button class="btn">${svg("image", 16)}PNG</button>
      <button class="btn">${svg("share", 16)}Share</button>
    </div>
  </div>`;
  return page(css, body);
}

/* ============================ TABLET (landscape) ============================ */
function tablet() {
  const css = `
  .app{position:absolute;inset:0}
  .topbar{position:absolute;top:12px;left:12px;right:12px;display:flex;align-items:center;gap:.6rem;z-index:10}
  .brand{display:flex;align-items:center;gap:.5rem;font-weight:700;padding:.45rem .7rem;border-radius:12px}
  .brand .logo{width:20px;height:20px;border-radius:6px;background:linear-gradient(140deg,var(--accent),var(--accentSolid))}
  .designsel{padding:.45rem .7rem;border-radius:12px;font-size:.88rem}
  .spacer{flex:1}
  .topright{display:flex;gap:.2rem;padding:.25rem .35rem;border-radius:12px;align-items:center}
  .install{display:inline-flex;align-items:center;gap:.4rem;background:var(--accentSolid);color:#fff;font-weight:600;font-size:.8rem;border-radius:10px;padding:.4rem .65rem}
  .dock{position:absolute;top:66px;left:12px;bottom:12px;width:320px;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;z-index:9}
  .dock-tools{padding:.6rem .7rem;border-bottom:1px solid var(--line);display:flex;gap:.4rem;flex-wrap:wrap}
  .dock-scroll{flex:1;overflow:auto;padding:.7rem}
  .dock-foot{border-top:1px solid var(--line);padding:.55rem .7rem;display:flex;gap:.5rem}
  .actions{position:absolute;bottom:14px;left:calc(50% + 166px);transform:translateX(-50%);display:flex;gap:.45rem;padding:.45rem;border-radius:14px;z-index:8}
  `;
  const presets = `${chip("Default", true)}${chip("Keychain")}${chip("Luggage")}`;
  const body = `
  <div class="app">
    <div class="viewer">${model({ scale: .92 })}</div>
    <div class="topbar">
      <div class="brand glass"><span class="logo"></span>ScadPub</div>
      <div class="designsel glass">Tag ▾</div>
      <div class="spacer"></div>
      <div class="topright glass"><span class="status" style="padding:0 .4rem"><span class="dot"></span>412 ms</span><button class="ib">${svg("sun", 17)}</button><button class="ib">${svg("help", 17)}</button><button class="install">${svg("install", 15)}Install</button></div>
    </div>
    <div class="dock glass">
      <div class="dock-tools">${presets}<button class="chip">+ Save</button></div>
      <div class="dock-scroll">
        ${section("Tag", true, `${slider("Width (mm).", "width", "90", 62)}${slider("Height (mm).", "height", "45", 38)}${slider("Thickness (mm).", "thickness", "3", 22)}`)}
        ${section("Text", true, `${textField("Emboss text.", "label", "ScadPub")}${slider("Font height (mm).", "text_size", "9", 45)}`)}
        ${section("Mounting", false, "", { advanced: true })}
      </div>
      <div class="dock-foot"><button class="reset" style="color:var(--muted);display:inline-flex;gap:.35rem;align-items:center">${svg("reset", 14)}Reset</button></div>
    </div>
    ${hud()}
    <div class="actions glass">
      <button class="btn primary">${svg("play", 14)}Render</button>
      <button class="btn">${svg("download", 15)}3MF</button>
      <button class="btn">${svg("image", 15)}PNG</button>
      <button class="btn">${svg("share", 15)}Share</button>
    </div>
  </div>`;
  return page(css, body);
}

/* ============================ PHONE ============================ */
function phone({ state }) {
  // state: "peek" | "half"
  const sheetH = state === "peek" ? 248 : 540;
  const css = `
  .app{position:absolute;inset:0}
  /* top safe-area + floating pill */
  .topbar{position:absolute;top:calc(10px + env(safe-area-inset-top,0px));left:12px;right:12px;display:flex;align-items:center;gap:.5rem;z-index:10}
  .topbar .brand{display:flex;align-items:center;gap:.5rem;border-radius:999px;padding:.45rem .7rem;font-weight:700;font-size:.92rem}
  .topbar .brand .logo{width:18px;height:18px;border-radius:5px;background:linear-gradient(140deg,var(--accent),var(--accentSolid))}
  .topbar .design{border-radius:999px;padding:.45rem .75rem;font-size:.85rem;display:flex;align-items:center;gap:.35rem}
  .spacer{flex:1}
  .topbar .ib{width:38px;height:38px;border-radius:999px}
  .topbar .status-pill{border-radius:999px;padding:.45rem .6rem;display:flex;align-items:center}

  /* HUD sits above the sheet */
  .hud{bottom:calc(${sheetH + 14}px)}

  /* bottom sheet */
  .sheet{position:absolute;left:0;right:0;bottom:0;height:${sheetH}px;border-radius:20px 20px 0 0;z-index:12;display:flex;flex-direction:column;
    padding-bottom:env(safe-area-inset-bottom,0px);transition:height .25s ease}
  .grip{display:flex;justify-content:center;padding:.55rem 0 .35rem}
  .grip span{width:42px;height:5px;border-radius:3px;background:#5a6373}
  .sheet-head{display:flex;align-items:center;gap:.6rem;padding:0 1rem .55rem}
  .sheet-head .h-ttl{font-weight:700;font-size:1rem}
  .sheet-head .status{margin-left:auto}
  .preset-scroll{display:flex;gap:.45rem;overflow:auto;padding:0 1rem .6rem}
  .sheet-body{flex:1;overflow:auto;padding:.2rem 1rem .6rem}
  .sheet-foot{display:flex;gap:.5rem;padding:.6rem 1rem calc(.6rem + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line)}
  .sheet-foot .btn{flex:1;justify-content:center}
  .tabbar{display:flex;gap:.2rem;padding:.1rem 1rem .4rem}
  .tab{flex:1;text-align:center;font-size:.78rem;color:var(--muted);padding:.4rem 0;border-bottom:2px solid transparent}
  .tab.on{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
  .peek-actions{display:flex;gap:.5rem;padding:.1rem 1rem .2rem}
  .peek-actions .btn{flex:1;justify-content:center}
  `;
  const presets = `${chip("Default", true)}${chip("Keychain")}${chip("Luggage")}${chip("Big")}${chip("Tiny")}`;

  const sheetInner = state === "peek"
    ? `
      <div class="grip">${cue(2, "left:calc(50% + 30px);top:4px")}<span></span></div>
      <div class="sheet-head"><span class="h-ttl">Tag</span><span class="status">${cue(3, "right:-4px;top:-12px")}<span class="dot"></span>Rendered 412&nbsp;ms</span></div>
      <div class="preset-scroll">${presets}</div>
      <div class="peek-actions">
        <button class="btn primary">${svg("play", 14)}Render</button>
        <button class="btn">${svg("download", 15)}3MF</button>
        <button class="btn">${svg("share", 15)}Share</button>
      </div>
      <div style="padding:.5rem 1rem 0;color:var(--muted);font-size:.8rem">Drag up to edit parameters ↑</div>
    `
    : `
      <div class="grip"><span></span></div>
      <div class="tabbar">${cue(4, "left:24px;top:-2px")}<span class="tab on">${svg("sliders", 15)} Parameters</span><span class="tab">${svg("layers", 15)} Presets</span><span class="tab">${svg("download", 15)} Export</span></div>
      <div class="sheet-body">
        <div class="searchbar" style="margin-bottom:.6rem">${svg("search", 15)}<span>Search parameters…</span></div>
        ${section("Tag", true, `${slider("Width (mm).", "width", "90", 62)}${slider("Height (mm).", "height", "45", 38)}${slider("Thickness (mm).", "thickness", "3", 22)}${slider("Corner radius (mm).", "corner_radius", "4", 30)}`)}
        ${section("Text", true, `${textField("Emboss text.", "label", "ScadPub")}${slider("Font height (mm).", "text_size", "9", 45)}`)}
        ${section("Mounting", false, "", { advanced: true })}
      </div>
      <div class="sheet-foot">${cue(5, "left:8px;top:-10px")}<button class="btn primary">${svg("play", 14)}Render now</button><button class="btn">${svg("download", 15)}Export</button><button class="btn">${svg("share", 15)}Share</button></div>
    `;

  const body = `
  <div class="app">
    <div class="viewer">${model({ scale: state === "peek" ? .82 : .6 })}</div>
    <div class="topbar">
      <div class="brand glass"><span class="logo"></span>ScadPub</div>
      <div class="design glass">${cue(1, "left:-8px;top:-9px")}Tag ▾</div>
      <div class="spacer"></div>
      <button class="ib glass">${svg("sun", 17)}</button>
      <button class="ib glass">${svg("info", 17)}</button>
    </div>
    ${hud()}
    <div class="sheet glass">${sheetInner}</div>
  </div>`;
  const head = `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`;
  return page(css, body, head);
}

/* ============================ render all ============================ */
const shots = [
  { name: "01-desktop-studio", html: desktop(), w: 1440, h: 900, dsf: 1 },
  { name: "02-tablet-landscape", html: tablet(), w: 1024, h: 768, dsf: 2 },
  { name: "03-phone-peek", html: phone({ state: "peek" }), w: 390, h: 844, dsf: 2 },
  { name: "04-phone-expanded", html: phone({ state: "half" }), w: 390, h: 844, dsf: 2 },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
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
