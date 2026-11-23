import {
  AlignLeft,
  AtSign,
  Calendar,
  CalendarDays,
  CircleChevronDown,
  Clock,
  Hash,
  History,
  LayoutGrid,
  Link,
  List,
  Loader,
  Phone,
  Rows3,
  SquareCheck,
  SquareKanban,
  Table2,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { TITLE_ID, type OptionColor, type Property, type PropertyType, type SelectOption, type ViewType } from "../../lib/database";

const typeIcons: Record<PropertyType, LucideIcon> = {
  text: AlignLeft,
  number: Hash,
  select: CircleChevronDown,
  multiSelect: List,
  status: Loader,
  date: Calendar,
  checkbox: SquareCheck,
  url: Link,
  email: AtSign,
  phone: Phone,
  createdTime: Clock,
  lastEdited: History,
};

export function PropertyIcon({ property, type, size = 14 }: { property?: Property; type?: PropertyType; size?: number }) {
  if (property?.id === TITLE_ID) return <Type size={size} className="db-prop-icon" aria-hidden />;
  const Icon = typeIcons[type ?? property?.type ?? "text"] ?? AlignLeft;
  return <Icon size={size} className="db-prop-icon" aria-hidden />;
}

const viewIcons: Record<ViewType, LucideIcon> = {
  table: Table2,
  board: SquareKanban,
  gallery: LayoutGrid,
  list: Rows3,
  calendar: CalendarDays,
};

export function ViewIcon({ type, size = 14 }: { type: ViewType; size?: number }) {
  const Icon = viewIcons[type] ?? Table2;
  return <Icon size={size} aria-hidden />;
}

export function OptionChip({
  option,
  color,
  children,
  onRemove,
  status,
}: {
  option?: SelectOption;
  color?: OptionColor;
  children?: ReactNode;
  onRemove?: () => void;
  status?: boolean;
}) {
  const tone = option?.color ?? color ?? "default";
  return (
    <span className={`db-chip tone-${tone} ${status ? "is-status" : ""}`}>
      {status ? <span className="db-chip-dot" aria-hidden /> : null}
      <span className="db-chip-label">{children ?? option?.name ?? ""}</span>
      {onRemove ? (
        <button
          type="button"
          className="db-chip-remove"
          aria-label={`Remove ${option?.name ?? ""}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
