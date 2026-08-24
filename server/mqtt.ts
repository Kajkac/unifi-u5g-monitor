import mqtt, { type MqttClient } from "mqtt";
import { config } from "./config.js";
import type { U5gStatus } from "./types.js";

let client: MqttClient | undefined;
let connected = false;
const log: Array<{ ts: string; level: string; message: string }> = [];

function note(level: string, message: string) {
  log.push({ ts: new Date().toISOString(), level, message });
  if (log.length > 200) log.shift();
}

export function mqttState() {
  return { enabled: config.mqtt.enabled, connected, log: log.slice(-100) };
}

export function applyMqtt() {
  client?.end(true);
  client = undefined;
  connected = false;
  if (!config.mqtt.enabled) return;
  client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.username || undefined,
    password: config.mqtt.password || undefined,
    will: { topic: `${config.mqtt.baseTopic}/availability`, payload: Buffer.from("offline"), retain: true, qos: 0 },
  });
  client.on("connect", () => {
    connected = true;
    note("info", "Connected");
    client?.publish(`${config.mqtt.baseTopic}/availability`, "online", { retain: true });
    if (config.mqtt.homeAssistantDiscovery) publishDiscovery();
  });
  client.on("close", () => { connected = false; });
  client.on("error", (error) => note("error", error.message));
}

export function publishStatus(status: U5gStatus) {
  if (!client || !connected) return;
  client.publish(`${config.mqtt.baseTopic}/state`, JSON.stringify(status), { retain: true });
}

export function publishSms(message: { id: string; from?: string; text?: string; timestamp?: number }) {
  if (!client || !connected) return;
  client.publish(`${config.mqtt.baseTopic}/sms/incoming`, JSON.stringify(message));
}

export function publishAutomation(ruleId: string, payload: unknown) {
  if (!client || !connected) return false;
  client.publish(`${config.mqtt.baseTopic}/automation/${ruleId}`, JSON.stringify(payload));
  return true;
}

export function publishDiscovery() {
  if (!client || !connected || !config.mqtt.homeAssistantDiscovery) return;
  const id = "unifi_u5g";
  const device = { identifiers: [id], name: "UniFi U5G Max", manufacturer: "Ubiquiti", model: "U5G Max Outdoor" };
  const sensors = [
    ["signal", "Signal", "radio.signalPercent", "%", "signal_strength"],
    ["lte_rsrp", "LTE RSRP", "radio.lte.rsrp", "dBm", "signal_strength"],
    ["nr_rsrp", "5G RSRP", "radio.nr.rsrp", "dBm", "signal_strength"],
    ["operator", "Operator", "radio.operator", "", ""],
    ["band", "Active band", "radio.band", "", ""],
    ["unread_sms", "Unread SMS", "sms.unread", "", ""],
  ];
  for (const [key, name, path, unit, deviceClass] of sensors) {
    const value = `{{ value_json.${path} }}`;
    client.publish(`${config.mqtt.discoveryPrefix}/sensor/${id}/${key}/config`, JSON.stringify({ name, unique_id: `${id}_${key}`, state_topic: `${config.mqtt.baseTopic}/state`, value_template: value, unit_of_measurement: unit || undefined, device_class: deviceClass || undefined, device }), { retain: true });
  }
  client.publish(`${config.mqtt.discoveryPrefix}/binary_sensor/${id}/connected/config`, JSON.stringify({ name: "Connected", unique_id: `${id}_connected`, state_topic: `${config.mqtt.baseTopic}/state`, value_template: "{{ 'ON' if value_json.connected else 'OFF' }}", payload_on: "ON", payload_off: "OFF", device_class: "connectivity", device }), { retain: true });
}
