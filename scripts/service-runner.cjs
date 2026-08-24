const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.cjs");
const serverEntry = path.join(root, "server", "index.ts");

const child = spawn(process.execPath, [tsxCli, serverEntry], {
  cwd: root,
  windowsHide: true,
  stdio: ["ignore", "inherit", "inherit"],
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
