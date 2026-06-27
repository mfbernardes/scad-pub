import { Toaster as Sonner, type ToasterProps } from "sonner";

// App-themed Sonner: the project resolves its own theme (data-theme) rather than
// using next-themes, so the caller passes the resolved theme. Toast surfaces use
// the existing palette variables, so they follow the active theme automatically.
function Toaster({ theme = "dark", ...props }: ToasterProps) {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-center"
      style={
        {
          "--normal-bg": "var(--panel)",
          "--normal-text": "var(--text)",
          "--normal-border": "var(--line)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
