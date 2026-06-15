export const demoTenantId = "11111111-1111-4111-8111-111111111111";

export const demoPrincipals = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Alex Demo", email: "alex@contoso-demo.com", principalType: "user", jobTitle: "Director of Operations", manager: "Morgan Demo", directReports: ["Jordan Demo", "Casey Demo"], description: null, memberships: [{ id: "12121212-1212-4212-8212-121212121212", displayName: "Everyone Except External Users", groupType: "domain" }, { id: "34343434-3434-4434-8434-343434343434", displayName: "Contoso Demo Operations Leadership", groupType: "m365" }, { id: "56565656-5656-4565-8565-565656565656", displayName: "Contoso Demo Site Owners", groupType: "security" }] },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", displayName: "Jordan Demo", email: "jordan@contoso-demo.com", principalType: "user", jobTitle: "Project Manager", manager: "Alex Demo", directReports: ["Taylor Demo"], description: null, memberships: [{ id: "12121212-1212-4212-8212-121212121212", displayName: "Everyone Except External Users", groupType: "domain" }, { id: "78787878-7878-4787-8787-787878787878", displayName: "Contoso Demo Project Contributors", groupType: "m365" }] },
  { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", displayName: "Morgan Demo", email: "morgan@contoso-demo.com", principalType: "user", jobTitle: "Vice President of Operations", manager: null, directReports: ["Alex Demo"], description: null, memberships: [{ id: "12121212-1212-4212-8212-121212121212", displayName: "Everyone Except External Users", groupType: "domain" }, { id: "34343434-3434-4434-8434-343434343434", displayName: "Contoso Demo Operations Leadership", groupType: "m365" }, { id: "56565656-5656-4565-8565-565656565656", displayName: "Contoso Demo Site Owners", groupType: "security" }] },
  { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", displayName: "Casey Demo", email: "casey@contoso-demo.com", principalType: "user", jobTitle: "Operations Manager", manager: "Alex Demo", directReports: [], description: null, memberships: [{ id: "12121212-1212-4212-8212-121212121212", displayName: "Everyone Except External Users", groupType: "domain" }, { id: "34343434-3434-4434-8434-343434343434", displayName: "Contoso Demo Operations Leadership", groupType: "m365" }] },
  { id: "99999999-9999-4999-8999-999999999999", displayName: "Taylor Demo", email: "taylor@contoso-demo.com", principalType: "user", jobTitle: "Project Coordinator", manager: "Jordan Demo", directReports: [], description: null, memberships: [{ id: "12121212-1212-4212-8212-121212121212", displayName: "Everyone Except External Users", groupType: "domain" }, { id: "78787878-7878-4787-8787-787878787878", displayName: "Contoso Demo Project Contributors", groupType: "m365" }] },
  { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", displayName: "Contoso Demo Finance Team", email: "finance-team@contoso-demo.com", principalType: "group", groupType: "security", jobTitle: null, manager: null, directReports: [], description: "Security group for finance reporting, planning, and budget access.", members: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Alex Demo", email: "alex@contoso-demo.com" }, { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", displayName: "Jordan Demo", email: "jordan@contoso-demo.com" }] },
  { id: "12121212-1212-4212-8212-121212121212", displayName: "Everyone Except External Users", email: "everyone-except-external@contoso-demo.com", principalType: "group", groupType: "domain", jobTitle: null, manager: null, directReports: [], description: "Tenant-wide domain group.", members: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Alex Demo", email: "alex@contoso-demo.com" }, { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", displayName: "Jordan Demo", email: "jordan@contoso-demo.com" }, { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", displayName: "Morgan Demo", email: "morgan@contoso-demo.com" }, { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", displayName: "Casey Demo", email: "casey@contoso-demo.com" }, { id: "99999999-9999-4999-8999-999999999999", displayName: "Taylor Demo", email: "taylor@contoso-demo.com" }] },
  { id: "34343434-3434-4434-8434-343434343434", displayName: "Contoso Demo Operations Leadership", email: "operations-leadership@contoso-demo.com", principalType: "group", groupType: "m365", jobTitle: null, manager: null, directReports: [], description: "M365 group for operations leadership.", members: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Alex Demo", email: "alex@contoso-demo.com" }, { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", displayName: "Morgan Demo", email: "morgan@contoso-demo.com" }, { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", displayName: "Casey Demo", email: "casey@contoso-demo.com" }] },
  { id: "56565656-5656-4565-8565-565656565656", displayName: "Contoso Demo Site Owners", email: null, principalType: "group", groupType: "security", jobTitle: null, manager: null, directReports: [], description: "Security group for SharePoint site owners.", members: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Alex Demo", email: "alex@contoso-demo.com" }, { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", displayName: "Morgan Demo", email: "morgan@contoso-demo.com" }] },
  { id: "78787878-7878-4787-8787-787878787878", displayName: "Contoso Demo Project Contributors", email: "project-contributors@contoso-demo.com", principalType: "group", groupType: "m365", jobTitle: null, manager: null, directReports: [], description: "M365 group for active project contributors.", members: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", displayName: "Jordan Demo", email: "jordan@contoso-demo.com" }, { id: "99999999-9999-4999-8999-999999999999", displayName: "Taylor Demo", email: "taylor@contoso-demo.com" }] },
  { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", displayName: "Riley Demo Guest", email: "riley.external@contoso-demo.com", principalType: "guest", jobTitle: "External Consultant", manager: null, directReports: [], description: null },
  { id: "10101010-1010-4010-8010-101010101010", displayName: "Elena Demo Guest", email: "elena.external@contoso-demo.com", principalType: "guest", jobTitle: "External Auditor", manager: null, directReports: [], description: null },
  { id: "20202020-2020-4020-8020-202020202020", displayName: "Noor Demo Guest", email: "noor.external@contoso-demo.com", principalType: "guest", jobTitle: "Outside Counsel", manager: null, directReports: [], description: null },
  { id: "30303030-3030-4030-8030-303030303030", displayName: "Sam Demo Guest", email: "sam.external@contoso-demo.com", principalType: "guest", jobTitle: "Training Partner", manager: null, directReports: [], description: null },
];

type NodeType = "site" | "library" | "folder" | "document";
type DemoNode = {
  id: string;
  parentId: string | null;
  nodeType: NodeType;
  name: string;
  path: string;
  depth: number;
  accessGroup: "all" | "finance" | "people" | "projects" | "leadership";
};

const demoNodes: DemoNode[] = [];
let sequence = 1;

function addNode(
  parent: DemoNode | null,
  nodeType: NodeType,
  name: string,
  accessGroup: DemoNode["accessGroup"],
  explicitId?: string,
): DemoNode {
  const pathPart = encodeURIComponent(name).replaceAll("%20", " ");
  const node: DemoNode = {
    id: explicitId ?? `${String(sequence++).padStart(8, "0")}-0000-4000-8000-000000000000`,
    parentId: parent?.id ?? null,
    nodeType,
    name,
    path: parent ? `${parent.path}/${pathPart}` : `/sites/${pathPart.toLowerCase().replaceAll(" ", "-")}`,
    depth: parent ? parent.depth + 1 : 0,
    accessGroup,
  };
  demoNodes.push(node);
  return node;
}

function addDocuments(parent: DemoNode, names: string[], accessGroup = parent.accessGroup) {
  names.forEach((name) => addNode(parent, "document", name, accessGroup));
}

const operations = addNode(null, "site", "Operations Hub", "all");
const shared = addNode(operations, "library", "Shared Documents", "all");
const policies = addNode(shared, "folder", "Policies", "all");
addDocuments(policies, ["Remote Work Policy.pdf", "Expense Policy.pdf", "Security Standards.docx"]);
const procedures = addNode(shared, "folder", "Procedures", "all");
const onboarding = addNode(procedures, "folder", "Onboarding", "people");
addDocuments(onboarding, ["New Hire Checklist.docx", "First Week Schedule.xlsx", "Manager Guide.pdf"], "people");
const operationsFolder = addNode(procedures, "folder", "Daily Operations", "all");
addDocuments(operationsFolder, ["Opening Checklist.docx", "Incident Runbook.pdf", "Vendor Contacts.xlsx"]);

const financeLibrary = addNode(operations, "library", "Finance", "finance");
const budgets = addNode(financeLibrary, "folder", "Budgets", "finance");
const fy26 = addNode(budgets, "folder", "FY26", "finance");
addDocuments(fy26, ["FY26 Budget.xlsx", "Forecast Q1.xlsx", "Forecast Q2.xlsx", "Assumptions.docx"], "finance");
const reports = addNode(financeLibrary, "folder", "Reports", "finance");
addDocuments(reports, ["Monthly Close.xlsx", "Cash Flow.pdf", "Variance Analysis.pptx"], "finance");
const financeArchive = addNode(financeLibrary, "folder", "Archive", "finance");
addNode(financeArchive, "document", "Compensation_2021.xlsx", "finance", "file-compensation-2021");

const peopleLibrary = addNode(operations, "library", "People & Culture", "people");
const benefits = addNode(peopleLibrary, "folder", "Benefits", "people");
addDocuments(benefits, ["Benefits Guide.pdf", "Enrollment Form.docx", "Provider Directory.xlsx"], "people");
const recruiting = addNode(peopleLibrary, "folder", "Recruiting", "people");
const templates = addNode(recruiting, "folder", "Templates", "people");
addDocuments(templates, ["Job Description.docx", "Interview Scorecard.xlsx", "Offer Letter.docx"], "people");

const projects = addNode(null, "site", "Project Delivery", "projects");
const activeProjects = addNode(projects, "library", "Active Projects", "projects");
const atlas = addNode(activeProjects, "folder", "Project Atlas", "projects");
const atlasDesign = addNode(atlas, "folder", "Design", "projects");
addDocuments(atlasDesign, ["Architecture.pdf", "Data Model.xlsx", "Wireframes.fig"], "projects");
const atlasDelivery = addNode(atlas, "folder", "Delivery", "projects");
addDocuments(atlasDelivery, ["Project Plan.mpp", "RAID Log.xlsx", "Status Report.pptx"], "projects");
const beacon = addNode(activeProjects, "folder", "Project Beacon", "projects");
addDocuments(beacon, ["Charter.docx", "Requirements.xlsx", "Timeline.pdf"], "projects");

const archive = addNode(projects, "library", "Project Archive", "projects");
const fy25Archive = addNode(archive, "folder", "FY25", "projects");
addDocuments(fy25Archive, ["Project Cedar.zip", "Project Delta.zip", "Lessons Learned.docx"], "projects");
const fy24Archive = addNode(archive, "folder", "FY24", "projects");
addDocuments(fy24Archive, ["Project Ember.zip", "Project Falcon.zip"], "projects");

const leadership = addNode(null, "site", "Leadership Center", "leadership");
const board = addNode(leadership, "library", "Board Materials", "leadership");
const meetings = addNode(board, "folder", "Meetings", "leadership");
const june = addNode(meetings, "folder", "June 2026", "leadership");
addNode(june, "document", "Agenda.docx", "leadership");
addNode(june, "document", "Board Pack.pdf", "leadership", "file-board-pack");
addNode(june, "document", "Minutes.docx", "leadership");
const strategy = addNode(board, "folder", "Strategy", "leadership");
addDocuments(strategy, ["Three Year Plan.pptx", "Market Analysis.pdf", "Investment Priorities.xlsx"], "leadership");

const legalDemo = addNode(null, "site", "Legal", "leadership");
const legalPlanning = addNode(legalDemo, "library", "Planning", "leadership");
addNode(legalPlanning, "folder", "M&A Planning", "leadership", "folder-legal-ma");

addNode(null, "site", "Legacy Projects", "all", "site-legacy-projects");

const generatedSites: Array<{
  site: string;
  accessGroup: DemoNode["accessGroup"];
  libraries: string[];
}> = [
  { site: "Sales & Customer Success", accessGroup: "all", libraries: ["Accounts", "Sales Enablement", "Customer Success"] },
  { site: "Technology Center", accessGroup: "projects", libraries: ["Engineering", "Architecture", "Service Operations"] },
  { site: "Legal & Compliance", accessGroup: "leadership", libraries: ["Contracts", "Compliance", "Corporate Records"] },
  { site: "Marketing Studio", accessGroup: "all", libraries: ["Campaigns", "Brand", "Research"] },
  { site: "Facilities & Workplace", accessGroup: "all", libraries: ["Locations", "Safety", "Vendors"] },
  { site: "Product Management", accessGroup: "projects", libraries: ["Roadmaps", "Discovery", "Releases"] },
  { site: "Risk Management", accessGroup: "finance", libraries: ["Assessments", "Controls", "Audit Evidence"] },
  { site: "Learning Center", accessGroup: "people", libraries: ["Courses", "Certifications", "Training Operations"] },
  { site: "Procurement Hub", accessGroup: "finance", libraries: ["Sourcing", "Purchase Orders", "Supplier Management"] },
];

const folderNames = ["Planning", "Active Work", "Reference"];
const subfolderNames = ["Current", "Archive"];
const deepFolderNames = ["Working Files", "Reviews", "Approved", "Regional", "Quarterly", "Supporting Materials", "Final", "Published"];
const documentNames = ["Overview.docx", "Tracker.xlsx", "Status Report.pptx", "Guidelines.pdf"];

function stableNumber(value: string) {
  return [...value].reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 2166136261);
}

function addRandomizedSubfolderChain(parent: DemoNode, seed: string) {
  const hash = stableNumber(seed);
  const layerCount = 1 + (hash % 4);
  let current = parent;
  for (let layer = 0; layer < layerCount; layer += 1) {
    const nameIndex = (hash + layer * 3) % deepFolderNames.length;
    current = addNode(current, "folder", deepFolderNames[nameIndex], parent.accessGroup);
  }
  return current;
}

generatedSites.forEach((definition) => {
  const site = addNode(null, "site", definition.site, definition.accessGroup);
  definition.libraries.forEach((libraryName) => {
    const library = addNode(site, "library", libraryName, definition.accessGroup);
    folderNames.forEach((folderName) => {
      const folder = addNode(library, "folder", folderName, definition.accessGroup);
      subfolderNames.forEach((subfolderName) => {
        const subfolder = addNode(folder, "folder", subfolderName, definition.accessGroup);
        const documentFolder = addRandomizedSubfolderChain(subfolder, `${definition.site}:${libraryName}:${folderName}:${subfolderName}`);
        addDocuments(
          documentFolder,
          documentNames.map((documentName) => `${libraryName} ${folderName} ${subfolderName} ${documentName}`),
          definition.accessGroup,
        );
      });
    });
  });
});

const jordanGroups = new Set<DemoNode["accessGroup"]>(["all", "people", "projects"]);
const guestAccess = new Map<string, Set<DemoNode["accessGroup"]>>([
  ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", new Set(["projects"])],
  ["10101010-1010-4010-8010-101010101010", new Set(["finance"])],
  ["20202020-2020-4020-8020-202020202020", new Set(["leadership"])],
  ["30303030-3030-4030-8030-303030303030", new Set(["people"])],
]);

function hasDemoAccess(node: DemoNode, principalId?: string) {
  if (!principalId || principalId === demoPrincipals[0].id) return true;
  if (principalId === demoPrincipals[1].id) return jordanGroups.has(node.accessGroup);
  if (principalId && guestAccess.has(principalId)) return guestAccess.get(principalId)?.has(node.accessGroup) ?? false;
  return node.accessGroup === "finance";
}

function accessGrant(node: DemoNode) {
  return {
    all: "Everyone Except External Users",
    finance: "Contoso Demo Finance Team",
    people: "Contoso Demo People Operations",
    projects: "Contoso Demo Project Contributors",
    leadership: "Contoso Demo Leadership Team",
  }[node.accessGroup];
}

function accessiblePrincipals(node: DemoNode) {
  return demoPrincipals
    .filter((principal) => hasDemoAccess(node, principal.id))
    .map(({ id, displayName, email, principalType }) => {
      const accessPath = node.accessGroup === "projects" ? "m365_group" : "security_group";
      const permissionLevel = node.accessGroup === "leadership" ? "Full Control" : node.accessGroup === "finance" || node.accessGroup === "projects" ? "Contribute" : "Read";
      return {
        id,
        displayName,
        email,
        principalType,
        accessGrants: [{
          accessPath,
          label: accessPath === "m365_group" ? "M365 group" : "Security group",
          grantedByPrincipalId: null,
          grantedBy: accessGrant(node),
          permissionLevel,
          inherited: node.depth > 0,
        }],
      };
    });
}

function demoGrantMethods(node: DemoNode, hasAccess: boolean, selected: typeof demoPrincipals[number] | undefined) {
  if (!hasAccess) return [];
  const groupType = node.accessGroup === "projects" ? "m365_group" : "security_group";
  const defaultPermissionLevel = node.accessGroup === "leadership"
    ? "Full Control"
    : node.accessGroup === "finance" || node.accessGroup === "projects"
      ? "Contribute"
      : "Read";
  const methods: Array<{ type: string; label: string; grantedBy: string | null; permissionLevel: string }> = [{
    type: groupType,
    label: groupType === "m365_group" ? "M365 group" : "Security group",
    grantedBy: accessGrant(node),
    permissionLevel: defaultPermissionLevel,
  }];
  if (node.depth > 0) methods.push({ type: "inherited", label: "Inherited permission", grantedBy: node.path.split("/")[2] ?? null, permissionLevel: defaultPermissionLevel });
  if (node.name.includes("Guide") || node.name.includes("Policy") || node.name.includes("Agenda")) {
    methods.push({ type: "sharing_link", label: "Sharing link", grantedBy: selected?.displayName ?? "Organization sharing link", permissionLevel: "Read" });
  }
  if (node.name.includes("Budget") || node.name.includes("Project Plan") || node.name.includes("Board Pack")) {
    methods.push({ type: "direct", label: "Direct permission", grantedBy: selected?.displayName ?? "Direct assignment", permissionLevel: "Contribute" });
  }
  if (node.accessGroup === "leadership") methods.push({ type: "role", label: "Owner role", grantedBy: "Contoso Demo Site Owners", permissionLevel: "Full Control" });
  return methods;
}

function syntheticDocumentSize(node: DemoNode) {
  if (node.nodeType !== "document") return 0;
  const extension = node.name.split(".").pop()?.toLowerCase();
  const baseBytes = {
    zip: 640_000_000,
    fig: 180_000_000,
    mpp: 48_000_000,
    pptx: 28_000_000,
    xlsx: 16_000_000,
    pdf: 9_000_000,
    docx: 4_000_000,
  }[extension ?? ""] ?? 6_000_000;
  return baseBytes + (stableNumber(node.path) % (baseBytes * 3));
}

export function demoGraph(principalId?: string) {
  const selected = demoPrincipals.find((principal) => principal.id === principalId);
  return {
    nodes: demoNodes.map((node) => {
      const hasAccess = hasDemoAccess(node, principalId);
      const grantedBy = hasAccess && selected ? accessGrant(node) : null;
      const grantMethods = demoGrantMethods(node, hasAccess, selected);
      return {
        id: node.id,
        parentId: node.parentId,
        nodeType: node.nodeType,
        name: node.name,
        path: node.path,
        depth: node.depth,
        sizeBytes: syntheticDocumentSize(node),
        hasAccess,
        accessDetails: {
          selectedPrincipal: selected?.displayName ?? null,
          permissions: hasAccess && selected ? [node.accessGroup === "leadership" ? "owner" : "read"] : [],
          grantedBy,
          accessMethod: !selected ? "No user selected" : hasAccess ? "Group membership" : "No effective grant",
          sourceNode: hasAccess && selected ? node.path.split("/").slice(0, 4).join("/") : null,
          inherited: Boolean(hasAccess && selected && node.depth > 0),
          grantMethods,
          grantMethodCount: new Set(grantMethods.filter((method) => method.type !== "inherited").map((method) => method.type)).size,
          accessiblePrincipals: accessiblePrincipals(node),
          reason: !selected
            ? "Select a user to inspect how they can access this resource."
            : hasAccess
              ? `${selected.displayName} receives access through ${grantedBy}${node.depth > 0 ? " and inherits it from a parent resource" : ""}.`
              : `${selected.displayName} has no direct, inherited, or group-based permission on this resource.`,
        },
      };
    }),
    edges: demoNodes
      .filter((node) => node.parentId)
      .map((node) => ({
        id: `${node.parentId}:${node.id}`,
        source: node.parentId!,
        target: node.id,
        relationship: "contains",
        details: `${demoNodes.find((parent) => parent.id === node.parentId)?.name} contains ${node.name}`,
      })),
  };
}
