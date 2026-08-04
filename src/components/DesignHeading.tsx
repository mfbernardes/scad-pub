// The design identity in a top bar: the picker (or a plain label when there is
// only one design) plus the optional "Design guide" button.
//
// Both layouts render it and both used to spell it out themselves, which
// drifted. Same precedent as ActionDock: mount it in each layout's own
// positioning context, but write the markup once.
import type { Design } from "../openscad/types";
import { DesignPicker } from "./DesignPicker";
import { BookOpen as GuideIcon } from "lucide-react";
import { IconButton } from "./IconButton";
import { t } from "../lib/i18n";
import { useLocale } from "../lib/localeStore";

export function DesignHeading({
  designs,
  designId,
  label,
  hasDoc,
  gallery,
  onChange,
  openPickerSignal,
  onShowDoc,
  docClassName,
}: {
  designs: Design[];
  designId: string;
  /** The active design's label; falls back to the id when nothing resolves. */
  label: string;
  hasDoc: boolean;
  gallery: boolean;
  onChange: (id: string) => void;
  openPickerSignal: number;
  onShowDoc: () => void;
  /** Layout-specific script hook class for the guide button. */
  docClassName: string;
}) {
  useLocale(); // subscription only: re-render this component's t() calls on a locale switch
  return (
    <>
      {designs.length > 1 ? (
        <DesignPicker
          designs={designs}
          value={designId}
          onChange={onChange}
          openSignal={openPickerSignal}
          gallery={gallery}
        />
      ) : (
        <span className="whitespace-nowrap px-[0.2rem] py-[0.3rem] text-[0.88rem] font-semibold text-foreground">
          {label}
        </span>
      )}
      {hasDoc && (
        <IconButton
          label={t("designHeading.guideLabel")}
          title={t("designHeading.guideTitle")}
          onClick={onShowDoc}
          className={`size-7 shrink-0 p-[0.3rem] ${docClassName}`}
        >
          <GuideIcon size={15} />
        </IconButton>
      )}
    </>
  );
}
