import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';

import {
  useDeleteDocument,
  useDocuments,
  type DocumentJson,
} from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import {
  ConfirmDialog,
  DataTable,
  ErrorState,
  type Column,
} from '../../shared/components';
import { useToast } from '../../shared/feedback';

import { DocumentPreview, formatBytes } from './DocumentPreview';

/**
 * F31 — the register: every document on file, newest first, ten at a time.
 *
 * This screen used to be a search box and nothing else: it answered a question
 * and showed an invitation until one was asked. But the commonest reason to
 * open it is not to find a known file — it is to see what is on file at all,
 * which a search box cannot answer, because you have to know the answer
 * already to type the question. So the list comes first and the box narrows it.
 *
 * **Newest first, and the server decides.** The order is a `doc_date` the
 * reader recognises, falling back to the upload for anything undated, and the
 * columns deliberately do not offer their own sort: sorting ten rows out of
 * thirty-four in the browser would reorder *a page* while looking like it
 * reordered the register, which is the kind of wrong that is hard to see.
 *
 * Rows on the left, the file itself on the right. Confirming that a candidate
 * is the right document is half of every visit, and a list that only links out
 * makes the second half a new tab per guess.
 */
export function DocumentRegister() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DocumentJson | null>(null);
  /*
    The document being deleted, held as the row rather than its id.

    This screen is where a document is the *subject*, which is why the delete
    lives here and not on the trail: there a file is evidence for one leg, and
    a button that quietly removed it from three other things as well would be
    reading the reader's mind. Here the confirmation can say what goes.
  */
  const [deleting, setDeleting] = useState<DocumentJson | null>(null);

  const searched = term.trim();
  const register = useDocuments({ search: searched, page });
  const remove = useDeleteDocument();
  const { notify } = useToast();

  const documents = register.data?.documents ?? [];
  /*
    The page the server served, not the one that was asked for.

    UC27 answers the last page to a request past the end — from a stale link,
    or from deleting your way off it — and the label and the arrows have to
    agree with the rows actually on screen.
  */
  const served = register.data?.page ?? page;
  const pages = register.data?.pages ?? 1;
  const total = register.data?.total ?? 0;
  const perPage = register.data?.perPage ?? 10;
  const first = documents.length === 0 ? 0 : (served - 1) * perPage + 1;
  const last = first === 0 ? 0 : first + documents.length - 1;

  const columns: readonly Column<DocumentJson>[] = useMemo(
    () => [
      {
        id: 'filename',
        header: 'File',
        cell: (document) => (
          <Typography variant="numeric">{document.filename}</Typography>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        cell: (document) => (
          <Typography variant="body2" sx={{ color: 'muted.main' }}>
            {document.docType ?? '—'}
          </Typography>
        ),
      },
      {
        id: 'date',
        header: 'Dated',
        cell: (document) => (
          <Typography variant="numeric">{document.docDate ?? '—'}</Typography>
        ),
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
      },
      {
        id: 'actions',
        header: '',
        align: 'right',
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
        Every agreement, invoice, receipt and statement, newest first and
        searchable by name or by what is written inside.
      </Typography>

      <TextField
        label="Search documents"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          // A narrower list has a different page 1, and staying on page 3 of
          // the old one is the fastest way to see an empty table by mistake.
          setPage(1);
        }}
        fullWidth
        size="small"
        sx={{ maxWidth: 420, mb: 3 }}
        autoFocus
        helperText="Matches filenames and the text extracted from PDFs."
      />

      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {register.isError ? (
            (() => {
              const failure = describeError(register.error);

              return (
                <ErrorState
                  message={failure.message}
                  {...(failure.action === undefined
                    ? {}
                    : { detail: failure.action })}
                  onRetry={() => {
                    void register.refetch();
                  }}
                />
              );
            })()
          ) : (
            <>
              <DataTable<DocumentJson>
                rows={documents}
                columns={columns}
                rowKey={(document) => document.id}
                loading={register.isPending}
                caption="Documents"
                onRowClick={setSelected}
                empty={
                  searched === ''
                    ? {
                        message: 'No documents yet.',
                        hint: 'A document arrives with a payout or a leg: open one and attach the statement, the invoice or the screenshot that proves it.',
                      }
                    : {
                        message: `Nothing matched “${searched}”.`,
                        hint: 'A filename matches on any fragment; the text inside a PDF matches whole words. Try a shorter term.',
                        action: {
                          label: 'Clear the search',
                          onClick: () => {
                            setTerm('');
                            setPage(1);
                          },
                        },
                      }
                }
              />

              {total === 0 ? null : (
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ mt: 2, alignItems: 'center' }}
                >
                  <Typography variant="numeric" sx={{ color: 'muted.main' }}>
                    {`${String(first)}–${String(last)} of ${String(total)}`}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Button
                    size="small"
                    disabled={served <= 1 || register.isFetching}
                    onClick={() => {
                      setPage(served - 1);
                    }}
                  >
                    Previous
                  </Button>
                  <Typography variant="numeric" sx={{ color: 'muted.main' }}>
                    {`Page ${String(served)} of ${String(pages)}`}
                  </Typography>
                  <Button
                    size="small"
                    disabled={served >= pages || register.isFetching}
                    onClick={() => {
                      setPage(served + 1);
                    }}
                  >
                    Next
                  </Button>
                </Stack>
              )}
            </>
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
