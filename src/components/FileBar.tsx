// FileBar.tsx — the Files tab: exactly two schema-driven task cards, one per
// job, instead of one generic file manager mixing unrelated jobs (PR19 item
// 1; simplified from three cards to two in the round-2 review pass — the
// previous standalone "Other files" catch-all is gone). The ACTIVE design's
// own params — plus, for the graphic card, the `fileImport` config — decide
// which cards show (deriveFilesCards — see src/lib/filesCards.ts): a font
// card only for a design with `@font` params, a graphic card only for one
// with `@svg` params or a `fileImport.accept` that still admits SVGs. When
// the design's SELECTED font isn't loaded, the font card leads with that
// state instead of its default blurb AND offers a second "Choose bundled
// font" action beside Import — reusing `attention`'s font-fallback items
// (src/lib/readiness.ts), the exact same predicate (and, for the fallback
// action, the exact same one-click substitution) the Customize tab's
// warning-card surfaces (AttentionItems.tsx) already use, so the two
// surfaces can never disagree about what "missing" means or how to fix it.
// The stored-files
// list, Clear action and one shared on-device privacy line stay compact at
// the bottom. Font-card copy is fixed i18n; the graphic card's body is
// config-driven (`fileImport.note`, rendered INSIDE the card, replacing its
// default one-liner — see FileImport's own doc) and its picker `accept` is
// `fileImport.accept` narrowed to SVG-relevant tokens (graphicAccept). The
// `fileImport` config gate still governs the whole tab.
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { Design, FileImport } from "../openscad/types";
import type { AttentionItem, FontFallbackItem } from "../lib/readiness";
import { deriveFilesCards, graphicAccept, missingFontFamilies } from "../lib/filesCards";
import { formatBytes } from "../lib/loadPhase";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { useAppActions } from "../lib/appActions";
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
  Image as GraphicCardIcon,
} from "lucide-react";

/** A user-imported file, with its byte size for display. */
export type LoadedFile = { name: string; size: number };

/**
 * The imported-files list + "Clear all" + the shared on-device privacy line —
 * factored out of FileBar so guided workflow's "Imported files" overflow
 * screen (ImportedFilesModal.tsx, opened from the mobile header's ⋮ menu /
 * the desktop command bar) can reuse the EXACT same list/remove/clear markup
 * and hook classes (`.file-manager`, `.file-manager__name`,
 * `.file-manager__privacy`) without also pulling in the two task cards
 * (which move inline to their own param controls in guided mode — see
 * FontSelect's in-dropdown import row and SvgPrepareControl's own drop
 * zone). FileBar itself still renders this at the end of its own markup, so
 * "tabs" workflow's Files tab is completely unchanged.
 */
export function ImportedFilesList({
  loadedFiles,
  onRemoveFile,
  onClearFiles,
}: {
  loadedFiles: LoadedFile[];
  onRemoveFile: (name: string) => void;
  onClearFiles: () => void;
}) {
  return (
    <div className="file-manager flex flex-col gap-2">
      {loadedFiles.length > 0 ? (
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
      ) : (
        <div className="px-[0.4rem] py-2 text-[0.85rem] text-muted-foreground">
          <p className="m-0">{t("files.importedEmpty")}</p>
          <p className="m-0 mt-1">{t("files.importedEmptyHint")}</p>
        </div>
      )}

      {/* Round-5 Wave 2 (item 8): hidden rather than merely disabled when
          there's nothing to clear — a large full-width outlined button that
          can never do anything read as dead chrome; the empty-state message
          above already covers "there's nothing here" on its own. */}
      {loadedFiles.length > 0 && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          title={t("files.clearAllTitle")}
          onClick={onClearFiles}
        >
          <TrashIcon size={16} /> {t("files.clearAll")}
        </Button>
      )}

      <p className="file-manager__privacy m-0 text-center text-[0.75rem] text-muted-foreground">
        {t("files.privacyLine")}
      </p>
    </div>
  );
}

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
 *  Import action. `lead` styles it like AttentionItems.tsx's warning card (an amber
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
  const { change } = useAppActions();
  if (!fileImport) return null;

  const { showFontCard, showGraphicCard } = deriveFilesCards(design.params, fileImport);
  const missingFamily = missingFontFamilies(attention)[0] ?? null;
  // The first missing font-fallback item, if any — same predicate as above,
  // just keeping the whole item (not just its family name) so the card can
  // offer a one-click "Choose bundled font" alongside Import, exactly like
  // AttentionItems.tsx's "Use a bundled font" (same underlying fontChoices.ts
  // fallback, a different label to fit this card's compact action pair).
  const missingItem = attention.find(
    (item): item is FontFallbackItem => item.kind === "font-fallback"
  );

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
            className="flex gap-2"
            renderImport={(open) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                title={t("files.fontCardImportTitle")}
                onClick={open}
              >
                <FolderIcon size={14} /> {t("files.fontCardImport")}
              </Button>
            )}
            // "Choose bundled font": the same one-click loaded-family
            // substitution AttentionItems.tsx's "Use a bundled font" offers
            // (fontChoices.ts's fontFallback, via the SAME attention item),
            // just with this card's own compact label. Only offered while a
            // fallback actually exists for the missing param (an enum with no
            // loaded choice has none) — Import alone still covers that case.
            renderFallback={
              missingItem?.fallback
                ? () => (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      title={t("files.fontCardUseBundledTitle")}
                      onClick={() => change(missingItem.param, missingItem.fallback!.value)}
                    >
                      {t("files.fontCardUseBundled")}
                    </Button>
                  )
                : undefined
            }
          />
        </TaskCard>
      )}

      {showGraphicCard && (
        <TaskCard icon={<GraphicCardIcon size={16} />}>
          {/* `fileImport.note` (config override) replaces the default
              one-liner entirely rather than appending to it — a design
              deployment that needs more specific graphic-import guidance
              (which filename to reference, etc.) says so once, here, instead
              of stacking a second explanatory paragraph under a fixed one. */}
          <div className="text-[0.83rem] leading-[1.4] text-foreground [&_:is(p,ul)]:m-0 [&_:is(p,ul)+:is(p,ul)]:mt-2 [&_ul]:pl-[1.1rem]">
            <Markdown body={fileImport.note ?? t("files.graphicCardBody")} />
          </div>
          <FileInput accept={graphicAccept(fileImport.accept)} onFile={importFile}>
            {(open) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                title={t("files.graphicCardImportTitle")}
                onClick={open}
              >
                <FolderIcon size={14} /> {fileImport.label ?? t("files.graphicCardImport")}
              </Button>
            )}
          </FileInput>
        </TaskCard>
      )}

      <ImportedFilesList loadedFiles={loadedFiles} onRemoveFile={onRemoveFile} onClearFiles={onClearFiles} />
    </div>
  );
}
