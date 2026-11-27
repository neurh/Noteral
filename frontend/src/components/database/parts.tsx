import { PageIcon } from "../PageIcon";
import {
  AlignLeft,
  Blocks,
  ChartColumn,
  Sigma,
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
  Puzzle,
  Rows3,
  SquareCheck,
  SquareKanban,
  Table2,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { contributions } from "../../lib/contributions";
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
  formula: Sigma,
  custom: Puzzle,
};

export function PropertyIcon({ property, type, size = 14 }: { property?: Property; type?: PropertyType; size?: number }) {
  if (property?.id === TITLE_ID) return <Type size={size} className="db-prop-icon" aria-hidden />;
  if (property?.type === "custom" && property.customType) {
    const icon = contributions.current().propertyTypeMap.get(property.customType)?.icon;
    if (icon) return <span className="db-prop-icon"><PageIcon value={icon} size={size} /></span>;
  }
  const Icon = typeIcons[type ?? property?.type ?? "text"] ?? AlignLeft;
  return <Icon size={size} className="db-prop-icon" aria-hidden />;
}

const viewIcons: Record<ViewType, LucideIcon> = {
  table: Table2,
  board: SquareKanban,
  gallery: LayoutGrid,
  list: Rows3,
  calendar: CalendarDays,
  chart: ChartColumn,
  custom: Blocks,
};

export function ViewIcon({ type, size = 14 }: { type: ViewType; size?: number }) {
  const Icon = viewIcons[type] ?? Table2;
  return <Icon size={size} aria-hidden />;
}

/** A view's own icon when it has one, otherwise its layout icon. */
export function ViewGlyph({ view, size = 14 }: { view: { type: ViewType; icon?: string }; size?: number }) {
  if (!view.icon) return <ViewIcon type={view.type} size={size} />;
  return (
    <span className="db-view-glyph" aria-hidden>
      <PageIcon value={view.icon} size={size} fallback={<ViewIcon type={view.type} size={size} />} />
    </span>
  );
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
