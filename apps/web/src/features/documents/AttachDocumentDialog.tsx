import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import {
  useAttachDocument,
  useDocumentSearch,
  useLinkDocument,
  type DocumentJson,
  type DocumentTargetJson,
} from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import { EmptyState, ErrorState, FileDropzone } from '../../shared/components';
import { useToast } from '../../shared/feedback';

import { DOC_TYPES, formatBytes } from './DocumentPreview';

/**
 * F6 and F23 — put a document on a payout or one of its legs, either way.
 *
 * Two ways in, in one dialog, because they are the same intention: *this file
 * is evidence for this leg*. Sometimes the file is on the desk and sometimes
 * it is already on record — the CoinDCX statement covering four sales is
 * uploaded against the first of them and then chosen for the other three, and
 * making somebody find it on disk and upload it again to say so would be
 * absurd. UC4 would dedupe the bytes anyway; this skips the round trip.
 *
 * The search half is the same FTS5 endpoint the Documents screen uses, so a
 * file is found the way it is always found here: by filename, or by what is
 * written inside it.
 */

export interface AttachDocumentDialogProps {
  /** What to attach to. `null` closes the dialog. */
  readonly target: DocumentTargetJson | null;
  /** Which payout's caches this touches — a leg's trail belongs to one. */
  readonly payoutId: number;
  /** What the reader is attaching to, in their words: "Transaction007". */
  readonly targetLabel: string;
  readonly onClose: () => void;
}

export function AttachDocumentDialog({
  target,
  payoutId,
  targetLabel,
  onClose,
}: AttachDocumentDialogProps) {
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      aria-labelledby="attach-document-title"
      maxWidth="sm"
      fullWidth
    >
      {/* Mounted only while open, so the search box and the chosen kind do
          not survive from the last leg to the next one. */}
      {target === null ? null : (
        <AttachDocumentForm
          key={`${target.kind}-${String(target.id)}`}
          target={target}
          payoutId={payoutId}
          targetLabel={targetLabel}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function AttachDocumentForm({
  target,
  payoutId,
  targetLabel,
  onClose,
}: {
  readonly target: DocumentTargetJson;
  readonly payoutId: number;
  readonly targetLabel: string;
  readonly onClose: () => void;
}) {
  const attach = useAttachDocument();
  const link = useLinkDocument();
  const { notify } = useToast();

  const [docType, setDocType] = useState('');
  const [docDate, setDocDate] = useState('');
  const [term, setTerm] = useState('');

  const found = useDocumentSearch(term);
  const failure =
    attach.error !== null
      ? describeError(attach.error)
      : link.error !== null
        ? describeError(link.error)
        : null;

  const upload = (files: readonly File[]): void => {
    const file = files[0];
    if (file === undefined || attach.isPending) return;

    attach.mutate(
      {
        payoutId,
        target,
        file,
        ...(docType === '' ? {} : { docType }),
        ...(docDate === '' ? {} : { docDate }),
      },
      {
        onSuccess: (result) => {
          notify(
            result.created
              ? `${result.document.filename} attached`
              : `${result.document.filename} was already stored — attached here as well`,
          );
          onClose();
        },
      },
    );
  };

  const choose = (document: DocumentJson): void => {
    if (link.isPending) return;

    link.mutate(
      { documentId: document.id, target, payoutId },
      {
        onSuccess: () => {
          notify(`${document.filename} attached`);
          onClose();
        },
      },
    );
  };

  return (
    <>
      <DialogTitle id="attach-document-title">
        Attach a document to {targetLabel}
      </DialogTitle>

      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Upload a file, or attach one that is already on record. The same file
          attached twice is one document with two attachments, never two copies.
        </DialogContentText>

        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <TextField
            select
            label="Kind"
            value={docType}
            onChange={(event) => {
              setDocType(event.target.value);
            }}
            size="small"
            sx={{ minWidth: 160 }}
            disabled={attach.isPending}
          >
            <MenuItem value="">Unspecified</MenuItem>
            {DOC_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {type}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Dated"
            type="date"
            value={docDate}
            onChange={(event) => {
              setDocDate(event.target.value);
            }}
            size="small"
            disabled={attach.isPending}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>

        <FileDropzone
          onFiles={upload}
          label="Drop a statement, receipt or screenshot here"
          hint="PDFs are indexed for full-text search; everything else is searchable by filename."
          {...(attach.isPending
            ? { progress: { label: 'Hashing and storing' } }
            : {})}
        />

        <Typography
          variant="label"
          component="h3"
          sx={{ display: 'block', mt: 3, mb: 1 }}
        >
          Or attach one already on record
        </Typography>

        <TextField
          label="Search documents"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
          }}
          fullWidth
          size="small"
          helperText="Matches filenames and the text extracted from PDFs."
        />

        <Box sx={{ mt: 1 }}>
          {term.trim() === '' ? null : found.data?.length === 0 ? (
            <EmptyState
              message={`Nothing on record matched “${term.trim()}”.`}
            />
          ) : (
            (found.data ?? []).map((document) => (
              <Box
                key={document.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                  py: 0.5,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="numeric">{document.filename}</Typography>
                  <Typography variant="body2" sx={{ color: 'muted.main' }}>
                    {document.docType ?? 'unspecified'} ·{' '}
                    {formatBytes(document.byteSize)}
                  </Typography>
                </Box>

                <Button
                  size="small"
                  aria-label={`Attach ${document.filename}`}
                  disabled={link.isPending}
                  onClick={() => {
                    choose(document);
                  }}
                >
                  Attach
                </Button>
              </Box>
            ))
          )}
        </Box>

        {failure === null ? null : (
          <Box sx={{ mt: 2 }}>
            <ErrorState
              message={failure.message}
              {...(failure.action === undefined
                ? {}
                : { detail: failure.action })}
            />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </>
  );
}
