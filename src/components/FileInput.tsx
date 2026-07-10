// FileInput.tsx — a hidden <input type="file"> plus a caller-supplied trigger.
// `children` receives an `open()` callback to wire onto any button.
import { useRef, type ReactNode } from "react";
import { toast } from "sonner";

interface Props {
  /** `accept` filter for the picker; omit to allow any file type. */
  accept?: string;
  onFile: (file: File) => void | Promise<void>;
  children: (open: () => void) => ReactNode;
}

export function FileInput({ accept, onFile, children }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      {children(() => ref.current?.click())}
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Clear the input's value so picking the *same* file again still fires
          // a change event (the browser only fires on a value change otherwise),
          // so every import flow (fonts, SVG wizard, preset import) works on retry.
          e.target.value = "";
          if (!file) return;
          Promise.resolve(onFile(file)).catch((err) => {
            toast.error(`Couldn't read "${file.name}": ${err instanceof Error ? err.message : String(err)}`);
          });
        }}
      />
    </>
  );
}
