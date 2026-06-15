import assert from "node:assert/strict";
import test from "node:test";
import { demoGraph, demoPrincipals } from "./demo.js";

test("large sample graph preserves familiar paths and provides roughly 10x demo scale", () => {
  const graph = demoGraph();
  const ids = new Set(graph.nodes.map((node) => node.id));
  const sites = graph.nodes.filter((node) => node.nodeType === "site");
  const guests = demoPrincipals.filter((principal) => principal.principalType === "guest");
  const deepestNode = Math.max(...graph.nodes.map((node) => node.depth));

  assert.ok(graph.nodes.length >= 700);
  assert.ok(sites.length >= 10);
  assert.equal(guests.length, 4);
  assert.ok(deepestNode >= 8);
  assert.equal(ids.size, graph.nodes.length);
  assert.ok(graph.nodes.some((node) => node.name === "First Week Schedule.xlsx"));
  assert.ok(graph.nodes.some((node) => node.name === "Forecast Q1.xlsx"));
  assert.ok(graph.nodes.filter((node) => node.nodeType === "document").every((node) => node.sizeBytes > 0));
  assert.ok(graph.nodes.filter((node) => node.nodeType !== "document").every((node) => node.sizeBytes === 0));
  assert.ok(graph.nodes.some((node) => node.id === "file-compensation-2021"));
  assert.ok(graph.nodes.some((node) => node.id === "folder-legal-ma"));
  assert.ok(graph.nodes.some((node) => node.id === "site-legacy-projects"));
  assert.equal(graph.edges.length, graph.nodes.length - sites.length);
});

test("sample guests have distinct limited-access profiles", () => {
  const guestAccessCounts = demoPrincipals
    .filter((principal) => principal.principalType === "guest")
    .map((principal) => demoGraph(principal.id).nodes.filter((node) => node.hasAccess).length);

  assert.ok(guestAccessCounts.every((count) => count > 0));
  assert.ok(new Set(guestAccessCounts).size >= 3);
});

test("sample identities and resource paths are explicitly synthetic", () => {
  const graph = demoGraph();
  const emails = demoPrincipals.map((principal) => principal.email).filter((email): email is string => Boolean(email));

  assert.ok(emails.every((email) => email.endsWith("@contoso-demo.com")));
  assert.ok(demoPrincipals.every((principal) => principal.displayName.includes("Demo") || principal.displayName === "Everyone Except External Users"));
  assert.ok(graph.nodes.every((node) => node.path.startsWith("/sites/") && !node.path.includes("://")));
});
