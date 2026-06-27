// DesignPicker.tsx — the shadcn Select used to switch designs. Shared by the
// desktop CommandBar and the mobile top bar (each wraps it differently and
// handles the single-design fallback in its own markup).
import type { Design } from "../openscad/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface Props {
  designs: Design[];
  value: string;
  onChange: (id: string) => void;
}

export function DesignPicker({ designs, value, onChange }: Props) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        aria-label="Select design"
        className="h-7 gap-1 border-0 bg-transparent px-1 font-semibold shadow-none focus-visible:ring-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {designs.map((d) => (
          <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
