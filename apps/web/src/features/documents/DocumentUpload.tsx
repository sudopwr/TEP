import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { useAttachDocument, useTransactions } from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import { FileDropzone } from '../../shared/components';
import { useToast } from '../../shared/feedback';

import { DOC_TYPES } from './DocumentPreview';

/**
 * F6 — attach a document, to a leg or to the payout itself.
 *
 * A file usually belongs to a *leg*, and that is what makes the trail
 * evidential: the exchange statement belongs to the sale it settles, the
 * withdrawal receipt to the withdrawal, and each appears at its own node next
 * to the amount it supports. But some documents belong to none of the
 * movements — the contract, the firm's own summary of the award — and
 * "the payout itself" is the first thing this form offers for exactly those.
 *
 * Re-uploading a file that is already stored does not duplicate it — UC4
 * dedupes by SHA-256 and links the existing document instead. The
 * confirmation says which of the two happened, because "attached" and
 * "already on file, now linked here as well" are different facts and the
 * second one is reassuring rather than alarming.
 *
 * Attaching a document that is *already on record* is the dialog's job
 * (`AttachDocumentDialog`), reached from the trail and from the payout's own
 * document list. This form is for bytes.
 */

/** The select's value for the payout itself, which has no transaction id. */
const THE_PAYOUT = 'payout';

export interface DocumentUploadProps {
  readonly payoutId: number;
}

export function DocumentUpload({ payoutId }: DocumentUploadProps) {
  const transactions = useTransactions(payoutId);
  const attach = useAttachDocument();
  const { notify } = useToast();

  const [attachTo, setAttachTo] = useState<string>(THE_PAYOUT);
  const [docType, setDocType] = useState('');
  const [docDate, setDocDate] = useState('');

  const failure = attach.error === null ? null : describeError(attach.error);

  const send = (files: readonly File[]): void => {
    const file = files[0];
    if (file === undefined) return;

    attach.mutate(
      {
        payoutId,
        target:
          attachTo === THE_PAYOUT
            ? { kind: 'payout', id: payoutId }
            : { kind: 'transaction', id: Number(attachTo) },
        file,
        ...(docType === '' ? {} : { docType }),
        ...(docDate === '' ? {} : { docDate }),
      },
      {
        onSuccess: (result) => {
          notify(
            result.created
              ? 'Document attached'
              : 'That file was already stored — linked here as well',
          );
        },
      },
    );
  };

  return (
    <Box>
      <Typography variant="h2" sx={{ mb: 1.5 }}>
        Attach a document
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <TextField
          select
          label="Attach to"
          value={attachTo}
          onChange={(event) => {
            setAttachTo(event.target.value);
          }}
          size="small"
          sx={{ minWidth: 240 }}
          required
          helperText="What this file is evidence for."
        >
          <MenuItem value={THE_PAYOUT}>The payout itself</MenuItem>
          {(transactions.data ?? []).map((transaction) => (
            <MenuItem key={transaction.id} value={String(transaction.id)}>
              {transaction.code} · {transaction.kind}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="Kind"
          value={docType}
          onChange={(event) => {
            setDocType(event.target.value);
          }}
          size="small"
          sx={{ minWidth: 160 }}
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
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Box>

      <FileDropzone
        onFiles={send}
        label="Drop a statement, receipt or screenshot here"
        hint="PDFs are indexed for full-text search; everything else is searchable by filename."
        {...(attach.isPending
          ? { progress: { label: 'Hashing and storing' } }
          : {})}
        {...(failure === null
          ? {}
          : {
              error: [failure.message, failure.action]
                .filter((part) => part !== undefined)
                .join(' '),
            })}
      />
    </Box>
  );
}
