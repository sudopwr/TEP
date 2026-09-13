import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useId } from 'react';

/**
 * A select whose last item adds the thing that is missing from it.
 *
 * ```tsx
 * <SelectWithCreate
 *   label="Company"
 *   value={companyId}
 *   onChange={setCompanyId}
 *   options={companies.map((c) => ({ value: String(c.id), label: c.name }))}
 *   createLabel="Add a company…"
 *   onCreate={() => { setAdding(true); }}
 *   required
 * />
 *
 * // Without `onCreate` it is an ordinary select, and no extra item appears.
 * <SelectWithCreate label="Kind" value={kind} onChange={setKind} options={KINDS} />
 * ```
 *
 * **Why the create item lives in the list.** The moment somebody needs a
 * choice that is not offered is the moment they have the dropdown open, and
 * a button elsewhere on the screen — or worse, on another screen — makes them
 * abandon a half-filled form to reach it. A divider sets the item apart, so
 * it reads as an action rather than as one more thing to pick.
 *
 * This component does not know how to create anything. It calls back; the
 * caller opens whatever it likes — a dialog, a drawer, a second form — and
 * reports the result by passing the new `value` in.
 */

export interface SelectOption {
  /** The string the caller gets back. Ids are stringified by the caller. */
  readonly value: string;
  readonly label: string;
}

export interface SelectWithCreateProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  /** The wording of the last item. Name the thing: "Add a company…". */
  readonly createLabel?: string;
  /** Omit it and the list is exactly `options` — no extra item at all. */
  readonly onCreate?: () => void;
  readonly helperText?: string;
  /** A message in the negative colour. Overrides `helperText`. */
  readonly error?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly name?: string;
  readonly fullWidth?: boolean;
}

/**
 * The value carried by the create item.
 *
 * A select reports a choice by its value, so the action needs one, and it has
 * to be a value no real option can hold. An option carrying it anyway is
 * dropped from the list rather than silently becoming the action: a caller
 * whose values look like this loses one row, instead of discovering that
 * picking one opens a dialog.
 */
const CREATE = '__create__';

export function SelectWithCreate({
  label,
  value,
  onChange,
  options,
  createLabel = 'Add new…',
  onCreate,
  helperText,
  error,
  required = false,
  disabled = false,
  autoFocus = false,
  name,
  fullWidth = true,
}: SelectWithCreateProps) {
  const fieldId = useId();
  const offered = options.filter((option) => option.value !== CREATE);

  return (
    <TextField
      select
      id={fieldId}
      label={label}
      value={value}
      {...(name === undefined ? {} : { name })}
      required={required}
      disabled={disabled}
      autoFocus={autoFocus}
      fullWidth={fullWidth}
      size="small"
      error={error !== undefined}
      helperText={error ?? helperText}
      onChange={(event) => {
        // The action is not a choice: the field keeps whatever value it had,
        // so a cancelled dialog leaves the form exactly as it was found.
        if (event.target.value === CREATE) {
          onCreate?.();
          return;
        }

        onChange(event.target.value);
      }}
    >
      {offered.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}

      {onCreate === undefined
        ? null
        : [
            <Divider key="create-divider" component="li" sx={{ my: 0.5 }} />,
            <MenuItem
              key="create"
              value={CREATE}
              sx={{ color: 'primary.main' }}
            >
              {createLabel}
            </MenuItem>,
          ]}
    </TextField>
  );
}
