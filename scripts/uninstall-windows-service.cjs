const path = require("node:path");
const { Service } = require("node-windows");

const root = path.resolve(__dirname, "..");
const svc = new Service({
  name: "UniFi U5G Monitor",
  script: path.join(root, "scripts", "service-runner.cjs"),
  workingDirectory: root,
});

svc.on("uninstall", () => {
  console.log("Uninstalled UniFi U5G Monitor.");
});

svc.on("alreadyuninstalled", () => {
  console.log("UniFi U5G Monitor is already uninstalled.");
});

svc.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

svc.uninstall();
