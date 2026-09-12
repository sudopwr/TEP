import Box from '@mui/material/Box';
import { Fragment, type ReactNode } from 'react';

/**
 * A recursive renderer for anything shaped like a tree. It has never heard of
 * a transaction, a payout, or a hop.
 *
 * ```tsx
 * interface Folder { name: string; items?: Folder[] }
 *
 * <TreeView<Folder>
 *   nodes={folders}
 *   childrenOf={(node) => node.items ?? []}
 *   keyOf={(node) => node.name}
 *   renderNode={(node, { depth, isLast }) => <span>{node.name} at depth {depth}</span>}
 * />
 *
 * // Amounts held at a fixed x whatever the depth: the indent belongs to the
 * // label column, so the figures still read straight down the page.
 * <TreeView
 *   nodes={legs}
 *   childrenOf={(leg) => leg.children}
 *   keyOf={(leg) => leg.id}
 *   renderNode={(leg) => leg.code}
 *   renderAside={(leg) => <MoneyDisplay minor={leg.minor} currency={leg.currency} />}
 * />
 * ```
 */

export interface TreeNodeContext {
  /** 0 for a root. Useful for a label, never needed for the indent. */
  readonly depth: number;
  /** Last among its siblings — the connector stops here rather than running on. */
  readonly isLast: boolean;
  readonly hasChildren: boolean;
  /** Position among siblings, from 0. */
  readonly index: number;
}

export interface TreeViewProps<Node> {
  readonly nodes: readonly Node[];
  /** Return this node's children. Return `[]` for a leaf. */
  readonly childrenOf: (node: Node) => readonly Node[];
  readonly keyOf: (node: Node) => string | number;
  /** The label column. Indented by depth. */
  readonly renderNode: (node: Node, context: TreeNodeContext) => ReactNode;
  /**
   * The right-hand column, never indented.
   *
   * This is the whole reason the component splits a row in two. Indenting the
   * amounts along with their labels would make a column of figures into a
   * staircase, and the one question a money trail has to answer — where did
   * it shrink — becomes unreadable.
   */
  readonly renderAside?: (node: Node, context: TreeNodeContext) => ReactNode;
  /** Pixels per level. */
  readonly indent?: number;
  readonly ariaLabel?: string;
}

const DEFAULT_INDENT = 20;

interface BranchProps<Node> extends TreeViewProps<Node> {
  readonly depth: number;
}

function Branch<Node>({
  nodes,
  childrenOf,
  keyOf,
  renderNode,
  renderAside,
  indent = DEFAULT_INDENT,
  depth,
}: BranchProps<Node>) {
  return (
    <>
      {nodes.map((node, index) => {
        const children = childrenOf(node);
        const context: TreeNodeContext = {
          depth,
          index,
          isLast: index === nodes.length - 1,
          hasChildren: children.length > 0,
        };

        return (
          <Fragment key={keyOf(node)}>
            <Box
              component="li"
              role="treeitem"
              aria-level={depth + 1}
              aria-setsize={nodes.length}
              aria-posinset={index + 1}
              {...(context.hasChildren ? { 'aria-expanded': true } : {})}
              sx={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 2,
                py: 0.5,
                listStyle: 'none',
              }}
            >
              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  pl: `${String(depth * indent)}px`,
                  // A rule down the left of each level, so a deep node can be
                  // traced back to its parent without counting pixels.
                  borderLeft: depth === 0 ? 'none' : '1px solid',
                  borderColor: 'divider',
                  ml: depth === 0 ? 0 : 0.5,
                }}
              >
                {renderNode(node, context)}
              </Box>

              {renderAside === undefined ? null : (
                <Box sx={{ flexShrink: 0 }}>{renderAside(node, context)}</Box>
              )}
            </Box>

            {children.length === 0 ? null : (
              <Branch
                nodes={children}
                childrenOf={childrenOf}
                keyOf={keyOf}
                renderNode={renderNode}
                {...(renderAside === undefined ? {} : { renderAside })}
                indent={indent}
                depth={depth + 1}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * Flat in the DOM, indented visually.
 *
 * Nested `<ul>` elements would nest the *asides* too, and then the amount
 * column could not be held at one x-position. So every node is a sibling
 * `<li>` in one list and depth is expressed as left padding on the label
 * only. A screen reader gets `role="tree"` and per-node `aria-level`, which
 * is what actually conveys the nesting.
 */
export function TreeView<Node>(props: TreeViewProps<Node>) {
  return (
    <Box
      component="ul"
      role="tree"
      {...(props.ariaLabel === undefined
        ? {}
        : { 'aria-label': props.ariaLabel })}
      sx={{ m: 0, p: 0, listStyle: 'none' }}
    >
      <Branch {...props} depth={0} />
    </Box>
  );
}
