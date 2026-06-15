import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { SigmaContainer, useLoadGraph, useRegisterEvents, useSigma } from "@react-sigma/core";
import { createNodeImageProgram } from "@sigma/node-image";
import Fuse from "fuse.js";
import Graph from "graphology";
import { toJpeg } from "html-to-image";
import CheckboxTree, { type TreeNode } from "react-checkbox-tree";
import type Sigma from "sigma";
import { NodeCircleProgram, createNodeCompoundProgram, type NodeLabelDrawingFunction } from "sigma/rendering";
import type { AccessiblePrincipal, DocumentNode, GrantMethodType, GraphPayload, PermissionLevel, Principal, Relationship, RiskInsight } from "./types";
import { InsightPanel } from "./components/InsightPanel";
import { fetchRiskInsights } from "./services/insightService";

type AppearanceTheme = "dark" | "light";
const appearanceStorageKey = "spaghetti-appearance-theme";
// Bump this suffix when preparing a clean onboarding demonstration without
// disconnecting or deleting the customer-owned Microsoft connector.
const launchModeStorageKey = "spaghetti-launch-mode-v2";
const activeTenantStorageKey = "spaghetti-active-tenant-id-v2";
const activeSiteScopeStorageKey = "spaghetti-active-site-scope-v2";
const initialAppearance = (): AppearanceTheme => localStorage.getItem(appearanceStorageKey) === "light" ? "light" : "dark";
function useAppearanceTheme() {
  const [theme, setThemeState] = useState<AppearanceTheme>(initialAppearance);
  const setTheme = (next: AppearanceTheme) => {
    localStorage.setItem(appearanceStorageKey, next);
    document.documentElement.dataset.theme = next;
    setThemeState(next);
  };
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return [theme, setTheme] as const;
}

const colors: Record<DocumentNode["nodeType"], string> = {
  site: "#74c7ec",
  library: "#a6e3a1",
  folder: "#f9e2af",
  document: "#cba6f7",
};

const nodeIcons: Record<DocumentNode["nodeType"], string> = {
  site: "/icons/site.svg",
  library: "/icons/library.svg",
  folder: "/icons/folder.svg",
  document: "/icons/document.svg",
};

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  return `${value >= 10 || unitIndex < 2 ? value.toFixed(0) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} ${units[unitIndex]}`;
}

function pluralizeResource(type: string, count: number) {
  if (count === 1) return type;
  if (type === "library") return "libraries";
  return `${type}s`;
}

const drawMapNodeLabel: NodeLabelDrawingFunction = (context, data, settings) => {
  if (!data.label) return;
  const fontSize = data.nodeType === "site" ? 14 : data.nodeType === "library" ? 13 : 11;
  const fontWeight = data.nodeType === "site" || data.nodeType === "library" ? "700" : "600";
  const focused = Boolean(data.layerFocus);
  context.font = `${fontWeight} ${fontSize}px ${settings.labelFont}`;
  const textWidth = context.measureText(data.label).width;
  const labelX = data.x + data.size + 7;
  const labelY = data.y - fontSize / 2 - 4;

  context.beginPath();
  context.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2);
  context.strokeStyle = data.outlineColor ?? (data.theme === "light" ? "#344054" : "#f8fafc");
  context.lineWidth = focused ? (data.nodeType === "site" ? 4 : 3) : 1.5;
  context.stroke();

  context.fillStyle = data.theme === "light"
    ? focused ? "rgba(255, 255, 255, .98)" : "rgba(248, 250, 252, .9)"
    : focused ? "rgba(8, 12, 20, .96)" : "rgba(20, 27, 38, .75)";
  context.beginPath();
  context.roundRect(labelX - 5, labelY, textWidth + 10, fontSize + 8, 6);
  context.fill();
  context.strokeStyle = data.theme === "light"
    ? focused ? "rgba(52, 64, 84, .45)" : "rgba(71, 84, 103, .22)"
    : focused ? "rgba(255, 255, 255, .42)" : "rgba(255, 255, 255, .14)";
  context.lineWidth = focused ? 1.5 : 1;
  context.stroke();

  context.fillStyle = data.theme === "light" ? focused ? "#101828" : "#475467" : focused ? "#ffffff" : "#aab4c2";
  context.fillText(data.label, labelX, data.y + fontSize / 3);
};

const MapIconProgram = createNodeImageProgram({
  drawingMode: "color",
  colorAttribute: "iconColor",
  objectFit: "contain",
  keepWithinCircle: true,
  padding: 0.23,
});
const MapNodeProgram = createNodeCompoundProgram([NodeCircleProgram, MapIconProgram], drawMapNodeLabel);

function blendHex(color: string, target: string, amount: number) {
  const parse = (value: string) => [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16));
  const sourceRgb = parse(color);
  const targetRgb = parse(target);
  return `#${sourceRgb.map((channel, index) => Math.round(channel + (targetRgb[index] - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 90) || "spaghetti-snapshot";
}

async function downloadElementAsJpeg(element: HTMLElement, fileName: string, options: { snapshotSheet?: boolean; backgroundColor?: string } = {}) {
  const width = Math.max(element.scrollWidth, element.clientWidth);
  const height = Math.max(element.scrollHeight, element.clientHeight);
  const dataUrl = await toJpeg(element, {
    width,
    height,
    canvasWidth: Math.min(width * 2, 6000),
    canvasHeight: Math.min(height * 2, 6000),
    quality: 0.94,
    backgroundColor: options.backgroundColor ?? (document.documentElement.dataset.theme === "light" ? "#f3f5f8" : "#0d1017"),
    style: options.snapshotSheet ? {
      position: "static",
      inset: "auto",
      left: "auto",
      top: "auto",
      zIndex: "auto",
      display: "block",
    } : undefined,
    filter: (node) => !(node instanceof HTMLElement) || !node.classList.contains("snapshot-exclude"),
  });
  const link = document.createElement("a");
  link.download = `${safeFileName(fileName)}.jpg`;
  link.href = dataUrl;
  link.click();
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const grantMethodOptions: Array<{ type: GrantMethodType; label: string }> = [
  { type: "direct", label: "Direct permission" },
  { type: "sharing_link", label: "Sharing link" },
  { type: "security_group", label: "Security group" },
  { type: "m365_group", label: "M365 group" },
  { type: "inherited", label: "Inherited" },
  { type: "role", label: "Role / owner" },
];
const permissionLevelOptions: Array<{ level: PermissionLevel; executable: boolean; note?: string }> = [
  { level: "Read", executable: true },
  { level: "Contribute", executable: true, note: "Microsoft Graph write role" },
  { level: "Edit", executable: false, note: "Requires SharePoint REST connector" },
  { level: "Design", executable: false, note: "Requires SharePoint REST connector" },
  { level: "Full Control", executable: false, note: "Requires SharePoint REST connector" },
];

type PermissionActionKind =
  | "remove_security_group_permission"
  | "remove_m365_group_permission"
  | "remove_sharing_link_user"
  | "delete_sharing_link"
  | "remove_principal_from_group"
  | "remove_direct_permission"
  | "remove_principal_permission"
  | "break_inheritance"
  | "reset_inheritance"
  | "add_permission_grant";
type PermissionActionStatus = "pending" | "running" | "succeeded" | "failed";
type SharingLinkType = "view" | "edit";
type SharingLinkScope = "users" | "organization" | "anonymous";
type TenantPermissionCommand = {
  provider: "microsoft_graph" | "sharepoint_rest";
  operation: PermissionActionKind;
  method: "POST" | "DELETE";
  endpointTemplate: string;
  accessPath?: GrantMethodType | "sharepoint_group";
  permissionLevel?: PermissionLevel;
  targetPrincipalId?: string;
  targetPrincipalName?: string;
  targetPrincipalType?: string;
  sourcePrincipalId?: string;
  sourcePrincipalName?: string;
  sharingLinkType?: SharingLinkType;
  sharingLinkScope?: SharingLinkScope;
};
type PermissionAction = {
  id: string;
  key: string;
  kind: PermissionActionKind;
  label: string;
  nodeId: string;
  nodeName: string;
  principalId?: string;
  principalName?: string;
  grantIndex?: number;
  command: TenantPermissionCommand;
  status: PermissionActionStatus;
  message?: string;
};

type PermissionActionLog = Omit<PermissionAction, "status"> & {
  eventId: string;
  actionId: string;
  eventType: "loaded" | "running" | "succeeded" | "failed";
  createdAt: string;
  message?: string;
};

function LogsPage() {
  const [query, setQuery] = useState("");
  const [logs, setLogs] = useState<PermissionActionLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  useEffect(() => {
    fetch("/api/actions/logs")
      .then((response) => response.json())
      .then(setLogs)
      .finally(() => setLoadingLogs(false));
  }, []);
  const filteredLogs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return logs;
    return logs.filter((log) => [
      log.eventType,
      log.label,
      log.kind,
      log.nodeName,
      log.principalName,
      log.message,
      log.actionId,
    ].some((value) => value?.toLowerCase().includes(normalized)));
  }, [logs, query]);

  return (
    <main className="logs-page">
      <header className="logs-header">
        <div className="brand-lockup">
          <img src="/spaghetti_logo.png" alt="Spaghetti" />
          <div>
            <p className="eyebrow">Spaghetti Explorer</p>
            <h1>Action Logs</h1>
            <p className="subtitle">A permanent, searchable event history for every staged and executed permission action.</p>
          </div>
        </div>
        <a href="/sites/operations-hub/Finance/Budgets/FY26/Forecast%20Q1.xlsx">Back to explorer</a>
      </header>
      <section className="logs-content">
        <div className="logs-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, resource, principal, status, details, or ID" />
          {query && <button onClick={() => setQuery("")}>Clear</button>}
        </div>
        <div className="logs-summary"><strong>{filteredLogs.length}</strong><span>{filteredLogs.length === 1 ? "action" : "actions"}</span></div>
        <div className="logs-table-wrap">
          <table className="logs-table">
            <thead><tr><th>Recorded</th><th>Event</th><th>Action</th><th>Resource</th><th>Principal</th><th>Details</th><th>Action ID</th></tr></thead>
            <tbody>
              {filteredLogs.length ? filteredLogs.map((log) => (
                <tr key={log.eventId}>
                  <td>{new Date(log.createdAt).toLocaleString()}</td>
                  <td><span className={`log-status ${log.eventType}`}>{log.eventType}</span></td>
                  <td><strong>{log.label}</strong><small>{log.kind.replaceAll("_", " ")}</small></td>
                  <td>{log.nodeName}</td>
                  <td>{log.principalName ?? "Not applicable"}</td>
                  <td>{log.message ?? "No details returned"}</td>
                  <td><code>{log.actionId}</code></td>
                </tr>
              )) : <tr><td className="logs-empty" colSpan={7}>{loadingLogs ? "Loading permanent action history..." : query ? "No actions match this search." : "No actions have been loaded yet."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

type AdminSection = "tenant" | "users" | "data" | "settings";
type MicrosoftConnection = {
  status: string;
  health: string;
  tenantId?: string;
  tenantDisplayName?: string;
  clientId?: string;
  applicationObjectId?: string;
  servicePrincipalObjectId?: string;
  credentialExpiresAt?: string;
  grantedPermissions?: string[];
  failureReason?: string;
  lastVerifiedAt?: string;
  createdByUpn?: string;
};
type MicrosoftConnectionResponse = {
  appMode?: "demo" | "production";
  bootstrapConfigured: boolean;
  administratorAuthorized: boolean;
  productionReadiness?: {
    ready: boolean;
    requirements: Array<{ name: string; configured: boolean }>;
    storageReady?: boolean;
    storageRequirements?: Array<{ name: string; configured: boolean }>;
  };
  connection: MicrosoftConnection;
};
type DiscoveredSite = { id: string; name: string; webUrl: string | null; hostname: string | null };
type TenantScanResult = {
  mode: "demo" | "production";
  tenantId: string;
  requestedSites: number;
  successfulSites: number;
  failedSites: number;
  nodes: number;
  permissions: number;
  directory?: DirectorySyncCounts;
  results: Array<{ siteId: string; ok: boolean; error?: string }>;
};
type TenantScanProgress = {
  jobId: string;
  mode: "demo" | "production";
  tenantId: string;
  status: "running" | "completed" | "failed";
  stage: "syncing_directory" | "scanning_sites" | "waiting_for_graph" | "completed" | "failed";
  requestedSites: number;
  currentSiteId: string | null;
  completedSites: number;
  successfulSites: number;
  failedSites: number;
  nodes: number;
  permissions: number;
  failures: Array<{ siteId: string; error: string }>;
  retryAfterMs?: number;
  retryAttempt?: number;
  directory?: DirectorySyncCounts;
  result?: Omit<TenantScanResult, "mode">;
  error?: string;
};
type TenantScanHistory = {
  id: string;
  tenantId: string;
  outcome: string;
  createdAt: string;
  details: TenantScanResult;
};
type DirectorySyncCounts = {
  users: number;
  guests: number;
  groups: number;
  memberships: number;
  failedGroups: number;
};
type PowerPlatformEnvironment = { id: string; name: string; isDemo: boolean };
type PowerAutomateValidation = {
  installed: boolean;
  environmentName: string;
  checkedAt: string;
  mode: "demo" | "live";
  solution: { uniqueName?: string; friendlyname?: string; displayName?: string; version: string };
};

function AdminPage() {
  const [theme, setTheme] = useAppearanceTheme();
  const [section, setSection] = useState<AdminSection>("tenant");
  const [microsoftCallbackMessage, setMicrosoftCallbackMessage] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("microsoft") === "error" ? params.get("message") : null;
  });
  const [discoveredSites, setDiscoveredSites] = useState<DiscoveredSite[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [siteSearch, setSiteSearch] = useState("");
  const [discoveringSites, setDiscoveringSites] = useState(false);
  const [scanResult, setScanResult] = useState<TenantScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [directorySync, setDirectorySync] = useState<DirectorySyncCounts | null>(null);
  const [syncingDirectory, setSyncingDirectory] = useState(false);
  const [microsoft, setMicrosoft] = useState<MicrosoftConnectionResponse>({
    bootstrapConfigured: false,
    administratorAuthorized: false,
    connection: { status: "not_connected", health: "Loading Microsoft connection status..." },
  });
  const [microsoftBusy, setMicrosoftBusy] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [scanProgress, setScanProgress] = useState<TenantScanProgress | null>(null);
  const [scanHistory, setScanHistory] = useState<TenantScanHistory[]>([]);
  const [loadingScanHistory, setLoadingScanHistory] = useState(false);
  const [powerPlatformEnvironments, setPowerPlatformEnvironments] = useState<PowerPlatformEnvironment[]>([]);
  const [powerPlatformEnvironmentId, setPowerPlatformEnvironmentId] = useState("");
  const [powerAutomateValidation, setPowerAutomateValidation] = useState<PowerAutomateValidation | null>(null);
  const [validatingPowerAutomate, setValidatingPowerAutomate] = useState(false);

  const refreshMicrosoftStatus = async () => {
    const response = await fetch("/api/microsoft/connect/status");
    const result = await response.json() as MicrosoftConnectionResponse;
    if (result.connection.tenantId && ["connected", "credential_expiring_soon"].includes(result.connection.status)) {
      localStorage.setItem(activeTenantStorageKey, result.connection.tenantId);
      localStorage.setItem(launchModeStorageKey, result.appMode === "demo" ? "sample" : "tenant");
      if (!localStorage.getItem(activeSiteScopeStorageKey)) localStorage.setItem(activeSiteScopeStorageKey, "[]");
    }
    setMicrosoft({
      ...result,
      connection: {
        ...result.connection,
        grantedPermissions: Array.isArray(result.connection.grantedPermissions) ? result.connection.grantedPermissions : [],
      },
    });
  };

  useEffect(() => {
    refreshMicrosoftStatus();
    fetch("/api/integrations/power-automate/environments")
      .then((response) => response.json())
      .then((result: { environments: PowerPlatformEnvironment[] }) => {
        setPowerPlatformEnvironments(result.environments);
        setPowerPlatformEnvironmentId(result.environments[0]?.id ?? "");
      });
    const timer = window.setInterval(refreshMicrosoftStatus, 1800);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!microsoftCallbackMessage) return;
    window.history.replaceState({}, "", "/admin");
  }, [microsoftCallbackMessage]);

  useEffect(() => {
    if (section !== "data" || !microsoft.connection.tenantId) return;
    setLoadingScanHistory(true);
    fetch(`/api/microsoft/connect/scan-history?tenantId=${encodeURIComponent(microsoft.connection.tenantId)}`)
      .then((response) => response.json())
      .then((result: { scans?: TenantScanHistory[] }) => setScanHistory(result.scans ?? []))
      .finally(() => setLoadingScanHistory(false));
  }, [section, microsoft.connection.tenantId, scanResult]);

  const provisionMicrosoft = async () => {
    setMicrosoftBusy(true);
    const response = await fetch("/api/microsoft/connect/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productName: "Spaghetti" }),
    });
    if (!response.ok) {
      const result = await response.json();
      setMicrosoft((current) => ({ ...current, connection: { ...current.connection, status: "failed", health: "Provisioning failed.", failureReason: result.error } }));
    }
    await refreshMicrosoftStatus();
    setMicrosoftBusy(false);
  };

  const disconnectMicrosoft = async () => {
    setMicrosoftBusy(true);
    await fetch("/api/microsoft/connect/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteApplication: false }),
    });
    setDiscoveredSites([]);
    setSelectedSiteIds([]);
    setScanResult(null);
    if (microsoft.appMode === "demo") localStorage.removeItem(activeTenantStorageKey);
    await refreshMicrosoftStatus();
    setMicrosoftBusy(false);
  };

  const upgradeMicrosoft = async () => {
    setMicrosoftBusy(true);
    setScanError(null);
    const provisionResponse = await fetch("/api/microsoft/connect/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productName: "Spaghetti" }),
    });
    if (!provisionResponse.ok) {
      const result = await provisionResponse.json();
      setScanError(result.error ?? "Unable to provision the remediation connector.");
    }
    await refreshMicrosoftStatus();
    setMicrosoftBusy(false);
  };

  const discoverSites = async () => {
    if (!connected || !microsoft.connection.tenantId) return;
    setDiscoveringSites(true);
    setScanError(null);
    try {
      const response = await fetch(`/api/microsoft/connect/sites?tenantId=${encodeURIComponent(microsoft.connection.tenantId)}`);
      const result = await response.json();
      if (response.ok) {
        setDiscoveredSites(Array.isArray(result.sites) ? result.sites : []);
        setSelectedSiteIds(Array.isArray(result.sites) ? result.sites.map((site: DiscoveredSite) => site.id) : []);
        if (!result.sites?.length) setScanError("The connector did not find any SharePoint sites in this tenant.");
      } else {
        setScanError(result.error ?? "Unable to discover SharePoint sites.");
      }
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Unable to discover SharePoint sites.");
    } finally {
      setDiscoveringSites(false);
    }
  };

  const syncDirectory = async () => {
    if (!connected || !microsoft.connection.tenantId) return;
    setSyncingDirectory(true);
    setScanError(null);
    try {
      const response = await fetch("/api/microsoft/connect/directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: microsoft.connection.tenantId }),
      });
      const result = await response.json();
      if (response.ok) setDirectorySync(result.directory);
      else setScanError(result.error ?? "Unable to sync the Microsoft directory.");
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Unable to sync the Microsoft directory.");
    } finally {
      setSyncingDirectory(false);
    }
  };

  const loadTenantData = async () => {
    if (!connected || !microsoft.connection.tenantId || !selectedSiteIds.length) return;
    setLoadingData(true);
    setScanError(null);
    setScanNotice(null);
    setScanResult(null);
    setScanProgress(null);
    try {
      const response = await fetch("/api/microsoft/connect/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: microsoft.connection.tenantId, siteIds: selectedSiteIds }),
      });
      let job = await response.json() as TenantScanProgress;
      if (!response.ok) {
        setScanError(job.error ?? "Tenant scan failed.");
        return;
      }
      setScanProgress(job);
      while (job.status === "running") {
        await new Promise((resolve) => window.setTimeout(resolve, 800));
        const statusResponse = await fetch(`/api/microsoft/connect/scan/${encodeURIComponent(job.jobId)}`);
        job = await statusResponse.json() as TenantScanProgress;
        if (statusResponse.status === 404) {
          setScanProgress(null);
          setScanNotice("The scan was interrupted by a server restart. Resources imported before the restart remain stored; start a new scan to continue.");
          return;
        }
        if (!statusResponse.ok) throw new Error(job.error ?? "Unable to read tenant scan progress.");
        setScanProgress(job);
      }
      if (job.status === "failed" || !job.result) {
        setScanError(job.error ?? "Tenant scan failed.");
        return;
      }
      const result: TenantScanResult = { mode: job.mode, ...job.result };
      setScanResult(result);
      if (result.directory) setDirectorySync(result.directory);
      localStorage.setItem(activeTenantStorageKey, result.tenantId);
      localStorage.setItem(launchModeStorageKey, result.mode === "demo" ? "sample" : "tenant");
      localStorage.setItem(activeSiteScopeStorageKey, JSON.stringify(selectedSiteIds));
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Tenant scan failed.");
    } finally {
      setLoadingData(false);
    }
  };

  const toggleSiteSelection = (siteId: string) => {
    setSelectedSiteIds((current) => current.includes(siteId) ? current.filter((id) => id !== siteId) : [...current, siteId]);
  };

  const validatePowerAutomate = async () => {
    if (!powerPlatformEnvironmentId) return;
    setValidatingPowerAutomate(true);
    setPowerAutomateValidation(null);
    const response = await fetch("/api/integrations/power-automate/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environmentId: powerPlatformEnvironmentId }),
    });
    const result = await response.json();
    setPowerAutomateValidation(response.ok ? result : {
      installed: false,
      environmentName: powerPlatformEnvironments.find((environment) => environment.id === powerPlatformEnvironmentId)?.name ?? "Selected environment",
      checkedAt: new Date().toISOString(),
      mode: "live",
      solution: { version: "", displayName: result.error ?? "Validation failed" },
    });
    setValidatingPowerAutomate(false);
  };

  const statusLabel = microsoft.connection.status.replaceAll("_", " ");
  const demoMode = microsoft.appMode === "demo";
  const authorized = microsoft.administratorAuthorized;
  const connected = microsoft.connection.status === "connected" || microsoft.connection.status === "credential_expiring_soon";
  const remediationReady = ["Sites.ReadWrite.All", "Files.ReadWrite.All", "GroupMember.ReadWrite.All"].every((permission) => (microsoft.connection.grantedPermissions ?? []).includes(permission));
  const progressStates = ["provisioning_app_registration", "creating_service_principal", "granting_graph_permissions", "verifying_graph_access"];
  const provisioning = progressStates.includes(microsoft.connection.status);
  const scanPercent = scanProgress
    ? scanProgress.stage === "syncing_directory"
      ? 4
      : Math.round((scanProgress.completedSites / Math.max(scanProgress.requestedSites, 1)) * 100)
    : 0;
  const currentScanSite = scanProgress?.currentSiteId
    ? discoveredSites.find((site) => site.id === scanProgress.currentSiteId)?.name ?? scanProgress.currentSiteId
    : null;
  const siteName = (siteId: string) => discoveredSites.find((site) => site.id === siteId)?.name ?? siteId;
  const visibleSites = discoveredSites.filter((site) => {
    const query = siteSearch.trim().toLowerCase();
    return !query || `${site.name} ${site.webUrl ?? ""} ${site.hostname ?? ""}`.toLowerCase().includes(query);
  });

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div className="brand-lockup">
          <img src="/spaghetti_logo.png" alt="Spaghetti" />
          <div><p className="eyebrow">Spaghetti Explorer</p><h1>Administration</h1><p className="subtitle">Connect tenants, manage directory scope, and control ingestion.</p></div>
        </div>
        <a href="/">Back to explorer</a>
      </header>
      <section className="admin-shell">
        <nav className="admin-nav" aria-label="Administration sections">
          {([
            ["tenant", "Tenant", "Connect Microsoft 365"],
            ["users", "Users", "Directory and scope"],
            ["data", "Data", "Ingestion and refresh"],
            ["settings", "Additional Settings", "Application preferences"],
          ] as Array<[AdminSection, string, string]>).map(([id, label, description]) => (
            <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>
              <strong>{label}</strong><small>{description}</small>
            </button>
          ))}
        </nav>
        <div className="admin-content">
          {section === "tenant" && (
            <>
              <div className="admin-section-heading"><div><span>Tenant</span><h2>Connect Microsoft 365 tenant</h2><p>Authorize the Spaghetti provisioning app, then create a customer-owned discovery and remediation connector visible in your tenant's Entra App registrations.</p></div><span className={`tenant-status ${connected ? "connected" : microsoft.connection.status === "failed" ? "failed" : provisioning ? "testing" : ""}`}>{statusLabel}</span></div>
              <div className={`microsoft-connection-banner ${connected ? "connected" : microsoft.connection.status === "failed" ? "failed" : ""}`}>
                <div><span>Connection health</span><strong>{microsoft.connection.tenantDisplayName ?? "Microsoft 365 tenant not connected"}</strong><p>{microsoft.connection.failureReason ?? microsoft.connection.health}</p></div>
                {!connected && !authorized && <a className={microsoft.bootstrapConfigured ? "" : "disabled"} href={microsoft.bootstrapConfigured ? "/api/microsoft/connect/start" : undefined}>{demoMode ? "Connect Demo Tenant" : "Connect Microsoft 365 Tenant"}</a>}
                {authorized && !connected && !provisioning && <button disabled={microsoftBusy} onClick={provisionMicrosoft}>Provision remediation connector</button>}
                {connected && authorized && remediationReady && <button className="secondary" disabled={microsoftBusy} onClick={disconnectMicrosoft}>{demoMode ? "Disconnect demo tenant" : "Disconnect connector"}</button>}
                {connected && authorized && !remediationReady && <button disabled={microsoftBusy} onClick={upgradeMicrosoft}>{microsoftBusy ? "Upgrading connector..." : "Upgrade remediation permissions"}</button>}
              </div>
              {demoMode && <div className="real-tenant-callout"><div><strong>Connect a real Microsoft tenant</strong><span>{microsoft.productionReadiness?.ready ? "Production configuration is ready. Restart the server in production mode to enable Microsoft authorization." : "Complete the production requirements below to enable Microsoft authorization."}</span></div><a href="#real-tenant-requirements">View requirements</a></div>}
              {microsoftCallbackMessage && <div className="admin-notice callback-error"><span>{microsoftCallbackMessage}</span><button onClick={() => setMicrosoftCallbackMessage(null)} aria-label="Dismiss Microsoft connection message">×</button></div>}
              {!microsoft.bootstrapConfigured && <div className="admin-notice">The multi-tenant bootstrap app must be configured before Microsoft authorization can begin. See the bootstrap setup instructions in the project README.</div>}
              {demoMode && (
                <div className="production-readiness" id="real-tenant-requirements">
                  <div><strong>Real tenant prerequisites</strong><span>The app remains safely in demo mode until every requirement is configured locally.</span></div>
                  <div className="production-requirement-list">
                    {(microsoft.productionReadiness?.requirements ?? []).map((requirement) => (
                      <span className={requirement.configured ? "configured" : "missing"} key={requirement.name}>
                        <b>{requirement.configured ? "✓" : "×"}</b>
                        <code>{requirement.name}</code>
                        <em>{requirement.configured ? "Configured" : "Missing"}</em>
                      </span>
                    ))}
                  </div>
                  <p>These values enable real Microsoft sign-in and connector provisioning. PostgreSQL is only required afterward, when you are ready to scan and store tenant data.</p>
                  <div><strong>Storage prerequisite</strong><span>{microsoft.productionReadiness?.storageReady ? "PostgreSQL is configured and tenant scans can be stored." : "DATABASE_URL is not configured yet. Real sign-in can still work, but tenant scans will remain unavailable."}</span></div>
                </div>
              )}
              {connected && !remediationReady && <div className="admin-notice">This connector is read-only. Upgrade it before running permission actions.</div>}
              {(provisioning || microsoftBusy) && <div className="provision-progress">
                {progressStates.map((state, index) => <span key={state} className={microsoft.connection.status === state ? "active" : progressStates.indexOf(microsoft.connection.status) > index ? "complete" : ""}>{state.replaceAll("_", " ")}</span>)}
              </div>}
              <div className="tenant-layout">
                <div className="admin-card tenant-details">
                  <h3>Connector details</h3>
                  <dl>
                    <div><dt>Tenant ID</dt><dd>{microsoft.connection.tenantId ?? "Not available"}</dd></div>
                    <div><dt>Connector client ID</dt><dd>{microsoft.connection.clientId ?? "Not provisioned"}</dd></div>
                    <div><dt>Created by</dt><dd>{microsoft.connection.createdByUpn ?? "Not available"}</dd></div>
                    <div><dt>Last verified</dt><dd>{microsoft.connection.lastVerifiedAt ? new Date(microsoft.connection.lastVerifiedAt).toLocaleString() : "Not verified"}</dd></div>
                    <div><dt>Credential expiration</dt><dd>{microsoft.connection.credentialExpiresAt ? new Date(microsoft.connection.credentialExpiresAt).toLocaleDateString() : "Not created"}</dd></div>
                  </dl>
                  <div className="permission-checklist"><strong>Granted discovery and remediation permissions</strong>{(microsoft.connection.grantedPermissions ?? ["Directory.Read.All", "Group.Read.All", "User.Read.All", "Sites.ReadWrite.All", "Files.ReadWrite.All"]).map((permission) => <span key={permission}>{permission}</span>)}</div>
                </div>
                <div className="admin-card ingestion-card">
                  <h3>Load tenant data</h3>
                  <p>Discover SharePoint sites through the connected connector, then replace only the selected site models in PostgreSQL. Previously loaded sites that are not selected remain unchanged.</p>
                  <button disabled={!connected || discoveringSites || loadingData} onClick={discoverSites}>{discoveringSites ? "Discovering sites..." : discoveredSites.length ? "Refresh site list" : "Discover SharePoint sites"}</button>
                  {discoveredSites.length > 0 && (
                    <>
                      <div className="site-selection-heading">
                        <strong>{selectedSiteIds.length}/{discoveredSites.length} sites selected</strong>
                        <span><button onClick={() => setSelectedSiteIds(discoveredSites.map((site) => site.id))}>Select all</button><button onClick={() => setSelectedSiteIds([])}>Clear</button></span>
                      </div>
                      <label className="site-search">
                        <span>Search sites</span>
                        <input value={siteSearch} onChange={(event) => setSiteSearch(event.target.value)} placeholder="Search by site name or URL" />
                      </label>
                      <div className="site-selection-list">
                        {visibleSites.map((site) => (
                          <label key={site.id}>
                            <input type="checkbox" checked={selectedSiteIds.includes(site.id)} onChange={() => toggleSiteSelection(site.id)} />
                            <span><strong>{site.name}</strong><small>{site.webUrl ?? site.hostname ?? site.id}</small></span>
                          </label>
                        ))}
                        {!visibleSites.length && <div className="site-search-empty">No sites match this search.</div>}
                      </div>
                      {loadingData ? (
                        <div className="scan-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={scanPercent}>
                          <div className="scan-progress-heading">
                            <strong>{!scanProgress
                              ? "Starting tenant scan"
                              : scanProgress.stage === "syncing_directory"
                                ? "Synchronizing directory"
                                : scanProgress.stage === "waiting_for_graph"
                                  ? "Waiting for Microsoft Graph"
                                  : `Loading sites · ${scanPercent}%`}</strong>
                            <span>{scanProgress?.completedSites ?? 0}/{scanProgress?.requestedSites ?? selectedSiteIds.length}</span>
                          </div>
                          <div className="scan-progress-track"><span style={{ width: `${scanPercent}%` }} /></div>
                          <div className="scan-progress-meta">
                            <span>{currentScanSite ? `Current: ${currentScanSite}` : "Preparing SharePoint scan..."}</span>
                            <span>{(scanProgress?.nodes ?? 0).toLocaleString()} resources · {(scanProgress?.permissions ?? 0).toLocaleString()} permissions</span>
                            {scanProgress?.stage === "waiting_for_graph" && <span className="throttled">Microsoft throttled this request. Retrying in about {Math.max(1, Math.ceil((scanProgress.retryAfterMs ?? 1000) / 1000))} seconds · attempt {scanProgress.retryAttempt ?? 1}</span>}
                            {(scanProgress?.failedSites ?? 0) > 0 && <span className="failed">{scanProgress?.failedSites} failed sites; scan continuing</span>}
                          </div>
                          {(scanProgress?.failures ?? []).length > 0 && <div className="scan-failure-list">
                            {scanProgress?.failures.map((failure) => <div key={failure.siteId}><strong>{siteName(failure.siteId)}</strong><span>{failure.error}</span></div>)}
                          </div>}
                        </div>
                      ) : (
                        <button disabled={!selectedSiteIds.length} onClick={loadTenantData}>{`Load ${selectedSiteIds.length} selected sites`}</button>
                      )}
                    </>
                  )}
                  {scanNotice && <div className="ingestion-result notice">{scanNotice}</div>}
                  {scanError && <div className="ingestion-result failed">{scanError}</div>}
                  {scanResult && (
                    <div className={`ingestion-result ${scanResult.failedSites ? "partial" : "success"}`}>
                      <strong>{scanResult.successfulSites}/{scanResult.requestedSites} sites loaded</strong>
                      <span>{scanResult.nodes.toLocaleString()} nodes · {scanResult.permissions.toLocaleString()} permission records</span>
                      {scanResult.directory && <span>{scanResult.directory.users.toLocaleString()} users · {scanResult.directory.guests.toLocaleString()} guests · {scanResult.directory.groups.toLocaleString()} groups synchronized</span>}
                      {scanResult.failedSites > 0 && <div className="scan-failure-list">
                        {scanResult.results.filter((result) => !result.ok).map((failure) => <div key={failure.siteId}><strong>{siteName(failure.siteId)}</strong><span>{failure.error ?? "Unknown ingestion failure."}</span></div>)}
                      </div>}
                      <a href="/">Open imported tenant in Explorer</a>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          {section === "users" && (
            <>
              <div className="admin-section-heading"><div><span>Users</span><h2>Directory users and groups</h2><p>Import every active Entra user, guest user, group, and transitive group membership through the connected tenant connector.</p></div></div>
              <div className="admin-card ingestion-card">
                <h3>Microsoft directory synchronization</h3>
                <p>This sync refreshes the principal list used by View Access For and effective-access calculations. It does not modify the Microsoft tenant.</p>
                <button disabled={!connected || syncingDirectory || loadingData} onClick={syncDirectory}>{syncingDirectory ? "Syncing directory..." : "Sync users, guests, groups, and memberships"}</button>
                {scanError && <div className="ingestion-result failed">{scanError}</div>}
                {directorySync && (
                  <div className={`ingestion-result ${directorySync.failedGroups ? "partial" : "success"}`}>
                    <strong>Directory synchronized</strong>
                    <span>{directorySync.users.toLocaleString()} users · {directorySync.guests.toLocaleString()} guests · {directorySync.groups.toLocaleString()} groups · {directorySync.memberships.toLocaleString()} memberships</span>
                    {directorySync.failedGroups > 0 && <small>{directorySync.failedGroups} groups could not be expanded.</small>}
                  </div>
                )}
              </div>
            </>
          )}
          {section === "settings" && (
            <>
              <div className="admin-section-heading"><div><span>Additional Settings</span><h2>Application preferences</h2><p>Choose the appearance used throughout Spaghetti Explorer, including both Tree and Map visualizations.</p></div></div>
              <div className="admin-card appearance-card">
                <div><h3>Appearance</h3><p>The selected mode is saved on this device and applies immediately.</p></div>
                <div className="theme-toggle" role="group" aria-label="Appearance theme">
                  <button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}><span>☀</span><strong>Light</strong><small>Bright Tree and Map canvases</small></button>
                  <button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}><span>◐</span><strong>Dark</strong><small>Low-light Tree and Map canvases</small></button>
                </div>
              </div>
              <div className="admin-card integrations-card">
                <div className="integration-heading">
                  <div><span>Power Automate</span><h3>Teams manager approvals</h3><p>Download the pre-built approval flows, import them into Power Platform, then verify the solution in the selected environment.</p></div>
                  <a href="/api/integrations/power-automate/solution" download>Download solution</a>
                </div>
                <div className="integration-flow-summary">
                  <span><b>1</b> Spaghetti sends approval request</span>
                  <span><b>2</b> Manager approves in Teams</span>
                  <span><b>3</b> Decision returns to Spaghetti</span>
                </div>
                <div className="integration-validation">
                  <label><span>Power Platform environment</span><select value={powerPlatformEnvironmentId} onChange={(event) => { setPowerPlatformEnvironmentId(event.target.value); setPowerAutomateValidation(null); }}>
                    {powerPlatformEnvironments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}{environment.isDemo ? " · Demo" : ""}</option>)}
                  </select></label>
                  <button disabled={!powerPlatformEnvironmentId || validatingPowerAutomate} onClick={validatePowerAutomate}>{validatingPowerAutomate ? "Validating solution..." : "Validate installation"}</button>
                </div>
                {powerAutomateValidation && <div className={`integration-result ${powerAutomateValidation.installed ? "installed" : "missing"}`}>
                  <strong>{powerAutomateValidation.installed ? "Solution installed" : "Solution not found"}</strong>
                  <span>{powerAutomateValidation.environmentName} · {powerAutomateValidation.mode} validation</span>
                  <small>{powerAutomateValidation.installed ? `Version ${powerAutomateValidation.solution.version} verified ${new Date(powerAutomateValidation.checkedAt).toLocaleString()}` : "Import the downloaded solution into this environment, bind its connections, and validate again."}</small>
                </div>}
              </div>
            </>
          )}
          {section === "data" && (
            <>
              <div className="admin-section-heading"><div><span>Data</span><h2>Data ingestion history</h2><p>Review completed SharePoint scans, imported resource counts, and exact failure reasons.</p></div></div>
              <div className="admin-card scan-history-card">
                <h3>Recent tenant scans</h3>
                {loadingScanHistory && <p>Loading scan history...</p>}
                {!loadingScanHistory && !scanHistory.length && <p>No completed tenant scans have been recorded yet.</p>}
                {scanHistory.map((scan) => (
                  <div className={`scan-history-entry ${scan.outcome}`} key={scan.id}>
                    <div><strong>{scan.details.successfulSites ?? 0}/{scan.details.requestedSites ?? 0} sites loaded</strong><span>{new Date(scan.createdAt).toLocaleString()} · {scan.outcome}</span></div>
                    <span>{(scan.details.nodes ?? 0).toLocaleString()} resources · {(scan.details.permissions ?? 0).toLocaleString()} permissions</span>
                    {(scan.details.results ?? []).some((result) => !result.ok) && <div className="scan-failure-list">
                      {scan.details.results.filter((result) => !result.ok).map((failure) => <div key={failure.siteId}><strong>{siteName(failure.siteId)}</strong><span>{failure.error ?? "Unknown ingestion failure."}</span></div>)}
                    </div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function PrintableTree({ nodes, expanded }: { nodes: DocumentNode[]; expanded?: Set<string> }) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const children = new Map<string | null, DocumentNode[]>();
  nodes.forEach((node) => {
    const parentId = node.parentId && nodeIds.has(node.parentId) ? node.parentId : null;
    children.set(parentId, [...(children.get(parentId) ?? []), node]);
  });
  const render = (parentId: string | null): ReactNode => (
    <ul>
      {(children.get(parentId) ?? []).map((node) => (
        <li key={node.id}>
          <div><span>{node.nodeType}</span><strong>{node.name}</strong><small>{node.path}</small></div>
          {children.has(node.id) && (!expanded || expanded.has(node.id)) ? render(node.id) : null}
        </li>
      ))}
    </ul>
  );
  return <div className="printable-tree">{render(null)}</div>;
}

function PathSnapshotTree({ nodes }: { nodes: DocumentNode[] }) {
  return (
    <div className="path-snapshot-tree">
      {nodes.map((node, index) => (
        <div className="path-snapshot-step" key={node.id} style={{ marginLeft: index * 42 }}>
          {index > 0 && <i aria-hidden="true" />}
          <img src={nodeIcons[node.nodeType]} alt="" />
          <div><span>{node.nodeType}</span><strong>{node.name}</strong></div>
        </div>
      ))}
    </div>
  );
}

function hubSpokePositions(nodes: DocumentNode[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const children = new Map<string, DocumentNode[]>();
  nodes.forEach((node) => {
    if (!node.parentId || !nodeIds.has(node.parentId)) return;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  });
  children.forEach((items) => items.sort((left, right) => left.name.localeCompare(right.name)));

  const weightCache = new Map<string, number>();
  const branchWeight = (nodeId: string): number => {
    const cached = weightCache.get(nodeId);
    if (cached) return cached;
    const descendants = children.get(nodeId) ?? [];
    const weight = descendants.length ? descendants.reduce((sum, child) => sum + branchWeight(child.id), 0) : 1;
    weightCache.set(nodeId, weight);
    return weight;
  };

  const roots = nodes
    .filter((node) => !node.parentId || !nodeIds.has(node.parentId))
    .sort((left, right) => left.name.localeCompare(right.name));
  const positions = new Map<string, { x: number; y: number }>();
  const clusterRadius = roots.length > 1 ? 145 : 0;
  const ringStep = 29;

  const placeChildren = (parentId: string, centerX: number, centerY: number, depth: number, startAngle: number, endAngle: number) => {
    const descendants = children.get(parentId) ?? [];
    if (!descendants.length) return;
    const totalWeight = descendants.reduce((sum, child) => sum + branchWeight(child.id), 0);
    let cursor = startAngle;
    descendants.forEach((child) => {
      const span = (endAngle - startAngle) * (branchWeight(child.id) / totalWeight);
      const childStart = cursor;
      const childEnd = cursor + span;
      const angle = (childStart + childEnd) / 2;
      const radius = depth * ringStep;
      positions.set(child.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
      placeChildren(child.id, centerX, centerY, depth + 1, childStart, childEnd);
      cursor = childEnd;
    });
  };

  roots.forEach((root, index) => {
    const clusterAngle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(roots.length, 1);
    const centerX = Math.cos(clusterAngle) * clusterRadius;
    const centerY = Math.sin(clusterAngle) * clusterRadius;
    positions.set(root.id, { x: centerX, y: centerY });
    placeChildren(root.id, centerX, centerY, 1, -Math.PI, Math.PI);
  });

  return positions;
}

function GraphLoader({
  payload,
  onEdgeHover,
  onNodeHover,
  onNodeClick,
  focusedNodeId,
  focusedPathIds,
  matchingNodeIds,
  activeNodeId,
  focusedDepth,
  theme,
  onSigmaReady,
}: {
  payload: GraphPayload;
  onEdgeHover: (edge: Relationship | null) => void;
  onNodeHover: (node: DocumentNode | null) => void;
  onNodeClick: (node: DocumentNode) => void;
  focusedNodeId: string | null;
  focusedPathIds: Set<string>;
  matchingNodeIds: Set<string>;
  activeNodeId: string | null;
  focusedDepth: number;
  theme: AppearanceTheme;
  onSigmaReady: (sigma: Sigma) => void;
}) {
  const loadGraph = useLoadGraph();
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();

  useEffect(() => {
    onSigmaReady(sigma);
  }, [onSigmaReady, sigma]);

  useEffect(() => {
    const graph = new Graph({ multi: false, type: "directed" });
    const positions = hubSpokePositions(payload.nodes);
    payload.nodes.forEach((node) => {
      const position = positions.get(node.id) ?? { x: 0, y: 0 };
      const layerDistance = Math.abs(node.depth - focusedDepth);
      const layerScale = layerDistance === 0 ? 1.45 : layerDistance === 1 ? 0.88 : 0.68;
      const baseSize = node.nodeType === "site" ? 22 : node.nodeType === "library" ? 15 : node.nodeType === "folder" ? 10 : 7;
      const baseColor = node.id === activeNodeId
        ? "#29b6ff"
        : matchingNodeIds.size
        ? matchingNodeIds.has(node.id) ? "#ffffff" : "#505968"
        : focusedPathIds.size
        ? focusedPathIds.has(node.id) ? (node.id === focusedNodeId ? "#ffffff" : colors[node.nodeType]) : "#3b4350"
        : node.hasAccess ? colors[node.nodeType] : "#788292";
      graph.addNode(node.id, {
        label: node.name,
        x: position.x,
        y: position.y,
        size: baseSize * layerScale,
        color: layerDistance === 0 ? baseColor : blendHex(baseColor, theme === "light" ? "#e4e7ec" : "#202936", layerDistance === 1 ? 0.48 : 0.72),
        type: "icon",
        image: nodeIcons[node.nodeType],
        iconColor: layerDistance === 0 ? (node.hasAccess ? "#101828" : theme === "light" ? "#475467" : "#f8fafc") : "#9aa4b2",
        outlineColor: node.id === activeNodeId || node.id === focusedNodeId ? "#29b6ff" : layerDistance === 0 ? theme === "light" ? "#344054" : "#ffffff" : "#667085",
        forceLabel: layerDistance === 0 || node.id === activeNodeId || node.id === focusedNodeId,
        layerDistance,
        layerFocus: layerDistance === 0,
        nodeType: node.nodeType,
        theme,
        path: node.path,
        hasAccess: node.hasAccess,
        hidden: false,
        zIndex: node.id === activeNodeId ? 7 : matchingNodeIds.has(node.id) ? 6 : node.id === focusedNodeId ? 5 : focusedPathIds.has(node.id) ? 4 : node.hasAccess ? 2 : 0,
      });
    });
    payload.edges.forEach((edge) => {
      const targetDepth = payload.nodes.find((node) => node.id === edge.target)?.depth ?? 0;
      const layerDistance = Math.abs(targetDepth - focusedDepth);
      graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
        ...edge,
        color: layerDistance === 0 ? (matchingNodeIds.size
          ? matchingNodeIds.has(edge.target) ? theme === "light" ? "#101828" : "#ffffff" : theme === "light" ? "#98a2b3" : "#3b4350"
          : focusedPathIds.size
          ? focusedPathIds.has(edge.source) && focusedPathIds.has(edge.target) ? theme === "light" ? "#101828" : "#ffffff" : theme === "light" ? "#b8c0cc" : "#353d49"
          : graph.getNodeAttribute(edge.target, "hasAccess") ? theme === "light" ? "#475467" : "#e2e8f0" : "#94a3b8") : layerDistance === 1 ? "#98a2b3" : theme === "light" ? "#d0d5dd" : "#354152",
        size: layerDistance === 0 ? (matchingNodeIds.has(edge.target) ? 5 : focusedPathIds.has(edge.source) && focusedPathIds.has(edge.target) ? 5 : 4) : layerDistance === 1 ? 1.8 : 1,
      });
    });
    loadGraph(graph);
  }, [activeNodeId, focusedDepth, focusedNodeId, focusedPathIds, loadGraph, matchingNodeIds, payload, theme]);

  useEffect(() => {
    if (!focusedNodeId) return;
    const graph = sigma.getGraph();
    if (!graph.hasNode(focusedNodeId)) return;
    const { x, y } = sigma.getNodeDisplayData(focusedNodeId) ?? {};
    if (typeof x === "number" && typeof y === "number") {
      sigma.getCamera().animate({ x, y, ratio: 0.35 }, { duration: 500 });
    }
  }, [focusedNodeId, sigma]);

  useEffect(() => registerEvents({
    enterEdge: ({ edge }) => onEdgeHover(payload.edges.find((item) => item.id === edge) ?? null),
    leaveEdge: () => onEdgeHover(null),
    enterNode: ({ node }) => {
      onEdgeHover(null);
      onNodeHover(payload.nodes.find((item) => item.id === node) ?? null);
    },
    leaveNode: () => onNodeHover(null),
    clickNode: ({ node }) => {
      const selected = payload.nodes.find((item) => item.id === node);
      if (selected) onNodeClick(selected);
    },
  }), [onEdgeHover, onNodeClick, onNodeHover, payload, registerEvents]);

  return null;
}

function AccessTree({
  nodes,
  expanded,
  onExpand,
  onNodeHover,
  onNodeClick,
  principal,
  focusedPathIds,
  focusedNodeId,
  matchingNodeIds,
  activeNodeId,
  principalCollapsed,
  onTogglePrincipal,
  onSelectRelatedPrincipal,
}: {
  nodes: DocumentNode[];
  expanded: string[];
  onExpand: (expanded: string[]) => void;
  onNodeHover: (node: DocumentNode | null) => void;
  onNodeClick: (node: DocumentNode) => void;
  principal: Principal | undefined;
  focusedPathIds: Set<string>;
  focusedNodeId: string | null;
  matchingNodeIds: Set<string>;
  activeNodeId: string | null;
  principalCollapsed: boolean;
  onTogglePrincipal: () => void;
  onSelectRelatedPrincipal: (displayName: string) => void;
}) {
  const childrenByParent = useMemo(() => {
    const children = new Map<string | null, DocumentNode[]>();
    nodes.forEach((node) => {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    });
    return children;
  }, [nodes]);

  const subtreeSizes = useMemo(() => {
    const sizes = new Map<string, number>();
    const calculate = (node: DocumentNode): number => {
      const size = node.sizeBytes + (childrenByParent.get(node.id) ?? []).reduce((total, child) => total + calculate(child), 0);
      sizes.set(node.id, size);
      return size;
    };
    (childrenByParent.get(null) ?? []).forEach(calculate);
    return sizes;
  }, [childrenByParent]);

  const childCountSummary = (node: DocumentNode) => {
    const children = childrenByParent.get(node.id) ?? [];
    const childTypes = new Set(children.map((child) => child.nodeType));
    const childType = childTypes.size === 1 ? children[0]?.nodeType : null;
    const label = childType === "site" ? "site"
      : childType === "library" ? "library"
      : childType === "folder" ? "folder"
      : childType === "document" ? "file"
      : "item";
    return `${children.length} ${pluralizeResource(label, children.length)}, ${formatBytes(subtreeSizes.get(node.id) ?? 0)}`;
  };

  const branchNodesByDepth = useMemo(() => {
    const parentIds = new Set(nodes.map((node) => node.parentId).filter((id): id is string => Boolean(id)));
    const branches = new Map<number, DocumentNode[]>();
    nodes.filter((node) => parentIds.has(node.id)).forEach((node) => {
      const atDepth = branches.get(node.depth) ?? [];
      atDepth.push(node);
      branches.set(node.depth, atDepth);
    });
    return [...branches.entries()].sort(([left], [right]) => left - right);
  }, [nodes]);

  const toggleDepth = (depthNodes: DocumentNode[]) => {
    const allExpanded = depthNodes.every((node) => expanded.includes(node.id));
    if (allExpanded) {
      const collapseIds = new Set(nodes.filter((node) => node.depth >= depthNodes[0].depth).map((node) => node.id));
      onExpand(expanded.filter((id) => !collapseIds.has(id)));
      return;
    }
    const parentLayers = nodes.filter((node) => node.depth <= depthNodes[0].depth && node.nodeType !== "document").map((node) => node.id);
    onExpand(parentLayers);
  };

  const toggleBranch = (nodeId: string) => {
    onExpand(expanded.includes(nodeId)
      ? expanded.filter((id) => id !== nodeId)
      : [...expanded, nodeId]);
  };

  const treeNodes = useMemo(() => {
    const build = (parentId: string | null): TreeNode[] =>
      (childrenByParent.get(parentId) ?? []).map((node) => {
        const children = build(node.id);
        return {
          value: node.id,
          disabled: !node.hasAccess,
          className: `access-tree-node ${node.hasAccess ? "has-access" : "no-access"} ${focusedPathIds.has(node.id) ? "search-path" : ""} ${node.id === focusedNodeId ? "search-target" : ""} ${matchingNodeIds.has(node.id) ? "grant-match" : ""} ${node.id === activeNodeId ? "active-node" : ""}`,
          label: (
            <span
              className="tree-node-label"
              onMouseEnter={() => onNodeHover(node)}
              onMouseLeave={() => onNodeHover(null)}
              onPointerDown={(event) => { event.stopPropagation(); onNodeClick(node); }}
              onClick={(event) => event.stopPropagation()}
            >
              <span>
                <strong>{node.name}</strong>
                <small>{node.nodeType}</small>
              </span>
              {children.length > 0 && (
                <button
                  className="branch-toggle"
                  type="button"
                  aria-expanded={expanded.includes(node.id)}
                  aria-label={`${expanded.includes(node.id) ? "Collapse" : "Expand"} ${node.name} branch. ${childCountSummary(node)}`}
                  data-summary={childCountSummary(node)}
                  onMouseEnter={(event) => { event.stopPropagation(); onNodeHover(null); }}
                  onMouseLeave={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); toggleBranch(node.id); }}
                >
                  {expanded.includes(node.id) ? "−" : "+"}
                </button>
              )}
            </span>
          ),
          ...(children.length ? { children } : {}),
        };
      });

    return build(null);
  }, [activeNodeId, childrenByParent, expanded, focusedNodeId, focusedPathIds, matchingNodeIds, nodes, onNodeClick, onNodeHover, subtreeSizes]);

  const checked = useMemo(() => nodes.filter((node) => node.hasAccess).map((node) => node.id), [nodes]);
  const icon = (value: string) => <span className="tree-icon">{value}</span>;
  const principalName = principal?.displayName ?? "Everyone";
  const initials = principalName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const membershipCount = principal?.principalType === "group" ? principal.members?.length ?? 0 : principal?.memberships?.length ?? 0;

  return (
    <div className={`tree-view ${principalCollapsed ? "principal-collapsed" : ""}`}>
      <div className={`tree-principal ${principalCollapsed ? "collapsed" : ""} ${focusedNodeId ? "search-path" : ""}`} onClick={onTogglePrincipal} title={principalCollapsed ? "Expand principal details" : "Collapse principal details"}>
        <div className="principal-card-header">
          <button className="principal-avatar" aria-label={principalCollapsed ? "Expand principal details" : "Collapse principal details"}>{initials}</button>
          <div className="principal-main">
            <span>{principal?.principalType === "guest" ? "Guest user" : principal?.groupType ? `${principal.groupType} group` : principal?.principalType ?? "group"}</span>
            <strong>{principalName}</strong>
            {!principalCollapsed && principal?.email && <small>{principal.email}</small>}
            {!principalCollapsed && principal?.jobTitle && <small className="principal-job">{principal.jobTitle}</small>}
            {!principalCollapsed && principal?.description && <small className="principal-description">{principal.description}</small>}
          </div>
        </div>
        {principalCollapsed ? (
          principal && principal.principalType !== "guest" && <span className="principal-collapsed-count">{membershipCount} {principal.principalType === "group" ? "members" : "groups"}</span>
        ) : (
          <div className="principal-overview-sections">
            {principal?.principalType === "user" && principal.manager && (
              <section>
                <span>Manager</span>
                <button onClick={(event) => { event.stopPropagation(); onSelectRelatedPrincipal(principal.manager!); }}>{principal.manager}</button>
              </section>
            )}
            {principal?.principalType === "user" && principal.directReports?.length ? (
              <section>
                <span>Direct reports · {principal.directReports.length}</span>
                <div>{principal.directReports.map((report) => <button key={report} onClick={(event) => { event.stopPropagation(); onSelectRelatedPrincipal(report); }}>{report}</button>)}</div>
              </section>
            ) : null}
            {principal?.principalType === "user" && principal.memberships?.length ? (
              <section>
                <span>Groups · {principal.memberships.length}</span>
                <div>{principal.memberships.map((group) => (
                  <button key={group.id} onClick={(event) => { event.stopPropagation(); onSelectRelatedPrincipal(group.displayName); }}>
                    {group.displayName}<em>{group.groupType}</em>
                  </button>
                ))}</div>
              </section>
            ) : null}
            {principal?.principalType === "group" && principal.members?.length ? (
              <section>
                <span>Members · {principal.members.length}</span>
                <div>{principal.members.map((member) => (
                  <button key={member.id} onClick={(event) => { event.stopPropagation(); onSelectRelatedPrincipal(member.displayName); }}>
                    {member.displayName}<em>{member.email}</em>
                  </button>
                ))}</div>
              </section>
            ) : null}
            {principal && principal.principalType !== "guest" && membershipCount === 0 && (
              <section><span>{principal.principalType === "group" ? "Members" : "Groups"}</span><small>None listed</small></section>
            )}
          </div>
        )}
      </div>
      <div className="tree-content">
        <CheckboxTree
          nodes={treeNodes}
          checked={checked}
          expanded={expanded}
          onCheck={() => undefined}
          onExpand={onExpand}
          noCascade
          showExpandAll={false}
          icons={{
            check: icon("✓"),
            uncheck: icon(""),
            halfCheck: icon("−"),
            expandClose: icon("›"),
            expandOpen: icon("⌄"),
            parentClose: icon(""),
            parentOpen: icon(""),
            leaf: icon(""),
          }}
        />
      </div>
      <div className="tree-depth-rail" aria-label="Expand or collapse resource layers">
        {branchNodesByDepth.map(([depth, depthNodes]) => {
          const allExpanded = depthNodes.every((node) => expanded.includes(node.id));
          const nodeTypes = new Set(depthNodes.map((node) => node.nodeType));
          const nodeType = nodeTypes.size === 1 ? depthNodes[0].nodeType : "resource";
          const layerSize = depthNodes.reduce((total, node) => total + (subtreeSizes.get(node.id) ?? 0), 0);
          const layerSummary = `${depthNodes.length} ${pluralizeResource(nodeType, depthNodes.length)}, ${formatBytes(layerSize)}`;
          return (
            <div className="depth-control" style={{ left: `${depth * 32}px` }} key={depth}>
              <span />
              <button
                onClick={(event) => { event.stopPropagation(); toggleDepth(depthNodes); }}
                aria-label={`${allExpanded ? "Collapse" : "Expand"} resource layer ${depth + 1}`}
                data-summary={layerSummary}
              >
                {allExpanded ? "−" : "+"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function App() {
  const [theme] = useAppearanceTheme();
  const explorerRoute = window.location.pathname !== "/admin" && window.location.pathname !== "/logs";
  const [activeTenantId] = useState(() => localStorage.getItem(activeTenantStorageKey) ?? "");
  const [activeSiteScope] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(activeSiteScopeStorageKey) ?? "[]") as unknown;
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
    } catch {
      return [];
    }
  });
  const [connectorPermissions, setConnectorPermissions] = useState<string[]>([]);
  const [launchMode, setLaunchMode] = useState<"sample" | "tenant" | null>(() => {
    const stored = localStorage.getItem(launchModeStorageKey);
    return stored === "sample" || stored === "tenant" ? stored : null;
  });
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [riskInsights, setRiskInsights] = useState<RiskInsight[]>([]);
  const [principalId, setPrincipalId] = useState("");
  const [payload, setPayload] = useState<GraphPayload>({ nodes: [], edges: [] });
  const [hoveredEdge, setHoveredEdge] = useState<Relationship | null>(null);
  const [hoveredNode, setHoveredNode] = useState<DocumentNode | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 24, y: 24 });
  const [pinnedNode, setPinnedNode] = useState<DocumentNode | null>(null);
  const [inheritanceBroken, setInheritanceBroken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"graph" | "tree">("tree");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [viewControlsOpen, setViewControlsOpen] = useState(true);
  const [accessControlsOpen, setAccessControlsOpen] = useState(true);
  const [sideDrawer, setSideDrawer] = useState<"ai" | "actions" | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [grantTypes, setGrantTypes] = useState<GrantMethodType[]>([]);
  const [grantCount, setGrantCount] = useState<"any" | "one" | "multiple">("any");
  const [principalSearch, setPrincipalSearch] = useState("");
  const [principalSearchOpen, setPrincipalSearchOpen] = useState(false);
  const [principalCollapsed, setPrincipalCollapsed] = useState(false);
  const [actions, setActions] = useState<PermissionAction[]>([]);
  const [actionsRunning, setActionsRunning] = useState(false);
  const [newGrantOpen, setNewGrantOpen] = useState(false);
  const [newGrantPath, setNewGrantPath] = useState<GrantMethodType | "sharepoint_group">("direct");
  const [newGrantPermissionLevel, setNewGrantPermissionLevel] = useState<PermissionLevel>("Read");
  const [newSharingLinkType, setNewSharingLinkType] = useState<SharingLinkType>("view");
  const [newSharingLinkScope, setNewSharingLinkScope] = useState<SharingLinkScope>("users");
  const [newGrantPrincipalId, setNewGrantPrincipalId] = useState("");
  const [mapDrillNodeId, setMapDrillNodeId] = useState<string | null>(null);
  const [snapshotExporting, setSnapshotExporting] = useState<"global" | "node" | null>(null);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const visualSnapshotRef = useRef<HTMLDivElement>(null);
  const globalTreeSnapshotRef = useRef<HTMLElement>(null);
  const groupMemberRemovalReady = launchMode === "sample" || connectorPermissions.includes("GroupMember.ReadWrite.All");

  useEffect(() => {
    if (!activeTenantId) return;
    fetch(`/api/microsoft/connect/status?tenantId=${encodeURIComponent(activeTenantId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((result) => setConnectorPermissions(Array.isArray(result?.connection?.grantedPermissions) ? result.connection.grantedPermissions : []))
      .catch(() => setConnectorPermissions([]));
  }, [activeTenantId]);
  const nodeSnapshotRef = useRef<HTMLElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  useEffect(() => {
    if (!explorerRoute) return;
    const params = activeTenantId ? `?tenantId=${encodeURIComponent(activeTenantId)}` : "";
    fetch(`/api/principals${params}`)
      .then(async (response) => response.ok ? response.json() : [])
      .then((result: Principal[]) => setPrincipals(Array.isArray(result) ? result : []));
    fetchRiskInsights(activeTenantId || undefined)
      .then(setRiskInsights)
      .catch(() => setRiskInsights([]));
  }, [activeTenantId, explorerRoute]);

  useEffect(() => {
    if (!explorerRoute) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (activeTenantId) params.set("tenantId", activeTenantId);
    if (principalId) params.set("principalId", principalId);
    activeSiteScope.forEach((siteId) => params.append("siteId", siteId));
    const query = params.size ? `?${params.toString()}` : "";
    fetch(`/api/graph${query}`)
      .then(async (response) => response.ok ? response.json() : { nodes: [], edges: [] })
      .then((result: GraphPayload) => setPayload(Array.isArray(result.nodes) && Array.isArray(result.edges) ? result : { nodes: [], edges: [] }))
      .finally(() => setLoading(false));
  }, [activeTenantId, activeSiteScope, explorerRoute, principalId]);

  useEffect(() => {
    setExpanded(payload.nodes.filter((node) => node.nodeType !== "document").map((node) => node.id));
  }, [payload.nodes]);

  useEffect(() => {
    if ((pinnedNode?.nodeType === "site" || pinnedNode?.nodeType === "library") && newGrantPath === "sharing_link") {
      setNewGrantPath("direct");
    }
  }, [newGrantPath, pinnedNode?.nodeType]);

  const selected = useMemo(() => principals.find((principal) => principal.id === principalId), [principalId, principals]);
  const groupPrincipals = useMemo(() => principals.filter((principal) => principal.principalType === "group"), [principals]);
  const newGrantTargetOptions = useMemo(() => {
    if (newGrantPath === "security_group" || newGrantPath === "m365_group" || newGrantPath === "sharepoint_group") return groupPrincipals;
    if (selected) return [selected];
    return principals;
  }, [groupPrincipals, newGrantPath, principals, selected]);
  const newGrantTarget = newGrantTargetOptions.find((principal) => principal.id === newGrantPrincipalId) ?? newGrantTargetOptions[0];
  const principalResults = useMemo(() => {
    const query = principalSearch.trim().toLowerCase();
    return principals
      .filter((principal) => !query || `${principal.displayName} ${principal.email ?? ""} ${principal.principalType}`.toLowerCase().includes(query))
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .slice(0, 10);
  }, [principalSearch, principals]);
  const accessCount = payload.nodes.filter((node) => node.hasAccess).length;
  const nodesById = useMemo(() => new Map(payload.nodes.map((node) => [node.id, node])), [payload.nodes]);
  const childrenByParent = useMemo(() => {
    const children = new Map<string | null, DocumentNode[]>();
    payload.nodes.forEach((node) => children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]));
    return children;
  }, [payload.nodes]);
  const subtreeSizes = useMemo(() => {
    const sizes = new Map<string, number>();
    const calculate = (node: DocumentNode): number => {
      const size = node.sizeBytes + (childrenByParent.get(node.id) ?? []).reduce((total, child) => total + calculate(child), 0);
      sizes.set(node.id, size);
      return size;
    };
    (childrenByParent.get(null) ?? []).forEach(calculate);
    return sizes;
  }, [childrenByParent]);
  const resourceSummary = (node: DocumentNode) => {
    const children = childrenByParent.get(node.id) ?? [];
    const childTypes = new Set(children.map((child) => child.nodeType));
    const childType = childTypes.size === 1 ? children[0]?.nodeType : null;
    const label = childType === "site" ? "site"
      : childType === "library" ? "library"
      : childType === "folder" ? "folder"
      : childType === "document" ? "file"
      : "item";
    return `${children.length} ${pluralizeResource(label, children.length)}, ${formatBytes(subtreeSizes.get(node.id) ?? node.sizeBytes)}`;
  };
  const focusedPathIds = useMemo(() => {
    const path = new Set<string>();
    let current = focusedNodeId ? nodesById.get(focusedNodeId) : undefined;
    while (current) {
      path.add(current.id);
      current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
    return path;
  }, [focusedNodeId, nodesById]);
  const grantFiltersActive = grantTypes.length > 0 || grantCount !== "any";
  const matchingNodeIds = useMemo(() => {
    if (!grantFiltersActive || !principalId) return new Set<string>();
    return new Set(payload.nodes.filter((node) => {
      const matchesType = grantTypes.length === 0 || node.accessDetails.grantMethods.some((method) => grantTypes.includes(method.type));
      const matchesCount = grantCount === "any"
        || (grantCount === "one" && node.accessDetails.grantMethodCount === 1)
        || (grantCount === "multiple" && node.accessDetails.grantMethodCount >= 2);
      return node.hasAccess && matchesType && matchesCount;
    }).map((node) => node.id));
  }, [grantCount, grantFiltersActive, grantTypes, payload.nodes, principalId]);
  const contextualNodeIds = useMemo(() => {
    if (!matchingNodeIds.size) return new Set<string>();
    const context = new Set(matchingNodeIds);
    matchingNodeIds.forEach((id) => {
      let current = nodesById.get(id);
      while (current?.parentId) {
        context.add(current.parentId);
        current = nodesById.get(current.parentId);
      }
    });
    return context;
  }, [matchingNodeIds, nodesById]);
  const searchIndex = useMemo(() => new Fuse(payload.nodes, {
    keys: [{ name: "name", weight: 0.6 }, { name: "path", weight: 0.3 }, { name: "nodeType", weight: 0.1 }],
    threshold: 0.35,
    ignoreLocation: true,
    includeScore: true,
  }), [payload.nodes]);
  const searchResults = useMemo(() => search.trim() ? searchIndex.search(search.trim(), { limit: 8 }).map((result) => result.item) : [], [search, searchIndex]);
  const filteredGraphPayload = useMemo<GraphPayload>(() => {
    if ((!accessibleOnly || !principalId) && !grantFiltersActive) return payload;
    const visibleNodeIds = grantFiltersActive
      ? contextualNodeIds
      : new Set(payload.nodes.filter((node) => node.hasAccess).map((node) => node.id));
    return {
      nodes: payload.nodes.filter((node) => visibleNodeIds.has(node.id)),
      edges: payload.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    };
  }, [accessibleOnly, contextualNodeIds, grantFiltersActive, payload, principalId]);
  const mapDrillNode = mapDrillNodeId ? nodesById.get(mapDrillNodeId) ?? null : null;
  const graphPayload = useMemo<GraphPayload>(() => {
    const filteredIds = new Set(filteredGraphPayload.nodes.map((node) => node.id));
    const currentNodes = filteredGraphPayload.nodes.filter((node) => mapDrillNode ? node.parentId === mapDrillNode.id : node.nodeType === "site");
    const visibleNodeIds = new Set(currentNodes.map((node) => node.id));
    if (mapDrillNode) {
      (childrenByParent.get(mapDrillNode.parentId) ?? []).forEach((parentLayerNode) => {
        if (filteredIds.has(parentLayerNode.id)) visibleNodeIds.add(parentLayerNode.id);
      });
    }
    currentNodes.forEach((node) => (childrenByParent.get(node.id) ?? []).forEach((child) => {
      if (filteredIds.has(child.id)) visibleNodeIds.add(child.id);
    }));
    return {
      nodes: filteredGraphPayload.nodes.filter((node) => visibleNodeIds.has(node.id)),
      edges: filteredGraphPayload.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    };
  }, [childrenByParent, filteredGraphPayload, mapDrillNode]);
  const treeNodes = grantFiltersActive ? payload.nodes.filter((node) => contextualNodeIds.has(node.id)) : payload.nodes;
  const mapDrillPath = useMemo(() => {
    const path: DocumentNode[] = [];
    let current = mapDrillNode ?? undefined;
    while (current) {
      path.unshift(current);
      current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
    return path;
  }, [mapDrillNode, nodesById]);

  useEffect(() => {
    if (mapDrillNodeId && !filteredGraphPayload.nodes.some((node) => node.id === mapDrillNodeId)) setMapDrillNodeId(null);
  }, [filteredGraphPayload.nodes, mapDrillNodeId]);

  useEffect(() => {
    setNewGrantOpen(false);
    setNewGrantPath("direct");
    setNewGrantPermissionLevel("Read");
    setNewSharingLinkType("view");
    setNewSharingLinkScope("users");
    setNewGrantPrincipalId("");
  }, [pinnedNode?.id]);

  useEffect(() => {
    if (!newGrantTargetOptions.some((principal) => principal.id === newGrantPrincipalId)) {
      setNewGrantPrincipalId(newGrantTargetOptions[0]?.id ?? "");
    }
  }, [newGrantPrincipalId, newGrantTargetOptions]);

  const toggleGrantType = (type: GrantMethodType) => {
    setGrantTypes((existing) => existing.includes(type) ? existing.filter((value) => value !== type) : [...existing, type]);
  };

  const selectPrincipal = (id: string) => {
    setPrincipalId(id);
    setPrincipalSearch("");
    setPrincipalSearchOpen(false);
    setHoveredNode(null);
    setPinnedNode(null);
  };

  const selectRelatedPrincipal = (displayName: string) => {
    const related = principals.find((principal) => principal.displayName === displayName);
    if (related) selectPrincipal(related.id);
  };

  const actionIsQueued = (key: string) => actions.some((action) => action.key === key && (action.status === "pending" || action.status === "running"));

  const enqueueAction = async (action: Omit<PermissionAction, "id" | "status">) => {
    if (actions.length >= 15 || actions.some((item) => item.key === action.key && (item.status === "pending" || item.status === "running"))) return;
    const stagedAction: PermissionAction = { ...action, id: crypto.randomUUID(), status: "pending" };
    const response = await fetch("/api/actions/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stagedAction),
    });
    if (!response.ok) return;
    setActions((current) => {
      if (current.length >= 15 || current.some((item) => item.key === action.key && (item.status === "pending" || item.status === "running"))) return current;
      return [...current, stagedAction];
    });
  };

  const revokeGrantCommand = (type: GrantMethodType, target?: Principal, targetName?: string | null): TenantPermissionCommand => {
    const shared = {
      targetPrincipalId: target?.id,
      targetPrincipalName: target?.displayName ?? targetName ?? undefined,
      targetPrincipalType: target?.principalType,
      sourcePrincipalId: selected?.id,
      sourcePrincipalName: selected?.displayName,
      accessPath: type,
    };
    if (type === "sharing_link") return { ...shared, provider: "microsoft_graph", operation: "remove_sharing_link_user", method: "DELETE", endpointTemplate: "/drives/{drive-id}/items/{item-id}/permissions/{link-permission-id}/grantedToIdentitiesV2/{principal-id}" };
    if (type === "security_group") return { ...shared, provider: "microsoft_graph", operation: "remove_security_group_permission", method: "DELETE", endpointTemplate: "/drives/{drive-id}/items/{item-id}/permissions/{permission-id}" };
    if (type === "m365_group") return { ...shared, provider: "microsoft_graph", operation: "remove_m365_group_permission", method: "DELETE", endpointTemplate: "/drives/{drive-id}/items/{item-id}/permissions/{permission-id}" };
    return { ...shared, provider: "microsoft_graph", operation: "remove_direct_permission", method: "DELETE", endpointTemplate: "/drives/{drive-id}/items/{item-id}/permissions/{permission-id}" };
  };

  const inheritanceCommand = (broken: boolean): TenantPermissionCommand => broken
    ? { provider: "sharepoint_rest", operation: "reset_inheritance", method: "POST", endpointTemplate: "/_api/web/lists/{list-id}/items/{item-id}/resetroleinheritance" }
    : { provider: "sharepoint_rest", operation: "break_inheritance", method: "POST", endpointTemplate: "/_api/web/lists/{list-id}/items/{item-id}/breakroleinheritance(copyRoleAssignments=true,clearSubscopes=false)" };

  const addGrantCommand = (
    path: GrantMethodType | "sharepoint_group",
    target: Principal,
    permissionLevel: PermissionLevel,
    sharingLinkType?: SharingLinkType,
    sharingLinkScope?: SharingLinkScope,
  ): TenantPermissionCommand => ({
    provider: path === "sharepoint_group" ? "sharepoint_rest" : "microsoft_graph",
    operation: "add_permission_grant",
    method: "POST",
    endpointTemplate: path === "sharing_link"
      ? "/drives/{drive-id}/items/{item-id}/createLink"
      : path !== "sharepoint_group"
      ? "/drives/{drive-id}/items/{item-id}/invite"
      : "/_api/web/lists/{list-id}/items/{item-id}/roleassignments/addroleassignment(principalid={group-id},roledefid={role-id})",
    accessPath: path,
    permissionLevel,
    sharingLinkType,
    sharingLinkScope,
    targetPrincipalId: target.id,
    targetPrincipalName: target.displayName,
    targetPrincipalType: target.principalType,
    sourcePrincipalId: selected?.id,
    sourcePrincipalName: selected?.displayName,
  });

  const queueNewGrant = () => {
    if (!pinnedNode || pinnedNode.nodeType === "site" || !newGrantTarget) return;
    const effectivePermissionLevel = newGrantPath === "sharing_link"
      ? newSharingLinkType === "edit" ? "Contribute" : "Read"
      : newGrantPermissionLevel;
    const command = addGrantCommand(
      newGrantPath,
      newGrantTarget,
      effectivePermissionLevel,
      newGrantPath === "sharing_link" ? newSharingLinkType : undefined,
      newGrantPath === "sharing_link" ? newSharingLinkScope : undefined,
    );
    const accessLabel = newGrantPath === "sharepoint_group"
      ? "SharePoint group"
      : grantMethodOptions.find((option) => option.type === newGrantPath)?.label ?? newGrantPath;
    enqueueAction({
      key: `add:${pinnedNode.id}:${newGrantPath}:${effectivePermissionLevel}:${newSharingLinkType}:${newSharingLinkScope}:${newGrantTarget.id}`,
      kind: "add_permission_grant",
      label: `Add ${accessLabel}`,
      nodeId: pinnedNode.id,
      nodeName: pinnedNode.name,
      principalId: newGrantTarget.id,
      principalName: newGrantTarget.displayName,
      command,
    });
    setNewGrantOpen(false);
  };

  const updateNode = (nodeId: string, updater: (node: DocumentNode) => DocumentNode) => {
    setPayload((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === nodeId ? updater(node) : node) }));
    setPinnedNode((current) => current?.id === nodeId ? updater(current) : current);
  };

  const applySuccessfulAction = (action: PermissionAction) => {
    if (["remove_security_group_permission", "remove_m365_group_permission", "remove_sharing_link_user", "remove_direct_permission"].includes(action.kind) && action.grantIndex !== undefined) {
      updateNode(action.nodeId, (node) => {
        const grantMethods = node.accessDetails.grantMethods.filter((_, index) => index !== action.grantIndex);
        return {
          ...node,
          hasAccess: grantMethods.length > 0,
          accessDetails: {
            ...node.accessDetails,
            grantMethods,
            grantMethodCount: grantMethods.length,
            reason: grantMethods.length
              ? node.accessDetails.reason
              : `${node.accessDetails.selectedPrincipal ?? "Selected principal"} has no remaining effective permission grants on this resource.`,
          },
        };
      });
    }
    if (action.kind === "remove_principal_permission" && action.principalId) {
      updateNode(action.nodeId, (node) => ({
        ...node,
        accessDetails: {
          ...node.accessDetails,
          accessiblePrincipals: node.accessDetails.accessiblePrincipals.filter((principal) => principal.id !== action.principalId),
        },
      }));
    }
    if (action.kind === "remove_principal_from_group" && action.principalId && action.command.sourcePrincipalId) {
      updateNode(action.nodeId, (node) => {
        const accessiblePrincipals = node.accessDetails.accessiblePrincipals.flatMap((principal) => {
          if (principal.id !== action.principalId) return [principal];
          const accessGrants = principal.accessGrants.filter((grant) => grant.grantedByPrincipalId !== action.command.sourcePrincipalId);
          return accessGrants.length ? [{ ...principal, accessGrants }] : [];
        });
        return { ...node, accessDetails: { ...node.accessDetails, accessiblePrincipals } };
      });
    }
    if (action.kind === "add_permission_grant" && action.command.accessPath) {
      updateNode(action.nodeId, (node) => {
        const label = action.command.accessPath === "sharepoint_group"
          ? "SharePoint group"
          : grantMethodOptions.find((option) => option.type === action.command.accessPath)?.label ?? action.command.accessPath!;
        const grantMethods = [...node.accessDetails.grantMethods, {
          type: action.command.accessPath === "sharepoint_group" ? "security_group" as const : action.command.accessPath as GrantMethodType,
          label,
          grantedBy: action.command.targetPrincipalName ?? null,
          permissionLevel: action.command.permissionLevel ?? "Read",
        }];
        return { ...node, hasAccess: true, accessDetails: { ...node.accessDetails, grantMethods, grantMethodCount: grantMethods.length } };
      });
    }
    if (action.kind === "break_inheritance") setInheritanceBroken(true);
    if (action.kind === "reset_inheritance") setInheritanceBroken(false);
  };

  const runActions = async () => {
    const pending = actions.filter((action) => action.status === "pending");
    if (!pending.length || actionsRunning) return;
    setActionsRunning(true);
    for (const action of pending) {
      setActions((current) => current.map((item) => item.id === action.id ? { ...item, status: "running", message: undefined } : item));
      try {
        const response = await fetch("/api/actions/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        });
        const result = await response.json() as { ok?: boolean; message?: string; error?: string; executedAt?: string };
        if (!response.ok || !result.ok) throw new Error(result.error ?? result.message ?? "Action failed");
        applySuccessfulAction(action);
        setActions((current) => current.map((item) => item.id === action.id ? { ...item, status: "succeeded", message: result.message ?? "Completed" } : item));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Action failed";
        setActions((current) => current.map((item) => item.id === action.id ? { ...item, status: "failed", message } : item));
      }
    }
    setActionsRunning(false);
    if (launchMode === "tenant" && activeTenantId) {
      window.setTimeout(async () => {
        const params = new URLSearchParams({ tenantId: activeTenantId });
        if (principalId) params.set("principalId", principalId);
        const response = await fetch(`/api/graph?${params.toString()}`);
        if (!response.ok) return;
        const refreshed = await response.json() as GraphPayload;
        setPayload(refreshed);
        setPinnedNode((current) => current ? refreshed.nodes.find((node) => node.id === current.id) ?? null : null);
      }, 3000);
    }
  };

  const focusNode = (node: DocumentNode) => {
    const ancestorIds: string[] = [];
    let current: DocumentNode | undefined = node;
    while (current) {
      if (current.parentId) ancestorIds.push(current.parentId);
      current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
    setExpanded((existing) => [...new Set([...existing, ...ancestorIds])]);
    setAccessibleOnly(false);
    setFocusedNodeId(node.id);
    if (view === "graph") setMapDrillNodeId(node.nodeType === "site" ? null : node.parentId);
    setSearch(node.name);
    setSearchOpen(false);
    window.setTimeout(() => document.querySelector(".search-target .tree-node-label")?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
  };

  const openInsightNode = (insight: RiskInsight) => {
    const node = nodesById.get(insight.nodeIdToOpen);
    if (!node) return;
    setSideDrawer(null);
    focusNode(node);
    setPinnedNode(node);
  };
  const openQuestionNode = (node: DocumentNode) => {
    setSideDrawer(null);
    focusNode(node);
    setPinnedNode(node);
  };

  const handleNodeHover = (node: DocumentNode | null) => {
    setHoveredNode(node);
    if (node) {
      const event = window.event as MouseEvent | undefined;
      if (event) setTooltipPosition({ x: event.clientX, y: event.clientY });
    }
  };
  const principalCounts = (node: DocumentNode) => ({
    users: node.accessDetails.accessiblePrincipals.filter((principal) => principal.principalType === "user").length,
    groups: node.accessDetails.accessiblePrincipals.filter((principal) => principal.principalType === "group").length,
    guests: node.accessDetails.accessiblePrincipals.filter((principal) => principal.principalType === "guest").length,
  });
  const principalSections = pinnedNode ? [
    { type: "user", label: "Users" },
    { type: "group", label: "Groups" },
    { type: "guest", label: "Guest users" },
  ].map((section) => ({
    ...section,
    principals: pinnedNode.accessDetails.accessiblePrincipals
      .filter((principal) => principal.principalType === section.type)
      .sort((left, right) => left.displayName.localeCompare(right.displayName)),
  })) : [];
  const principalGrantAction = (principal: AccessiblePrincipal, grant: AccessiblePrincipal["accessGrants"][number]) => {
    const throughGroup = (grant.grantedByPrincipalType === "group" || ["security_group", "m365_group"].includes(grant.accessPath))
      && principal.id !== grant.grantedByPrincipalId;
    if (throughGroup) {
      return {
        kind: "remove_principal_from_group" as const,
        text: "REMOVE",
        label: `Remove ${principal.displayName} from ${grant.grantedBy ?? "group"}`,
        disabled: !grant.grantedByPrincipalId || !groupMemberRemovalReady,
        disabledReason: !grant.grantedByPrincipalId
          ? "The granting group was not resolved during ingestion."
          : !groupMemberRemovalReady
            ? "Upgrade the remediation connector with GroupMember.ReadWrite.All to remove members from groups."
            : undefined,
        command: {
          provider: "microsoft_graph" as const,
          operation: "remove_principal_from_group" as const,
          method: "DELETE" as const,
          endpointTemplate: "/groups/{group-id}/members/{member-id}/$ref",
          accessPath: grant.accessPath,
          targetPrincipalId: principal.id,
          targetPrincipalName: principal.displayName,
          targetPrincipalType: principal.principalType,
          sourcePrincipalId: grant.grantedByPrincipalId ?? undefined,
          sourcePrincipalName: grant.grantedBy ?? undefined,
        },
      };
    }
    if (grant.inherited || grant.accessPath === "inherited") return null;
    if (grant.accessPath === "sharing_link") {
      return {
        kind: "delete_sharing_link" as const,
        text: "DELETE LINK",
        label: `Delete sharing link for ${pinnedNode?.name ?? "resource"}`,
        disabled: false,
        disabledReason: undefined,
        command: {
          provider: "microsoft_graph" as const,
          operation: "delete_sharing_link" as const,
          method: "DELETE" as const,
          endpointTemplate: "/drives/{drive-id}/items/{item-id}/permissions/{link-permission-id}",
          accessPath: grant.accessPath,
          targetPrincipalId: principal.id,
          targetPrincipalName: principal.displayName,
          targetPrincipalType: principal.principalType,
        },
      };
    }
    return {
      kind: "remove_principal_permission" as const,
      text: "REVOKE",
      label: `Revoke ${principal.displayName}`,
      disabled: false,
      disabledReason: undefined,
      command: {
        provider: "microsoft_graph" as const,
        operation: "remove_principal_permission" as const,
        method: "DELETE" as const,
        endpointTemplate: "/drives/{drive-id}/items/{item-id}/permissions/{permission-id}",
        accessPath: grant.accessPath,
        targetPrincipalId: principal.id,
        targetPrincipalName: principal.displayName,
        targetPrincipalType: principal.principalType,
      },
    };
  };
  const pinnedPath = useMemo(() => {
    const path: DocumentNode[] = [];
    let current = pinnedNode ?? undefined;
    while (current) {
      path.unshift(current);
      current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
    return path;
  }, [nodesById, pinnedNode]);
  const pinNode = (node: DocumentNode) => {
    setPinnedNode(node);
    setInheritanceBroken(false);
  };
  const handleMapNodeClick = (node: DocumentNode) => {
    const hasChildren = payload.nodes.some((candidate) => candidate.parentId === node.id);
    if (node.nodeType === "site" && hasChildren && node.id !== mapDrillNodeId) {
      setMapDrillNodeId(node.id);
      setFocusedNodeId(node.id);
      setHoveredNode(null);
      setPinnedNode(null);
      return;
    }
    pinNode(node);
    if (hasChildren && node.id !== mapDrillNodeId) {
      setMapDrillNodeId(node.id);
      setFocusedNodeId(node.id);
      setHoveredNode(null);
    }
  };
  const navigateMapTo = (nodeId: string | null) => {
    setMapDrillNodeId(nodeId);
    setFocusedNodeId(nodeId);
    setHoveredNode(null);
    setPinnedNode(null);
  };
  const closeInspector = () => setPinnedNode(null);
  const printNode = async () => {
    if (!pinnedNode || !nodeSnapshotRef.current || snapshotExporting) return;
    setSnapshotExporting("node");
    setSnapshotMessage(null);
    try {
      await document.fonts.ready;
      await downloadElementAsJpeg(nodeSnapshotRef.current, `Spaghetti - ${pinnedNode.name} - path snapshot`, { snapshotSheet: true, backgroundColor: "#ffffff" });
      setSnapshotMessage("Node JPG downloaded.");
    } catch {
      setSnapshotMessage("Unable to create the node JPG snapshot.");
    } finally {
      setSnapshotExporting(null);
    }
  };
  const printGlobalTree = async () => {
    const snapshotTarget = view === "tree" ? globalTreeSnapshotRef.current : visualSnapshotRef.current;
    if (!snapshotTarget || snapshotExporting) return;
    setSnapshotExporting("global");
    setSnapshotMessage(null);
    const camera = view === "graph" ? sigmaRef.current?.getCamera() : null;
    const previousCameraState = camera?.getState();
    try {
      await document.fonts.ready;
      if (camera) {
        await camera.animatedReset({ duration: 0 });
        await nextFrame();
        await nextFrame();
      }
      await downloadElementAsJpeg(snapshotTarget, `Spaghetti - ${view === "tree" ? "Tree" : "Map"} snapshot`, view === "tree" ? { snapshotSheet: true, backgroundColor: "#ffffff" } : {});
      setSnapshotMessage(`${view === "tree" ? "Tree" : "Map"} JPG downloaded.`);
    } catch {
      setSnapshotMessage(`Unable to create the ${view === "tree" ? "Tree" : "Map"} JPG snapshot.`);
    } finally {
      if (camera && previousCameraState) camera.setState(previousCameraState);
      setSnapshotExporting(null);
    }
  };
  const openSideDrawer = (drawer: "ai" | "actions") => {
    setFiltersOpen(false);
    setPinnedNode(null);
    setHoveredNode(null);
    setSideDrawer((current) => current === drawer ? null : drawer);
  };
  const toggleFilters = () => {
    setSideDrawer(null);
    setFiltersOpen((open) => sideDrawer ? true : !open);
  };
  const chooseLaunchMode = (mode: "sample" | "tenant") => {
    localStorage.setItem(launchModeStorageKey, mode);
    setLaunchMode(mode);
    if (mode === "tenant") window.location.assign("/admin");
  };

  if (window.location.pathname === "/logs") return <LogsPage />;
  if (window.location.pathname === "/admin") return <AdminPage />;

  return (
    <main>
      {!launchMode && (
        <div className="first-launch-backdrop">
          <section className="first-launch-dialog" role="dialog" aria-modal="true" aria-labelledby="first-launch-title">
            <img src="/spaghetti_logo.png" alt="" />
            <span>Welcome to Spaghetti Explorer</span>
            <h2 id="first-launch-title">Do you want to load a real tenant or demo with sample data?</h2>
            <p>Sample Data opens a large generated SharePoint environment immediately. Connect a Tenant takes you to Microsoft 365 setup.</p>
            <div>
              <button onClick={() => chooseLaunchMode("sample")}>Sample Data</button>
              <button onClick={() => chooseLaunchMode("tenant")}>Connect a Tenant</button>
            </div>
          </section>
        </div>
      )}
      <header>
        <div className="brand-lockup">
          <img src="/spaghetti_logo.png" alt="Spaghetti" />
          <div>
          <p className="eyebrow">Tenant permission explorer</p>
          <h1>Spaghetti Explorer</h1>
          <p className="subtitle">Trace content hierarchy and effective user access across SharePoint.</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="snapshot-actions">
            <button title="Send snapshot of view via email"><img src="/icons/microsoft-outlook.svg" alt="" /></button>
            <button title="Send snapshot of view via Teams"><img src="/icons/microsoft-teams.svg" alt="" /></button>
            <button title="Download JPG snapshot of view" disabled={snapshotExporting !== null} onClick={printGlobalTree}><img src="/icons/print.svg" alt="" /></button>
            <button className={sideDrawer === "ai" ? "active" : ""} title="Open AI insights" aria-label="Open AI insights" onClick={() => openSideDrawer("ai")}><img src="/icons/ai.svg" alt="" /></button>
            <button className={sideDrawer === "actions" ? "active" : ""} title="Open staged actions" aria-label="Open staged actions" onClick={() => openSideDrawer("actions")}><img src="/icons/actions.svg" alt="" /><span className="control-badge">{actions.length}</span></button>
            <button className={!sideDrawer && filtersOpen ? "active" : ""} title="Toggle filters" aria-label="Toggle filters" onClick={toggleFilters}><img src="/icons/filter.svg" alt="" /></button>
            <a className="text-action-icon" href="/admin" title="Settings" aria-label="Settings">⚙</a>
            <a className="text-action-icon" href="/logs" title="View action logs" aria-label="View action logs">≡</a>
          </div>
          <div className="summary">
          <span>{accessCount}/{payload.nodes.length} resource access</span>
          </div>
        </div>
      </header>

      <section className="visualization-workspace">
        {snapshotMessage && <button className="snapshot-message" onClick={() => setSnapshotMessage(null)}>{snapshotMessage}<span>×</span></button>}
        <div className="global-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Search sites, libraries, folders, files, or full paths"
          />
          {search && <button onClick={() => { setSearch(""); setFocusedNodeId(null); setSearchOpen(false); }}>Clear</button>}
          {searchOpen && search.trim() && (
            <div className="search-results">
              {searchResults.length ? searchResults.map((node) => (
                <button key={node.id} onClick={() => focusNode(node)}>
                  <i style={{ background: colors[node.nodeType] }} />
                  <span><strong>{node.name}</strong><small>{node.path}</small></span>
                  <em>{node.nodeType}</em>
                </button>
              )) : <p>No matching resources</p>}
            </div>
          )}
        </div>
        <div className="visualization-layout">
        <div
          ref={visualSnapshotRef}
          className={`graph-shell ${view === "tree" ? "tree-mode" : ""} ${pinnedNode ? "inspector-open" : ""}`}
          onMouseMove={(event) => hoveredNode && setTooltipPosition({ x: event.clientX, y: event.clientY })}
        >
          {hoveredNode && !pinnedNode && (
            <div
              className={`node-tooltip snapshot-exclude ${hoveredNode.hasAccess ? "has-access" : "no-access"}`}
              style={{
                left: Math.max(12, Math.min(tooltipPosition.x + 18, window.innerWidth - 450)),
                top: Math.max(12, Math.min(tooltipPosition.y - 30, window.innerHeight - 400)),
              }}
            >
              <div className="tooltip-heading">
                <div>
                  <span className="tooltip-kicker">{hoveredNode.nodeType}</span>
                  <strong>{hoveredNode.name}</strong>
                </div>
                <span className={`access-state ${hoveredNode.hasAccess ? "" : "no-access"}`}>{hoveredNode.hasAccess ? "Has access" : "No access"}</span>
              </div>
              <p>{hoveredNode.accessDetails.reason}</p>
              <h3 className="hover-grants-title">Access granted through</h3>
              <div className="hover-grants">
                {hoveredNode.accessDetails.grantMethods.length ? hoveredNode.accessDetails.grantMethods.map((method, index) => (
                  <span key={`${method.type}-${method.grantedBy}-${index}`}><strong>{method.label}</strong><b>→</b><em>{method.grantedBy ?? "Unknown"} · {method.permissionLevel}</em></span>
                )) : <small>No grant records available.</small>}
              </div>
              <div className="resource-hover-summary">
                <span><small>Direct children</small><strong>{(childrenByParent.get(hoveredNode.id) ?? []).length}</strong></span>
                <span><small>Total size</small><strong>{formatBytes(subtreeSizes.get(hoveredNode.id) ?? hoveredNode.sizeBytes)}</strong></span>
              </div>
              <div className="hover-counts">
                <span><strong>{principalCounts(hoveredNode).users}</strong> Users</span>
                <span><strong>{principalCounts(hoveredNode).groups}</strong> Groups</span>
                <span><strong>{principalCounts(hoveredNode).guests}</strong> Guests</span>
              </div>
            </div>
          )}
          {pinnedNode && (
            <aside className="pinned-inspector snapshot-exclude" onClick={(event) => event.stopPropagation()}>
              <button className="inspector-close" onClick={closeInspector} aria-label="Close inspector">×</button>
              <div className="tooltip-heading">
                <div><span className="tooltip-kicker">{pinnedNode.nodeType}</span><strong>{pinnedNode.name}</strong></div>
                <div className="inspector-header-actions snapshot-actions">
                  <button title="Send snapshot of this node via email"><img src="/icons/microsoft-outlook.svg" alt="" /></button>
                  <button title="Send snapshot of this node via Teams"><img src="/icons/microsoft-teams.svg" alt="" /></button>
                  <button title="Download JPG snapshot of this node" disabled={snapshotExporting !== null} onClick={printNode}><img src="/icons/print.svg" alt="" /></button>
                  <span className={`access-state ${pinnedNode.hasAccess ? "" : "no-access"}`}>{pinnedNode.hasAccess ? "Has access" : "No access"}</span>
                </div>
              </div>
              <div className="inspector-target-resource"><small>Action target</small><strong>{pinnedNode.nodeType} · {pinnedNode.name}</strong></div>
              <p>{pinnedNode.accessDetails.reason}</p>
              <div className="resource-path">
                <code>{pinnedNode.path}</code>
                {pinnedNode.path && <a href={pinnedNode.path} target="_blank" rel="noreferrer" title="Open resource in new tab" aria-label="Open resource in new tab"><img src="/icons/globe.svg" alt="" /></a>}
              </div>
              <section className="grant-records">
                <div className="grant-records-heading">
                  <h3>Permission grant records</h3>
                  <button disabled={pinnedNode.nodeType === "site"} onClick={() => setNewGrantOpen((open) => !open)} title={pinnedNode.nodeType === "site" ? "Site-level permission remediation is not supported by the current Graph connector" : "Add a new permission grant"} aria-label="Add a new permission grant">{newGrantOpen ? "−" : "+"}</button>
                </div>
                {pinnedNode.nodeType === "site" && <div className="resource-remediation-notice">Site-level permission remediation is not supported by the current Graph connector. Select a library, folder, or file.</div>}
                {newGrantOpen && (
                  <div className="grant-record new-grant-record">
                    <div className="grant-target-resource"><small>Applies to</small><strong>{pinnedNode.nodeType} · {pinnedNode.name}</strong></div>
                    <label>
                      <small>Access path</small>
                      <select value={newGrantPath} onChange={(event) => setNewGrantPath(event.target.value as GrantMethodType | "sharepoint_group")}>
                        <option value="direct">Direct permission</option>
                        <option disabled={pinnedNode.nodeType === "site" || pinnedNode.nodeType === "library"} value="sharing_link">Sharing link</option>
                        <option value="security_group">Security group</option>
                        <option value="m365_group">M365 group</option>
                        <option value="sharepoint_group">SharePoint group</option>
                      </select>
                    </label>
                    {(pinnedNode.nodeType === "site" || pinnedNode.nodeType === "library") && <div className="resource-remediation-notice sharing-link-disabled">Sharing links can only be created on folders and files. Select a folder or document.</div>}
                    <b aria-hidden="true">→</b>
                    <label>
                      <small>Granted by / target</small>
                      <select value={newGrantTarget?.id ?? ""} onChange={(event) => setNewGrantPrincipalId(event.target.value)}>
                        {newGrantTargetOptions.map((principal) => <option key={principal.id} value={principal.id}>{principal.displayName}</option>)}
                      </select>
                    </label>
                    {newGrantPath !== "sharing_link" && (
                      <label>
                        <small>Permission lvl</small>
                        <select value={newGrantPermissionLevel} onChange={(event) => setNewGrantPermissionLevel(event.target.value as PermissionLevel)}>
                          {permissionLevelOptions.map((option) => <option disabled={!option.executable} key={option.level} value={option.level}>{option.level}{option.note ? ` · ${option.note}` : ""}</option>)}
                        </select>
                      </label>
                    )}
                    {newGrantPath === "sharing_link" && (
                      <div className="sharing-link-options">
                        <label>
                          <small>Link type</small>
                          <select value={newSharingLinkType} onChange={(event) => setNewSharingLinkType(event.target.value as SharingLinkType)}>
                            <option value="view">View link</option>
                            <option value="edit">Edit link</option>
                          </select>
                        </label>
                        <label>
                          <small>Link scope</small>
                          <select value={newSharingLinkScope} onChange={(event) => setNewSharingLinkScope(event.target.value as SharingLinkScope)}>
                            <option value="users">Specific people</option>
                            <option value="organization">People in organization</option>
                            <option value="anonymous">Anyone with the link</option>
                          </select>
                        </label>
                        <small>Specific people links are created as Graph users-scoped links. The selected target is retained in the action log.</small>
                      </div>
                    )}
                    <button disabled={!newGrantTarget || !permissionLevelOptions.find((option) => option.level === (newGrantPath === "sharing_link" ? newSharingLinkType === "edit" ? "Contribute" : "Read" : newGrantPermissionLevel))?.executable || actionIsQueued(`add:${pinnedNode.id}:${newGrantPath}:${newGrantPath === "sharing_link" ? newSharingLinkType === "edit" ? "Contribute" : "Read" : newGrantPermissionLevel}:${newSharingLinkType}:${newSharingLinkScope}:${newGrantTarget.id}`)} onClick={queueNewGrant}>
                      {newGrantTarget && actionIsQueued(`add:${pinnedNode.id}:${newGrantPath}:${newGrantPath === "sharing_link" ? newSharingLinkType === "edit" ? "Contribute" : "Read" : newGrantPermissionLevel}:${newSharingLinkType}:${newSharingLinkScope}:${newGrantTarget.id}`) ? "PENDING" : "SAVE"}
                    </button>
                  </div>
                )}
                {pinnedNode.accessDetails.grantMethods.length ? pinnedNode.accessDetails.grantMethods.map((method, index) => (
                  <div className="grant-record" key={`${method.type}-${method.grantedBy}-${index}`}>
                    <span><small>Access path</small><strong>{method.label}</strong></span>
                    <b aria-hidden="true">→</b>
                    <span><small>Granted by</small><strong>{method.grantedBy ?? "Unknown"}</strong></span>
                    <span><small>Permission lvl</small><strong>{method.permissionLevel}</strong></span>
                    {method.type === "inherited" ? (() => {
                      const kind = inheritanceBroken ? "reset_inheritance" : "break_inheritance";
                      const key = `inheritance:${pinnedNode.id}:${kind}`;
                      const queued = actionIsQueued(key);
                      return <button className="inheritance-button" disabled={queued} onClick={() => enqueueAction({ key, kind, label: inheritanceBroken ? "Delete unique permissions" : "Stop inheriting permissions", nodeId: pinnedNode.id, nodeName: pinnedNode.name, command: inheritanceCommand(inheritanceBroken) })}>{queued ? "PENDING" : inheritanceBroken ? "DELETE UNIQUE PERMISSIONS" : "STOP INHERITING PERMISSIONS"}</button>;
                    })() : (() => {
                      const selectedPrincipalForAction = selected;
                      const selectedThroughGroup = selectedPrincipalForAction
                        ? selectedPrincipalForAction.principalType !== "group"
                          && method.grantedByPrincipalType === "group"
                          && selectedPrincipalForAction.id !== method.grantedByPrincipalId
                        : false;
                      const key = selectedThroughGroup
                        ? `membership:${method.grantedByPrincipalId}:${selectedPrincipalForAction?.id}`
                        : `grant:${pinnedNode.id}:${method.type}:${method.grantedBy}:${index}`;
                      const queued = actionIsQueued(key);
                      if (selectedThroughGroup && selectedPrincipalForAction) {
                        const disabled = !method.grantedByPrincipalId || !groupMemberRemovalReady;
                        const disabledReason = !method.grantedByPrincipalId
                          ? "The granting group was not resolved during ingestion."
                          : !groupMemberRemovalReady
                            ? "Upgrade the remediation connector with GroupMember.ReadWrite.All to remove members from groups."
                            : `Remove ${selectedPrincipalForAction.displayName} from ${method.grantedBy ?? "group"}`;
                        const command: TenantPermissionCommand = {
                          provider: "microsoft_graph",
                          operation: "remove_principal_from_group",
                          method: "DELETE",
                          endpointTemplate: "/groups/{group-id}/members/{member-id}/$ref",
                          accessPath: method.type,
                          targetPrincipalId: selectedPrincipalForAction.id,
                          targetPrincipalName: selectedPrincipalForAction.displayName,
                          targetPrincipalType: selectedPrincipalForAction.principalType,
                          sourcePrincipalId: method.grantedByPrincipalId ?? undefined,
                          sourcePrincipalName: method.grantedBy ?? undefined,
                        };
                        return <button disabled={queued || disabled} title={disabledReason} onClick={() => enqueueAction({ key, kind: command.operation, label: `Remove ${selectedPrincipalForAction.displayName} from ${method.grantedBy ?? "group"}`, nodeId: pinnedNode.id, nodeName: pinnedNode.name, principalId: selectedPrincipalForAction.id, principalName: selectedPrincipalForAction.displayName, grantIndex: index, command })}>{queued ? "PENDING" : "REMOVE"}</button>;
                      }
                      const target = method.type === "security_group" || method.type === "m365_group" ? principals.find((principal) => principal.displayName === method.grantedBy) : selected;
                      const command = revokeGrantCommand(method.type, target, method.grantedBy);
                      return <button disabled={queued} onClick={() => enqueueAction({ key, kind: command.operation, label: `Revoke ${method.label}`, nodeId: pinnedNode.id, nodeName: pinnedNode.name, principalId: command.targetPrincipalId, principalName: command.targetPrincipalName, grantIndex: index, command })}>{queued ? "PENDING" : "REVOKE"}</button>;
                    })()}
                  </div>
                )) : <p>No grant records available for the current selection.</p>}
                {!pinnedNode.accessDetails.grantMethods.some((method) => method.type === "inherited") && (
                  <div className="grant-record inheritance-record">
                    <span><small>Access path</small><strong>{inheritanceBroken ? "Unique permissions" : "Inherited permission"}</strong></span>
                    <b aria-hidden="true">→</b>
                    <span><small>Granted by</small><strong>{inheritanceBroken ? "This resource" : "Parent resource"}</strong></span>
                    <span><small>Permission lvl</small><strong>{pinnedNode.accessDetails.permissions.includes("owner") ? "Full Control" : pinnedNode.accessDetails.permissions.includes("write") ? "Contribute" : "Read"}</strong></span>
                    {(() => {
                      const kind = inheritanceBroken ? "reset_inheritance" : "break_inheritance";
                      const key = `inheritance:${pinnedNode.id}:${kind}`;
                      const queued = actionIsQueued(key);
                      return <button className="inheritance-button" disabled={queued} onClick={() => enqueueAction({ key, kind, label: inheritanceBroken ? "Delete unique permissions" : "Stop inheriting permissions", nodeId: pinnedNode.id, nodeName: pinnedNode.name, command: inheritanceCommand(inheritanceBroken) })}>{queued ? "PENDING" : inheritanceBroken ? "DELETE UNIQUE PERMISSIONS" : "STOP INHERITING PERMISSIONS"}</button>;
                    })()}
                  </div>
                )}
              </section>
              <section className="principal-sections">
                <h3>Principals with access</h3>
                {principalSections.map((section) => (
                  <div className="principal-section" key={section.type}>
                    <h4>{section.label}<span>{section.principals.length}</span></h4>
                    {section.principals.length ? section.principals.map((principal) => (
                      <div className="principal-row" key={principal.id}>
                        <span>{principal.displayName[0]}</span>
                        <div className="principal-identity"><strong>{principal.displayName}</strong><small>{principal.email}</small></div>
                        <div className="principal-access-grants">
                          {principal.accessGrants.map((grant, grantIndex) => {
                            const action = principalGrantAction(principal, grant);
                            const key = `principal:${pinnedNode.id}:${principal.id}:${grant.accessPath}:${grant.grantedByPrincipalId ?? grantIndex}`;
                            const queued = actionIsQueued(key);
                            return (
                              <div className="principal-access-grant" key={`${grant.accessPath}:${grant.grantedByPrincipalId}:${grantIndex}`}>
                                <span><small>Access path</small><strong>{grant.label}{grant.grantedBy ? ` · ${grant.grantedBy}` : ""}</strong></span>
                                <span><small>Permission</small><strong>{grant.permissionLevel}</strong></span>
                                {!selected && action && <button disabled={queued || action.disabled} title={action.disabledReason ?? action.label} onClick={() => enqueueAction({ key, kind: action.kind, label: action.label, nodeId: pinnedNode.id, nodeName: pinnedNode.name, principalId: principal.id, principalName: principal.displayName, command: action.command })}>{queued ? "PENDING" : action.text}</button>}
                                {!action && <em>INHERITED</em>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )) : <small>None</small>}
                  </div>
                ))}
              </section>
            </aside>
          )}
          {hoveredEdge && !hoveredNode && <div className="edge-tooltip snapshot-exclude"><strong>{hoveredEdge.relationship}</strong><span>{hoveredEdge.details}</span></div>}
          {loading && <div className="loading snapshot-exclude">Loading graph...</div>}
          {view === "graph" && (
            <nav className="map-drill-navigation snapshot-exclude" aria-label="Map drill-down path">
              <div>
                {mapDrillNode && <button className="map-drill-back" onClick={() => navigateMapTo(mapDrillNode.parentId)}>←</button>}
                <span>Map location</span>
                <strong>{mapDrillNode?.name ?? "All sites"}</strong>
                <small>{mapDrillNode ? resourceSummary(mapDrillNode) : `${(childrenByParent.get(null) ?? []).length} sites`} · click a resource to drill in</small>
              </div>
              <div className="map-drill-breadcrumbs">
                <button className={!mapDrillNode ? "active" : ""} onClick={() => navigateMapTo(null)}>All sites</button>
                {mapDrillPath.map((node) => <button className={node.id === mapDrillNodeId ? "active" : ""} key={node.id} onClick={() => navigateMapTo(node.id)}>{node.name}</button>)}
              </div>
            </nav>
          )}
          {view === "graph" ? (
            <SigmaContainer settings={{
              enableEdgeEvents: true,
              renderEdgeLabels: false,
              labelColor: { color: theme === "light" ? "#101828" : "#f8fafc" },
              labelDensity: 2,
              labelGridCellSize: 115,
              labelRenderedSizeThreshold: 0,
              labelSize: 12,
              labelWeight: "600",
              minEdgeThickness: 2,
              stagePadding: 70,
              zIndex: true,
              nodeProgramClasses: { icon: MapNodeProgram },
            }}>
              <GraphLoader payload={graphPayload} onEdgeHover={setHoveredEdge} onNodeHover={handleNodeHover} onNodeClick={handleMapNodeClick} focusedNodeId={focusedNodeId} focusedPathIds={focusedPathIds} matchingNodeIds={matchingNodeIds} activeNodeId={pinnedNode?.id ?? null} focusedDepth={mapDrillNode ? mapDrillNode.depth + 1 : 0} theme={theme} onSigmaReady={(sigma) => { sigmaRef.current = sigma; }} />
            </SigmaContainer>
          ) : (
            <AccessTree nodes={treeNodes} expanded={expanded} onExpand={setExpanded} onNodeHover={handleNodeHover} onNodeClick={pinNode} principal={selected} focusedNodeId={focusedNodeId} focusedPathIds={focusedPathIds} matchingNodeIds={matchingNodeIds} activeNodeId={pinnedNode?.id ?? null} principalCollapsed={principalCollapsed} onTogglePrincipal={() => setPrincipalCollapsed((collapsed) => !collapsed)} onSelectRelatedPrincipal={selectRelatedPrincipal} />
          )}
        </div>
        {!sideDrawer && filtersOpen && <aside className="filter-panel open">
            <div className="filter-panel-content">
              <section className="panel-section legend-section">
                <button className="panel-section-heading" onClick={() => setLegendOpen((open) => !open)}>
                  <span>Legend</span>
                  <span>{legendOpen ? "−" : "+"}</span>
                </button>
                {legendOpen && <div className="legend">
                  {Object.entries(colors).map(([type, color]) => <span key={type}><i style={{ background: color }} />{type}</span>)}
                  <span><i className="no-access" />no access</span>
                </div>}
              </section>
              <section className="panel-section view-controls-section">
                <button className="panel-section-heading" onClick={() => setViewControlsOpen((open) => !open)} aria-expanded={viewControlsOpen}>
                  <span>View controls</span>
                  <span>{viewControlsOpen ? "−" : "+"}</span>
                </button>
                {viewControlsOpen && <div className="panel-section-body">
                  <div className="view-toggle" role="group" aria-label="Visualization">
                    <button className={view === "tree" ? "active" : ""} onClick={() => setView("tree")}>Tree</button>
                    <button className={view === "graph" ? "active" : ""} onClick={() => setView("graph")}>Map</button>
                  </div>
                </div>}
              </section>
              <section className="panel-section access-controls-section">
                <button className="panel-section-heading" onClick={() => setAccessControlsOpen((open) => !open)} aria-expanded={accessControlsOpen}>
                  <span>View access for</span>
                  <span>{accessControlsOpen ? "−" : "+"}</span>
                </button>
                {accessControlsOpen && <div className="panel-section-body">
                  <div className="principal-control">
                    <div className="principal-combobox">
                      <input
                        id="principal-search"
                        aria-label="View access for"
                        value={principalSearch}
                        placeholder={selected?.displayName ?? "Everyone / no filter"}
                        onFocus={() => setPrincipalSearchOpen(true)}
                        onChange={(event) => { setPrincipalSearch(event.target.value); setPrincipalSearchOpen(true); }}
                      />
                      {principalSearchOpen && <div className="principal-results">
                        <button onClick={() => selectPrincipal("")}>Everyone / no filter</button>
                        {principalResults.map((principal) => <button key={principal.id} onClick={() => selectPrincipal(principal.id)}><strong>{principal.displayName}</strong><small>{principal.principalType} · {principal.email}</small></button>)}
                      </div>}
                    </div>
                  </div>
                  {view === "graph" && (
                    <label className={`access-only-control ${!principalId ? "disabled" : ""}`}>
                      <input
                        type="checkbox"
                        checked={accessibleOnly}
                        disabled={!principalId}
                        onChange={(event) => setAccessibleOnly(event.target.checked)}
                      />
                      <span>
                        <strong>Accessible content only</strong>
                        <small>{principalId ? "Hide resources without effective access" : "Select a user to enable"}</small>
                      </span>
                    </label>
                  )}
                  <div className={`grant-filters ${!principalId ? "disabled" : ""}`}>
                    <div className="filter-section-heading">
                      <span>Permission grants</span>
                      {grantFiltersActive && <button onClick={() => { setGrantTypes([]); setGrantCount("any"); }}>Clear</button>}
                    </div>
                    <div className="grant-type-options">
                      {grantMethodOptions.map((option) => (
                        <label key={option.type}>
                          <input type="checkbox" disabled={!principalId} checked={grantTypes.includes(option.type)} onChange={() => toggleGrantType(option.type)} />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                    <label className="grant-count-control">
                      <span>Independent methods</span>
                      <select disabled={!principalId} value={grantCount} onChange={(event) => setGrantCount(event.target.value as typeof grantCount)}>
                        <option value="any">Any number</option>
                        <option value="one">Uniquely one method</option>
                        <option value="multiple">2+ methods</option>
                      </select>
                    </label>
                    {grantFiltersActive && <small className="grant-match-count">{matchingNodeIds.size} matching resources</small>}
                  </div>
                  {selected && <div className="selected-user"><strong>{selected.displayName}</strong><span>{selected.email}</span></div>}
                </div>}
              </section>
            </div>
        </aside>}
        {sideDrawer && (
          <aside className={`workspace-drawer ${sideDrawer}-drawer`}>
            <div className="workspace-drawer-heading">
              <div>
                <span>{sideDrawer === "ai" ? "Intelligence" : "Execution queue"}</span>
                <h2>{sideDrawer === "ai" ? "AI Insights" : "Actions"}</h2>
                <p>{sideDrawer === "ai" ? "Permission anomalies and unusual access patterns for the current view." : "Review and execute staged Microsoft tenant permission changes."}</p>
              </div>
              <button onClick={() => setSideDrawer(null)} aria-label={`Close ${sideDrawer} drawer`}>×</button>
            </div>
            {sideDrawer === "ai" ? (
              <InsightPanel insights={riskInsights} nodes={payload.nodes} principals={principals} onOpen={openInsightNode} onOpenNode={openQuestionNode} />
            ) : (
              <div className="drawer-actions-content">
                <div className="drawer-action-summary"><strong>{actions.length}/15</strong><span>actions loaded</span></div>
                <div className="action-list">
                  {actions.length ? actions.map((action, index) => (
                    <article className={`action-item ${action.status}`} key={action.id}>
                      <div><span>{index + 1}</span><strong>{action.label}</strong><em>{action.status}</em></div>
                      <small>{action.nodeName}{action.principalName ? ` · ${action.principalName}` : ""}</small>
                      {action.command.permissionLevel && <small>Permission level · {action.command.permissionLevel}</small>}
                      {action.command.sharingLinkType && <small>Sharing link · {action.command.sharingLinkType} · {action.command.sharingLinkScope}</small>}
                      <code>{action.command.provider.replaceAll("_", " ")} · {action.command.method} · {action.command.endpointTemplate}</code>
                      {action.message && <p>{action.message}</p>}
                    </article>
                  )) : <div className="empty-actions">No staged actions</div>}
                </div>
                <div className="action-tray-controls">
                  <button disabled={actionsRunning || !actions.some((action) => action.status === "pending")} onClick={runActions}>
                    {actionsRunning ? "Running actions..." : `Run actions (${actions.filter((action) => action.status === "pending").length})`}
                  </button>
                  <button disabled={!actions.some((action) => action.status === "succeeded" || action.status === "failed")} onClick={() => setActions((current) => current.filter((action) => action.status === "pending" || action.status === "running"))}>Clear finished</button>
                </div>
                <a className="show-logs-link" href="/logs">Show logs</a>
              </div>
            )}
          </aside>
        )}
        </div>
      </section>
      {pinnedNode && (
        <section className="node-print-sheet snapshot-sheet" ref={nodeSnapshotRef}>
          <div className="node-print-summary">
            <span>{pinnedNode.nodeType}</span>
            <h1>{pinnedNode.name}</h1>
            <p>{pinnedNode.accessDetails.reason}</p>
            <code>{pinnedNode.path || pinnedPath.map((node) => node.name).join(" > ")}</code>
            <div className="print-details-grid">
              <div><span>Access status</span><strong className={pinnedNode.hasAccess ? "" : "print-no-access"}>{pinnedNode.hasAccess ? "Has access" : "No access"}</strong></div>
              <div><span>Permissions</span><strong>{pinnedNode.accessDetails.permissions.join(", ") || "None"}</strong></div>
              <div><span>Grant methods</span><strong>{pinnedNode.accessDetails.grantMethods.map((method) => method.label).join(", ") || "None"}</strong></div>
              <div><span>Principals with access</span><strong>{pinnedNode.accessDetails.accessiblePrincipals.length}</strong></div>
            </div>
          </div>
          <div className="node-snapshot-details">
            <section>
              <h2>Permission grant records</h2>
              <div className="snapshot-grant-list">
                {pinnedNode.accessDetails.grantMethods.length ? pinnedNode.accessDetails.grantMethods.map((method, index) => (
                  <div key={`${method.type}-${method.grantedBy}-${index}`}>
                    <span><small>Access path</small><strong>{method.label}</strong></span>
                    <b aria-hidden="true">→</b>
                    <span><small>Granted by</small><strong>{method.grantedBy ?? "Unknown"}</strong></span>
                  </div>
                )) : <p>No grant records available.</p>}
              </div>
            </section>
            <section>
              <h2>Principals with access</h2>
              <div className="snapshot-principal-grid">
                {principalSections.map((section) => (
                  <div key={section.type}>
                    <h3>{section.label}<span>{section.principals.length}</span></h3>
                    {section.principals.length ? section.principals.map((principal) => (
                      <p key={principal.id}><strong>{principal.displayName}</strong><small>{principal.email || principal.principalType}</small></p>
                    )) : <p><small>None</small></p>}
                  </div>
                ))}
              </div>
            </section>
          </div>
          <h2>Path to root</h2>
          <code className="snapshot-breadcrumb">{pinnedPath.map((node) => node.name).join(" > ")}</code>
          <PathSnapshotTree nodes={pinnedPath} />
        </section>
      )}
      <section className="global-print-sheet snapshot-sheet" ref={globalTreeSnapshotRef}>
        <div className="node-print-summary">
          <span>Spaghetti Explorer</span>
          <h1>Complete visible tree</h1>
          <p>Includes every currently displayed branch and excludes collapsed child layers.</p>
        </div>
        <PrintableTree nodes={treeNodes} expanded={new Set(expanded)} />
      </section>
    </main>
  );
}
