import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { useAttachDocument, useTransactions } from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import { FileDropzone } from '../../shared/components';
import { useToast } from '../../shared/feedback';

/**
 * F6 — attach a document to a transaction.
 *
 * A file is attached to a *leg*, not to the payout as a whole, because that
 * is what makes the trail evidential: the exchange statement belongs to the
 * sale it settles, and the withdrawal receipt to the withdrawal. Both then
 * appear at their own node in the tree, next to the amount they support.
 *
 * Re-uploading a file that is already stored does not duplicate it — UC4
 * dedupes by SHA-256 and links the existing document instead. The
 * confirmation says which of the two happened, because "attached" and
 * "already on file, now linked here as well" are different facts and the
 * second one is reassuring rather than alarming.
 */

const DOC_TYPES = [
  'agreement',
  'invoice',
  'receipt',
  'screenshot',
  'statement',
  'contract',
  'other',
] as const;

export interface DocumentUploadProps {
  readonly payoutId: number;
}

export function DocumentUpload({ payoutId }: DocumentUploadProps) {
  const transactions = useTransactions(payoutId);
  const attach = useAttachDocument();
  const { notify } = useToast();

  const [transactionId, setTransactionId] = useState('');
  const [docType, setDocType] = useState('');
  const [docDate, setDocDate] = useState('');

  const failure = attach.error === null ? null : describeError(attach.error);
  const ready = transactionId !== '';

  const send = (files: readonly File[]): void => {
    const file = files[0];
    if (file === undefined || !ready) return;

    attach.mutate(
      {
        payoutId,
        transactionId: Number(transactionId),
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
          label="To which leg"
          value={transactionId}
          onChange={(event) => {
            setTransactionId(event.target.value);
          }}
          size="small"
          sx={{ minWidth: 240 }}
          required
          helperText="The movement this file is evidence for."
        >
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
        hint={
          ready
            ? 'PDFs are indexed for full-text search; everything else is searchable by filename.'
            : 'Choose the leg it belongs to first.'
        }
        disabled={!ready}
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
