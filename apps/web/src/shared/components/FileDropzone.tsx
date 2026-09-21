import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';

/**
 * Takes files from a drop, a file picker or a paste, and hands them to
 * `onFiles`. It uploads nothing, knows no endpoint, and owns no request.
 *
 * **Paste is the fastest way in.** A screenshot of a bank confirmation is
 * already in the clipboard the moment it is taken, and the alternative is
 * saving it to disk, finding it in a picker and deleting it afterwards.
 * Ctrl + V anywhere on the screen drops it here instead. Pasting text is
 * untouched — only a clipboard carrying *files* is taken.
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
  /**
   * Listen for Ctrl + V. On by default.
   *
   * Only ever one zone at a time: the most recently mounted one wins, so a
   * dialog over a screen that also has a dropzone takes the paste, and the
   * screen underneath takes it again once the dialog closes. Two uploads
   * from one keystroke is the failure this prevents.
   */
  readonly pasteable?: boolean;
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
  pasteable = true,
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

  /*
    The handler is re-subscribed whenever `onFiles` changes, which keeps the
    top of the stack pointing at a current closure rather than the first one
    this zone ever rendered — a stale `onFiles` would upload against whatever
    the form held on mount.
  */
  const latest = useRef(onFiles);
  latest.current = onFiles;

  useEffect(() => {
    if (!pasteable || inert) return undefined;

    return subscribeToPaste((files) => {
      latest.current(files);
    });
  }, [pasteable, inert]);

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

        {/*
          Said out loud, because a shortcut nobody knows about is a shortcut
          nobody uses — and this is the one that turns a screenshot into a
          document without it ever touching the disk.
        */}
        {pasteable ? (
          <Typography variant="body2" sx={{ color: 'muted.main', mt: 1.5 }}>
            {`Or paste an image from the clipboard — ${pasteShortcut()}.`}
          </Typography>
        ) : null}
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

/*
  One window listener, and the newest zone wins.

  A paste has no target the way a drop does: the event arrives at whatever
  happens to have focus, which is usually neither dropzone on the screen. So
  the zones queue up here and the last one mounted — the dialog, when one is
  open — takes it. Without that, a payout screen with its upload panel and an
  open attach dialog would store the same screenshot twice from one keystroke.
*/
type PasteHandler = (files: readonly File[]) => void;

const listening: PasteHandler[] = [];

function onWindowPaste(event: ClipboardEvent): void {
  const newest = listening[listening.length - 1];
  if (newest === undefined) return;

  const files = filesOnClipboard(event.clipboardData);
  if (files.length === 0) return;

  // Only once files are found: a text paste into a search box must reach the
  // box, and preventing it by reflex is how a paste stops working elsewhere.
  event.preventDefault();
  newest(files);
}

function subscribeToPaste(handler: PasteHandler): () => void {
  if (listening.length === 0) {
    window.addEventListener('paste', onWindowPaste);
  }
  listening.push(handler);

  return () => {
    const at = listening.lastIndexOf(handler);
    if (at !== -1) listening.splice(at, 1);
    if (listening.length === 0) {
      window.removeEventListener('paste', onWindowPaste);
    }
  };
}

/**
 * The files on a clipboard, named well enough to find again.
 *
 * `clipboardData.files` is empty in some browsers for an image copied from a
 * page, where the same bytes are on `items` — so both are read, and the
 * result de-duplicated by identity.
 *
 * A pasted screenshot arrives as `image.png` at best and nameless at worst,
 * which would fill a document list with rows nobody can tell apart and make
 * F7's filename search useless. So those get the moment they arrived instead.
 */
function filesOnClipboard(data: DataTransfer | null): readonly File[] {
  if (data === null) return [];

  const found: File[] = [...(data.files ?? [])];

  for (const item of data.items ?? []) {
    if (item.kind !== 'file') continue;

    const file = item.getAsFile();
    if (file !== null && !found.includes(file)) found.push(file);
  }

  return found.map(nameIfAnonymous);
}

const ANONYMOUS = /^(image|blob)?(\.[a-z0-9]+)?$/i;

function nameIfAnonymous(file: File): File {
  if (!ANONYMOUS.test(file.name)) return file;

  // 2026-09-21T14-05-09 — sortable, and the same shape as every other date
  // in this application.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
  const extension =
    file.name.includes('.') && !file.name.startsWith('.')
      ? file.name.slice(file.name.lastIndexOf('.') + 1)
      : (file.type.split('/')[1] ?? 'png');

  return new File([file], `pasted-${stamp}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

/** What to tell the reader to press. The keyboard differs; the feature does not. */
function pasteShortcut(): string {
  const mac = /mac|iphone|ipad/i.test(
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
  );

  return mac ? '⌘V' : 'Ctrl + V';
}
