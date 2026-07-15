// pauseReason.ts — display text for useRenderPipeline's `pauseReason` (see
// renderState.ts's PauseReason doc). Shared by StaleBanner's explanation line
// and AppShell's Messages notice row so the two surfaces can never drift out
// of sync with each other's wording.
import { t } from "./i18n";
import type { PauseReason } from "./renderState";

export function pauseReasonText(reason: Exclude<PauseReason, null>): string {
  return reason === "heavy" ? t("stale.pauseReason.heavy") : t("stale.pauseReason.manualDesign");
}
