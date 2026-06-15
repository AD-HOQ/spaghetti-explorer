import type { DocumentNode, Principal, RiskInsight } from "../types";

export type PermissionModelAnswer = {
  question: string;
  answer: string;
  evidence: string[];
  nodeIds: string[];
  source: "Local model";
};

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function findResource(question: string, nodes: DocumentNode[]) {
  const query = normalized(question);
  return [...nodes]
    .filter((node) => query.includes(normalized(node.name)) || query.includes(normalized(node.path ?? "")))
    .sort((left, right) => right.name.length - left.name.length)[0];
}

function findPrincipal(question: string, principals: Principal[]) {
  const query = normalized(question);
  return [...principals]
    .filter((principal) => query.includes(normalized(principal.displayName)) || Boolean(principal.email && query.includes(normalized(principal.email))))
    .sort((left, right) => right.displayName.length - left.displayName.length)[0];
}

function formatType(node: DocumentNode) {
  return node.nodeType === "document" ? "file" : node.nodeType;
}

export function askPermissionModel(
  question: string,
  model: { nodes: DocumentNode[]; principals: Principal[]; insights: RiskInsight[] },
): PermissionModelAnswer {
  const query = normalized(question);
  const { nodes, principals, insights } = model;
  const resource = findResource(question, nodes);
  const principal = findPrincipal(question, principals);
  const risksByNode = new Map<string, RiskInsight[]>();
  insights.forEach((insight) => risksByNode.set(insight.nodeIdToOpen, [...(risksByNode.get(insight.nodeIdToOpen) ?? []), insight]));

  if (resource && (query.includes("who") || query.includes("principal") || query.includes("access"))) {
    const access = resource.accessDetails.accessiblePrincipals;
    const names = access.slice(0, 8).map((item) => item.displayName);
    return {
      question,
      answer: access.length
        ? `${access.length} principals are recorded with access to ${resource.name}.`
        : `No principal-level access records are available for ${resource.name} in the current model view.`,
      evidence: [
        ...names.map((name) => `Access: ${name}`),
        ...(access.length > names.length ? [`Plus ${access.length - names.length} more principals.`] : []),
        `Path: ${resource.path ?? resource.name}`,
      ],
      nodeIds: [resource.id],
      source: "Local model",
    };
  }

  if (principal && (query.includes("access") || query.includes("see") || query.includes("resource"))) {
    const accessible = nodes.filter((node) =>
      node.accessDetails.accessiblePrincipals.some((item) => item.id === principal.id)
      || (node.accessDetails.selectedPrincipal === principal.displayName && node.hasAccess),
    );
    return {
      question,
      answer: `${principal.displayName} can access ${accessible.length} resources represented in the current model.`,
      evidence: [
        ...accessible.slice(0, 8).map((node) => `${formatType(node)}: ${node.path ?? node.name}`),
        ...(accessible.length > 8 ? [`Plus ${accessible.length - 8} more resources.`] : []),
      ],
      nodeIds: accessible.slice(0, 25).map((node) => node.id),
      source: "Local model",
    };
  }

  if (query.includes("risk") || query.includes("anomal") || query.includes("danger") || query.includes("exposure")) {
    const matches = insights.filter((insight) =>
      !query.includes("critical") || insight.severity === "Critical",
    );
    return {
      question,
      answer: `${matches.length} ${query.includes("critical") ? "critical " : ""}permission-risk insights are open. ${matches[0] ? `The highest-priority finding is “${matches[0].title}” on ${matches[0].resourceName}.` : ""}`.trim(),
      evidence: matches.slice(0, 8).map((insight) => `${insight.severity}: ${insight.title} · ${insight.resourcePath}`),
      nodeIds: unique(matches.map((insight) => insight.nodeIdToOpen)),
      source: "Local model",
    };
  }

  if (query.includes("sharing link") || query.includes("direct permission") || query.includes("multiple method") || query.includes("2+")) {
    const type = query.includes("sharing link") ? "sharing_link" : query.includes("direct") ? "direct" : null;
    const matches = nodes.filter((node) => type
      ? node.accessDetails.grantMethods.some((method) => method.type === type)
      : node.accessDetails.grantMethodCount >= 2);
    return {
      question,
      answer: `${matches.length} resources match the requested permission-grant pattern.`,
      evidence: matches.slice(0, 8).map((node) => `${node.name}: ${node.accessDetails.grantMethods.map((method) => method.label).join(", ") || "No grant details"}`),
      nodeIds: matches.slice(0, 25).map((node) => node.id),
      source: "Local model",
    };
  }

  if (query.includes("largest") || query.includes("biggest") || query.includes("size")) {
    const matches = [...nodes].filter((node) => node.sizeBytes > 0).sort((left, right) => right.sizeBytes - left.sizeBytes).slice(0, 10);
    return {
      question,
      answer: `The model contains ${nodes.filter((node) => node.sizeBytes > 0).length} files with recorded size. These are the largest.`,
      evidence: matches.map((node) => `${node.name}: ${(node.sizeBytes / 1_000_000).toFixed(1)} MB`),
      nodeIds: matches.map((node) => node.id),
      source: "Local model",
    };
  }

  if (query.includes("how many") || query.includes("count") || query.includes("summary") || query.includes("overview")) {
    const counts = {
      sites: nodes.filter((node) => node.nodeType === "site").length,
      libraries: nodes.filter((node) => node.nodeType === "library").length,
      folders: nodes.filter((node) => node.nodeType === "folder").length,
      files: nodes.filter((node) => node.nodeType === "document").length,
      accessible: nodes.filter((node) => node.hasAccess).length,
    };
    return {
      question,
      answer: `The current model contains ${nodes.length} resources: ${counts.sites} sites, ${counts.libraries} libraries, ${counts.folders} folders, and ${counts.files} files.`,
      evidence: [`${counts.accessible} resources are accessible in the current access view.`, `${principals.length} users, groups, and guests are loaded.`, `${insights.length} anomaly insights are open.`],
      nodeIds: [],
      source: "Local model",
    };
  }

  const broad = nodes.filter((node) => node.accessDetails.grantMethods.some((method) =>
    method.grantedBy?.toLowerCase().includes("everyone")
    || method.grantedBy?.toLowerCase().includes("organization")
    || method.type === "sharing_link",
  ));
  return {
    question,
    answer: "I can answer deterministic questions about resources, access, principals, grant methods, file sizes, and permission risks. Try one of the suggested questions.",
    evidence: [`Current model: ${nodes.length} resources, ${principals.length} principals, ${insights.length} risks.`, `${broad.length} resources have broad-access or sharing-link indicators.`],
    nodeIds: broad.slice(0, 10).map((node) => node.id),
    source: "Local model",
  };
}

export const suggestedPermissionQuestions = [
  "Give me an overview of the permission model",
  "What are the highest permission risks?",
  "Show resources with sharing links",
  "Show resources with 2+ access methods",
  "What are the largest files?",
];
