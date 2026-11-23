import { Check, GripVertical, MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  OPTION_COLORS,
  STATUS_GROUPS,
  nextOptionColor,
  uid,
  type DatabaseSchema,
  type OptionColor,
  type Property,
  type SelectOption,
} from "../../lib/database";
import { OptionChip } from "./parts";
import { Popover } from "./Popover";

export const COLOR_NAMES: Record<OptionColor, string> = {
  default: "Default",
  gray: "Gray",
  brown: "Brown",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  red: "Red",
};

type UpdateSchema = (change: (schema: DatabaseSchema) => DatabaseSchema | void) => void;

function withProperty(schema: DatabaseSchema, propertyId: string, change: (property: Property) => void) {
  const property = schema.properties.find((p) => p.id === propertyId);
  if (property) change(property);
}

/** Edits one option: rename, recolor, delete. */
export function OptionEditor({
  anchor,
  property,
  option,
  updateSchema,
  onClose,
}: {
  anchor: HTMLElement;
  property: Property;
  option: SelectOption;
  updateSchema: UpdateSchema;
  onClose: () => void;
}) {
  const [name, setName] = useState(option.name);
  const commitName = () => {
    const clean = name.trim();
    if (!clean || clean === option.name) return;
    updateSchema((schema) =>
      withProperty(schema, property.id, (p) => {
        const target = p.options?.find((o) => o.id === option.id);
        if (target) target.name = clean;
      }),
    );
  };
  return (
    <Popover anchor={anchor} onClose={() => { commitName(); onClose(); }} placement="right-start" width={220} label="Edit option">
      <div className="db-menu">
        <div className="db-menu-pad">
          <input
            className="db-input"
            value={name}
            autoFocus
            aria-label="Option name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitName();
                onClose();
              }
            }}
          />
        </div>
        <button
          type="button"
          className="db-menu-item danger"
          onClick={() => {
            updateSchema((schema) =>
              withProperty(schema, property.id, (p) => {
                p.options = (p.options ?? []).filter((o) => o.id !== option.id);
              }),
            );
            onClose();
          }}
        >
          <Trash2 size={14} /> Delete
        </button>
        {property.type === "status" ? (
          <>
            <div className="db-menu-sep" />
            <div className="db-menu-label">Group</div>
            {STATUS_GROUPS.map((group) => (
              <button
                key={group.id}
                type="button"
                className="db-menu-item"
                onClick={() =>
                  updateSchema((schema) =>
                    withProperty(schema, property.id, (p) => {
                      const target = p.options?.find((o) => o.id === option.id);
                      if (target) target.group = group.id;
                    }),
                  )
                }
              >
                {group.name}
                {(option.group ?? "todo") === group.id ? <Check size={14} className="db-menu-check" /> : null}
              </button>
            ))}
          </>
        ) : null}
        <div className="db-menu-sep" />
        <div className="db-menu-label">Colors</div>
        {OPTION_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="db-menu-item"
            onClick={() =>
              updateSchema((schema) =>
                withProperty(schema, property.id, (p) => {
                  const target = p.options?.find((o) => o.id === option.id);
                  if (target) target.color = color;
                }),
              )
            }
          >
            <span className={`db-swatch tone-${color}`} aria-hidden />
            {COLOR_NAMES[color]}
            {option.color === color ? <Check size={14} className="db-menu-check" /> : null}
          </button>
        ))}
      </div>
    </Popover>
  );
}

interface OptionPickerProps {
  property: Property;
  /** Selected option ids. */
  selected: string[];
  multi: boolean;
  onChange: (ids: string[]) => void;
  updateSchema: UpdateSchema;
  /** Close after picking (single select). */
  onDone?: () => void;
}

/**
 * The select / multi-select / status value editor: search, pick, create and
 * edit options in place.
 */
export function OptionPicker({ property, selected, multi, onChange, updateSchema, onDone }: OptionPickerProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<{ option: SelectOption; anchor: HTMLElement } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = property.options ?? [];
  const isStatus = property.type === "status";
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => options.filter((o) => o.name.toLowerCase().includes(needle)), [options, needle]);
  const exact = options.some((o) => o.name.toLowerCase() === needle);
  const canCreate = !!needle && !exact;
  const total = filtered.length + (canCreate ? 1 : 0);

  useEffect(() => setActive(0), [needle]);
  useEffect(() => inputRef.current?.focus({ preventScroll: true }), []);

  function toggle(id: string) {
    if (multi) onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
    else {
      onChange(selected[0] === id ? [] : [id]);
      onDone?.();
    }
    setQuery("");
  }

  function create() {
    const name = query.trim();
    if (!name) return;
    const option: SelectOption = { id: uid("opt"), name, color: nextOptionColor(options), ...(isStatus ? { group: "todo" as const } : {}) };
    updateSchema((schema) =>
      withProperty(schema, property.id, (p) => {
        p.options = [...(p.options ?? []), option];
      }),
    );
    if (multi) onChange([...selected, option.id]);
    else {
      onChange([option.id]);
      onDone?.();
    }
    setQuery("");
  }

  function reorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    updateSchema((schema) =>
      withProperty(schema, property.id, (p) => {
        const list = [...(p.options ?? [])];
        const from = list.findIndex((o) => o.id === fromId);
        const to = list.findIndex((o) => o.id === toId);
        if (from < 0 || to < 0) return;
        const [moved] = list.splice(from, 1);
        list.splice(to, 0, moved);
        p.options = list;
      }),
    );
  }

  const chosen = selected.map((id) => options.find((o) => o.id === id)).filter((o): o is SelectOption => !!o);

  const renderOption = (option: SelectOption, index: number) => (
    <div
      key={option.id}
      className={`db-option-row ${index === active ? "is-active" : ""} ${dragId === option.id ? "is-dragging" : ""}`}
      role="option"
      aria-selected={selected.includes(option.id)}
      onMouseEnter={() => setActive(index)}
      onClick={() => toggle(option.id)}
      draggable={!needle}
      onDragStart={(event) => {
        setDragId(option.id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", option.id);
      }}
      onDragOver={(event) => {
        if (dragId) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (dragId) reorder(dragId, option.id);
        setDragId(null);
      }}
      onDragEnd={() => setDragId(null)}
    >
      {!needle ? <GripVertical size={13} className="db-option-grip" aria-hidden /> : null}
      <OptionChip option={option} status={isStatus} />
      {selected.includes(option.id) ? <Check size={14} className="db-option-check" aria-hidden /> : null}
      <button
        type="button"
        className="icon-button tiny db-option-more"
        aria-label={`Edit ${option.name}`}
        onClick={(event) => {
          event.stopPropagation();
          setEditing({ option, anchor: event.currentTarget });
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );

  return (
    <div className="db-option-picker">
      <div className="db-option-search">
        {chosen.map((option) => (
          <OptionChip key={option.id} option={option} status={isStatus} onRemove={() => onChange(selected.filter((id) => id !== option.id))} />
        ))}
        <input
          ref={inputRef}
          value={query}
          placeholder={chosen.length ? "" : options.length ? "Search for an option…" : "Type to create an option…"}
          aria-label="Search options"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((value) => Math.min(total - 1, value + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((value) => Math.max(0, value - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (active < filtered.length) toggle(filtered[active].id);
              else if (canCreate) create();
              else onDone?.();
            } else if (event.key === "Backspace" && !query && selected.length) {
              onChange(selected.slice(0, -1));
            }
          }}
        />
      </div>
      <div className="db-option-hint">{options.length ? (multi ? "Select options or create one" : "Select an option or create one") : "No options yet"}</div>
      <div className="db-option-list" role="listbox" aria-multiselectable={multi}>
        {isStatus && !needle
          ? STATUS_GROUPS.map((group) => {
              const members = filtered.filter((o) => (o.group ?? "todo") === group.id);
              if (!members.length) return null;
              return (
                <div key={group.id} className="db-option-group">
                  <div className="db-menu-label">{group.name}</div>
                  {members.map((option) => renderOption(option, filtered.indexOf(option)))}
                </div>
              );
            })
          : filtered.map((option, index) => renderOption(option, index))}
        {canCreate ? (
          <div
            className={`db-option-row is-create ${active === filtered.length ? "is-active" : ""}`}
            role="option"
            aria-selected={false}
            onMouseEnter={() => setActive(filtered.length)}
            onClick={create}
          >
            <span className="db-option-create">Create</span>
            <OptionChip color={nextOptionColor(options)} status={isStatus}>{query.trim()}</OptionChip>
          </div>
        ) : null}
      </div>
      {editing ? (
        <OptionEditor
          anchor={editing.anchor}
          property={property}
          option={options.find((o) => o.id === editing.option.id) ?? editing.option}
          updateSchema={updateSchema}
          onClose={() => {
            setEditing(null);
            inputRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
