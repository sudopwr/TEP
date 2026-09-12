import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '../../../test/render';

import { DataTable, type Column } from './DataTable';
import { MoneyDisplay } from './MoneyDisplay';

/** A row type the component has never heard of. That is the whole point. */
interface Book {
  readonly id: number;
  readonly title: string;
  readonly pages: number;
  readonly priceMinor: string;
}

const BOOKS: readonly Book[] = [
  { id: 1, title: 'Zeno', pages: 9, priceMinor: '900' },
  { id: 2, title: 'Aristotle', pages: 300, priceMinor: '8464293' },
  { id: 3, title: 'Marcus', pages: 120, priceMinor: '12050' },
];

const COLUMNS: readonly Column<Book>[] = [
  {
    id: 'title',
    header: 'Title',
    cell: (book) => book.title,
    sortBy: (book) => book.title,
  },
  {
    id: 'pages',
    header: 'Pages',
    align: 'right',
    cell: (book) => book.pages,
    sortBy: (book) => book.pages,
  },
  {
    id: 'price',
    header: 'Price',
    align: 'right',
    cell: (book) => <MoneyDisplay minor={book.priceMinor} currency="INR" />,
    // The integer, not the rendered string.
    sortBy: (book) => BigInt(book.priceMinor),
  },
  {
    id: 'actions',
    header: '',
    cell: () => <button type="button">Edit</button>,
  },
];

const titles = (): string[] =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '');

describe('DataTable', () => {
  it('renders with only its required props', () => {
    render(<DataTable rows={BOOKS} columns={COLUMNS} rowKey={(b) => b.id} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Aristotle')).toBeInTheDocument();
  });

  it('renders one row per item plus a header', () => {
    render(<DataTable rows={BOOKS} columns={COLUMNS} rowKey={(b) => b.id} />);

    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(
      BOOKS.length + 1,
    );
  });

  it('keeps the caller order until a column is clicked', () => {
    render(<DataTable rows={BOOKS} columns={COLUMNS} rowKey={(b) => b.id} />);

    expect(titles()).toEqual(['Zeno', 'Aristotle', 'Marcus']);
  });

  describe('sorting', () => {
    it('sorts ascending on the first click and descending on the second', async () => {
      const user = userEvent.setup();
      render(<DataTable rows={BOOKS} columns={COLUMNS} rowKey={(b) => b.id} />);

      await user.click(screen.getByRole('button', { name: /title/i }));
      expect(titles()).toEqual(['Aristotle', 'Marcus', 'Zeno']);

      await user.click(screen.getByRole('button', { name: /title/i }));
      expect(titles()).toEqual(['Zeno', 'Marcus', 'Aristotle']);
    });

    it('sorts a money column by its integer, not its rendered text', async () => {
      // As text, "9.00" sorts after "84,642.93". This is the bug the separate
      // `sortBy` exists to make impossible.
      const user = userEvent.setup();
      render(<DataTable rows={BOOKS} columns={COLUMNS} rowKey={(b) => b.id} />);

      await user.click(screen.getByRole('button', { name: /price/i }));

      expect(titles()).toEqual(['Zeno', 'Marcus', 'Aristotle']);
    });

    it('sorts a numeric column numerically', async () => {
      const user = userEvent.setup();
      render(<DataTable rows={BOOKS} columns={COLUMNS} rowKey={(b) => b.id} />);

      await user.click(screen.getByRole('button', { name: /pages/i }));

      expect(titles()).toEqual(['Zeno', 'Marcus', 'Aristotle']);
    });

    it('offers no sort control for a column without sortBy', () => {
      render(<DataTable rows={BOOKS} columns={COLUMNS} rowKey={(b) => b.id} />);

      // Three sortable headers; the actions column has no button.
      const headerRow = within(screen.getByRole('table')).getAllByRole(
        'row',
      )[0];
      expect(
        within(headerRow as HTMLElement).queryAllByRole('button'),
      ).toHaveLength(3);
    });

    it('announces the sort direction to assistive technology', async () => {
      const user = userEvent.setup();
      render(<DataTable rows={BOOKS} columns={COLUMNS} rowKey={(b) => b.id} />);

      await user.click(screen.getByRole('button', { name: /title/i }));

      expect(
        screen.getByRole('columnheader', { name: /title/i }),
      ).toHaveAttribute('aria-sort', 'ascending');
    });

    it('never mutates the rows it was given', async () => {
      const user = userEvent.setup();
      const rows = [...BOOKS];
      const before = rows.map((book) => book.id);

      render(<DataTable rows={rows} columns={COLUMNS} rowKey={(b) => b.id} />);
      await user.click(screen.getByRole('button', { name: /title/i }));

      expect(rows.map((book) => book.id)).toEqual(before);
    });

    it('honours an initial sort', () => {
      render(
        <DataTable
          rows={BOOKS}
          columns={COLUMNS}
          rowKey={(b) => b.id}
          initialSort={{ columnId: 'title', direction: 'asc' }}
        />,
      );

      expect(titles()).toEqual(['Aristotle', 'Marcus', 'Zeno']);
    });

    it('sorts an absent value last in both directions', async () => {
      const user = userEvent.setup();
      const withGap = [
        { id: 1, name: 'b' },
        { id: 2, name: undefined },
        { id: 3, name: 'a' },
      ];
      const columns: Column<(typeof withGap)[number]>[] = [
        {
          id: 'name',
          header: 'Name',
          cell: (row) => row.name ?? '—',
          sortBy: (row) => row.name,
        },
      ];

      render(
        <DataTable rows={withGap} columns={columns} rowKey={(r) => r.id} />,
      );

      await user.click(screen.getByRole('button', { name: /name/i }));
      expect(titles()).toEqual(['a', 'b', '—']);

      await user.click(screen.getByRole('button', { name: /name/i }));
      expect(titles()).toEqual(['b', 'a', '—']);
    });
  });

  describe('loading', () => {
    it('shows skeleton rows instead of data', () => {
      render(
        <DataTable
          rows={[]}
          columns={COLUMNS}
          rowKey={(b) => b.id}
          loading
          loadingRows={4}
        />,
      );

      expect(
        within(screen.getByRole('table')).getAllByRole('row'),
      ).toHaveLength(5);
    });

    it('does not claim the table is empty while it is still loading', () => {
      // The lie this prevents: "No books yet" flashing up before the rows
      // arrive, which reads as a fact and is merely early.
      render(
        <DataTable
          rows={[]}
          columns={COLUMNS}
          rowKey={(b) => b.id}
          loading
          empty={{ message: 'No books yet.' }}
        />,
      );

      expect(screen.queryByText('No books yet.')).not.toBeInTheDocument();
    });

    it('keeps the header visible while loading, so columns do not jump', () => {
      render(
        <DataTable rows={[]} columns={COLUMNS} rowKey={(b) => b.id} loading />,
      );

      expect(screen.getByText('Title')).toBeInTheDocument();
    });
  });

  describe('empty', () => {
    it('shows the empty state once loading is done', () => {
      render(
        <DataTable
          rows={[]}
          columns={COLUMNS}
          rowKey={(b) => b.id}
          empty={{ message: 'No books yet.' }}
        />,
      );

      expect(screen.getByText('No books yet.')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('offers the action it was given', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();

      render(
        <DataTable
          rows={[]}
          columns={COLUMNS}
          rowKey={(b) => b.id}
          empty={{
            message: 'No books yet.',
            action: { label: 'Add one', onClick },
          }}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Add one' }));
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('renders an empty table when no empty state was supplied', () => {
      render(<DataTable rows={[]} columns={COLUMNS} rowKey={(b) => b.id} />);

      expect(
        within(screen.getByRole('table')).getAllByRole('row'),
      ).toHaveLength(1);
    });
  });

  it('calls onRowClick with the row that was clicked', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();

    render(
      <DataTable
        rows={BOOKS}
        columns={COLUMNS}
        rowKey={(b) => b.id}
        onRowClick={onRowClick}
      />,
    );

    await user.click(screen.getByText('Marcus'));

    expect(onRowClick).toHaveBeenCalledWith(BOOKS[2]);
  });

  it('labels the table when given a caption', () => {
    render(
      <DataTable
        rows={BOOKS}
        columns={COLUMNS}
        rowKey={(b) => b.id}
        caption="Reading list"
      />,
    );

    expect(
      screen.getByRole('table', { name: 'Reading list' }),
    ).toBeInTheDocument();
  });
});
