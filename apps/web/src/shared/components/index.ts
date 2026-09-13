/**
 * The shared component library.
 *
 * Every component here knows nothing about payouts, fees, transactions or
 * settlements. They take props, render, and call callbacks; none of them
 * fetches anything or imports from `features/`. Both rules are enforced by
 * `no-feature-imports` and `no-fetch-in-shared` in eslint.config.js.
 */
export { AmountField, isPartialDecimal } from './AmountField';
export type { AmountFieldProps } from './AmountField';

export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';

export { CurrencyChip } from './CurrencyChip';
export type { CurrencyChipProps } from './CurrencyChip';

export { DataTable } from './DataTable';
export type {
  Column,
  DataTableProps,
  SortDirection,
  SortValue,
} from './DataTable';

export { EmptyState } from './EmptyState';
export type { EmptyStateAction, EmptyStateProps } from './EmptyState';

export { ErrorBoundary } from './ErrorBoundary';
export type { ErrorBoundaryProps } from './ErrorBoundary';

export { ErrorState } from './ErrorState';
export type { ErrorStateProps } from './ErrorState';

export { FileDropzone } from './FileDropzone';
export type { DropzoneProgress, FileDropzoneProps } from './FileDropzone';

export {
  DEFAULT_LOCALE,
  InvalidMinorAmountError,
  MoneyDisplay,
  formatMinor,
  scaleFor,
} from './MoneyDisplay';
export type { MoneyDisplayProps, MoneyTone } from './MoneyDisplay';

export { PasswordField } from './PasswordField';
export type { PasswordFieldProps, PasswordStrength } from './PasswordField';

export { SelectWithCreate } from './SelectWithCreate';
export type { SelectOption, SelectWithCreateProps } from './SelectWithCreate';

export { StatCard } from './StatCard';
export type { StatCardProps, StatDelta } from './StatCard';

export { TreeView } from './TreeView';
export type { TreeNodeContext, TreeViewProps } from './TreeView';

export { UserMenu } from './UserMenu';
export type { UserMenuItem, UserMenuProps } from './UserMenu';
