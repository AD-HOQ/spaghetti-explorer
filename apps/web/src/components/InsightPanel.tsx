import { useState } from "react";
import type { RiskInsight } from "../types";
import type { DocumentNode, Principal } from "../types";
import { InsightCard } from "./InsightCard";
import { PermissionModelQuestionPanel } from "./PermissionModelQuestionPanel";

export function InsightPanel({ insights, nodes, principals, onOpen, onOpenNode }: { insights: RiskInsight[]; nodes: DocumentNode[]; principals: Principal[]; onOpen: (insight: RiskInsight) => void; onOpenNode: (node: DocumentNode) => void }) {
  const [mode, setMode] = useState<"ask" | "insights">("ask");
  const availableNodeIds = new Set(nodes.map((node) => node.id));
  return (
    <div className="ai-insight-panel">
      <div className="ai-insight-tabs">
        <button className={mode === "ask" ? "active" : ""} onClick={() => setMode("ask")}>Ask data</button>
        <button className={mode === "insights" ? "active" : ""} onClick={() => setMode("insights")}>Insights <span>{insights.length}</span></button>
      </div>
      {mode === "ask"
        ? <PermissionModelQuestionPanel nodes={nodes} principals={principals} insights={insights} onOpenNode={onOpenNode} />
        : <div className="ai-insight-list">
          {insights.length
            ? insights.map((insight) => <InsightCard key={insight.id} insight={insight} available={availableNodeIds.has(insight.nodeIdToOpen)} onOpen={onOpen} />)
            : <div className="empty-actions">No permission anomalies detected.</div>}
        </div>}
    </div>
  );
}
