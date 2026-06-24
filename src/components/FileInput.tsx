// FileInput.tsx — a hidden <input type="file"> plus a caller-supplied trigger.
// `children` receives an `open()` callback to wire onto any button.
import { useRef, type ReactNode } from "react";

interface Props {
  accept: string;
  onFile: (file: File) => void;
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
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
    </>
  );
}
