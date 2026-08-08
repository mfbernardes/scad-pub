// LanguageSelect.tsx: the runtime language switcher, shared by both top bars
// like BarActions' other secondary controls. Renders nothing on a
// single-locale deployment (enabledTags.length < 2, see localeStore.ts) —
// there's nothing to switch between, so no control should exist to imply
// otherwise.
//   • inline (desktop CommandBar): a compact Select, icon-button height, next
//     to ThemeToggle.
//   • collapsed (mobile top bar): a MenuRow that cycles to the next enabled
//     locale in place, naming the CURRENT one — same precedent as BarActions'
//     own theme row (label updates in place; the click is the only feedback).
import { Languages as LanguageIcon } from "lucide-react";
import { useLocale } from "../lib/localeStore";
import { useAppActions } from "../lib/appActions";
import { t } from "../lib/i18n";
import { MenuRow } from "./MenuRow";
import { ICON_BUTTON_CLASS } from "./IconButton";
import { cn } from "../lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface Props {
  /** Collapse into a MenuRow (mobile) instead of an inline Select (desktop),
   *  matching BarActions' own presentation switch. */
  collapse?: boolean;
}

export function LanguageSelect({ collapse = false }: Props) {
  const { tag, locales } = useLocale();
  const { localeChange } = useAppActions();
  if (locales.length < 2) return null;
  const index = locales.findIndex((l) => l.tag === tag);
  const current = index >= 0 ? locales[index] : locales[0];

  if (collapse) {
    const next = locales[(index + 1) % locales.length];
    return (
      <MenuRow
        label={t("lang.current", { name: current.label })}
        icon={<LanguageIcon size={16} />}
        onClick={() => localeChange(next.tag)}
      />
    );
  }

  return (
    <Select value={tag} onValueChange={localeChange}>
      <SelectTrigger
        size="sm"
        aria-label={t("lang.label")}
        title={t("lang.current", { name: current.label })}
        className={cn(
          ICON_BUTTON_CLASS,
          "lang-select inline-flex w-auto items-center gap-1 border bg-muted px-[0.4rem] text-xs font-semibold uppercase shadow-none hover:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
        )}
      >
        <LanguageIcon size={14} aria-hidden="true" />
        <SelectValue>{tag}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {locales.map((l) => (
          <SelectItem key={l.tag} value={l.tag}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
