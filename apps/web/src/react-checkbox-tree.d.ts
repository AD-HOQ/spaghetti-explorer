declare module "react-checkbox-tree" {
  import type { ReactNode } from "react";

  export type TreeNode = {
    value: string;
    label: ReactNode;
    children?: TreeNode[];
    disabled?: boolean;
    className?: string;
  };

  export default function CheckboxTree(props: {
    nodes: TreeNode[];
    checked: string[];
    expanded: string[];
    onCheck: (checked: string[]) => void;
    onExpand: (expanded: string[]) => void;
    icons?: Record<string, ReactNode>;
    noCascade?: boolean;
    showExpandAll?: boolean;
  }): ReactNode;
}
