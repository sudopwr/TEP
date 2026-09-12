import { describe, expect, it } from 'vitest';

import { render, screen, within } from '../../../test/render';

import { MoneyDisplay } from './MoneyDisplay';
import { TreeView } from './TreeView';

/**
 * A shape with nothing to do with money, to prove the component is generic.
 * If `TreeView` ever needs to know what a transaction is, it has failed.
 */
interface Folder {
  readonly name: string;
  readonly items?: readonly Folder[];
}

const FOLDERS: readonly Folder[] = [
  {
    name: 'root',
    items: [
      { name: 'child-a', items: [{ name: 'grandchild' }] },
      { name: 'child-b' },
    ],
  },
  { name: 'second-root' },
];

const basicProps = {
  nodes: FOLDERS,
  childrenOf: (node: Folder) => node.items ?? [],
  keyOf: (node: Folder) => node.name,
  renderNode: (node: Folder) => node.name,
};

describe('TreeView', () => {
  it('renders with only its required props', () => {
    render(<TreeView {...basicProps} />);

    expect(screen.getByText('root')).toBeInTheDocument();
  });

  it('renders every node at every depth', () => {
    render(<TreeView {...basicProps} />);

    for (const name of [
      'root',
      'child-a',
      'grandchild',
      'child-b',
      'second-root',
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('walks children in order, depth first', () => {
    render(<TreeView {...basicProps} />);

    const rendered = screen
      .getAllByRole('treeitem')
      .map((item) => item.textContent);

    expect(rendered).toEqual([
      'root',
      'child-a',
      'grandchild',
      'child-b',
      'second-root',
    ]);
  });

  it('passes the depth to the render prop', () => {
    render(
      <TreeView
        {...basicProps}
        renderNode={(node, context) => `${node.name}@${String(context.depth)}`}
      />,
    );

    expect(screen.getByText('root@0')).toBeInTheDocument();
    expect(screen.getByText('child-a@1')).toBeInTheDocument();
    expect(screen.getByText('grandchild@2')).toBeInTheDocument();
  });

  it('tells the render prop which node is last among its siblings', () => {
    render(
      <TreeView
        {...basicProps}
        renderNode={(node, context) =>
          `${node.name}${context.isLast ? ' (last)' : ''}`
        }
      />,
    );

    expect(screen.getByText('child-b (last)')).toBeInTheDocument();
    expect(screen.getByText('second-root (last)')).toBeInTheDocument();
    expect(screen.getByText('child-a')).toBeInTheDocument();
  });

  it('tells the render prop whether a node has children', () => {
    render(
      <TreeView
        {...basicProps}
        renderNode={(node, context) =>
          `${node.name}${context.hasChildren ? ' +' : ''}`
        }
      />,
    );

    expect(screen.getByText('root +')).toBeInTheDocument();
    expect(screen.getByText('child-b')).toBeInTheDocument();
  });

  describe('the aside column', () => {
    it('renders beside each node when supplied', () => {
      render(
        <TreeView
          {...basicProps}
          renderAside={(node) => <span>aside:{node.name}</span>}
        />,
      );

      expect(screen.getByText(/aside:grandchild/)).toBeInTheDocument();
    });

    it('is never indented, so figures read straight down', () => {
      // The whole reason the row splits in two. If the amount were inside the
      // indented label, a column of money would become a staircase and the
      // question "where did it shrink" stops being answerable at a glance.
      render(
        <TreeView
          {...basicProps}
          renderAside={(node) => (
            <MoneyDisplay minor="8464293" currency="INR" title={node.name} />
          )}
        />,
      );

      const amounts = screen.getAllByText('84,642.93');
      const paddings = amounts.map((amount) => {
        const cell = amount.parentElement;
        return window.getComputedStyle(cell as Element).paddingLeft;
      });

      // Every aside shares one padding, whatever the node's depth.
      expect(new Set(paddings).size).toBe(1);
    });

    it('indents the label and only the label', () => {
      render(<TreeView {...basicProps} indent={20} />);

      const root = screen.getByText('root').closest('[role="treeitem"]');
      const deep = screen.getByText('grandchild').closest('[role="treeitem"]');

      const labelPadding = (item: Element | null): string =>
        window.getComputedStyle(
          (item as HTMLElement).firstElementChild as Element,
        ).paddingLeft;

      expect(labelPadding(root)).toBe('0px');
      expect(labelPadding(deep)).toBe('40px');
    });
  });

  describe('accessibility', () => {
    it('is a tree, with a level on every item', () => {
      render(<TreeView {...basicProps} ariaLabel="Folders" />);

      const tree = screen.getByRole('tree', { name: 'Folders' });
      const items = within(tree).getAllByRole('treeitem');

      expect(items).toHaveLength(5);
      expect(items.map((item) => item.getAttribute('aria-level'))).toEqual([
        '1',
        '2',
        '3',
        '2',
        '1',
      ]);
    });

    it('marks a node with children as expanded and a leaf as neither', () => {
      render(<TreeView {...basicProps} />);

      const root = screen.getByText('root').closest('[role="treeitem"]');
      const leaf = screen.getByText('child-b').closest('[role="treeitem"]');

      expect(root).toHaveAttribute('aria-expanded', 'true');
      expect(leaf).not.toHaveAttribute('aria-expanded');
    });
  });

  it('renders nothing for an empty forest', () => {
    render(<TreeView {...basicProps} nodes={[]} />);

    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });

  it('handles a node whose children array is empty', () => {
    render(<TreeView {...basicProps} nodes={[{ name: 'alone', items: [] }]} />);

    expect(screen.getByText('alone')).toBeInTheDocument();
  });

  it('works on a deep chain without special-casing depth', () => {
    const deep: Folder = {
      name: 'l0',
      items: [{ name: 'l1', items: [{ name: 'l2', items: [{ name: 'l3' }] }] }],
    };

    render(<TreeView {...basicProps} nodes={[deep]} />);

    expect(screen.getAllByRole('treeitem')).toHaveLength(4);
    expect(screen.getByText('l3').closest('[role="treeitem"]')).toHaveAttribute(
      'aria-level',
      '4',
    );
  });
});
