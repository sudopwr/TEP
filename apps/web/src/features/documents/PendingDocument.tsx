import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { formatBytes } from './DocumentPreview';

/**
 * F26 — the file that is about to be stored, named before it is.
 *
 * Upload used to happen the instant a file was chosen, which was fine while
 * every file came from a disk and already had the name its owner gave it. It
 * stopped being fine with F25: a pasted screenshot arrives as `image.png` or
 * as nothing at all, and the name it is stored under is the name it keeps —
 * it is what the trail shows, what a reader recognises a year later, and what
 * F7's search matches on. So the file waits here, named, until somebody says
 * to go ahead.
 *
 * The name is the only thing editable. Everything else about the file — its
 * bytes, its type, its size — is what it is, and shown rather than offered.
 */

export interface PendingDocumentProps {
  /** What was dropped, chosen or pasted. */
  readonly file: File;
  /** Sent with the name as it now reads. */
  readonly onConfirm: (file: File) => void;
  readonly onDiscard: () => void;
  /** The wording of the button: "Attach document", "Upload". */
  readonly confirmLabel?: string;
  readonly busy?: boolean;
}

export function PendingDocument({
  file,
  onConfirm,
  onDiscard,
  confirmLabel = 'Attach document',
  busy = false,
}: PendingDocumentProps) {
  const [name, setName] = useState(file.name);

  const trimmed = name.trim();
  const empty = trimmed === '';

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 2,
        mb: 2,
      }}
    >
      <Typography variant="label" component="h3" sx={{ display: 'block' }}>
        Ready to attach
      </Typography>

      <Box
        sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mt: 1.5 }}
      >
        <TextField
          label="Filename"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          fullWidth
          size="small"
          autoFocus
          disabled={busy}
          error={empty}
          helperText={
            empty
              ? 'A document needs a name.'
              : `${formatBytes(file.size)} · ${file.type === '' ? 'unknown type' : file.type}`
          }
        />

        <Button
          variant="contained"
          disabled={busy || empty}
          sx={{ mt: 0.25 }}
          onClick={() => {
            onConfirm(renamed(file, trimmed));
          }}
        >
          {busy ? 'Attaching…' : confirmLabel}
        </Button>

        <Button
          color="inherit"
          disabled={busy}
          sx={{ mt: 0.25 }}
          onClick={onDiscard}
        >
          Discard
        </Button>
      </Box>
    </Box>
  );
}

/**
 * The same bytes under a new name.
 *
 * A `File` is immutable, so this is a new one over the same blob — nothing is
 * re-read and nothing is copied that was not already in memory. The type and
 * the modification time are carried across, because neither of them changed.
 *
 * **The ending is kept when it is left off.** Somebody typing `hdfc-credit`
 * over `image.png` means the name, not the format, and a file stored without
 * its extension is one the operating system will not open when it is saved
 * out later. Typing a *different* ending is left alone: that is a decision,
 * not an omission.
 */
function renamed(file: File, name: string): File {
  if (name === file.name) return file;

  const ending = extensionOf(file.name);
  const full =
    ending !== null && extensionOf(name) === null ? `${name}.${ending}` : name;

  return new File([file], full, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

/** `statement.pdf` -> `pdf`; `statement` and `.hidden` -> null. */
function extensionOf(name: string): string | null {
  const at = name.lastIndexOf('.');

  return at > 0 && at < name.length - 1 ? name.slice(at + 1) : null;
}
