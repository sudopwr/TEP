import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

import { documentUrl, type DocumentJson } from '../../shared/api';
import { EmptyState } from '../../shared/components';

/**
 * Show a document without leaving the screen it was found on.
 *
 * Everything comes through `GET /api/documents/:id`, which streams the file
 * from disk behind both guards. There is no static mount and there must not
 * be one (§13): mounting `data/files` would publish every stored statement to
 * anyone who can guess a hash, and the hashes are in the search results.
 *
 * Because the URL is same-origin, the session cookie travels with the
 * `<iframe>` and the `<img>` exactly as it does with a `fetch` — so the
 * browser's own PDF viewer can be used rather than shipping one.
 */

export interface DocumentPreviewProps {
  readonly document: DocumentJson | null;
  /** Height of the viewport the file is shown in. */
  readonly height?: number;
}

function isImage(mimeType: string | null): boolean {
  return mimeType !== null && mimeType.startsWith('image/');
}

function isPdf(mimeType: string | null): boolean {
  return mimeType === 'application/pdf';
}

/** `20480` as `20 KB`. Decimal, matching what a file manager shows. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'unknown size';
  if (bytes < 1000) return `${String(bytes)} B`;
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(0)} KB`;

  return `${(bytes / 1000 / 1000).toFixed(1)} MB`;
}

export function DocumentPreview({
  document,
  height = 520,
}: DocumentPreviewProps) {
  if (document === null) {
    return (
      <EmptyState
        message="No document selected."
        hint="Choose one from the results to read it here."
      />
    );
  }

  const href = documentUrl(document.id);

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 2,
          mb: 1,
        }}
      >
        <Typography variant="numeric" sx={{ fontWeight: 600 }}>
          {document.filename}
        </Typography>
        <Link href={href} target="_blank" rel="noreferrer" variant="body2">
          Open in a new tab
        </Link>
      </Box>

      <Typography variant="body2" sx={{ color: 'muted.main', mb: 1 }}>
        {document.docType ?? 'document'} · {formatBytes(document.byteSize)}
        {document.docDate === null ? '' : ` · ${document.docDate}`}
      </Typography>

      {isPdf(document.mimeType) ? (
        <Box
          component="iframe"
          src={href}
          title={document.filename}
          sx={{
            width: '100%',
            height,
            border: '1px solid',
            borderColor: 'divider',
          }}
        />
      ) : isImage(document.mimeType) ? (
        <Box
          component="img"
          src={href}
          alt={document.filename}
          sx={{ maxWidth: '100%', border: '1px solid', borderColor: 'divider' }}
        />
      ) : (
        <Box
          sx={{
            border: '1px dashed',
            borderColor: 'divider',
            p: 3,
            textAlign: 'center',
          }}
        >
          <Typography variant="body2" sx={{ color: 'muted.main' }}>
            {/*
              A CSV or a spreadsheet renders as nothing useful in an iframe.
              Saying so is better than showing an empty grey box and letting
              the reader wonder whether the file is corrupt.
            */}
            This is a {document.mimeType ?? 'file of unknown type'}, which the
            browser cannot display inline.
          </Typography>
          <Link href={href} target="_blank" rel="noreferrer" variant="body2">
            Open it in a new tab
          </Link>
        </Box>
      )}

      {document.sha256 === null ? null : (
        <Typography
          variant="numeric"
          component="p"
          sx={{
            color: 'muted.main',
            mt: 1,
            fontSize: 11,
            wordBreak: 'break-all',
          }}
        >
          {/*
            The hash, in full. It is how the same file uploaded twice is
            recognised as one document (UC4), and how a reader confirms that
            the file on screen is the file they were sent.
          */}
          sha256 {document.sha256}
        </Typography>
      )}
    </Box>
  );
}
