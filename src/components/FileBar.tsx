// FileBar.tsx: the imported-file MANAGER: it lists the files a user has
// imported (name, type, size) with a per-file remove and a "Clear all" action.
// Importing is contextual now: it happens at the control that needs the file
// (a font control's "Import font…", an SVG control's "Prepare SVG…"), so this
// surface no longer carries a generic import button; it only manages what those
// controls have added. Hosted inside FilesModal (opened from the toolbar's
// "Files" action, see BarActions.tsx). `fileImport` still gates whether the
// Files action exists at all; its optional `note` renders here as guidance.
import type { FileImport } from "../openscad/types";
import { isFontFile } from "../openscad/renderArgs";
import { isSvgFile } from "../lib/svgFiles";
import { Markdown } from "./Markdown";
import { IconButton } from "./IconButton";
import { Button } from "./ui/button";
import { t, formatNumber } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";
import { lxOpt } from "../lib/configI18n";
import { Trash2 as TrashIcon, File as FileIcon, X as XIcon } from "lucide-react";

/** A user-imported file, with its byte size for display. */
export type LoadedFile = { name: string; size: number };

interface Props {
  /** Generic file-import config, or null to hide the manager entirely. */
  fileImport: FileImport | null;
  /** Every user-supplied file currently loaded (name + byte size). */
  loadedFiles: LoadedFile[];
  /** Remove a single imported file by name. */
  onRemoveFile: (name: string) => void;
  /** Remove every imported file (and drop the render cache). */
  onClearFiles: () => void;
}

// useGrouping: false throughout — a file size is a technical readout, not
// prose: formatNumber's default grouping would render "1,024 B"/"1.024 B".
function formatSize(bytes: number): string {
  if (bytes < 1024) return t("files.sizeB", { n: formatNumber(bytes, { useGrouping: false }) });
  if (bytes < 1024 * 1024) {
    const frac = bytes < 10 * 1024 ? 1 : 0;
    return t("files.sizeKb", {
      n: formatNumber(bytes / 1024, { minimumFractionDigits: frac, maximumFractionDigits: frac, useGrouping: false }),
    });
  }
  return t("files.sizeMb", {
    n: formatNumber(bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }),
  });
}

/** The human label for a file's kind, inferred from its extension. */
function fileTypeLabel(name: string): string {
  if (isFontFile(name)) return t("files.typeFont");
  if (isSvgFile(name)) return t("files.typeSvg");
  return t("files.typeOther");
}

export function FileBar({ fileImport, loadedFiles, onRemoveFile, onClearFiles }: Props) {
  const { tag } = useLocale();
  if (!fileImport) return null;
  const note = lxOpt(fileImport.note, tag);

  return (
    <div className="file-manager flex flex-col gap-2 px-3 pt-2 pb-3">
      {note && (
        <div className="text-[0.85rem] leading-[1.4] text-muted-foreground [&_:is(p,ul)]:m-0 [&_:is(p,ul)+:is(p,ul)]:mt-2 [&_ul]:pl-[1.1rem]">
          <Markdown body={note} />
        </div>
      )}

      {loadedFiles.length === 0 ? (
        <div className="file-manager__empty flex flex-col gap-1 rounded-(--radius-sm) border border-dashed bg-muted/40 px-[0.7rem] py-4 text-[0.85rem] leading-[1.4] text-muted-foreground">
          <p className="text-foreground">{t("files.empty")}</p>
          <p>{t("files.emptyFonts")}</p>
          <p>{t("files.emptySvgs")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-[0.4rem]">
          {loadedFiles.map((f) => (
            <li
              className="flex items-center gap-2 rounded-(--radius-sm) border bg-muted px-[0.6rem] py-2"
              key={f.name}
            >
              <FileIcon size={16} className="mt-[0.15rem] shrink-0 self-start text-brand" />
              <span className="min-w-0 flex-1">
                <span
                  className="file-manager__name block text-[0.9rem] [overflow-wrap:anywhere]"
                  title={f.name}
                >
                  {f.name}
                </span>
                <span className="mt-[0.1rem] flex items-center gap-2 text-[0.78rem] text-muted-foreground">
                  <span className="rounded-(--radius-sm) border bg-card px-[0.35rem] py-[0.05rem] font-medium">
                    {fileTypeLabel(f.name)}
                  </span>
                  <span className="tabular-nums">{formatSize(f.size)}</span>
                </span>
              </span>
              <IconButton
                className="shrink-0 self-start border-transparent bg-transparent text-brand hover:border-border hover:bg-card"
                onClick={() => onRemoveFile(f.name)}
                label={t("files.remove", { name: f.name })}
                title={t("files.remove", { name: f.name })}
              >
                <XIcon size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onClearFiles}
        disabled={loadedFiles.length === 0}
      >
        <TrashIcon size={16} /> {t("files.clearAll")}
      </Button>
    </div>
  );
}
