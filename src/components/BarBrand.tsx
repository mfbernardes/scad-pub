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
    />
  ) : (
    <span className={titleClassName}>{schema.title}</span>
  );
}
