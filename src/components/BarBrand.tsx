// BarBrand.tsx — the top-bar brand: the config's per-theme logo when one is
// supplied, else the title text. Shared by the desktop CommandBar and the
// mobile top bar (their wrappers differ; the content is identical).
import type { Schema } from "../openscad/types";
import { assetUrl } from "../lib/assetUrl";
import { cn } from "../lib/utils";

export function BarBrand({
  schema,
  theme,
  titleClassName,
  logoClassName,
}: {
  schema: Schema;
  theme: "dark" | "light";
  /** Class for the plain-title fallback (the logo styles itself). */
  titleClassName?: string;
  /** Size override for the logo (the mobile bar renders it smaller). */
  logoClassName?: string;
}) {
  return schema.logo ? (
    <img
      className={cn("brand-logo block h-[1.6rem] w-auto", logoClassName)}
      src={assetUrl(schema.logo[theme])}
      alt={schema.title}
      width={160}
      height={32}
    />
  ) : (
    // Wordmark treatment for the plain-title fallback: display face + an
    // accent full stop — a tiny, title-agnostic brand mark that reads as
    // deliberate design rather than a default header.
    <span className={cn("font-display tracking-tight", titleClassName)}>
      {schema.title}
      <span className="text-brand" aria-hidden="true">
        .
      </span>
    </span>
  );
}
