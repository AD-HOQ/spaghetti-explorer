import AdmZip from "adm-zip";
import { isDemoMode, requireProductionEnvironment } from "./config.js";

export const powerAutomateSolution = {
  uniqueName: "spaghetti_approvals",
  displayName: "Spaghetti Approval Flows",
  version: "1.0.0.0",
};

export type PowerPlatformEnvironment = {
  id: string;
  name: string;
  url: string;
  isDemo?: boolean;
};

function configuredEnvironments(): PowerPlatformEnvironment[] {
  if (isDemoMode) {
    return [
      { id: "demo-default", name: "Contoso Demo Environment", url: "https://contoso-demo.invalid", isDemo: true },
      { id: "demo-production", name: "Northwind Demo Environment", url: "https://northwind-demo.invalid", isDemo: true },
    ];
  }
  const configured = process.env.POWER_PLATFORM_ENVIRONMENTS_JSON;
  if (configured) return JSON.parse(configured) as PowerPlatformEnvironment[];
  return [];
}

export function listPowerPlatformEnvironments() {
  return configuredEnvironments().map(({ id, name, isDemo }) => ({ id, name, isDemo: Boolean(isDemo) }));
}

export function buildPowerAutomateSolutionPackage() {
  const zip = new AdmZip();
  const solutionId = "d7c6ce7f-54dc-4f47-b7cc-325e9d9239f5";
  const requestFlowId = "14fe36a7-bdf6-41ab-88d8-f07799fb3799";
  const outcomeFlowId = "d082af75-0faf-44fa-b766-4d34050df48a";
  zip.addFile("[Content_Types].xml", Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/octet-stream" />
  <Default Extension="json" ContentType="application/json" />
</Types>`));
  zip.addFile("solution.xml", Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<ImportExportXml version="9.2.0.0" SolutionPackageVersion="9.2" languagecode="1033">
  <SolutionManifest>
    <UniqueName>${powerAutomateSolution.uniqueName}</UniqueName>
    <LocalizedNames><LocalizedName description="${powerAutomateSolution.displayName}" languagecode="1033" /></LocalizedNames>
    <Descriptions><Description description="Teams manager approval flows for Spaghetti permission actions." languagecode="1033" /></Descriptions>
    <Version>${powerAutomateSolution.version}</Version>
    <Managed>0</Managed>
    <Publisher><UniqueName>spaghetti</UniqueName><LocalizedNames><LocalizedName description="Spaghetti" languagecode="1033" /></LocalizedNames><CustomizationPrefix>spaghetti</CustomizationPrefix><CustomizationOptionValuePrefix>72600</CustomizationOptionValuePrefix></Publisher>
    <RootComponents>
      <RootComponent type="29" id="{${requestFlowId}}" behavior="0" />
      <RootComponent type="29" id="{${outcomeFlowId}}" behavior="0" />
    </RootComponents>
  </SolutionManifest>
</ImportExportXml>`));
  zip.addFile("customizations.xml", Buffer.from(`<?xml version="1.0" encoding="utf-8"?><ImportExportXml><Entities /><Roles /><Workflows /></ImportExportXml>`));
  zip.addFile("workflows/Spaghetti-Manager-Approval-Request.json", Buffer.from(JSON.stringify({
    id: requestFlowId,
    name: "Spaghetti - Request manager approval in Teams",
    description: "HTTP-triggered template that posts a Teams approval request to the selected user's manager and returns the approval outcome.",
    trigger: { type: "Request", schema: { actionId: "string", actionLabel: "string", nodeName: "string", requestedForUpn: "string", requestedByUpn: "string" } },
    steps: [
      "Resolve requestedForUpn manager using Microsoft 365 Users",
      "Create an approval assigned to the manager",
      "Post adaptive card to manager in Microsoft Teams",
      "Wait for approval response",
      "Return approved or rejected outcome to Spaghetti callback URL",
    ],
  }, null, 2)));
  zip.addFile("workflows/Spaghetti-Approval-Outcome.json", Buffer.from(JSON.stringify({
    id: outcomeFlowId,
    name: "Spaghetti - Notify approval outcome",
    description: "Posts the approval result to Teams and forwards the decision to Spaghetti.",
    steps: [
      "Receive approval outcome",
      "Post result to the requester in Microsoft Teams",
      "Call the Spaghetti approval outcome endpoint",
    ],
  }, null, 2)));
  zip.addFile("README.txt", Buffer.from(`Spaghetti Approval Flows ${powerAutomateSolution.version}

This unmanaged starter solution contains the pre-built manager approval flow definitions used by Spaghetti.

After import:
1. Bind the Microsoft Teams, Approvals, Microsoft 365 Users, and HTTP connections.
2. Configure the Spaghetti base URL and callback authentication values.
3. Turn on both flows.
4. Return to Spaghetti Settings > Integrations and validate the environment.

Solution unique name: ${powerAutomateSolution.uniqueName}
Solution package ID: ${solutionId}

Production note: connection references and environment variables must be bound during import because Microsoft does not permit credentials to be embedded in a solution package.
`));
  return zip.toBuffer();
}

export async function validatePowerAutomateSolution(environmentId: string) {
  const environment = configuredEnvironments().find((item) => item.id === environmentId);
  if (!environment) throw new Error("The selected Power Platform environment is not configured.");
  if (environment.isDemo) {
    return {
      environmentId,
      environmentName: environment.name,
      installed: environmentId === "demo-production",
      solution: powerAutomateSolution,
      checkedAt: new Date().toISOString(),
      mode: "demo",
    };
  }
  requireProductionEnvironment(["POWER_PLATFORM_ACCESS_TOKEN"]);
  const token = process.env.POWER_PLATFORM_ACCESS_TOKEN;
  if (!token) throw new Error("POWER_PLATFORM_ACCESS_TOKEN is required to validate a live Dataverse environment.");
  const query = `/api/data/v9.2/solutions?$select=uniquename,friendlyname,version&$filter=uniquename eq '${powerAutomateSolution.uniqueName}'`;
  const response = await fetch(`${environment.url.replace(/\/$/, "")}${query}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Dataverse solution validation failed (${response.status}).`);
  const result = await response.json() as { value: Array<{ uniquename: string; friendlyname: string; version: string }> };
  const installed = result.value[0];
  return {
    environmentId,
    environmentName: environment.name,
    installed: Boolean(installed),
    solution: installed ?? powerAutomateSolution,
    checkedAt: new Date().toISOString(),
    mode: "live",
  };
}
