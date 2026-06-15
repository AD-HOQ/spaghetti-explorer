# Security Notice

This project is a public contest submission and runs with synthetic demo data by default.

Do not commit API keys, client secrets, tokens, refresh tokens, passwords, tenant data, customer data, exported permission scans, audit logs, database dumps, screenshots of real tenants, or personally identifiable information.

Real Microsoft Graph, SharePoint, Purview, or Fabric integrations must be configured through local environment variables only. Use `.env.example` as a template and keep `.env` files out of source control.

Before submitting changes, run a local secret scan with a tool such as Gitleaks or TruffleHog.
