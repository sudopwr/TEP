import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import {
  useExportLedger,
  useImportLedger,
  useLedgerState,
  type ImportResultJson,
  type LedgerCountsJson,
} from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import {
  ConfirmDialog,
  ErrorState,
  FileDropzone,
} from '../../shared/components';
import { useToast } from '../../shared/feedback';

/**
 * F33 — the whole ledger out to one file, and back in from one.
 *
 * `npm run backup` already copies `data/` on the machine, and that remains the
 * right thing for a scheduled backup. This screen is the other half, and the
 * half a person can actually use: a file they download, keep somewhere that is
 * not this laptop, and load into a fresh install when they need to.
 *
 * The instructions are on the screen rather than in a document nobody will
 * find. Restoring a backup is a thing people do once, under pressure, having
 * forgotten everything they knew about it — so the steps are written out where
 * the buttons are, including the two facts that surprise people: importing
 * replaces everything, and the archive holds no password.
 */

/**
 * What the counts are called, in the order a person reads them.
 *
 * Both forms written out, rather than a rule for dropping an `s`: that rule
 * turns "companies" into "1 companie", which is exactly the sort of thing that
 * makes a reader doubt the figures beside it.
 */
const COUNT_LABELS: readonly (readonly [string, string, string])[] = [
  ['traders', 'trader', 'traders'],
  ['companies', 'company', 'companies'],
  ['accounts', 'account', 'accounts'],
  ['payouts', 'payout', 'payouts'],
  ['transactions', 'transaction', 'transactions'],
  ['fees', 'fee', 'fees'],
  ['feeSchedules', 'fee schedule', 'fee schedules'],
  ['documents', 'document', 'documents'],
  ['documentLinks', 'attachment', 'attachments'],
];

/** `1 payout, 13 transactions and 2 documents` — only what is there. */
function describeCounts(counts: LedgerCountsJson): string {
  const parts = COUNT_LABELS.filter(([key]) => (counts[key] ?? 0) > 0).map(
    ([key, one, many]) => {
      const total = counts[key] ?? 0;

      return `${String(total)} ${total === 1 ? one : many}`;
    },
  );

  if (parts.length === 0) return 'nothing yet';
  if (parts.length === 1) return parts[0] ?? '';

  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

/**
 * Hand the blob to the browser as a download.
 *
 * The one piece of this feature that has to touch the document: `shared/api`
 * fetches the bytes and has no business making anchor elements, and a feature
 * is where the DOM is allowed. The object URL is revoked immediately after the
 * click — the download has already started by then, and leaving it behind pins
 * the whole archive in memory for as long as the tab is open.
 */
function saveToDisk(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Steps({ children }: { readonly children: React.ReactNode }) {
  return (
    <Box
      component="ol"
      sx={{ pl: 3, m: 0, '& li': { mb: 0.75 }, color: 'muted.main' }}
    >
      {children}
    </Box>
  );
}

export function LedgerTransferScreen() {
  const ledger = useLedgerState();
  const save = useExportLedger();
  const load = useImportLedger();
  const { notify } = useToast();

  const [chosen, setChosen] = useState<File | null>(null);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<ImportResultJson | null>(null);

  const counts = ledger.data?.counts ?? {};
  const onFile = describeCounts(counts);
  const empty = Object.values(counts).every((total) => total === 0);

  const exportNow = () => {
    save.mutate(undefined, {
      onSuccess: (file) => {
        saveToDisk(file.blob, file.filename);
        notify(`Exported ${onFile}`);
      },
    });
  };

  const importNow = () => {
    if (chosen === null) return;

    load.mutate(
      { file: chosen, replace: true },
      {
        onSuccess: (result) => {
          setAsking(false);
          setChosen(null);
          setDone(result);
          notify(`Imported ${describeCounts(result.counts)}`);
        },
      },
    );
  };

  return (
    <Box sx={{ maxWidth: 820 }}>
      <Typography variant="h1" sx={{ mb: 0.5 }}>
        Export and import
      </Typography>
      <Typography sx={{ color: 'muted.main', mb: 3 }}>
        One file holds the whole ledger and every document attached to it. Keep
        a copy somewhere that is not this machine.
      </Typography>

      {/* ---------------------------------------------------------- export */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h2" sx={{ mb: 0.5 }}>
          Export
        </Typography>
        <Typography sx={{ color: 'muted.main', mb: 2 }}>
          {ledger.isPending
            ? 'Counting what is on file…'
            : `On file now: ${onFile}.`}
        </Typography>

        <Steps>
          <li>
            Press <strong>Export everything</strong>. The file downloads as{' '}
            <Typography component="span" variant="numeric">
              payout-tracker-&lt;date&gt;.tar.gz
            </Typography>
            .
          </li>
          <li>
            Keep it somewhere other than this machine — another drive, or
            storage you trust. A backup on the disk that fails is not a backup.
          </li>
          <li>
            To look inside without importing it, any unzip tool will open it, or{' '}
            <Typography component="span" variant="numeric">
              tar -xzf payout-tracker-&lt;date&gt;.tar.gz
            </Typography>
            . It holds <Typography component="span" variant="numeric">ledger.json</Typography>,
            a manifest, and every document under{' '}
            <Typography component="span" variant="numeric">files/</Typography>.
          </li>
          <li>
            It contains no password. Your sign-in details stay on this machine
            and are not in the file.
          </li>
        </Steps>

        {save.isError ? (
          <Box sx={{ mt: 2 }}>
            <ErrorState message={describeError(save.error).message} />
          </Box>
        ) : null}

        <Box sx={{ mt: 2.5 }}>
          <Button
            variant="contained"
            onClick={exportNow}
            disabled={save.isPending}
          >
            {save.isPending ? 'Preparing…' : 'Export everything'}
          </Button>
        </Box>
      </Paper>

      {/* ---------------------------------------------------------- import */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h2" sx={{ mb: 0.5 }}>
          Import
        </Typography>
        <Typography sx={{ color: 'negative.main', mb: 2 }}>
          Importing replaces everything in this ledger. It is a restore, not a
          merge.
        </Typography>

        <Steps>
          <li>
            On a new machine, start the application and change the shipped
            password first — no screen works until that is done, including this
            one.
          </li>
          <li>
            Choose the{' '}
            <Typography component="span" variant="numeric">
              .tar.gz
            </Typography>{' '}
            file an export produced. Nothing is read until you confirm.
          </li>
          <li>
            Confirm the replacement. Every payout, leg, fee, document and
            attachment is replaced by what the archive holds, and the documents
            are written back to{' '}
            <Typography component="span" variant="numeric">data/files</Typography>.
          </li>
          <li>
            Sign in afterwards with the password of <em>this</em> installation.
            The archive carries no credentials, so the one you changed in step 1
            is still the one that works.
          </li>
        </Steps>

        <Box sx={{ mt: 2.5 }}>
          <FileDropzone
            label={
              chosen === null ? 'Choose an export file' : 'Choose a different file'
            }
            hint={
              chosen === null
                ? 'A .tar.gz written by Export, from this application.'
                : `${chosen.name} — ${String(Math.max(1, Math.round(chosen.size / 1024)))} KB`
            }
            accept=".gz,.tgz,application/gzip"
            onFiles={(files) => {
              const [file] = files;
              if (file !== undefined) {
                setChosen(file);
                setDone(null);
                load.reset();
              }
            }}
            disabled={load.isPending}
            // F25's window-level paste belongs to the document screens: a
            // screenshot pasted here would be a file nobody meant to restore.
            pasteable={false}
          />
        </Box>

        {/*
          Only once the question has been dismissed.

          While the dialog is open it shows the reason itself: MUI marks the rest
          of the page `aria-hidden` behind a dialog, so a message out here would
          be a refusal nobody can read and nothing can reach — which is how an
          e2e run found it.
        */}
        {load.isError && !asking ? (
          <Box sx={{ mt: 2 }}>
            <ErrorState message={describeError(load.error).message} />
          </Box>
        ) : null}

        {done === null ? null : (
          <Box sx={{ mt: 2 }}>
            <Divider sx={{ mb: 2 }} />
            <Typography sx={{ color: 'positive.main' }}>
              Imported {describeCounts(done.counts)}, with{' '}
              {String(done.filesRestored)}{' '}
              {done.filesRestored === 1 ? 'file' : 'files'} written back. The
              archive was made on {done.createdAt.slice(0, 10)}.
            </Typography>
          </Box>
        )}

        <Box sx={{ mt: 2.5 }}>
          <Button
            variant="contained"
            color="error"
            disabled={chosen === null || load.isPending}
            onClick={() => {
              setAsking(true);
            }}
          >
            {load.isPending ? 'Importing…' : 'Import and replace everything'}
          </Button>
        </Box>
      </Paper>

      <ConfirmDialog
        open={asking}
        title="Replace everything in this ledger?"
        message={
          <>
            {empty
              ? 'This ledger is empty, so there is nothing to lose — the archive will simply be loaded.'
              : `This ledger holds ${onFile}. All of it is replaced by what ${chosen?.name ?? 'the archive'} holds, and this cannot be undone. Export first if you have not already.`}
            {load.isError ? (
              <Box sx={{ mt: 2 }}>
                <ErrorState message={describeError(load.error).message} />
              </Box>
            ) : null}
          </>
        }
        confirmLabel="Replace the ledger"
        destructive
        busy={load.isPending}
        onConfirm={importNow}
        onCancel={() => {
          setAsking(false);
        }}
      />
    </Box>
  );
}
