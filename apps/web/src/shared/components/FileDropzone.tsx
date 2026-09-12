import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { useId, useRef, useState, type DragEvent } from 'react';

/**
 * Takes files from a drop or a file picker and hands them to `onFiles`. It
 * uploads nothing, knows no endpoint, and owns no request.
 *
 * ```tsx
 * <FileDropzone onFiles={(files) => { setPending(files); }} />
 *
 * <FileDropzone
 *   label="Drop a statement here"
 *   accept="application/pdf,image/png"
 *   multiple
 *   onFiles={attach}
 *   progress={{ value: 62, label: 'coindcx-march.pdf' }}
 * />
 *
 * // Indeterminate: something is happening, we cannot say how much.
 * <FileDropzone onFiles={attach} progress={{ label: 'Hashing…' }} />
 *
 * <FileDropzone onFiles={attach} disabled error="That file is larger than 25MB." />
 * ```
 */

export interface DropzoneProgress {
  /** 0-100. Omit for an indeterminate bar. */
  readonly value?: number;
  readonly label?: string;
}

export interface FileDropzoneProps {
  /**
   * Called with whatever was dropped or chosen. What happens next — hashing,
   * uploading, validating — belongs to the caller. This component has no
   * opinion and no network access.
   */
  readonly onFiles: (files: readonly File[]) => void;
  readonly label?: string;
  readonly hint?: string;
  /** Passed straight to the input's `accept`. A hint to the picker, not a guard. */
  readonly accept?: string;
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  /** Present means busy: the zone stops accepting and shows a bar. */
  readonly progress?: DropzoneProgress;
  /** A message to show in the negative colour. The caller decides what is wrong. */
  readonly error?: string;
}

export function FileDropzone({
  onFiles,
  label = 'Drop a file here',
  hint,
  accept,
  multiple = false,
  disabled = false,
  progress,
  error,
}: FileDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const busy = progress !== undefined;
  const inert = disabled || busy;

  const accepting = (files: FileList | null): void => {
    if (inert || files === null || files.length === 0) return;
    onFiles(Array.from(files));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    // Without both of these the browser navigates away to the dropped file,
    // which loses whatever was on screen.
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    accepting(event.dataTransfer.files);
  };

  return (
    <Box>
      <Box
        onDragOver={(event) => {
          event.preventDefault();
          if (!inert) setOver(true);
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={onDrop}
        sx={{
          border: '1px dashed',
          borderColor: over ? 'text.primary' : 'divider',
          borderRadius: 1,
          px: 3,
          py: 4,
          textAlign: 'center',
          opacity: inert ? 0.6 : 1,
          transition: 'border-color 120ms',
        }}
      >
        <Typography sx={{ fontWeight: 600 }}>{label}</Typography>

        {hint === undefined ? null : (
          <Typography variant="body2" sx={{ color: 'muted.main', mt: 0.5 }}>
            {hint}
          </Typography>
        )}

        {/*
          A real file input, visually hidden rather than `display: none`: a
          hidden-by-display input is skipped by keyboard navigation, and
          choosing a file would become mouse-only.
        */}
        <Box
          component="input"
          ref={inputRef}
          id={inputId}
          type="file"
          multiple={multiple}
          disabled={inert}
          {...(accept === undefined ? {} : { accept })}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            accepting(event.target.files);
            // Clear, so choosing the same file twice fires change twice.
            event.target.value = '';
          }}
          sx={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            whiteSpace: 'nowrap',
          }}
        />

        <Button
          component="label"
          htmlFor={inputId}
          variant="outlined"
          disabled={inert}
          sx={{ mt: 1.5 }}
        >
          Choose a file
        </Button>
      </Box>

      {busy ? (
        <Box sx={{ mt: 1 }}>
          <LinearProgress
            {...(progress.value === undefined
              ? { variant: 'indeterminate' as const }
              : { variant: 'determinate' as const, value: progress.value })}
            aria-label={progress.label ?? 'Upload progress'}
          />
          {progress.label === undefined ? null : (
            <Typography variant="body2" sx={{ color: 'muted.main', mt: 0.5 }}>
              {progress.label}
              {progress.value === undefined
                ? null
                : ` — ${String(Math.round(progress.value))}%`}
            </Typography>
          )}
        </Box>
      ) : null}

      {error === undefined ? null : (
        <Typography
          role="alert"
          variant="body2"
          sx={{ color: 'negative.main', mt: 1 }}
        >
          {error}
        </Typography>
      )}
    </Box>
  );
}
