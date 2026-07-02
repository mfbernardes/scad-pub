// BarBrand.tsx — the top-bar brand: the config's per-theme logo when one is
// supplied, else the title text. Shared by the desktop CommandBar and the
// mobile top bar (their wrappers differ; the content is identical).
import type { Schema } from "../openscad/types";
import { assetUrl } from "../lib/assetUrl";

export function BarBrand({
  schema,
  theme,
  titleClassName,
}: {
  schema: Schema;
  theme: "dark" | "light";
  /** Class for the plain-title fallback (the logo styles itself). */
  titleClassName?: string;
}) {
  return schema.logo ? (
    <img className="brand-logo" src={assetUrl(schema.logo[theme])} alt={schema.title} />
  ) : (
    <span className={titleClassName}>{schema.title}</span>
  );
}
