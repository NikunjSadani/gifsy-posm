'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchableSelectProps {
  /** Current selected value (a plain string — the option text). */
  value: string;
  /** Called with the selected option string (or '' when cleared). */
  onChange: (value: string) => void;
  /** The list of selectable option strings. */
  options: readonly string[];
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

  // While open the input shows the transient query; while closed it mirrors value.
  const display = open ? query : value;

  const filtered = open
    ? options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

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

  const commit = (option: string) => {
    onChange(option);
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
            // Typing an exact (case-insensitive) match commits it immediately.
            const exact = options.find((o) => o.toLowerCase() === e.target.value.trim().toLowerCase());
            if (exact) onChange(exact);
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
              const selected = option === value;
              return (
                <li
                  key={option}
                  role="option"
                  aria-selected={selected}
                  data-testid={`${testIdPrefix}-option-${option}`}
                  onMouseDown={(e) => { e.preventDefault(); commit(option); }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'flex items-center justify-between px-3 py-2 text-sm cursor-pointer select-none',
                    i === highlight ? 'bg-[var(--brand-primary)]/5 text-[var(--brand-primary)]' : 'text-gray-700',
                  )}
                >
                  <span>{option}</span>
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
