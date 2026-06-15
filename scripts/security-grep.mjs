import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  "client_secret",
  "password",
  "refresh_token",
  "access_token",
  "private_key",
  "sharepoint.com",
  "onmicrosoft.com",
].join("|");

const filesResult = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
  shell: false,
});

if (filesResult.status !== 0) {
  if (filesResult.stderr) process.stderr.write(filesResult.stderr);
  process.exit(filesResult.status ?? 1);
}

const expression = new RegExp(patterns, "i");
const matches = [];
const files = filesResult.stdout.split(/\r?\n/).filter((file) => file && file !== "scripts/security-grep.mjs");

for (const file of files) {
  const content = readFileSync(file);
  if (content.includes(0)) continue;
  content.toString("utf8").split(/\r?\n/).forEach((line, index) => {
    if (expression.test(line)) matches.push(`${file}:${index + 1}:${line}`);
  });
}

if (matches.length) {
  console.log(matches.join("\n"));
  console.log("\nReview the matches above and confirm they contain only placeholders, documentation, or safe source identifiers.");
} else {
  console.log("No publishable working-tree matches found.");
}
