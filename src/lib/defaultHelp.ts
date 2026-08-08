// defaultHelp.ts: the generic, project-agnostic help shown when a config does
// not supply its own `help`. It documents only universal configurator features
// (no design-specific wording), in the Markdown subset the Markdown component
// renders, and speaks to a non-technical maker: no OpenSCAD knowledge assumed.
// A deployment can override any of this via `help` in its config.
//
// The prose lives in the catalogue (`helpDefault.intro`, `helpDefault.s1..s9`
// in src/locales/*.json), not here, so it goes through the same translation
// pipeline as the rest of the chrome; `defaultHelp()` just assembles it into
// `HelpContent` at call time (never at module scope, so it keeps resolving
// through the active locale after a runtime switch, see i18n.ts's `rebind`).
//
// This is PROSE ABOUT THE UI, so it goes stale silently: nothing type-checks a
// sentence against the component it describes. When a control moves, is renamed,
// or changes layout, fix EVERY shipped locale's catalogue entry in the same
// commit. Two recurring traps:
//   • Several controls live in different places per layout. Live preview, Save
//     image, theme, Help, licenses and Files are top-bar/panel items on desktop
//     and sit behind the mobile top bar's "⋮" overflow (BarActions). Say both,
//     or the instruction is wrong for half the visitors.
//   • Names here must be the strings the visitor actually sees, IN THAT
//     LOCALE: the catalogue (src/locales/<tag>.json) for anything routed
//     through t()/tn(), the component otherwise. A German body that tells a
//     visitor to press "Update" is wrong once de.json renders that button as
//     "Aktualisieren" — translate the control names too, not just the
//     surrounding sentence. The tab names are the exception: `strings["presets.title"]` /
//     `strings["settings.title"]` can rename them, but a config that renames
//     tabs supplies its own `help` too, so the defaults are the right thing to
//     name.
import type { HelpContent } from "../openscad/types";
import { t } from "./i18n";

export function defaultHelp(): HelpContent {
  return {
    intro: t("helpDefault.intro"),
    sections: [
      { title: t("helpDefault.s1.title"), body: t("helpDefault.s1.body") },
      { title: t("helpDefault.s2.title"), body: t("helpDefault.s2.body") },
      { title: t("helpDefault.s3.title"), body: t("helpDefault.s3.body") },
      { title: t("helpDefault.s4.title"), body: t("helpDefault.s4.body") },
      { title: t("helpDefault.s5.title"), body: t("helpDefault.s5.body") },
      { title: t("helpDefault.s6.title"), body: t("helpDefault.s6.body") },
      { title: t("helpDefault.s7.title"), body: t("helpDefault.s7.body") },
      { title: t("helpDefault.s8.title"), body: t("helpDefault.s8.body") },
      { title: t("helpDefault.s9.title"), body: t("helpDefault.s9.body") },
    ],
  };
}
