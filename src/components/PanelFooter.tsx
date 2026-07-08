// PanelFooter.tsx — the parameter-scoped footer row: the Live-preview
// (auto-render) switch. Shared by the desktop ParamPanel (pinned under the
// whole panel) and the mobile SheetTabs (pinned inside the Parameters tab);
// only the container class differs. Reset-to-defaults used to live here too,
// but the unified preset-diff strip (PresetDiffBar, at the top of the
// Parameters tab) is now the single restore control — see that file.
import { useAppActions } from "../lib/appActions";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";

export function PanelFooter({
  autoRender,
  className,
}: {
  autoRender: boolean;
  className: string;
}) {
  const { autoRenderChange } = useAppActions();
  return (
    <div className={className}>
      {/* Live preview (auto-render) lives here, with the settings it governs,
          rather than in the output toolbar: it's a mode that's rarely toggled. */}
      <Label
        className="auto-render inline-flex cursor-pointer select-none items-center gap-[0.35rem] text-[0.85rem] font-normal text-muted-foreground hover:text-foreground"
        title="Update the preview automatically as you change settings"
      >
        <Switch checked={autoRender} onCheckedChange={autoRenderChange} aria-label="Live preview" />
        Live preview
      </Label>
    </div>
  );
}
