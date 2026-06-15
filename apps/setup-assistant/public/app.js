const fields = ["tenantId", "displayName", "profile", "redirectUri", "spaghettiApiUrl", "handoffToken"];
const values = () => Object.fromEntries(fields.map((id) => [id, document.getElementById(id).value]));
const connection = document.getElementById("microsoftConnection");
const connectMicrosoft = document.getElementById("connectMicrosoft");
const disconnectMicrosoft = document.getElementById("disconnectMicrosoft");
const previewButton = document.getElementById("previewButton");
const showStep = (step) => {
  document.querySelectorAll(".step").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === String(step)));
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", button.dataset.step === String(step)));
};
document.querySelectorAll("[data-back]").forEach((button) => button.addEventListener("click", () => showStep(button.dataset.back)));

async function refreshAuthStatus() {
  const response = await fetch("/api/auth/status");
  const status = await response.json();
  if (status.connected) {
    connection.className = "connection-card connected";
    connection.querySelector("strong").textContent = status.tenantName;
    connection.querySelector("p").textContent = `${status.administrator} · Connected until ${new Date(status.expiresAt).toLocaleTimeString()}`;
    document.getElementById("tenantId").value = status.tenantId;
    connectMicrosoft.hidden = true;
    disconnectMicrosoft.hidden = false;
    previewButton.disabled = false;
  } else {
    connection.className = `connection-card${status.configured ? "" : " error"}`;
    connection.querySelector("strong").textContent = status.configured ? "No Microsoft tenant connected" : "Setup Assistant OAuth is not configured";
    connection.querySelector("p").textContent = status.configured ? "Sign in with a tenant administrator to continue." : "Set SETUP_ASSISTANT_CLIENT_ID and SETUP_ASSISTANT_CLIENT_SECRET, then restart the assistant.";
    document.getElementById("tenantId").value = "";
    connectMicrosoft.hidden = false;
    connectMicrosoft.classList.toggle("disabled", !status.configured);
    connectMicrosoft.setAttribute("aria-disabled", String(!status.configured));
    disconnectMicrosoft.hidden = true;
    previewButton.disabled = true;
  }
}

connectMicrosoft.addEventListener("click", (event) => {
  if (connectMicrosoft.getAttribute("aria-disabled") === "true") event.preventDefault();
});

disconnectMicrosoft.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  await refreshAuthStatus();
});

previewButton.addEventListener("click", async () => {
  const form = values();
  const response = await fetch("/api/setup/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
  const result = await response.json();
  if (!response.ok) return alert(result.error);
  document.getElementById("plan").innerHTML = `<div class="plan-card"><h3>${result.plan.displayName} · ${result.plan.profile}</h3><ul>${result.plan.permissions.map((item) => `<li>${item}</li>`).join("")}</ul><ul>${result.plan.steps.map((item) => `<li>${item}</li>`).join("")}</ul></div>`;
  showStep(2);
});

document.getElementById("provisionButton").addEventListener("click", async () => {
  showStep(3);
  const status = document.getElementById("provisioningStatus");
  status.className = "status";
  status.innerHTML = "<strong>Provisioning...</strong><p>Creating the application registration, enterprise application, credential, and secure handoff.</p>";
  try {
    const response = await fetch("/api/setup/provision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values()) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    status.className = "status success";
    status.innerHTML = "<strong>Provisioning complete</strong><p>The generated credential was transferred directly into Spaghetti. Continue to Microsoft administrator consent.</p>";
    document.getElementById("result").innerHTML = `<div class="result-card"><h3>${result.application.displayName}</h3><ul><li>Client ID: <code>${result.application.clientId}</code></li><li>Service principal: <code>${result.servicePrincipal.objectId}</code></li><li>Credential expires: ${result.credential.expiresAt}</li><li>Credential transferred: ${result.credential.transferredToSpaghetti}</li></ul></div>`;
    document.getElementById("consentLink").href = result.consentUrl;
    setTimeout(() => showStep(4), 650);
  } catch (error) {
    status.className = "status error";
    status.innerHTML = `<strong>Provisioning failed</strong><p>${error.message}</p>`;
  }
});

refreshAuthStatus();
