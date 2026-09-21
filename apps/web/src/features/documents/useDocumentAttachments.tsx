import Box from '@mui/material/Box';
import { useState, type ReactNode } from 'react';

import {
  useDetachDocument,
  type DocumentJson,
  type DocumentTargetJson,
} from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import { ConfirmDialog, ErrorState } from '../../shared/components';
import { useToast } from '../../shared/feedback';

import { AttachDocumentDialog } from './AttachDocumentDialog';

/**
 * Attaching and detaching, for every target on the payout screen at once.
 *
 * A hook that hands back a node, which is unusual enough to justify: the two
 * dialogs are needed by two features on the same screen — the trail renders a
 * leg's documents, `PayoutDocuments` renders the payout's — and N8 forbids
 * either feature from importing the other. The composition root wires them
 * (§5), and the state, the mutations and the copy stay here in `documents/`
 * rather than leaking into `routes.tsx`.
 *
 * One instance per screen, so one dialog exists rather than one per leg.
 */

export interface DocumentAttachments {
  /** Open the attach dialog for a payout or one of its legs. */
  readonly attachTo: (target: DocumentTargetJson, label: string) => void;
  /** Ask to take a document off that target. The file stays on record. */
  readonly removeFrom: (
    target: DocumentTargetJson,
    label: string,
    document: DocumentJson,
  ) => void;
  /** Render this once, anywhere on the screen. */
  readonly dialogs: ReactNode;
}

interface Pending {
  readonly target: DocumentTargetJson;
  readonly label: string;
  readonly document: DocumentJson;
}

export function useDocumentAttachments(payoutId: number): DocumentAttachments {
  const detach = useDetachDocument();
  const { notify } = useToast();

  const [attaching, setAttaching] = useState<{
    target: DocumentTargetJson;
    label: string;
  } | null>(null);
  const [removing, setRemoving] = useState<Pending | null>(null);

  const dialogs = (
    <>
      <AttachDocumentDialog
        target={attaching?.target ?? null}
        payoutId={payoutId}
        targetLabel={attaching?.label ?? ''}
        onClose={() => {
          setAttaching(null);
        }}
      />

      {/*
        "Remove", not "Delete": this breaks one attachment and leaves the file
        on record, which is what makes it undoable — attach it again, here or
        anywhere else. Deleting the file itself is F22, on the Documents
        screen, and says so in its own words.
      */}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.document.filename ?? 'this document'}?`}
        message={
          <>
            It comes off {removing?.label ?? 'this'} only. The file stays on
            record, so it can be attached again — here, or to the leg it
            actually belongs to.
            {detach.error === null ? null : (
              <Box sx={{ mt: 2 }}>
                <ErrorState message={describeError(detach.error).message} />
              </Box>
            )}
          </>
        }
        confirmLabel="Remove document"
        busy={detach.isPending}
        onConfirm={() => {
          if (removing === null || detach.isPending) return;

          detach.mutate(
            {
              documentId: removing.document.id,
              target: removing.target,
              payoutId,
            },
            {
              onSuccess: (result) => {
                const { filename } = result.document;

                setRemoving(null);
                notify(
                  result.remainingLinks === 0
                    ? `${filename} removed — still on record, attached to nothing`
                    : `${filename} removed from ${removing.label}`,
                );
              },
            },
          );
        }}
        onCancel={() => {
          setRemoving(null);
          detach.reset();
        }}
      />
    </>
  );

  return {
    attachTo: (target, label) => {
      setAttaching({ target, label });
    },
    removeFrom: (target, label, document) => {
      setRemoving({ target, label, document });
    },
    dialogs,
  };
}
