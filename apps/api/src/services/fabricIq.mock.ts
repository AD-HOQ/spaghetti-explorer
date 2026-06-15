export function getDemoRiskInsights() {
  return [
    {
      id: "risk-001",
      title: "Dormant file broadly shared",
      severity: "High",
      resourceName: "Compensation_2021.xlsx",
      resourcePath: "/Finance/Archive/Compensation_2021.xlsx",
      lastAccessedDaysAgo: 1240,
      exposure: "Everyone Except External Users",
      recommendedAction: "Review inherited permissions and restrict access.",
      nodeIdToOpen: "file-compensation-2021",
    },
    {
      id: "risk-002",
      title: "Anonymous link on sensitive folder",
      severity: "Critical",
      resourceName: "M&A Planning",
      resourcePath: "/Legal/M&A Planning",
      exposure: "Anyone with the link",
      recommendedAction: "Remove anonymous sharing link and review direct permissions.",
      nodeIdToOpen: "folder-legal-ma",
    },
    {
      id: "risk-003",
      title: "Ownerless site with broad access",
      severity: "Medium",
      resourceName: "Legacy Projects",
      resourcePath: "/sites/legacy-projects",
      exposure: "All Employees",
      recommendedAction: "Assign site owners and review group membership.",
      nodeIdToOpen: "site-legacy-projects",
    },
  ];
}
