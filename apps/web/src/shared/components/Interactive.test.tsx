import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '../../../test/render';

import { ConfirmDialog } from './ConfirmDialog';
import { FileDropzone } from './FileDropzone';
import { PasswordField } from './PasswordField';
import { SelectWithCreate } from './SelectWithCreate';
import { UserMenu } from './UserMenu';

const file = (name: string, contents = 'bytes'): File =>
  new File([contents], name, { type: 'application/pdf' });

describe('ConfirmDialog', () => {
  const required = {
    open: true,
    title: 'Remove this document?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders with only its required props', () => {
    render(<ConfirmDialog {...required} />);

    expect(screen.getByText('Remove this document?')).toBeInTheDocument();
  });

  it('renders nothing while closed', () => {
    render(<ConfirmDialog {...required} open={false} />);

    expect(screen.queryByText('Remove this document?')).not.toBeInTheDocument();
  });

  it('confirms and cancels through the callbacks it was given', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        {...required}
        onConfirm={onConfirm}
        onCancel={onCancel}
        confirmLabel="Remove document"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove document' }));
    expect(onConfirm).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('cancels on Escape — the accidental outcome must be "nothing happened"', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog {...required} onCancel={onCancel} onConfirm={onConfirm} />,
    );
    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('names the verb rather than saying OK', () => {
    // "Remove document" can be understood from the button alone; "OK"
    // requires having read and retained the title.
    render(<ConfirmDialog {...required} confirmLabel="Remove document" />);

    expect(
      screen.queryByRole('button', { name: 'OK' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove document' }),
    ).toBeInTheDocument();
  });

  it('disables both buttons while the action is in flight', () => {
    render(<ConfirmDialog {...required} busy />);

    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('does not close on Escape while busy', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<ConfirmDialog {...required} onCancel={onCancel} busy />);
    await user.keyboard('{Escape}');

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('describes itself to assistive technology', () => {
    render(<ConfirmDialog {...required} message="The file stays on disk." />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Remove this document?');
    expect(dialog).toHaveAccessibleDescription('The file stays on disk.');
  });
});

describe('FileDropzone', () => {
  it('renders with only its required prop', () => {
    render(<FileDropzone onFiles={vi.fn()} />);

    expect(screen.getByText('Drop a file here')).toBeInTheDocument();
  });

  it('hands over a file chosen through the picker', async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();

    const { container } = render(<FileDropzone onFiles={onFiles} />);
    const input = container.querySelector('input[type="file"]');

    await user.upload(input as HTMLInputElement, file('statement.pdf'));

    expect(onFiles).toHaveBeenCalledOnce();
    expect(onFiles.mock.calls[0]?.[0]?.[0]?.name).toBe('statement.pdf');
  });

  it('uploads nothing itself — it only calls back', async () => {
    // The component has no endpoint, no fetch and no opinion about what
    // happens to the bytes. `onFiles` is the entire contract.
    const user = userEvent.setup();
    const onFiles = vi.fn();

    const { container } = render(<FileDropzone onFiles={onFiles} />);
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      file('statement.pdf'),
    );

    expect(onFiles).toHaveBeenCalledWith([expect.any(File)]);
  });

  it('keeps the input reachable by keyboard', () => {
    // Hidden with clipping rather than `display: none`: a display-hidden
    // input is skipped by tab order, and choosing a file becomes mouse-only.
    const { container } = render(<FileDropzone onFiles={vi.fn()} />);
    const input = container.querySelector('input[type="file"]');

    expect(window.getComputedStyle(input as Element).display).not.toBe('none');
  });

  it('accepts a drop', () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} label="Drop a statement here" />);

    const zone = screen.getByText('Drop a statement here').parentElement;
    const dropped = file('dropped.pdf');

    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [dropped] },
    });
    (zone as HTMLElement).dispatchEvent(event);

    expect(onFiles).toHaveBeenCalledOnce();
  });

  it('ignores a drop while disabled', () => {
    const onFiles = vi.fn();
    render(<FileDropzone onFiles={onFiles} disabled />);

    const zone = screen.getByText('Drop a file here').parentElement;
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [file('nope.pdf')] },
    });
    (zone as HTMLElement).dispatchEvent(event);

    expect(onFiles).not.toHaveBeenCalled();
  });

  it('shows a determinate bar when progress has a value', () => {
    render(
      <FileDropzone
        onFiles={vi.fn()}
        progress={{ value: 62, label: 'coindcx-march.pdf' }}
      />,
    );

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '62');
    expect(screen.getByText(/coindcx-march\.pdf — 62%/)).toBeInTheDocument();
  });

  it('shows an indeterminate bar when it cannot say how much', () => {
    render(<FileDropzone onFiles={vi.fn()} progress={{ label: 'Hashing…' }} />);

    expect(screen.getByRole('progressbar')).not.toHaveAttribute(
      'aria-valuenow',
    );
  });

  it('stops accepting files while busy', () => {
    const { container } = render(
      <FileDropzone onFiles={vi.fn()} progress={{ value: 10 }} />,
    );

    expect(container.querySelector('input[type="file"]')).toBeDisabled();
  });

  it('shows an error the caller decided on', () => {
    render(
      <FileDropzone onFiles={vi.fn()} error="That file is larger than 25MB." />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'That file is larger than 25MB.',
    );
  });
});

describe('PasswordField', () => {
  it('renders with only its required props', () => {
    // `/^password/i` rather than `/password/i`: the reveal toggle is also
    // labelled "Show password", so the loose pattern matches two elements.
    render(<PasswordField value="" onChange={vi.fn()} />);

    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
  });

  it('masks the value until the toggle is used', async () => {
    const user = userEvent.setup();
    render(<PasswordField value="hunter2" onChange={vi.fn()} />);

    const input = screen.getByLabelText(/^password/i);
    expect(input).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('says whether the password is currently visible', () => {
    // A toggle labelled only with an icon leaves a screen reader user unable
    // to tell whether their password is on screen.
    render(<PasswordField value="x" onChange={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'Show password' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('never submits the form when revealing', () => {
    // A <button> with no type inside a form submits it, so revealing your
    // password would attempt a sign-in.
    render(<PasswordField value="x" onChange={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'Show password' }),
    ).toHaveAttribute('type', 'button');
  });

  it('reports every keystroke to the caller', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<PasswordField value="" onChange={onChange} />);
    await user.type(screen.getByLabelText(/^password/i), 'abc');

    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('computes no strength of its own', () => {
    // The real policy is a pure function in core and the server applies it.
    // A second implementation here would drift, and the drift would show as
    // a field saying "strong" about a password the server then rejects.
    render(<PasswordField value="a-very-long-passphrase" onChange={vi.fn()} />);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('renders the strength it is handed', () => {
    render(
      <PasswordField
        value="x"
        onChange={vi.fn()}
        strength={{ score: 3, label: 'Long enough' }}
      />,
    );

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '75',
    );
    expect(screen.getByText('Long enough')).toBeInTheDocument();
  });

  it('shows an empty bar at score zero rather than hiding it', () => {
    render(
      <PasswordField value="x" onChange={vi.fn()} strength={{ score: 0 }} />,
    );

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
  });

  it('shows the caller error in place of the helper text', () => {
    render(
      <PasswordField
        value="x"
        onChange={vi.fn()}
        helperText="At least 12 characters."
        error="Password rejected: too_short."
      />,
    );

    expect(
      screen.getByText('Password rejected: too_short.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('At least 12 characters.'),
    ).not.toBeInTheDocument();
  });

  it('asks the browser for the right autofill behaviour', () => {
    render(
      <PasswordField
        value=""
        onChange={vi.fn()}
        label="New password"
        autoComplete="new-password"
      />,
    );

    expect(screen.getByLabelText(/new password/i)).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
  });

  it('calls onSubmitKey when Enter is pressed', async () => {
    const user = userEvent.setup();
    const onSubmitKey = vi.fn();

    render(
      <PasswordField value="x" onChange={vi.fn()} onSubmitKey={onSubmitKey} />,
    );
    await user.type(screen.getByLabelText(/^password/i), '{Enter}');

    expect(onSubmitKey).toHaveBeenCalledOnce();
  });
});

describe('UserMenu', () => {
  it('renders with only its required prop', () => {
    render(<UserMenu username="admin" />);

    expect(screen.getByRole('button', { name: /admin/ })).toBeInTheDocument();
  });

  it('opens on click and shows who is signed in', async () => {
    const user = userEvent.setup();
    render(<UserMenu username="admin" onSignOut={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /admin/ }));

    expect(screen.getByText('Signed in as')).toBeInTheDocument();
  });

  it('signs out through the callback it was given', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();

    render(<UserMenu username="admin" onSignOut={onSignOut} />);
    await user.click(screen.getByRole('button', { name: /admin/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('closes the menu before acting', async () => {
    // A menu still open over the screen it just navigated to is a bug that
    // only shows up in a real browser, so the ordering is pinned here.
    const user = userEvent.setup();
    const onSignOut = vi.fn();

    render(<UserMenu username="admin" onSignOut={onSignOut} />);
    await user.click(screen.getByRole('button', { name: /admin/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('omits an entry whose callback was not supplied', async () => {
    const user = userEvent.setup();
    render(<UserMenu username="admin" onSignOut={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /admin/ }));

    expect(
      screen.queryByRole('menuitem', { name: /change username/i }),
    ).not.toBeInTheDocument();
  });

  it('renders extra items in order', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <UserMenu
        username="kd"
        items={[{ label: 'Keyboard shortcuts', onClick }]}
        onSignOut={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /kd/ }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Keyboard shortcuts' }),
    );

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('marks a standing must-change state, not a dismissible one', async () => {
    // While the flag is set every data route is closed (F15), so this is the
    // condition the person is in — it should still be visible on the fourth
    // visit, not a toast that appeared once.
    const user = userEvent.setup();
    render(
      <UserMenu username="admin" mustChangePassword onSignOut={vi.fn()} />,
    );

    expect(
      screen.getByTitle('The default password is still in place'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /admin/ }));
    expect(
      screen.getByText('The default password is still in place.'),
    ).toBeInTheDocument();
  });

  it('reads nothing about the session itself', () => {
    // Every fact is a prop. There is no `/auth/me` call in here; if there
    // were, the MSW handler with `onUnhandledRequest: 'error'` would say so.
    render(<UserMenu username="somebody-else" />);

    expect(
      screen.getByRole('button', { name: /somebody-else/ }),
    ).toBeInTheDocument();
  });
});

describe('SelectWithCreate', () => {
  const OPTIONS = [
    { value: '1', label: 'Tradeify' },
    { value: '2', label: 'Rise' },
  ];

  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('combobox', { name: /Company/ }));
  };

  it('reports an ordinary choice by its value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SelectWithCreate
        label="Company"
        value=""
        onChange={onChange}
        options={OPTIONS}
      />,
    );

    await open(user);
    await user.click(screen.getByRole('option', { name: 'Rise' }));

    expect(onChange).toHaveBeenCalledWith('2');
  });

  it('offers no extra item when there is nothing to create', async () => {
    const user = userEvent.setup();

    render(
      <SelectWithCreate
        label="Company"
        value=""
        onChange={vi.fn()}
        options={OPTIONS}
      />,
    );

    await open(user);

    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('calls back for the create item instead of choosing it', async () => {
    // The value has to stay exactly as it was: a cancelled dialog must leave
    // the form holding what it held, not a sentinel nobody can see.
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onCreate = vi.fn();

    render(
      <SelectWithCreate
        label="Company"
        value="1"
        onChange={onChange}
        options={OPTIONS}
        createLabel="Add a company…"
        onCreate={onCreate}
      />,
    );

    await open(user);
    await user.click(screen.getByRole('option', { name: 'Add a company…' }));

    expect(onCreate).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('drops an option carrying the create item own value', async () => {
    const user = userEvent.setup();

    render(
      <SelectWithCreate
        label="Company"
        value=""
        onChange={vi.fn()}
        options={[...OPTIONS, { value: '__create__', label: 'Impostor' }]}
        onCreate={vi.fn()}
      />,
    );

    await open(user);

    expect(screen.queryByRole('option', { name: 'Impostor' })).toBeNull();
  });
});
