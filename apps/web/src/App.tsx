import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { AccountBalances } from './features/balances/AccountBalances';
import { AppShell } from './shared/layout/AppShell';

export function App() {
  return (
    <AppShell>
      <Typography variant="h1" sx={{ mb: 0.5 }}>
        Balances
      </Typography>
      <Typography sx={{ color: 'muted.main', mb: 3 }}>
        Derived from movements every time, never stored.
      </Typography>
      <Box component="section">
        <AccountBalances />
      </Box>
    </AppShell>
  );
}
