// UnifiedSelectorDialog.tsx — guided workflow's ONE selector for "what am I
// making, and from what starting point": three groups (Designs / Examples /
// Saved setups) behind a single dialog, replacing the separate Examples tab
// + design-picker dialog that "tabs" workflow still uses (DesignPickerDialog,
// PresetPicker). Opened from the header design-name button (see
// DesignPickerButton.tsx, reused verbatim for guided mode — see
// CommandBar.tsx / GuidedMobileHeader.tsx) and auto-opened on first run (no
// design chosen yet — see App.tsx). Desktop renders as a large centred
// dialog with a segmented Designs/Examples/Saved row, a 3-col card grid, and
// a fixed footer that never covers the last row (the scroll area's own
// bottom padding is measured to match the footer's live height + 24px — see
// `footerH` below). Mobile renders FULL-SCREEN (its own fixed inset-0 shell,
// not the shared centred `Modal`) with a one-column illustrated list, the
// same three groups reachable via the same segmented row.
//
// "Designs" reuses DesignPickerDialog's card look (image/icon/letter
// fallback); "Examples" is the current design's bundled presets as cards
// (thumbnail via `design.presetImages`, parsed title/overline/badge — see
// presetCard.ts, the exact same parsing PresetPicker's bundled list uses);
// "Saved" is the current design's user-saved presets, plus a lightweight
// "Save current settings…" row so saving a preset stays reachable now that
// the Presets tab is gone from guided primary nav (import/export of a
// parameterSets file — PresetPicker's own power-tools row — stays out of
// scope here; that JSON-interchange affordance is a power-user path this
// SHELL pass doesn't need to relocate).
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import type { Design } from "../openscad/types";
import type { ParsedSet, Values } from "../lib/presets";
import { deletePreset, loadPreset, savePreset } from "../lib/presets";
import { groupPresetsByBadge, parsePresetCardName } from "../lib/presetCard";
import { groupDesigns } from "./DesignPicker";
import { DesignArt, DesignCard, designMatchesQuery, type PickerCardLayout } from "./DesignPickerDialog";
import { Markdown } from "./Markdown";
import { useIsMobile } from "../lib/useIsMobile";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent, chipTabTrigger } from "./ui/tabs";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Check as CheckIcon, Trash2 as TrashIcon, X as XIcon } from "lucide-react";

type SelectorGroup = "designs" | "examples" | "saved";

/**
 * Round-5 Wave 2 (item 1): present only when this dialog is standing in for
 * the configurable popup's own first-run "welcome" surface (`popup.mode:
 * "picker"`, guided workflow — see App.tsx's `popupSurface === "welcome"`
 * branch). The popup's header/body/footnote become this dialog's own
 * heading/subtitle/footer note in place of the plain `selector.title` +
 * privacy line, so a deployment's welcome copy still lands somewhere —
 * exactly as DesignPickerDialog's own `welcome` prop does for "tabs"
 * workflow. Unlike that dialog's two-step highlight-then-confirm flow, this
 * one keeps its ordinary single-click-applies-and-closes behaviour: picking
 * a card (design, example, or saved setup) IS the confirmation action —
 * there's no separate "Start with…" button to click afterward. No
 * `onBrowseExamples` here either — Examples is just another tab in this
 * same dialog, not a separate surface to pivot to.
 */
export interface UnifiedSelectorWelcome {
  /** Popup `header` — the dialog's heading, in place of `selector.title`. */
  heading: string;
  /** Popup `body` — a short Markdown subtitle shown under the heading. */
  subtitle: string;
  /** Popup `footnote` — replaces the footer's default privacy line when
   *  present; the default line still shows when absent. */
  footnote?: string | null;
}

interface Props {
  designs: Design[];
  design: Design;
  bundled: ParsedSet[];
  userPresets: string[];
  selectedPreset: string;
  values: Values;
  onSelectDesign: (id: string) => void;
  onApplyPreset: (values: Values, selectedId: string) => void;
  onPresetsChange: () => void;
  onClose: () => void;
  /** Which group to land on — the header trigger always opens on "designs";
   *  the welcome popup's "Browse examples" action (App.tsx's `browseExamples`)
   *  opens straight to "examples". */
  initialGroup?: SelectorGroup;
  /** See `UnifiedSelectorWelcome`'s own doc — present only for the
   *  configurable popup's first-run welcome surface. */
  welcome?: UnifiedSelectorWelcome;
}

/** Shared card shell for the Examples/Saved groups: a fixed 4:3 art box, a
 *  title line, an optional 1-2 line description (no mid-word truncation —
 *  `line-clamp-2` wraps on word boundaries, unlike a hard `truncate`), and a
 *  "current" check badge. The Designs group reuses DesignPickerDialog's own
 *  `DesignCard` instead (see the render loop below) — the two dialogs' design
 *  cards were near-verbatim duplicates.
 *
 *  Round-5 review, quality item 6: `layout` mirrors `DesignCard`'s own prop
 *  of the same name — "row" is mobile's one-column illustrated list (a
 *  larger thumbnail, the FULL title wrapping instead of truncating, an
 *  untruncated 1-2 line description), replacing what used to be a separate,
 *  near-identical `SelectorListRow` copy of this same shell. Defaults to
 *  "grid" (today's tile), so every existing caller (desktop, which never
 *  passes this) stays byte-identical. */
function SelectorCard({
  art,
  title,
  meta,
  description,
  current,
  onSelect,
  dataHook,
  layout = "grid",
}: {
  art: ReactNode;
  title: string;
  meta?: ReactNode;
  description?: string | null;
  current: boolean;
  onSelect: () => void;
  dataHook?: string;
  layout?: PickerCardLayout;
}) {
  const row = layout === "row";
  return (
    <button
      type="button"
      data-selector-card={dataHook}
      aria-current={current ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "unified-selector__card rounded-(--radius-card) border text-left shadow-(--shadow-1) transition-[border-color,box-shadow,background-color] outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        row ? "flex w-full items-center gap-3 p-2" : "flex flex-col overflow-hidden",
        current
          ? "border-primary bg-primary/10"
          : row
            ? "border-border bg-card hover:border-brand"
            : "border-border bg-card hover:border-brand hover:shadow-(--shadow-2)"
      )}
    >
      <span
        className={cn(
          "relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted",
          row ? "w-24 shrink-0 rounded-(--radius-sm)" : "w-full"
        )}
      >
        {art}
        {current && (
          <span
            className={cn(
              "unified-selector__check absolute inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground",
              row ? "top-1 right-1" : "top-1.5 right-1.5"
            )}
            aria-hidden="true"
          >
            <CheckIcon size={13} strokeWidth={3} />
          </span>
        )}
      </span>
      <span
        className={cn(
          row ? "flex min-w-0 flex-1 flex-col gap-0.5 py-1" : "flex flex-col gap-0.5 px-3 py-2",
          // Round-6 (item 6.2): the grid card's min-height was reserved
          // unconditionally, sized to fit a title + 2-line description —
          // dead space under the title on every card that has no
          // description (every Examples/preset card today, none of which
          // pass one). Only reserve it when a description is actually
          // present to clamp; `description` is optional and this shell is
          // shared with callers that never pass one at all.
          !row && description && "min-h-[4.75rem]"
        )}
      >
        {row && meta}
        <span
          className={
            row
              ? "text-[0.92rem] leading-[1.25] font-semibold text-foreground"
              : "block text-[0.85rem] leading-[1.25] font-semibold text-foreground"
          }
        >
          {title}
          {current && <span className="sr-only"> — {t("selector.current")}</span>}
        </span>
        {!row && meta}
        {description && (
          <span
            className={cn(
              "line-clamp-2 text-muted-foreground",
              row ? "text-[0.8rem] leading-[1.35]" : "text-[0.75rem] leading-[1.35]"
            )}
          >
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

// Memoized: App.tsx passes this a stable-identity `onApplyPreset` (see its
// own applySelectorPreset useCallback) alongside `onSelectDesign`/
// `onPresetsChange`/`onClose`, which were already stable — so a dialog left
// open no longer reconciles this whole card-grid tree on unrelated App
// re-renders (render ticks, output console updates, …).
function UnifiedSelectorDialogInner({
  designs,
  design,
  bundled,
  userPresets,
  selectedPreset,
  values,
  onSelectDesign,
  onApplyPreset,
  onPresetsChange,
  onClose,
  initialGroup = "designs",
  welcome,
}: Props) {
  const isMobile = useIsMobile();
  const [rawGroup, setGroup] = useState<SelectorGroup>(initialGroup);
  const [query, setQuery] = useState("");
  const [saveName, setSaveName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // m6: at first run (welcome) there's nothing saved yet — an empty "Saved
  // setups" tab just advertises a feature the visitor can't use yet (every
  // other open has at least one design chosen already). The effective group
  // is DERIVED, not corrected by an effect: if "saved" is hidden but somehow
  // still selected, fall back to "designs" inline — no throwaway render and
  // no one-frame "tab omitted from the strip but still active" mismatch.
  const savedTabHidden = welcome != null && userPresets.length === 0;
  const group: SelectorGroup = savedTabHidden && rawGroup === "saved" ? "designs" : rawGroup;

  const designRuns = useMemo(() => {
    const filtered = query.trim() ? designs.filter((d) => designMatchesQuery(d, query.trim())) : designs;
    return groupDesigns(filtered);
  }, [designs, query]);
  // m1: the search box is only ever visible on the Examples group, so gate
  // the filter on `group === "examples"` too — a query typed in the Designs
  // search must not invalidate/re-group the Examples list a tab away. Matches
  // against the same parsed title/overline the cards themselves render (see
  // presetCard.ts), not the raw preset name (which may carry the
  // "Category | Title (Badge)" scaffolding a user never sees).
  const filteredBundled = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || group !== "examples") return bundled;
    return bundled.filter((p) => {
      const { title, overline } = parsePresetCardName(p.name);
      return title.toLowerCase().includes(q) || (overline ?? "").toLowerCase().includes(q);
    });
  }, [bundled, query, group]);
  const exampleGroups = useMemo(() => groupPresetsByBadge(filteredBundled), [filteredBundled]);

  // Footer clearance (round-3 gap this pass fixes): the scroll area's own
  // bottom padding is measured to the footer's LIVE height + 24px, via the
  // same ResizeObserver-into-a-CSS-var pattern AppShell's own `dockRef` uses
  // for the export dock — never a guessed static value, so a footer that
  // grows (a longer privacy note, font scaling, …) never ends up covering
  // the last row of cards.
  const [footerH, setFooterH] = useState(0);
  const footerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setFooterH(Math.round(el.offsetHeight)));
    ro.observe(el);
    setFooterH(Math.round(el.offsetHeight));
    return () => ro.disconnect();
  }, []);

  const pickDesign = (id: string) => {
    onSelectDesign(id);
    onClose();
  };
  const pickExample = (p: ParsedSet) => {
    onApplyPreset(p.values, `bundled:${design.id}:${p.name}`);
    onClose();
  };
  const pickSaved = (name: string) => {
    const v = loadPreset(design.id, name);
    if (!v) return;
    onApplyPreset(v, `user:${design.id}:${name}`);
    onClose();
  };
  const saveCurrent = () => {
    const name = saveName.trim();
    if (!name) return;
    savePreset(design.id, name, values);
    onPresetsChange();
    setSaveName("");
  };

  // Round-5 Wave 2 (item 1): the popup-driven welcome surface's own heading,
  // in place of the plain `selector.title` every other open uses.
  const dialogTitle = welcome?.heading ?? t("selector.title");

  // m6: the "Saved setups" tab is omitted from the strip whenever it's
  // hidden (see `savedTabHidden`/`group` above) — the effective `group` can
  // never be "saved" in that case, so there's no stuck-selection to guard.
  const groups: { id: SelectorGroup; label: string }[] = [
    { id: "designs", label: t("selector.designs") },
    { id: "examples", label: t("selector.examples") },
    ...(savedTabHidden ? [] : [{ id: "saved" as const, label: t("selector.saved") }]),
  ];

  // Round-5 Wave 2 (item 2): mobile's one-column illustrated list vs.
  // desktop's 3-column card grid. Shared by both the Designs and Examples
  // groups below. Round-5 review, quality item 6: `cardLayout` drives
  // DesignCard/SelectorCard's own `layout` prop (replacing what used to be a
  // separate `isMobile ? <SelectorListRow/> : <DesignCard/|<SelectorCard/>`
  // ternary duplicated at each of the two render loops below) — computed
  // once here so the grid-class/card-shape choice can never disagree.
  const cardLayout: PickerCardLayout = isMobile ? "row" : "grid";
  const gridClass = isMobile
    ? "unified-selector__grid flex flex-col gap-2"
    : "unified-selector__grid grid grid-cols-2 gap-4 sm:grid-cols-3";

  const body = (
    <div className="unified-selector flex min-h-0 flex-1 flex-col">
      {/* Round-5 Wave 2 (item 1): the configurable popup's own subtitle
          (`welcome.subtitle`), in place of the plain `selector.title`
          heading having no explanatory line at all — mirrors
          DesignPickerDialog's own MODAL_INTRO for its welcome variant. */}
      {welcome && (
        <div className="unified-selector__intro shrink-0 px-4 pt-2 pb-1 text-[0.85rem] text-muted-foreground">
          <Markdown body={welcome.subtitle} />
        </div>
      )}
      <Tabs value={group} onValueChange={(v) => setGroup(v as SelectorGroup)} className="min-h-0 flex-1 gap-0">
        <div className="shrink-0 px-4 pt-2 pb-2">
          <TabsList className="unified-selector__groups w-full" aria-label={t("selector.groupsAria")}>
            {groups.map((g) => (
              <TabsTrigger key={g.id} value={g.id} className={cn(chipTabTrigger, "flex-1")}>
                {g.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {/* M1: the Examples/Saved groups are silently scoped to the CURRENT
            design — nothing else in the dialog says so, so switching designs
            looks like the examples/saved list just changed for no reason.
            This row names the design and offers a one-click way back to the
            Designs tab (same `setGroup` the tab strip itself uses). */}
        {(group === "examples" || group === "saved") && (
          <div className="unified-selector__scope shrink-0 flex items-center justify-between gap-2 px-4 pb-2 text-[0.8rem] text-muted-foreground">
            <span className="truncate">
              {t(group === "examples" ? "selector.scopedExamples" : "selector.scopedSaved", { design: design.label })}
            </span>
            <button
              type="button"
              className="unified-selector__change-type shrink-0 font-medium text-foreground hover:text-brand hover:underline"
              onClick={() => setGroup("designs")}
            >
              {t("selector.changeType")} <span aria-hidden="true">›</span>
            </button>
          </div>
        )}
        {(group === "designs" && designs.length > SEARCH_THRESHOLD_LOCAL) ||
        (group === "examples" && bundled.length > SEARCH_THRESHOLD_LOCAL) ? (
          <div className="shrink-0 px-4 pb-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("picker.search")}
              aria-label={t("picker.search")}
              className="unified-selector__search w-full min-w-0 rounded-(--radius-sm) border bg-transparent px-3 py-[0.35rem] text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        ) : null}

        <div
          className="unified-selector__scroll min-h-0 flex-1 overflow-y-auto px-4 pt-1"
          style={{ paddingBottom: footerH + 24 }}
        >
          {/* Round-3 review fix: each group's content is now a real Radix
              `TabsContent` (one per `SelectorGroup` value), not a plain `{group
              === "x" && …}` conditional — TabsTrigger unconditionally sets
              `aria-controls` to its own group's content id (see @radix-ui/
              react-tabs), so without a matching TabsContent for EVERY group
              (not just the active one) that id pointed at nothing, an
              axe-core `aria-valid-attr-value` violation (a dangling ID
              reference) caught by this wave's new guided-mode smoke coverage.
              TabsContent's own default behavior (unmount while inactive,
              mirroring the old conditional) keeps every other behavior here
              — including this shared scroll container's single footer-height-
              aware bottom padding — identical to before.

              Perf fix (this pass): TabsContent's CHILDREN are still ordinary
              JSX — React builds them (calls DesignCard/SelectorCard, walks
              every design/preset/saved entry) before handing them to
              TabsPrimitive.Content, which only decides AFTERWARD whether to
              render them or `null`. With three non-trivial card trees that
              meant every keystroke in the search/save-name fields rebuilt all
              three groups, not just the active one. Each TabsContent's own
              content expression is now gated on `group === "…"` so the two
              inactive groups' trees are never constructed at all — the shell
              (and its aria-controls target) stays real for all three. */}
          <TabsContent value="designs">
            {group === "designs" ? (
              designRuns.every((r) => r.items.length === 0) ? (
                <p className="px-1 py-8 text-center text-[0.85rem] text-muted-foreground">{t("picker.empty")}</p>
              ) : (
                designRuns.map((run, i) => (
                  <div key={run.group ?? `ungrouped-${i}`} className="mb-3 last:mb-0">
                    {run.group && (
                      <h3 className="mb-1.5 px-0.5 text-xs font-semibold tracking-wider text-foreground/70 uppercase">
                        {run.group}
                      </h3>
                    )}
                    <div className={gridClass}>
                      {run.items.map((d) => (
                        <DesignCard
                          key={d.id}
                          design={d}
                          // m5: at first run (welcome), nothing has been
                          // chosen yet — a pre-checked card would claim a
                          // decision the visitor hasn't made. Non-welcome
                          // opens still mark the design already in view.
                          current={!welcome && d.id === design.id}
                          welcome={false}
                          onSelect={pickDesign}
                          layout={cardLayout}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )
            ) : null}
          </TabsContent>

          <TabsContent value="examples">
            {group === "examples" ? (
              exampleGroups.length === 0 ? (
                <p className="px-1 py-8 text-center text-[0.85rem] text-muted-foreground">
                  {bundled.length === 0 ? t("selector.examplesEmpty") : t("selector.examplesNoMatch")}
                </p>
              ) : (
                exampleGroups.map((run, i) => (
                  <div key={run.badge ?? `ungrouped-${i}`} className="mb-3 last:mb-0">
                    <h3 className="mb-1.5 px-0.5 text-xs font-semibold tracking-wider text-foreground/70 uppercase">
                      {run.badge ?? t("presets.readyMade")}
                    </h3>
                    <div className={gridClass}>
                      {run.items.map((p) => {
                        const id = `bundled:${design.id}:${p.name}`;
                        const parsed = p.parsed;
                        const thumb = design.presetImages?.[p.name];
                        const art = thumb ? (
                          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <DesignArt design={design} />
                        );
                        const meta = parsed.overline && (
                          <span className="text-[0.68rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                            {parsed.overline}
                          </span>
                        );
                        const current = selectedPreset === id;
                        return (
                          <SelectorCard
                            key={p.name}
                            art={art}
                            title={parsed.title}
                            meta={meta}
                            current={current}
                            onSelect={() => pickExample(p)}
                            dataHook={`example:${p.name}`}
                            layout={cardLayout}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))
              )
            ) : null}
          </TabsContent>

          <TabsContent value="saved">
            {group === "saved" ? (
              <>
                <div className="unified-selector__save-row mb-3 flex items-center gap-2">
                  <Input
                    type="text"
                    autoComplete="off"
                    className="h-9 flex-1"
                    placeholder={t("presets.savePlaceholder")}
                    value={saveName}
                    aria-label={t("presets.saveAria")}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveCurrent();
                    }}
                  />
                  <Button type="button" size="sm" onClick={saveCurrent} disabled={!saveName.trim()}>
                    {t("presets.save")}
                  </Button>
                </div>
                {userPresets.length === 0 ? (
                  <p className="px-1 py-8 text-center text-[0.85rem] text-muted-foreground">
                    {t("selector.savedEmpty", { design: design.label })}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5" aria-label={t("presets.savedByYouAria")}>
                    {userPresets.map((name) => {
                      const id = `user:${design.id}:${name}`;
                      const isSelected = selectedPreset === id;
                      return (
                        <li key={name} className="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-selector-card={`saved:${name}`}
                            aria-pressed={isSelected}
                            onClick={() => pickSaved(name)}
                            className={cn(
                              "unified-selector__saved-item my-0 flex min-w-0 flex-1 items-center gap-2 rounded-(--radius-sm) border bg-background/40 px-3 py-2 text-left text-[0.88rem]",
                              isSelected ? "border-primary bg-primary font-medium text-primary-foreground" : "enabled:hover:border-brand"
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{name}</span>
                            {isSelected && <CheckIcon size={15} className="shrink-0" aria-hidden="true" />}
                          </button>
                          <button
                            type="button"
                            className="shrink-0 rounded-(--radius-sm) border border-transparent bg-transparent px-[0.45rem] py-[0.4rem] text-muted-foreground enabled:hover:bg-muted enabled:hover:text-warn"
                            onClick={() => setDeleteTarget(name)}
                            aria-label={t("presets.deleteAria", { name })}
                            title={t("presets.deleteTitle", { name })}
                          >
                            <TrashIcon size={14} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            ) : null}
          </TabsContent>
        </div>
      </Tabs>

      <div ref={footerCallbackRef} className="unified-selector__footer shrink-0 border-t px-4 py-3">
        {/* Round-5 Wave 2 (item 1): the popup's own footnote, in place of the
            plain privacy line, when this is the welcome surface. */}
        <p className="m-0 text-center text-[0.78rem] text-muted-foreground">
          {welcome?.footnote ?? t("selector.privacyLine")}
        </p>
      </div>
    </div>
  );

  const deleteDialog = (
    <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("presets.deleteConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("presets.deleteConfirmDescription", { name: deleteTarget ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("dialog.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (deleteTarget) {
                deletePreset(design.id, deleteTarget);
                onPresetsChange();
              }
              setDeleteTarget(null);
            }}
          >
            {t("presets.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (isMobile) {
    // Full-screen: its own fixed inset-0 shell (mirrors AppShell's mobile
    // Output console dialog — see AppShell.tsx's own comment on that pattern)
    // rather than the shared centred `Modal`, so the one-column illustrated
    // list gets the whole viewport instead of a phone-width centred card.
    return (
      <>
        <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
          <DialogContent
            showCloseButton={false}
            aria-label={dialogTitle}
            aria-describedby={undefined}
            className="unified-selector-dialog unified-selector-dialog--mobile fixed inset-0 z-50 flex flex-col gap-0 rounded-none border-0 p-0 max-w-none translate-x-0 translate-y-0 sm:max-w-none"
          >
            <DialogHeader className="flex-row items-center justify-between gap-2 border-b px-4 py-[calc(env(safe-area-inset-top,0px)+0.8rem)]">
              <DialogTitle>{dialogTitle}</DialogTitle>
              <button
                type="button"
                className="unified-selector__close inline-flex size-8 shrink-0 items-center justify-center rounded-(--radius-sm) border-none bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={onClose}
                aria-label={t("common.close")}
              >
                <XIcon size={18} />
              </button>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
        {deleteDialog}
      </>
    );
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent
          className="unified-selector-dialog flex w-[min(920px,calc(100vw-32px))] max-h-[min(760px,calc(100vh-48px))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[920px]"
          aria-label={dialogTitle}
          aria-describedby={undefined}
        >
          <DialogHeader className="flex-row items-center justify-between border-b px-4 py-[0.8rem]">
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
      {deleteDialog}
    </>
  );
}

// Only offer the Designs search box once there's enough to search — mirrors
// DesignPickerDialog's own SEARCH_THRESHOLD, kept as a smaller, independent
// literal here rather than a shared export: this dialog's grid is 3-wide at
// a wider max width, so the point past which scanning beats typing differs
// slightly from that dialog's own threshold.
const SEARCH_THRESHOLD_LOCAL = 6;

export const UnifiedSelectorDialog = memo(UnifiedSelectorDialogInner);
