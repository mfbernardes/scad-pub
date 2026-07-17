// FileBar.tsx — the Files tab: schema-driven task cards instead of one
// generic file manager mixing unrelated jobs (PR19 item 1). The ACTIVE
// design's own params decide which cards show (deriveFilesCards — see
// src/lib/filesCards.ts): a font card only for a design with `@font` params,
// an SVG/graphics card only for one with `@svg` params. A design with
// neither shows only the always-available "Other files" card. When the
// design's SELECTED font isn't loaded, the font card leads with that state
// instead of its default blurb — reusing `attention`'s font-fallback items
// (src/lib/readiness.ts), the exact same predicate the Customize tab's
// attention chip and ParamRows' inline FontMissingHint already use, so the
// three surfaces can never disagree about what "missing" means. The stored-
// files list, Clear action and an on-device privacy line stay at the bottom.
// All copy is i18n (font/SVG cards) or config-driven (`fileImport.note` /
// `.label`, scoped to the "Other files" card — see FileImport's own doc). The
// `fileImport` config gate still governs the whole tab.
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { Design, FileImport } from "../openscad/types";
import type { AttentionItem } from "../lib/readiness";
import { deriveFilesCards, missingFontFamilies } from "../lib/filesCards";
import { formatBytes } from "../lib/loadPhase";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { FileInput } from "./FileInput";
import { FontImportActions } from "./FontImportActions";
import { Markdown } from "./Markdown";
import { IconButton } from "./IconButton";
import { Button } from "./ui/button";
import {
  Folder as FolderIcon,
  Trash2 as TrashIcon,
  File as FileIcon,
  X as XIcon,
  Type as FontCardIcon,
  Image as SvgCardIcon,
} from "lucide-react";

/** A user-imported file, with its byte size for display. */
export type LoadedFile = { name: string; size: number };

interface Props {
  /** The active design — its params decide which task cards show (see
   *  deriveFilesCards). */
  design: Design;
  /** Generic file-import config, or null to hide the control entirely. */
  fileImport: FileImport | null;
  /** Every user-supplied file currently loaded (name + byte size). */
  loadedFiles: LoadedFile[];
  /** Production-readiness attention items (src/lib/readiness.ts) — only the
   *  font-fallback entries are read, to lead the font card with a "not
   *  loaded" state naming the selected family. */
  attention: AttentionItem[];
  onAddFile: (name: string, bytes: Uint8Array) => void;
  /** Remove a single imported file by name. */
  onRemoveFile: (name: string) => void;
  /** Remove every imported file (and drop the render cache). */
  onClearFiles: () => void;
}

/** Shared task-card chrome: an icon, freeform body content, and (usually) an
 *  Import action. `lead` styles it like ParamRows' FontMissingHint (an amber
 *  left border) for the one state that actually needs attention right now —
 *  every other card is a plain neutral block. */
function TaskCard({
  icon,
  lead = false,
  className,
  children,
}: {
  icon: ReactNode;
  lead?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      role={lead ? "status" : undefined}
      className={cn(
        "file-card flex flex-col gap-2 rounded-(--radius-sm) border px-3 py-2.5",
        lead ? "border-l-[3px] border-l-warn bg-muted" : "bg-muted/40",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-[0.1rem] shrink-0 text-brand" aria-hidden="true">
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
      </div>
    </section>
  );
}

export function FileBar({ design, fileImport, loadedFiles, attention, onAddFile, onRemoveFile, onClearFiles }: Props) {
  if (!fileImport) return null;

  const { showFontCard, showSvgCard } = deriveFilesCards(design.params);
  const missingFamily = missingFontFamilies(attention)[0] ?? null;

  const importFile = async (file: File) => {
    // Reject an over-cap upload before reading it — a friendly toast, no store.
    if (fileImport.maxBytes !== undefined && file.size > fileImport.maxBytes) {
      toast.error(
        t("files.tooLarge", { name: file.name, size: formatBytes(file.size), limit: formatBytes(fileImport.maxBytes) }),
        { id: "file-too-large" }
      );
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    onAddFile(file.name, bytes);
  };

  return (
    <div className="file-manager flex flex-col gap-2 px-3 pt-2 pb-3">
      {showFontCard && (
        <TaskCard icon={<FontCardIcon size={16} />} lead={missingFamily !== null}>
          <p className="m-0 text-[0.83rem] leading-[1.4] text-foreground">
            {missingFamily
              ? t("files.fontCardMissing", { family: missingFamily })
              : t("files.fontCardBody")}
          </p>
          <FontImportActions
            onImportFile={importFile}
            className=""
            renderImport={(open) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                title={t("files.fontCardImportTitle")}
                onClick={open}
              >
                <FolderIcon size={14} /> {t("files.fontCardImport")}
              </Button>
            )}
          />
        </TaskCard>
      )}

      {showSvgCard && (
        <TaskCard icon={<SvgCardIcon size={16} />}>
          <p className="m-0 text-[0.83rem] leading-[1.4] text-foreground">{t("files.svgCardBody")}</p>
          <FileInput accept=".svg,image/svg+xml" onFile={importFile}>
            {(open) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                title={t("files.svgCardImportTitle")}
                onClick={open}
              >
                <FolderIcon size={14} /> {t("files.svgCardImport")}
              </Button>
            )}
          </FileInput>
        </TaskCard>
      )}

      {/* Always available, deliberately demoted below the schema-specific
          cards above (a plain block, no icon/lead treatment) — the catch-all
          for whatever a design's `import()`/`surface()` calls reference by a
          plain filename. `fileImport.note`/`.label` (config overrides) scope
          to this card specifically now — see FileImport's own doc. */}
      <section className="file-manager__data flex flex-col gap-2 rounded-(--radius-sm) border border-dashed px-3 py-2">
        <div className="text-[0.8rem] leading-[1.4] text-muted-foreground [&_:is(p,ul)]:m-0 [&_:is(p,ul)+:is(p,ul)]:mt-2 [&_ul]:pl-[1.1rem]">
          <Markdown body={fileImport.note ?? t("files.dataCardBody")} />
        </div>
        <FileInput accept={fileImport.accept} onFile={importFile}>
          {(open) => (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              title={t("files.importTitle")}
              onClick={open}
            >
              <FolderIcon size={14} /> {fileImport.label ?? t("files.importDefaultLabel")}…
            </Button>
          )}
        </FileInput>
      </section>

      {loadedFiles.length > 0 && (
        <ul className="flex flex-col gap-[0.4rem]">
          {loadedFiles.map((f) => (
            <li
              className="flex items-center gap-2 rounded-(--radius-sm) border bg-muted px-[0.6rem] py-2"
              key={f.name}
            >
              <FileIcon size={16} className="shrink-0 text-brand" />
              <span className="file-manager__name min-w-0 flex-1 truncate text-[0.9rem]" title={f.name}>
                {f.name}
              </span>
              <span className="shrink-0 text-[0.82rem] text-muted-foreground tabular-nums">
                {formatBytes(f.size)}
              </span>
              <IconButton
                className="shrink-0 border-transparent bg-transparent text-brand hover:border-border hover:bg-card"
                onClick={() => onRemoveFile(f.name)}
                label={t("files.removeAria", { name: f.name })}
                title={t("files.removeAria", { name: f.name })}
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
        title={t("files.clearAllTitle")}
        onClick={onClearFiles}
        disabled={loadedFiles.length === 0}
      >
        <TrashIcon size={16} /> {t("files.clearAll")}
      </Button>

      <p className="file-manager__privacy m-0 text-center text-[0.75rem] text-muted-foreground">
        {t("files.privacyLine")}
      </p>
    </div>
  );
}
