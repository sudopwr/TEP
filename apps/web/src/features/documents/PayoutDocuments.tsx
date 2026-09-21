import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';

import {
  documentUrl,
  usePayoutDocuments,
  type DocumentJson,
} from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import { EmptyState, ErrorState } from '../../shared/components';

import { formatBytes } from './DocumentPreview';

/**
 * F6 — what is attached to the payout as a whole.
 *
 * The trail hangs each leg's documents on its own node, which is right for
 * the statement that settles a sale and wrong for the one covering the whole
 * award: the contract, or the platform's own summary. Those belong to no
 * movement, and before this they could be attached to a payout by the API and
 * seen by nobody.
 *
 * It renders the list and calls back; the dialogs that attach and detach live
 * with the payout screen, so the same two are shared with the trail rather
 * than existing twice.
 */

export interface PayoutDocumentsProps {
  readonly payoutId: number;
  readonly onAttach: () => void;
  readonly onRemove: (document: DocumentJson) => void;
}

export function PayoutDocuments({
  payoutId,
  onAttach,
  onRemove,
}: PayoutDocumentsProps) {
  const documents = usePayoutDocuments(payoutId);

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 1.5,
        }}
      >
        <Typography variant="h2">Documents</Typography>
        <Button variant="outlined" onClick={onAttach}>
          Attach a document
        </Button>
      </Box>

      {documents.isPending ? (
        <Skeleton variant="text" height={28} width={320} />
      ) : documents.isError ? (
        (() => {
          const failure = describeError(documents.error);

          return (
            <ErrorState
              message={failure.message}
              {...(failure.action === undefined
                ? {}
                : { detail: failure.action })}
              onRetry={() => {
                void documents.refetch();
              }}
            />
          );
        })()
      ) : documents.data.length === 0 ? (
        <EmptyState
          message="Nothing is attached to this payout itself."
          hint="The contract or the firm's own statement goes here; a receipt for one movement belongs on its leg in the trail."
        />
      ) : (
        documents.data.map((document) => (
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
              <Link
                // Served by the handler, behind both guards (§13).
                href={documentUrl(document.id)}
                target="_blank"
                rel="noreferrer"
                variant="numeric"
              >
                {document.filename}
              </Link>
              <Typography variant="body2" sx={{ color: 'muted.main' }}>
                {document.docType ?? 'unspecified'} ·{' '}
                {formatBytes(document.byteSize)}
              </Typography>
            </Box>

            <Button
              size="small"
              color="inherit"
              aria-label={`Remove ${document.filename} from this payout`}
              onClick={() => {
                onRemove(document);
              }}
              sx={{ color: 'muted.main' }}
            >
              Remove
            </Button>
          </Box>
        ))
      )}
    </Box>
  );
}
