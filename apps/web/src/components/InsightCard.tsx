import type { RiskInsight } from "../types";

export function InsightCard({ insight, available, onOpen }: { insight: RiskInsight; available: boolean; onOpen: (insight: RiskInsight) => void }) {
  return (
    <article className="ai-insight-card">
      <div className="ai-insight-card-heading">
        <span className={`insight-severity ${insight.severity.toLowerCase()}`}>{insight.severity}</span>
        <small>{insight.source === "LocalRules" ? "Local Rules" : insight.source === "FabricIQ" ? "Fabric IQ" : "Hybrid"}</small>
      </div>
      <h3>{insight.title}</h3>
      <strong>{insight.resourceName}</strong>
      <code>{insight.resourcePath}</code>
      <p className="insight-summary">{insight.summary}</p>
      <dl>
        {insight.evidence.exposure && <div><dt>Exposure</dt><dd>{insight.evidence.exposure}</dd></div>}
        {insight.evidence.sensitivityLabel && <div><dt>Sensitivity</dt><dd>{insight.evidence.sensitivityLabel}</dd></div>}
        {insight.evidence.daysSinceLastAccess !== undefined && <div><dt>Last accessed</dt><dd>{insight.evidence.daysSinceLastAccess.toLocaleString()} days ago</dd></div>}
        {insight.evidence.principalIds?.length ? <div><dt>Principals</dt><dd>{insight.evidence.principalIds.length}</dd></div> : null}
        {insight.evidence.grantIds?.length ? <div><dt>Grants</dt><dd>{insight.evidence.grantIds.length}</dd></div> : null}
      </dl>
      <p><strong>Recommended action</strong><br />{insight.recommendedAction}</p>
      <button disabled={!available} onClick={() => onOpen(insight)}>
        {available ? "Open resource" : "Resource unavailable"}
      </button>
    </article>
  );
}
