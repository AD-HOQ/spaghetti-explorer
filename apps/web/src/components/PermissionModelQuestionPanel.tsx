import { useState } from "react";
import { askPermissionModel, suggestedPermissionQuestions, type PermissionModelAnswer } from "../services/permissionModelQuestionService";
import type { DocumentNode, Principal, RiskInsight } from "../types";

export function PermissionModelQuestionPanel({
  nodes,
  principals,
  insights,
  onOpenNode,
}: {
  nodes: DocumentNode[];
  principals: Principal[];
  insights: RiskInsight[];
  onOpenNode: (node: DocumentNode) => void;
}) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<PermissionModelAnswer[]>([]);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  const ask = (value = question) => {
    if (!value.trim()) return;
    setHistory((current) => [...current, askPermissionModel(value, { nodes, principals, insights })]);
    setQuestion("");
  };

  return (
    <div className="model-question-panel">
      <div className="model-question-intro">
        <strong>Ask your permission model</strong>
        <p>Answers are calculated locally from the currently loaded hierarchy, principals, grants, and risk insights.</p>
      </div>
      {!history.length && <div className="model-question-suggestions">
        {suggestedPermissionQuestions.map((suggestion) => <button key={suggestion} onClick={() => ask(suggestion)}>{suggestion}</button>)}
      </div>}
      <div className="model-question-history">
        {history.map((item, index) => (
          <article className="model-answer" key={`${item.question}-${index}`}>
            <small>You asked</small>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
            <ul>{item.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>
            {item.nodeIds.length > 0 && <div className="model-answer-resources">
              {item.nodeIds.slice(0, 8).map((nodeId) => {
                const node = nodesById.get(nodeId);
                return node ? <button key={nodeId} onClick={() => onOpenNode(node)}><strong>{node.name}</strong><small>{node.path}</small></button> : null;
              })}
            </div>}
            <em>{item.source}</em>
          </article>
        ))}
      </div>
      <form className="model-question-form" onSubmit={(event) => { event.preventDefault(); ask(); }}>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask who has access, what is risky, or where permissions come from..." rows={2} />
        <button disabled={!question.trim()} type="submit">Ask model</button>
      </form>
    </div>
  );
}
