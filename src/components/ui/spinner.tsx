import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/localeStore";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  useLocale(); // subscription only: re-render this component's t() call on a locale switch
  return (
    <Loader2Icon
      role="status"
      aria-label={t("common.loading")}
      className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

export { Spinner };
