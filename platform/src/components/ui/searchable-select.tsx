'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A labeled option. `value` is the stable key committed to `onChange`; `label` is what the user
 * sees; `keywords` (defaults to `label`) extends what the search query matches against — so an
 * option can be found by text that is not shown (e.g. an RS code as well as its name).
 */
export interface SearchableOption {
  value: string;
  label: string;
  keywords?: string;
}

/**
 * Options may be plain strings (value === label === the string, the long-standing form used by
 * admin / re-KYC forms) OR labeled `{ value, label, keywords? }` objects. Both are accepted and
 * normalised internally, so existing string[] callers are entirely unaffected.
 */
type RawOption = string | SearchableOption;

interface NormOption {
  value: string;
  label: string;
  keywords: string;
}

/** Normalise a raw option: a string → value=label=string, no extra keywords; an object → its
 *  own keywords (or none). Keywords are EXTRA search text only — the label is always searched —
 *  so leaving them empty keeps a string option's search identical to a plain label match (no
 *  self-join across a duplicated "label label" string). */
function normalizeOption(o: RawOption): NormOption {
  if (typeof o === 'string') return { value: o, label: o, keywords: '' };
  return { value: o.value, label: o.label, keywords: o.keywords ?? '' };
}

interface SearchableSelectProps {
  /** Current selected value — the option's `value` (for string options this is the string itself). */
  value: string;
  /** Called with the selected option's `value` (or '' when cleared). */
  onChange: (value: string) => void;
  /** The selectable options — plain strings or labeled `{ value, label, keywords? }` objects. */
  options: readonly RawOption[];
  placeholder?: string;
  /** Extra classes merged onto the text input (used for re-KYC flag styling). */
  className?: string;
  disabled?: boolean;
  /** Stable id prefix for option testids: `${testIdPrefix}-option-<value>`. */
  testIdPrefix?: string;
  'aria-label'?: string;
}

/**
 * Lightweight searchable combobox: a text input that filters `options` as the
 * user types, opens the list on focus, supports click + keyboard (↑/↓/Enter/Esc)
 * selection, and is clearable. The committed `value` is always a plain option
 * string (or '') — never a partial query.
 *
 * Behaviour notes:
 *  - The input mirrors the committed `value` while closed; while open the user
 *    edits a transient `query` to filter. Blurring without picking restores the
 *    committed `value` (so a half-typed query is never submitted).
 *  - Typing a string that exactly matches an option (case-insensitive) commits it.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
  disabled,
  testIdPrefix = 'searchable-select',
  'aria-label': ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Normalise every option once so the rest of the component works in a single labeled shape.
  const norm = React.useMemo(() => options.map(normalizeOption), [options]);

  // The label to show for a committed value (looked up by value; falls back to the raw value when
  // not in the list — e.g. a value that is no longer a valid option).
  const labelFor = (v: string) => norm.find((o) => o.value === v)?.label ?? v;

  // While open the input shows the transient query; while closed it mirrors the selected label.
  const display = open ? query : (value ? labelFor(value) : '');

  // Filtering matches the query against `label + ' ' + keywords` (case-insensitive) so an option
  // can be found by hidden keywords (e.g. an RS code) as well as its visible label.
  const filtered = open
    ? norm.filter((o) =>
        (o.keywords ? `${o.label} ${o.keywords}` : o.label).toLowerCase().includes(query.trim().toLowerCase()),
      )
    : norm;

  // Close on outside click — restore the committed value (drop the partial query).
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
    setQuery('');
    setHighlight(0);
    setOpen(true);
  };

  const commit = (option: NormOption) => {
    onChange(option.value);
    setOpen(false);
    setQuery('');
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setQuery('');
    setOpen(false);
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
      if (open && filtered[highlight]) commit(filtered[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
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
          placeholder={placeholder}
          value={display}
          disabled={disabled}
          onFocus={openList}
          onClick={openList}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            if (!open) setOpen(true);
            // Typing an exact (case-insensitive) match on an option's label commits its value.
            const exact = norm.find((o) => o.label.toLowerCase() === e.target.value.trim().toLowerCase());
            if (exact) onChange(exact.value);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-1 text-gray-400">
          {value && !disabled && (
            <button
              type="button"
              aria-label="Clear"
              data-testid={`${testIdPrefix}-clear`}
              onClick={clear}
              className="p-0.5 rounded hover:text-gray-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown className="h-4 w-4 pointer-events-none" />
        </div>
      </div>

      {open && (
        <ul
          role="listbox"
          data-testid={`${testIdPrefix}-list`}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">No matches</li>
          ) : (
            filtered.map((option, i) => {
              const selected = option.value === value;
              return (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={selected}
                  data-testid={`${testIdPrefix}-option-${option.value}`}
                  onMouseDown={(e) => { e.preventDefault(); commit(option); }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'flex items-center justify-between px-3 py-2 text-sm cursor-pointer select-none',
                    i === highlight ? 'bg-[var(--brand-primary)]/5 text-[var(--brand-primary)]' : 'text-gray-700',
                  )}
                >
                  <span>{option.label}</span>
                  {selected && <Check className="h-4 w-4" />}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

export default SearchableSelect;
