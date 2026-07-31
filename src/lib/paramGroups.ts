// paramGroups.ts: the single source of truth for a design's VISIBLE parameter
// sections. It is the exact filter ParamForm applies to build its <details>
// groups, extracted so a second consumer (the "Jump to section" navigator in
// ParamPanel/SheetTabs) can derive its option list from the SAME computation
// and never disagree with the form: a section the form doesn't render must
// never appear in the navigator, and vice versa. Given the same design/values/
// search/showAdvanced, both call this and get identical section lists.
import type { Design, Param } from "../openscad/types";
import type { Values } from "./presets";
import { isVisible } from "./visibility";

export interface VisibleGroup {
  section: string;
  params: Param[];
}

export interface VisibleGroupsOptions {
  /** Search query (case-insensitive); matches a param's name, description, or
   *  full help text, so a term that only appears in the detail still matches. */
  search?: string;
  /** Include `@advanced` params. false hides them: the essentials view. */
  showAdvanced?: boolean;
}

/**
 * The design's sections that currently hold at least one visible parameter, in
 * declaration order. Each section's params are filtered by advanced-state,
 * their own `@showIf` visibility, and the search query; sections left empty are
 * dropped. `[Hidden]` sections were already excluded at build time (params.mjs),
 * so there's nothing to do for them here.
 */
export function visibleGroups(
  design: Design,
  values: Values,
  { search = "", showAdvanced = true }: VisibleGroupsOptions = {}
): VisibleGroup[] {
  const q = search.toLowerCase();
  return design.sections
    .map((section) => ({
      section,
      params: design.params.filter(
        (p) =>
          p.section === section &&
          (showAdvanced || !p.advanced) &&
          isVisible(p, values) &&
          (!q ||
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.help.toLowerCase().includes(q))
      ),
    }))
    .filter((g) => g.params.length > 0);
}
