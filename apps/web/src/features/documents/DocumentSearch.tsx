import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';

import {
  useDeleteDocument,
  useDocumentSearch,
  type DocumentJson,
} from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import {
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  type Column,
} from '../../shared/components';
import { useToast } from '../../shared/feedback';

import { DocumentPreview, formatBytes } from './DocumentPreview';

/**
 * F7 — full-text search across filenames and extracted PDF text.
 *
 * Results on the left, the file itself on the right. Searching a document
 * store is almost always a two-step act — find the candidate, confirm it is
 * the right one — and a list that only links out makes the second step a
 * round trip through a new tab for every guess.
 *
 * Nothing is searched until something is typed. The API answers 400 to an
 * empty query and is right to, but an empty search box is the normal state of
 * a search box and rendering an error into it would be absurd; `useDocumentSearch`
 * disables the query instead.
 */
export function DocumentSearch() {
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<DocumentJson | null>(null);
  /*
    The document being deleted, held as the row rather than its id.

    This screen is where a document is the *subject*, which is why the delete
    lives here and not on the trail: there a file is evidence for one leg, and
    a button that quietly removed it from three other things as well would be
    reading the reader's mind. Here the confirmation can say what goes.
  */
  const [deleting, setDeleting] = useState<DocumentJson | null>(null);

  const results = useDocumentSearch(term);
  const remove = useDeleteDocument();
  const { notify } = useToast();

  const columns: readonly Column<DocumentJson>[] = useMemo(
    () => [
      {
        id: 'filename',
        header: 'File',
        cell: (document) => (
          <Typography variant="numeric">{document.filename}</Typography>
        ),
        sortBy: (document) => document.filename,
      },
      {
        id: 'type',
        header: 'Type',
        cell: (document) => (
          <Typography variant="body2" sx={{ color: 'muted.main' }}>
            {document.docType ?? '—'}
          </Typography>
        ),
        sortBy: (document) => document.docType,
      },
      {
        id: 'date',
        header: 'Dated',
        cell: (document) => (
          <Typography variant="numeric">{document.docDate ?? '—'}</Typography>
        ),
        sortBy: (document) => document.docDate,
      },
      {
        id: 'size',
        header: 'Size',
        align: 'right',
        cell: (document) => (
          <Typography variant="numeric">
            {formatBytes(document.byteSize)}
          </Typography>
        ),
        sortBy: (document) => document.byteSize,
      },
      {
        id: 'actions',
        header: '',
        align: 'right',
        // No `sortBy`: a column of buttons has nothing to sort on.
        cell: (document) => (
          <Button
            size="small"
            color="error"
            aria-label={`Delete ${document.filename}`}
            onClick={(event) => {
              // The row opens the preview; the button must not, or deleting
              // would first select what it is about to remove.
              event.stopPropagation();
              setDeleting(document);
            }}
            sx={{ minWidth: 0, px: 0.75, py: 0 }}
          >
            Delete
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <Box>
      <Typography variant="h1" sx={{ mb: 0.5 }}>
        Documents
      </Typography>
      <Typography sx={{ color: 'muted.main', mb: 3 }}>
        Every agreement, invoice, receipt and statement, searchable by name and
        by what is written inside.
      </Typography>

      <TextField
        label="Search documents"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
        }}
        fullWidth
        size="small"
        sx={{ maxWidth: 420, mb: 3 }}
        autoFocus
        helperText="Matches filenames and the text extracted from PDFs."
      />

      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {results.isError ? (
            (() => {
              const failure = describeError(results.error);

              return (
                <ErrorState
                  message={failure.message}
                  {...(failure.action === undefined
                    ? {}
                    : { detail: failure.action })}
                  onRetry={() => {
                    void results.refetch();
                  }}
                />
              );
            })()
          ) : term.trim() === '' ? (
            <EmptyState
              message="Search for a document."
              hint="A company name, a month, an invoice number — anything that appears in the filename or in the text of a PDF."
            />
          ) : (
            <DataTable<DocumentJson>
              rows={results.data ?? []}
              columns={columns}
              rowKey={(document) => document.id}
              loading={results.isPending}
              caption="Search results"
              onRowClick={setSelected}
              empty={{
                message: `Nothing matched “${term.trim()}”.`,
                hint: 'Full-text search matches whole words. Try a shorter term, or part of the filename.',
                action: {
                  label: 'Clear the search',
                  onClick: () => {
                    setTerm('');
                    setSelected(null);
                  },
                },
              }}
            />
          )}
        </Box>

        <Paper sx={{ flex: 1, minWidth: 0, p: 2 }}>
          <DocumentPreview document={selected} />
        </Paper>
      </Box>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.filename ?? 'this document'}?`}
        message={
          <>
            The file goes from disk, and with it every attachment to a company,
            a payout or a leg — one file can be evidence for several things, and
            this removes it from all of them. This cannot be undone.
            {remove.error === null ? null : (
              <Box sx={{ mt: 2 }}>
                <ErrorState message={describeError(remove.error).message} />
              </Box>
            )}
          </>
        }
        confirmLabel="Delete document"
        destructive
        busy={remove.isPending}
        onConfirm={() => {
          if (deleting === null || remove.isPending) return;

          remove.mutate(deleting.id, {
            onSuccess: (result) => {
              // The preview is showing what no longer exists.
              if (selected?.id === result.document.id) setSelected(null);
              setDeleting(null);
              notify(
                result.linksRemoved === 0
                  ? `${result.document.filename} deleted`
                  : `${result.document.filename} deleted, from ${String(result.linksRemoved)} ${result.linksRemoved === 1 ? 'attachment' : 'attachments'}`,
              );
            },
          });
        }}
        onCancel={() => {
          setDeleting(null);
          remove.reset();
        }}
      />
    </Box>
  );
}
