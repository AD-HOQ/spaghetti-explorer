# Spaghetti Explorer

A public-safe demo application for exploring synthetic SharePoint-style document hierarchies and effective access in Sigma.js.

## Public Submission Safety

This project is safe for public review. It uses synthetic demo data by default and does not include real tenant data, customer data, credentials, secrets, or production exports.

The public hackathon version does not include real customer or Microsoft 365 tenant data. All included users, groups, sites, libraries, folders, files, permissions, audit events, and risk insights are synthetic.

To connect a real Microsoft 365 tenant, create a local `.env` file based on `.env.example`. Real Microsoft Graph, SharePoint, Purview, and Fabric integrations require local environment variables. Do not commit `.env` or any other `.env.*` file containing credentials.

## Application modes

`APP_MODE=demo` is the default. Demo mode uses synthetic Contoso Demo Tenant data and mock Microsoft Graph, SharePoint scanner, Fabric IQ, Purview audit, Power Platform, and permission-action behavior. It does not require credentials, PostgreSQL, or network access to Microsoft services.

Live integrations are available only when `APP_MODE=production` is explicitly configured. Production mode requires its environment variables and does not silently fall back to demo data.

Mock service boundaries are implemented in `apps/api/src/services/graphClient.mock.ts`, `sharePointScanner.mock.ts`, `fabricIq.mock.ts`, and `purviewAudit.mock.ts`. Real Microsoft and Dataverse HTTP clients reject calls while demo mode is active.

## Permission Anomaly Insights

The app includes a deterministic local anomaly engine that generates clickable permission-risk cards from normalized permission graph data. It works in demo and production modes without Fabric IQ. Optional Fabric IQ enrichment is controlled by `FABRIC_IQ_ENABLED` and fails back to local insights when configuration is missing or enrichment fails.

See [docs/fabric-iq-integration.md](docs/fabric-iq-integration.md) for the Fabric workspace, lakehouse, ontology, data binding, and future adapter setup.

## Run locally

```powershell
Copy-Item .env.example .env
docker compose up -d
npm install
npm run dev
```

Open `http://localhost:5173`. The public configuration serves the large synthetic demo graph by default.

## Local security scans

Run the built-in publishable working-tree pattern review before publishing:

```powershell
npm run security:grep
```

This command reports potentially sensitive terms for manual review. Matches may include safe placeholders, documentation, and environment-variable names.

For a deeper scan, install either Gitleaks or TruffleHog locally and run:

```powershell
gitleaks detect --source . --verbose
trufflehog filesystem .
```

These external tools are intentionally not project dependencies. The GitHub Actions workflow at `.github/workflows/secret-scan.yml` runs Gitleaks automatically for pushes and pull requests.

## Customer-owned Microsoft connector onboarding

The primary Tenant Admin flow at `http://localhost:4000/admin` provisions a customer-owned discovery and remediation connector application inside the authorized Microsoft 365 tenant:

1. The administrator selects **Connect Microsoft 365 Tenant** and authorizes the multi-tenant bootstrap app.
2. Spaghetti validates the Microsoft-signed identity, tenant claim, OAuth state, and nonce.
3. The backend creates `{ProductName} Connector - Remediation` and its service principal in the customer tenant.
4. Microsoft Graph application-role IDs are resolved dynamically from the tenant's Graph service principal.
5. The backend grants the configured discovery and remediation application permissions, creates an encrypted development credential, and verifies app-only Graph access.
6. Disconnect disables the service principal and removes Spaghetti's stored credential by default. Deletion is only enabled when `MICROSOFT_ALLOW_DESTRUCTIVE_DISCONNECT=true`.

Register one multi-tenant bootstrap application in the Spaghetti vendor tenant with web redirect URI `http://localhost:4000/api/microsoft/connect/callback`. Configure these delegated permissions and grant vendor-tenant admin consent:

- `Application.ReadWrite.All`
- `AppRoleAssignment.ReadWrite.All`
- `Directory.Read.All`

Configure the variables documented in `.env.example`. The default remediation profile requests `Directory.Read.All`, `Group.Read.All`, `User.Read.All`, `Sites.ReadWrite.All`, and `Files.ReadWrite.All`. Existing read-only connectors must be disconnected and reprovisioned before remediation actions can execute. Production should replace the encrypted database secret with certificate authentication backed by Azure Key Vault and implement credential rotation.

The onboarding API routes are:

- `GET /api/microsoft/connect/start`
- `GET /api/microsoft/connect/callback`
- `POST /api/microsoft/connect/provision`
- `GET /api/microsoft/connect/status`
- `GET /api/microsoft/connect/sites`
- `POST /api/microsoft/connect/scan`
- `POST /api/microsoft/connect/disconnect`

After the connector is provisioned, the Tenant Admin page can discover SharePoint sites and scan selected sites without asking the administrator to paste a Graph access token. The backend decrypts the stored connector credential locally, obtains an app-only Graph token, recursively imports selected sites, and stores the resulting hierarchy and permissions in PostgreSQL. A successful scan sets that tenant as the active Explorer tenant.

## Permission remediation

Running the Actions tray in production now executes supported Microsoft Graph permission commands using the connected remediation connector. Direct user/group grants use the drive-item invite API, and non-inherited direct or group permission revokes delete the matching drive-item permission. Every attempt is permanently logged, Microsoft failures are returned to the action tray, and successful actions trigger a refresh of the affected site.

Microsoft Graph cannot safely remove only one user from a sharing link, and the current connector does not yet authorize SharePoint REST inheritance operations. Sharing-link user removal, stop-inheriting, delete-unique-permissions, and SharePoint-local-group actions therefore return an explicit failure instead of reporting a simulated success.

## Permanent permission action logs

Every permission action creates an append-only permanent event when it is loaded into the action tray, begins execution, succeeds, or fails. The Logs page reads this server-side history from `GET /api/actions/logs`; it no longer relies on browser storage.

PostgreSQL stores records in `permission_action_logs`. When PostgreSQL is unavailable in local demo mode, the API persists the same records to `ACTION_LOG_FILE` (default `.data/permission-action-logs.json`) so they survive API restarts.

## Power Automate approval integration

Settings > Integrations provides a downloadable Spaghetti Approval Flows solution package and validates whether its `spaghetti_approvals` solution exists in a selected Power Platform environment.

The package includes manager-approval and approval-outcome flow templates for Teams, Approvals, Microsoft 365 Users, and Spaghetti callback integration. Microsoft connection credentials are deliberately not embedded; administrators bind connection references after importing the unmanaged solution.

Configure live validation environments through `POWER_PLATFORM_ENVIRONMENTS_JSON` and provide a Dataverse-scoped token through `POWER_PLATFORM_ACCESS_TOKEN`. Without these values, the UI clearly exposes demo environments for local development.

## Ingest a SharePoint site

The recommended flow is **Admin > Tenant > Discover SharePoint sites > Load selected sites**. The connected customer-owned connector supplies the Graph token automatically.

The lower-level ingestion endpoint remains available for development or troubleshooting. Acquire a delegated or application Microsoft Graph access token with the required tenant consent, then:

```powershell
$body = @{
  tenantId = "00000000-0000-0000-0000-000000000000"
  siteId = "contoso-demo.sharepoint.invalid,synthetic-site-collection,synthetic-site"
  accessToken = "<graph-access-token>"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/ingest/sharepoint `
  -ContentType application/json -Body $body
```

Typical application permissions are `Sites.Read.All`, `Files.Read.All`, `GroupMember.Read.All`, and `User.Read.All`. Prefer `Sites.Selected` for production and grant the application only the sites it must scan.

## Current scope

- Recursively imports a site, its document libraries, folders, files, and item permissions.
- Stores raw nodes, principals, permissions, closure paths, and effective-access cache rows.
- Displays hierarchy edges and relationship detail on hover.
- Filters the graph by selected user, greying inaccessible nodes and preventing navigation from them.
- Runs in demo mode before PostgreSQL or Graph credentials are configured.

The next production hardening step is moving larger scans into a durable background job queue with progress reporting, cancellation, retry policies, incremental/delta synchronization, and certificate credentials backed by Azure Key Vault.
