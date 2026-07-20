// diagnostics.ts — turn the raw OpenSCAD worker log into friendly, structured
// notices and the count badges shown on the "OpenSCAD output" panel.
//
// The notice categories are CONFIG-DRIVEN (schema.notices, built from the
// config's `notices` key): a design echoes
// `ECHO: "<context>: <marker>: <message>"` and each configured category (its
// marker, label and optional colour) becomes a friendly notice and a coloured
// count badge. OpenSCAD's own `WARNING:` lines and `assert()` failures
// (`ERROR: Assertion …`) are handled in a fixed, hardcoded way: warnings surface
// as notices; assert failures get both a notice and a count badge.
//
// See also computedInfo.ts, a separate echo convention (`echo("@info", ...)`)
// for surfacing internally-calculated values in the measurements panel.
import type { NoticeCategory } from "../openscad/types";

export type DiagnosticLevel = "notice" | "warning" | "assert";

export interface Diagnostic {
  level: DiagnosticLevel;
  text: string;
  /** Optional notice/badge colour (config-driven notice categories only). */
  color?: string;
  /**
   * The config category's marker (notice-level diagnostics only) — lets a
   * consumer cross-reference this diagnostic against the parallel
   * `BadgeCount` for the same category (e.g. its `attention` flag) without
   * re-deriving category membership from the raw text. Set alongside
   * `label`; both omitted for warnings/asserts (hardcoded, not config-driven
   * categories). See `noticeCards`.
   */
  marker?: string;
  /** The config category's badge noun (e.g. "alerts", "font notes") — the
   *  plain-language card heading `noticeCards` renders. Set alongside
   *  `marker`. */
  label?: string;
}

/** One count badge for the OpenSCAD output panel header. */
export interface BadgeCount {
  /** Stable identity (`notice:<marker>` or `assert`). */
  key: string;
  /** Badge noun (e.g. "alerts", "notes", "asserts"). */
  label: string;
  count: number;
  /** Optional singular form of `label` (see NoticeCategory.labelOne) — pass to
   *  `noticeLabel` alongside `count` to pick the right form. */
  labelOne?: string;
  /** Optional fill colour; falls back to the default badge styling. */
  color?: string;
  /**
   * True when this category is flagged `attention: true` in config (see
   * `NoticeCategory.attention`) — i.e. a pending notice here is one of the
   * production-readiness gaps readiness.ts's `deriveAttention` also
   * surfaces, not just a routine, informational aside. `badgeVariant` uses
   * this to decide amber ("warn") vs neutral ("secondary") styling (see
   * docs/ux-improvement-plan.md item 4.2: an informational-only notice, e.g.
   * a `fontnote` marker with `attention: false`, must not read as urgent
   * next to an "all clear" Review stage). Omitted (not just `false`) when
   * not flagged, matching `subsumedByFont`'s own sparse-emission convention.
   * Never set on the hardcoded `assert` badge — `badgeVariant` always treats
   * that one as its own destructive style regardless of this field.
   */
  attention?: boolean;
  /**
   * True when this category is `attention`-flagged AND `subsumedByFont`
   * (see NoticeCategory.subsumedByFont) — i.e. it's ELIGIBLE to be treated
   * as a symptom of a missing font rather than its own distinct issue.
   * `countBadges` sets this from config; it does NOT by itself mean the
   * category is currently subsumed (that also depends on whether a font is
   * actually missing this render, which `countBadges` has no way to know —
   * see `displayBadges`, the caller-side filter that combines this flag
   * with that live signal). Omitted when not eligible, so an ordinary
   * badge's shape is unchanged.
   */
  subsumedByFont?: boolean;
}

/**
 * The correct singular/plural form of a notice category's badge/notice noun:
 * `labelOne` when the live count is exactly 1 and one was configured, else
 * the plain `label` (e.g. "alerts"). A config label is a single noun with no
 * built-in plural rule, so without this a single pending notice always reads
 * as "1 alerts" — see NoticeCategory.labelOne's own doc. Used wherever a
 * count renders alongside a notice category's label: CountBadges' accessible
 * name and the consolidated attention chip's notice rows (src/lib/
 * readiness.ts's deriveAttention).
 */
export function noticeLabel(label: string, count: number, labelOne?: string): string {
  return count === 1 && labelOne ? labelOne : label;
}

// An OpenSCAD echo line, e.g. `[err] ECHO: "tag: alert: …"`. OpenSCAD-WASM
// routes ECHO to stderr, so accept both streams (like WARNING/ERROR below).
const ECHO_RE = /^\[(?:out|err)\]\s*ECHO:\s*"(.*)"\s*$/;
// Hardcoded OpenSCAD diagnostics (not configurable). Exported so other log
// consumers (e.g. src/lib/friendlyErrors.ts, which needs the raw assertion
// text to pull the authored assert() message out of) reuse the same match
// instead of duplicating it.
export const WARNING_RE = /^\[(?:out|err)\]\s*WARNING:\s*(.*)$/;
// An `assert()` failure: OpenSCAD prints `ERROR: Assertion '…' failed …`.
export const ASSERT_RE = /^\[(?:out|err)\]\s*ERROR:\s*(Assertion\b.*)$/;

// Static shape escapeRegExp tests on every call — hoisted to module scope
// rather than re-literalized per call.
const REGEXP_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(s: string): string {
  return s.replace(REGEXP_ESCAPE_RE, "\\$&");
}

// A line classified into a diagnostic, plus the key of the badge it contributes
// to (if any — warnings get a notice but no badge). `null` for plain output
// lines. The badge's label/colour come from the category map in countBadges, so
// only the key is carried here.
interface Classified extends Diagnostic {
  badgeKey?: string;
}

// One notice category's match rule, precompiled once per (notices) input
// rather than once per log LINE — classify() used to build a fresh RegExp per
// category on every line it examined (parseDiagnostics/countBadges both loop
// over every line), which is wasted work since `notices` doesn't change
// within either loop. `re.marker` is dynamic (config-driven), so the pattern
// itself can't be a module-level constant like ECHO_RE/WARNING_RE/ASSERT_RE
// below — this cache is the next best thing: build it once, reuse per line.
interface CompiledNotice {
  re: RegExp;
  category: NoticeCategory;
  badgeKey: string;
}

function compileNotices(notices: NoticeCategory[]): CompiledNotice[] {
  return notices.map((n) => ({
    // Match the design's convention `: <marker>:` and strip the marker so the
    // notice reads "tag: text size is large …" rather than repeating it.
    re: new RegExp(`:\\s*${escapeRegExp(n.marker)}:\\s*`, "i"),
    category: n,
    badgeKey: `notice:${n.marker}`,
  }));
}

// Classify one log line. Config-driven notice categories win over the hardcoded
// rules; the first matching category claims the line.
function classify(
  line: string,
  compiledNotices: CompiledNotice[]
): Classified | null {
  const echo = line.match(ECHO_RE);
  if (echo) {
    for (const { re, category, badgeKey } of compiledNotices) {
      if (re.test(echo[1]))
        return {
          level: "notice",
          text: echo[1].replace(re, ": "),
          color: category.color,
          marker: category.marker,
          label: category.label,
          badgeKey,
        };
    }
    return null;
  }
  const assertM = line.match(ASSERT_RE);
  if (assertM)
    return {
      level: "assert",
      text: assertM[1].trim(),
      badgeKey: "assert",
    };
  const warn = line.match(WARNING_RE);
  if (warn) return { level: "warning", text: warn[1].trim() };
  return null;
}

/** De-duplicated, structured notices for the Diagnostics list. */
export function parseDiagnostics(
  log: string[],
  notices: NoticeCategory[]
): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  const compiled = compileNotices(notices);
  for (const line of log) {
    const c = classify(line, compiled);
    if (!c || !c.text) continue;
    const key = `${c.level}:${c.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      level: c.level,
      text: c.text,
      ...(c.color ? { color: c.color } : {}),
      ...(c.marker ? { marker: c.marker } : {}),
      ...(c.label ? { label: c.label } : {}),
    });
  }
  return out;
}

/**
 * Count badges for the OpenSCAD output panel: one per configured notice category
 * and one for assert failures. Categories keep their configured order; the
 * assert badge comes last. Only badges with a non-zero count are returned.
 * Counts are over raw matching log lines (not de-duplicated) so repeated notices
 * still tally.
 */
export function countBadges(
  log: string[],
  notices: NoticeCategory[]
): BadgeCount[] {
  const byKey = new Map<string, BadgeCount>();
  for (const n of notices)
    byKey.set(`notice:${n.marker}`, {
      key: `notice:${n.marker}`,
      label: n.label,
      count: 0,
      ...(n.labelOne ? { labelOne: n.labelOne } : {}),
      ...(n.color ? { color: n.color } : {}),
      ...(n.attention ? { attention: true } : {}),
      // subsumedByFont is only meaningful alongside `attention` (see
      // NoticeCategory.subsumedByFont's own doc — "meaningless (ignored) on
      // a category not also flagged attention: true"), so it's only carried
      // onto the badge when both are set.
      ...(n.subsumedByFont && n.attention ? { subsumedByFont: true } : {}),
    });
  byKey.set("assert", { key: "assert", label: "asserts", count: 0 });

  const compiled = compileNotices(notices);
  for (const line of log) {
    const c = classify(line, compiled);
    if (c?.badgeKey) {
      const badge = byKey.get(c.badgeKey);
      if (badge) badge.count++;
    }
  }
  return [...byKey.values()].filter((b) => b.count > 0);
}

/**
 * Filter `countBadges`' output for display: a `subsumedByFont`-eligible
 * badge (see `BadgeCount.subsumedByFont`) is shown only when its marker also
 * has a genuine, visible notice this render — i.e. its `notice:<marker>` key
 * is present in `visibleNoticeKeys`. Every other badge (not
 * subsumedByFont-eligible, e.g. `assert` or a plain notice category) passes
 * through unchanged.
 *
 * Fixes a count/visibility mismatch: `countBadges` alone has no way to know
 * whether a font is currently missing (it only sees the raw log + config),
 * so a `subsumedByFont` category's badge always showed its raw pending
 * count — including while readiness.ts's `deriveAttention` had ALREADY
 * excluded that same category's notice from the curated attention list
 * because a font-fallback item was covering it. The Notices tab then showed
 * a non-zero count (e.g. "Notices 1") with no corresponding visible
 * plain-language notice card, breaking the "a badge always points at
 * something you can see" contract.
 *
 * The caller (OutputConsole) passes the markers backing its own `attention`
 * prop's `kind: "notice"` items as `visibleNoticeKeys` — the exact same
 * computation (deriveAttention, including its font-param-count/ambiguity
 * guard) that decides which attention cards render, so this can never
 * disagree with what's actually on screen. This only ever HIDES a badge
 * (never counts differently) — a subsumed category's raw text still shows
 * up in the Technical details disclosure, unaffected; it's just no longer
 * double-counted as its own chip once the font problem already explains it.
 */
export function displayBadges(badges: BadgeCount[], visibleNoticeKeys: Set<string>): BadgeCount[] {
  return badges.filter((b) => !b.subsumedByFont || visibleNoticeKeys.has(b.key));
}

/**
 * The shadcn `Badge` `variant` a count chip (CountBadges) should render as.
 *
 * Round: UX plan item 4.2. Before this, every notice-category chip used the
 * same amber "warn" styling as the assert chip, regardless of whether its
 * category was actually a production-readiness concern — so a purely
 * informational notice (e.g. a `fontnote` marker with no `attention: true`
 * in config) painted "Notices 1" just as urgently as a genuine unresolved
 * issue, directly contradicting an adjacent "no unresolved issues" Review
 * summary. Now: an assert-failure chip is always "destructive" (its own
 * long-standing red, unaffected); a notice-category chip is "warn" (amber)
 * only when `BadgeCount.attention` is true (config's `notices[].attention`),
 * and "secondary" (neutral/muted) otherwise. Applied per badge, so a render
 * with both an attention category and a routine one shows exactly one amber
 * chip next to a neutral one — never a single blanket verdict painted across
 * unrelated categories.
 */
export function badgeVariant(b: BadgeCount): "destructive" | "warn" | "secondary" {
  if (b.key === "assert") return "destructive";
  return b.attention ? "warn" : "secondary";
}

/**
 * Pick black or white text for a badge whose background is a config-supplied
 * colour, so the count stays legible (WCAG contrast) regardless of the hue.
 * Only #rgb / #rrggbb are parsed; other CSS colour forms return undefined.
 */
export function badgeTextColor(color?: string): string | undefined {
  if (!color) return undefined;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return undefined;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  return lum > 0.4 ? "#000" : "#fff";
}

/**
 * Round: UX plan item 5.1b. Whether the console has little enough VISIBLE
 * content to open at a compact, content-height size on mobile rather than
 * commanding the full screen: true when there's no friendly render-failure
 * card, and the total of attention cards + plain-language notice cards
 * (`noticeCards`) is small (≤ 2) — the same things a visitor actually SEES
 * on the primary Notices surface, not the raw (often longer, always more
 * technical) diagnostics log. A render with a real failure or an unresolved
 * readiness gap always gets the full-height treatment — this only shrinks
 * the "just a note or two" case the mobile full-screen dialog used to devote
 * the entire viewport to (see OutputConsole.tsx's own doc on why that dialog
 * exists at all).
 */
export function isCompactConsoleContent(opts: {
  hasFriendlyError: boolean;
  attentionCount: number;
  noticeCardCount: number;
}): boolean {
  return !opts.hasFriendlyError && opts.attentionCount + opts.noticeCardCount <= 2;
}

// Strips the internal design-id prefix classify() leaves in place on a
// notice's text (it strips only the MARKER, e.g. ": fontnote: ", keeping the
// echo's own leading context — see `ECHO: "<context>: <marker>: <message>"`
// in this file's header doc). That context is the design's internal id
// (e.g. "door_sign"), never meant for a visitor.
const NOTICE_PREFIX_RE = /^\s*[A-Za-z0-9_]+:\s*/;

// Matches a quoted Fontconfig-style family name carrying `:prop=value`
// pattern-matching properties — the wire format OpenSCAD's own font
// resolution emits, e.g. 'Atkinson Hyperlegible:style=Regular' or
// "DIN 32986 Taktil Positiv:style=Regular:weight=Bold". Captures the quote
// and the bare family name so the replacement can drop everything from the
// first `:prop=` onward while keeping the family NAME itself.
const FONTCONFIG_PROPS_RE = /(['"])([^'":]+)(?::[A-Za-z]+=[^'"]*)+\1/g;

/**
 * Round: "Notices surface" directive. Turns a raw, already marker-stripped
 * notice line (`Diagnostic.text`, as `classify()` produces it — still
 * carries the echo's own leading design-id context and any Fontconfig
 * wire-format font properties) into the plain-language sentence the Notices
 * tab's primary cards (`noticeCards`) show: strips the internal design-id
 * prefix, and reduces any quoted Fontconfig family name
 * (`'Family:style=Regular'`) down to just the family (`'Family'`). Font
 * NAMES stay — they're meaningful to a visitor choosing a font; only the
 * `:style=`/`:weight=`/… property syntax and the design-id are
 * implementation plumbing that never belongs in front of one. The untouched
 * original (`Diagnostic.text`) is unaffected — the raw "Technical details"
 * disclosure keeps showing it verbatim.
 */
export function cleanNoticeText(text: string): string {
  return text.replace(NOTICE_PREFIX_RE, "").replace(FONTCONFIG_PROPS_RE, "$1$2$1");
}

/** One plain-language notice card for the Notices tab's primary surface. */
export interface NoticeCard {
  /** The config category's marker — stable React key alongside the index
   *  (a category can produce more than one distinct-text card). */
  marker: string;
  /** The config category's badge noun (e.g. "font notes"), shown as the
   *  card's small heading. */
  label: string;
  /** `cleanNoticeText(text)` — plain language, no Fontconfig/design-id
   *  plumbing. */
  text: string;
}

/**
 * Round: "Notices surface" directive. The plain-language cards the Notices
 * tab's PRIMARY surface shows: one per unique, already-deduplicated notice
 * diagnostic (`parseDiagnostics`) whose category is NOT `attention`-flagged.
 *
 * An `attention`-flagged category's pending notice already gets its own
 * card via AttentionItems (readiness.ts's `deriveAttention`, aggregated and
 * count-pluralized via `noticeLabel`) — repeating it here, worded
 * differently, would just duplicate that surface. A category's `attention`
 * flag is looked up from `badges` (the same `countBadges()` output
 * `CountBadges`/`badgeVariant` render from) rather than re-derived, so this
 * can never disagree with what the tab's own chip colour says about the
 * category.
 *
 * GUARANTEE (badge count ⇔ visible cards): every notice-category badge
 * `countBadges`/`displayBadges` can show with a non-zero count is backed by
 * at least one visible card somewhere on this surface — an attention-
 * flagged category's badge is backed by its `attention` list entry (already
 * guaranteed by construction: `displayBadges` only lets a badge through when
 * its marker is either not subsumed or present in `attention`); a non-
 * attention category's badge is backed by a card THIS function returns,
 * because `countBadges` and `parseDiagnostics` classify the exact same log
 * lines with the exact same rules — any line that increments a category's
 * badge count also yields (after de-dup) at least one `Diagnostic` for that
 * marker, so `noticeCards` never returns fewer than one card for a category
 * with a pending badge. A non-zero badge is therefore never shown over an
 * empty primary surface.
 */
export function noticeCards(diagnostics: Diagnostic[], badges: BadgeCount[]): NoticeCard[] {
  const attentionByKey = new Map(badges.map((b) => [b.key, !!b.attention]));
  const out: NoticeCard[] = [];
  for (const d of diagnostics) {
    if (d.level !== "notice" || !d.marker || !d.label) continue;
    if (attentionByKey.get(`notice:${d.marker}`)) continue; // covered by AttentionItems already
    out.push({ marker: d.marker, label: d.label, text: cleanNoticeText(d.text) });
  }
  return out;
}
