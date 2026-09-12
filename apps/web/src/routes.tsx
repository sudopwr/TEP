import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';

import { AccountList, RecordAccountForm } from './features/accounts';
import {
  AccountSettings,
  ChangePasswordScreen,
  RequireAuth,
  RequireSession,
  SignInScreen,
} from './features/auth';
import { DataQualityScreen } from './features/data-quality';
import { DocumentSearch, DocumentUpload } from './features/documents';
import { PayoutHeader, PayoutList, RecordPayoutForm } from './features/payouts';
import {
  AccountBalances,
  FinancialYearReport,
  SettlementPanel,
} from './features/reports';
import {
  RecordTransactionForm,
  TransactionTree,
} from './features/transactions';
import { useAuth } from './shared/api';
import { EmptyState, ErrorBoundary } from './shared/components';
import { AppShell, type Destination } from './shared/layout';

/**
 * Where the features meet. The UI's composition root.
 *
 * N8 says a feature may not import another feature, and the payout detail
 * screen is exactly where that rule earns its keep: it wants the payout's
 * header, its settlement and its transaction tree, which live in three
 * different features. The wrong fix is for `payouts/` to import
 * `transactions/` — then `transactions/` cannot be understood or tested
 * without `payouts/`, and within a month each one needs the other.
 *
 * So the composition happens here instead, in a file that belongs to no
 * feature and that every feature is allowed to be imported by. It is the same
 * shape as `apps/api/src/container.ts`: one place that knows how the parts
 * fit together, so that no part has to.
 */

const DESTINATIONS: readonly Destination[] = [
  { label: 'Payouts', to: '/payouts' },
  { label: 'Accounts', to: '/accounts' },
  { label: 'Balances', to: '/balances' },
  { label: 'Documents', to: '/documents' },
  { label: 'Data quality', to: '/data-quality' },
  { label: 'Report', to: '/reports' },
  { label: 'Account', to: '/account' },
];

/**
 * Everything behind both guards, inside the shell.
 *
 * `RequireAuth` wraps the shell rather than sitting inside it, so a person
 * who is not signed in never sees the rail flash up before being redirected.
 */
function ProtectedLayout() {
  const { user, mustChangePassword, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <RequireAuth>
      <AppShell
        destinations={DESTINATIONS}
        {...(user === null ? {} : { username: user.username })}
        mustChangePassword={mustChangePassword}
        onSignOut={() => {
          signOut.mutate();
        }}
        onAccountSettings={() => {
          void navigate('/account');
        }}
      >
        {/*
          One boundary around the page, not around the shell: a screen that
          throws should leave the rail intact so there is somewhere to go
          next. `resetKey` is absent deliberately — a page that failed to
          render will fail again on the same data, and the retry button is
          the honest way back.
        */}
        <ErrorBoundary title="This screen could not be drawn">
          <Outlet />
        </ErrorBoundary>
      </AppShell>
    </RequireAuth>
  );
}

/** The `:payoutId` in the URL, or null when it is not a row id. */
function usePayoutIdParam(): number | null {
  const { payoutId } = useParams();
  const parsed = Number(payoutId);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function BadPayoutId() {
  const navigate = useNavigate();

  return (
    <EmptyState
      message="That is not a payout."
      hint="The address should end in a payout's number, as in /payouts/1."
      action={{
        label: 'Go to the payout list',
        onClick: () => {
          void navigate('/payouts');
        },
      }}
    />
  );
}

/**
 * The payout detail screen: who awarded it, what it settled to, and the tree.
 *
 * Top to bottom is the reader's question in order — which payout is this,
 * what did it come to, and how did it get there. The settlement sits above
 * the trail rather than below it because it is the answer, and the tree is
 * the working: somebody checking a figure wants to see the total first and
 * then descend into it.
 */
function PayoutDetailPage() {
  const payoutId = usePayoutIdParam();
  const navigate = useNavigate();

  if (payoutId === null) return <BadPayoutId />;

  return (
    <Box>
      <PayoutHeader payoutId={payoutId} />

      <Box sx={{ mt: 4 }}>
        <SettlementPanel payoutId={payoutId} />
      </Box>

      <Box sx={{ mt: 4 }}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 1.5,
          }}
        >
          <Typography variant="h2">Money trail</Typography>
          <Button
            variant="outlined"
            onClick={() => {
              void navigate(`/payouts/${String(payoutId)}/transactions/new`);
            }}
          >
            Record transaction
          </Button>
        </Box>

        <TransactionTree payoutId={payoutId} />
      </Box>

      <Box sx={{ mt: 5 }}>
        <DocumentUpload payoutId={payoutId} />
      </Box>
    </Box>
  );
}

function RecordTransactionPage() {
  const payoutId = usePayoutIdParam();
  const navigate = useNavigate();

  if (payoutId === null) return <BadPayoutId />;

  const back = (): void => {
    void navigate(`/payouts/${String(payoutId)}`);
  };

  return (
    <Box>
      <Typography variant="h1" sx={{ mb: 0.5 }}>
        Record transaction
      </Typography>
      <Typography sx={{ color: 'muted.main', mb: 3 }}>
        One movement between two accounts, hanging off the leg it continues.
      </Typography>

      <RecordTransactionForm
        payoutId={payoutId}
        onRecorded={back}
        onCancel={back}
      />
    </Box>
  );
}

function BalancesPage() {
  return (
    <Box>
      <Typography variant="h1" sx={{ mb: 0.5 }}>
        Balances
      </Typography>
      <Typography sx={{ color: 'muted.main', mb: 3 }}>
        Derived from every movement on each read, never stored.
      </Typography>

      <AccountBalances />
    </Box>
  );
}

function NotFound() {
  const navigate = useNavigate();

  return (
    <EmptyState
      message="There is no screen at this address."
      hint="It may be a link from an older version, or a typed address."
      action={{
        label: 'Go to the payout list',
        onClick: () => {
          void navigate('/payouts');
        },
      }}
    />
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/signin" element={<SignInScreen />} />

      {/*
        F15's cage, and the one screen behind `RequireSession` rather than
        `RequireAuth`. It has to work *while* the flag is set, because it is
        how the flag gets cleared — the mirror of §5a's `MUST_CHANGE_EXEMPT`
        on the server. Behind the other guard it would redirect to itself.
      */}
      <Route
        path="/change-password"
        element={
          <RequireSession>
            <ChangePasswordScreen />
          </RequireSession>
        }
      />

      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Navigate to="/payouts" replace />} />
        <Route path="/payouts" element={<PayoutList />} />
        <Route path="/payouts/new" element={<RecordPayoutForm />} />
        <Route path="/payouts/:payoutId" element={<PayoutDetailPage />} />
        <Route
          path="/payouts/:payoutId/transactions/new"
          element={<RecordTransactionPage />}
        />
        <Route path="/accounts" element={<AccountList />} />
        <Route path="/accounts/new" element={<RecordAccountForm />} />
        <Route path="/balances" element={<BalancesPage />} />
        <Route path="/documents" element={<DocumentSearch />} />
        <Route path="/data-quality" element={<DataQualityScreen />} />
        <Route path="/reports" element={<FinancialYearReport />} />
        <Route path="/account" element={<AccountSettings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
