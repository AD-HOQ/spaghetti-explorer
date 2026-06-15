export function getDemoAuditEvents() {
  return [
    { id: "demo-audit-1", activity: "Permission reviewed", actor: "alex@contoso-demo.com", target: "/Finance/Archive/Compensation_2021.xlsx", synthetic: true },
    { id: "demo-audit-2", activity: "Sharing link inspected", actor: "jordan@contoso-demo.com", target: "/Sales/Pipeline/Pipeline_Export.xlsx", synthetic: true },
  ];
}
