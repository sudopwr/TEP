import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useState } from 'react';

import { usePayouts, useDeletePayout, useTransactions } from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import { ConfirmDialog, ErrorState } from '../../shared/components';
import { useToast } from '../../shared/feedback';

/**
 * F2 — remove a payout that should not have been recorded.
 *
 * Deleting is the only destructive thing this application can do, so it is
 * the only place with a confirmation, and the confirmation earns its
 * interruption by *counting*: "its 13 legs and every fee on them" is the
 * sentence that stops somebody deleting the payout below the one they meant.
 * The count comes from a cache the payout screen has already loaded, so the
 * dialog costs no request.
 *
 * There is no undo and the copy says so. An undo here would mean either
 * keeping deleted rows about — a fourth status for every total to remember to
 * exclude, which §13 rejected — or replaying thirteen inserts from the
 * browser's memory and hoping nothing else moved in between. N6's answer is
 * better and already true: the data is one folder, and `npm run backup`
 * copies it.
 */
export function DeletePayoutButton({
  payoutId,
  onDeleted,
}: {
  readonly payoutId: number;
  readonly onDeleted: () => void;
}) {
  const payouts = usePayouts();
  const legs = useTransactions(payoutId);
  const remove = useDeletePayout();
  const { notify } = useToast();

  const [asking, setAsking] = useState(false);

  const payout = payouts.data?.find((one) => one.id === payoutId);
  const legCount = legs.data?.length ?? 0;

  const confirm = (): void => {
    if (remove.isPending) return;

    remove.mutate(payoutId, {
      onSuccess: (result) => {
        setAsking(false);
        notify(`${result.payout.code} deleted`);
        onDeleted();
      },
      // No `onError`. A failure leaves the dialog open with the reason under
      // the question, because the question is still live: the payout is still
      // there and the answer is still "delete it". Closing the dialog and
      // toasting the reason would report a failure in the one place reserved
      // for confirmations — `ToastTone` has no error, deliberately.
    });
  };

  const failure = remove.error === null ? null : describeError(remove.error);

  return (
    <>
      <Button
        color="error"
        onClick={() => {
          setAsking(true);
        }}
        disabled={payout === undefined || remove.isPending}
      >
        Delete payout
      </Button>

      <ConfirmDialog
        open={asking}
        title={`Delete ${payout?.code ?? 'this payout'}?`}
        message={
          <>
            {legCount === 0
              ? 'Nothing has been recorded against it yet. Documents attached to it stay on file.'
              : `Its ${String(legCount)} ${legCount === 1 ? 'leg' : 'legs'} and every fee on them go too. Documents attached to it stay on file, and so does everything they are attached to elsewhere. This cannot be undone.`}

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
          </>
        }
        confirmLabel="Delete payout"
        destructive
        busy={remove.isPending}
        onConfirm={confirm}
        onCancel={() => {
          setAsking(false);
          remove.reset();
        }}
      />
    </>
  );
}
