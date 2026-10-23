'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchableMultiSelectProps {
  /** Currently selected option strings. */
  values: string[];
  /** Called with the next selection whenever an option is toggled or all are cleared. */
  onChange: (values: string[]) => void;
  /** The list of selectable option strings. */
  options: readonly string[];
  placeholder?: string;
  /** Extra classes merged onto the text input (matches SearchableSelect's FIELD_CLASS styling). */
  className?: string;
  disabled?: boolean;
  /** Stable id prefix for testids: `${testIdPrefix}-input`, `-option-<value>`, `-chip-<value>`, `-clear`. */
  testIdPrefix?: string;
  'aria-label'?: string;
}

/**
 * Searchable MULTI-select of plain strings — a sibling of SearchableSelect for the field app's
 * Beat picker (beats are optional and a rep may pick several).
 *
 * Interaction model:
 *  - A text input filters `options` by case-insensitive substring as the user types.
 *  - Clicking an option (or Enter on the highlighted one) TOGGLES it; the list STAYS OPEN so the
 *    rep can pick several in a row. The transient query is left intact across toggles.
 *  - Selected options render as removable chips below the control; an "×" on a chip (or re-clicking
 *    the option) removes it. A "Clear all" affordance empties the selection.
 *  - Keyboard: ↑/↓ move the highlight, Enter toggles the highlighted option, Esc closes.
 *  - Empty selection is valid (the control never forces a pick). Touch-friendly tap targets.
 */
export function SearchableMultiSelect({
  values,
  onChange,
  options,
  placeholder,
  className,
  disabled,
  testIdPrefix = 'searchable-multi-select',
  'aria-label': ariaLabel,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedSet = new Set(values);

  const filtered = open
    ? options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  // Close on outside click — drop the transient query (the committed selection is unaffected).
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const openList = () => {
    if (disabled) return;
    setHighlight(0);
    setOpen(true);
  };

  // Toggle one option in/out of the selection. The list stays open for multi-pick.
  const toggle = (option: string) => {
    if (selectedSet.has(option)) {
      onChange(values.filter((v) => v !== option));
    } else {
      onChange([...values, option]);
    }
  };

  const removeChip = (option: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange(values.filter((v) => v !== option));
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
    setQuery('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { openList(); return; }
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[highlight]) toggle(filtered[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Backspace' && query === '' && values.length > 0) {
      // Backspace on an empty query removes the most recently added chip (familiar tag-input UX).
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          data-testid={`${testIdPrefix}-input`}
          className={cn('pr-16', className)}
          placeholder={values.length > 0 ? `${values.length} selected` : placeholder}
          value={open ? query : ''}
          disabled={disabled}
          onFocus={openList}
          onClick={openList}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            if (!open) setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-1 text-gray-400">
          {values.length > 0 && !disabled && (
            <button
              type="button"
              aria-label="Clear all"
              data-testid={`${testIdPrefix}-clear`}
              onClick={clearAll}
              className="p-0.5 rounded hover:text-gray-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown className="h-4 w-4 pointer-events-none" />
        </div>
      </div>

      {/* Selected chips — removable; empty selection renders nothing. */}
      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`${testIdPrefix}-chips`}>
          {values.map((v) => (
            <span
              key={v}
              data-testid={`${testIdPrefix}-chip-${v}`}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-primary)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--brand-primary)]"
            >
              {v}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${v}`}
                  data-testid={`${testIdPrefix}-chip-remove-${v}`}
                  onClick={(e) => removeChip(v, e)}
                  className="rounded-full p-0.5 hover:bg-[var(--brand-primary)]/20"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {open && (
        <ul
          role="listbox"
          aria-multiselectable="true"
          data-testid={`${testIdPrefix}-list`}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">No matches</li>
          ) : (
            filtered.map((option, i) => {
              const selected = selectedSet.has(option);
              return (
                <li
                  key={option}
                  role="option"
                  aria-selected={selected}
                  data-testid={`${testIdPrefix}-option-${option}`}
                  // Toggle on mousedown (preventDefault keeps focus on the input so the list stays open).
                  onMouseDown={(e) => { e.preventDefault(); toggle(option); }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'flex items-center justify-between px-3 py-2.5 text-sm cursor-pointer select-none',
                    i === highlight ? 'bg-[var(--brand-primary)]/5 text-[var(--brand-primary)]' : 'text-gray-700',
                  )}
                >
                  <span className="flex items-center gap-2">
                    {/* Checkbox-style indicator so multi-pick reads clearly. */}
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        selected
                          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white'
                          : 'border-gray-300 bg-white',
                      )}
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                    {option}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

export default SearchableMultiSelect;
