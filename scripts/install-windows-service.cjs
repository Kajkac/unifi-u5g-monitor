const path = require("node:path");
const { Service } = require("node-windows");

const root = path.resolve(__dirname, "..");
const svc = new Service({
  name: "UniFi U5G Monitor",
  description: "Local dashboard, SMS inbox/outbox and automation service for UniFi U5G modems.",
  script: path.join(root, "scripts", "service-runner.cjs"),
  workingDirectory: root,
  nodeOptions: ["--enable-source-maps"],
});

svc.on("install", () => {
  svc.start();
  console.log("Installed and started UniFi U5G Monitor.");
});

svc.on("alreadyinstalled", () => {
  console.log("UniFi U5G Monitor is already installed.");
});

svc.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

svc.install();
