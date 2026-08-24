import type { Client } from "ssh2";
import { config, saveConfig } from "./config.js";
import { exec, observedFingerprints, withGateway, withJump } from "./ssh-jump.js";
import type { SmsMessage, U5gStatus } from "./types.js";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function mask(value?: string, visible = 4): string | undefined {
  if (!value) return undefined;
  if (value.length <= visible * 2) return "•".repeat(value.length);
  return `${value.slice(0, visible)}${"•".repeat(Math.min(10, value.length - visible * 2))}${value.slice(-visible)}`;
}

function number(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function safeObject(value: unknown, key = ""): unknown {
  if (value == null || typeof value !== "object") {
    if (typeof value === "string" && /(?:password|passwd|token|secret|username)/i.test(key)) return "[redacted]";
    if (typeof value === "string" && /(?:imei|iccid|eid|imsi)/i.test(key)) return mask(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => safeObject(item, key));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, safeObject(child, childKey)]));
}

function safeSimSlot(value: Record<string, any>): Record<string, unknown> {
  return {
    slot: number(value.slot), active: Boolean(value.active), present: Boolean(value.card_present), esim: Boolean(value.esim), state: value.display_state,
    stateElapsed: number(value.display_state_elapsed), carrier: value.spn, mcc: number(value.mcc), mnc: number(value.mnc), asn: number(value.asn),
    iccidMasked: mask(value.iccid), hasCarrier: Boolean(value.has_carrier), hasDataPlan: Boolean(value.has_data_plan), metered: Boolean(value.metered),
    pinVerified: Boolean(value.pin_verified), pinLock: Boolean(value.pin_lock), pinBlocked: Boolean(value.pin_blocked), pinTriesRemaining: number(value.pin_tries_remaining),
    pukTriesRemaining: number(value.puk_tries_remaining), operationInProgress: Boolean(value.operation_in_progress), incompatible: Boolean(value.incompatible),
    rxBytes: number(value.rxbytes), txBytes: number(value.txbytes), connectionInfo: safeObject(value.connection_info),
    apn: value.current_apn?.apn ?? value.default_apn?.apn, apnType: value.current_apn?.pdp_type ?? value.default_apn?.pdp_type,
    apnAuth: value.current_apn?.auth_type ?? value.default_apn?.auth_type, apnUsername: value.current_apn?.username ? "[redacted]" : undefined,
  };
}

async function managedCredentials(): Promise<{ user: string; password: string; host?: string }> {
  return withGateway(config.connection.gateway, async (gateway) => {
    const command = `mongo --quiet --port 27117 ace --eval 'var s=db.setting.findOne({key:"mgmt"}); var a=db.device.find({model:/^(U5G|UMBB)/i}).sort({last_seen:-1}).limit(1).toArray(); var d=a.length?a[0]:null; print(s.x_ssh_username); print(s.x_ssh_password); print(d&&d.ip?d.ip:"")'`;
    const result = await exec(gateway, command, 8000);
    if (result.code !== 0) throw new Error("Unable to read UniFi Device SSH credentials from the gateway");
    const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error("UniFi Device SSH credentials are not configured");
    return { user: lines[0], password: lines[1], host: lines[2] };
  });
}

async function modemTarget() {
  const target = { ...config.connection.modem };
  if (target.authMode === "unifi") {
    const credentials = await managedCredentials();
    target.user = credentials.user;
    target.password = credentials.password;
    if (credentials.host && /^[0-9a-f:.]+$/i.test(credentials.host)) {
      target.host = credentials.host;
      if (config.connection.modem.host !== credentials.host) {
        config.connection.modem.host = credentials.host;
        saveConfig();
      }
    }
  }
  if (!target.user) throw new Error("U5G SSH username is not configured");
  return target;
}

export async function withModem<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const target = await modemTarget();
  return withJump(config.connection.gateway, target, work);
}

export async function testConnection() {
  const started = Date.now();
  const result = await withModem((client) => exec(client, "printf connected", 8000));
  if (result.code !== 0 || result.stdout !== "connected") throw new Error(result.stderr || "Unexpected U5G response");
  return { ok: true, latencyMs: Date.now() - started, fingerprints: observedFingerprints };
}

export async function collectU5gStatus(): Promise<U5gStatus> {
  const checkedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const result = await withModem((client) => exec(client, "mca-dump", 15000));
    if (result.code !== 0) throw new Error(result.stderr.trim() || `mca-dump exited ${result.code}`);
    const raw = JSON.parse(result.stdout) as Record<string, any>;
    const mbb = raw.mbb ?? {};
    const radio = mbb.radio ?? {};
    const sims = Array.isArray(mbb.sim) ? mbb.sim : [];
    const sim = sims.find((item: any) => item?.active) ?? sims[0] ?? {};
    const apn = sim.current_apn ?? sim.default_apn ?? {};
    const ip = mbb.ip_settings ?? {};
    const geo = mbb.geo_info ?? {};
    const eth = Array.isArray(raw.if_table) ? raw.if_table.find((item: any) => item?.name === "eth0") ?? raw.if_table[0] : {};
    return {
      checkedAt,
      connected: true,
      connection: { gatewayHost: config.connection.gateway.host, modemHost: config.connection.modem.host, mode: "ssh-jump", latencyMs: Date.now() - started },
      device: {
        model: raw.model,
        modelDisplay: raw.model_display,
        hostname: raw.hostname,
        version: raw.version,
        firmwareVersion: mbb.firmware_version,
        serial: raw.serial,
        mac: raw.mac,
        architecture: raw.architecture,
        kernelVersion: raw.kernel_version,
        uptime: number(raw.uptime),
        uptimeText: raw.uptime_str,
        cpuPercent: number(raw["system-stats"]?.cpu),
        memoryPercent: number(raw["system-stats"]?.mem),
        emmcWearLevel: number(raw.emmc_wear_level),
        ip: raw.ip,
        ipv6: Array.isArray(raw.ipv6) ? raw.ipv6 : raw.ipv6 ? [String(raw.ipv6)] : [],
        bootId: raw.boot?.id ?? raw.bootid,
        bootReason: raw.boot?.reason,
        dualBoot: safeObject(raw.dualboot),
        everCrash: Boolean(raw.ever_crash),
        boardRevision: raw.board_rev,
        bomRevision: raw.bomrev,
        bootromVersion: raw.bootrom_version,
        requiredVersion: raw.required_version,
        manufacturerId: raw.manufacturer_id,
        systemId: raw.sysid,
        hardwareCapabilities: safeObject(raw.hw_caps),
        firmwareCapabilities: safeObject({ fw: raw.fw_caps, fw2: raw.fw2_caps, fw3: raw.fw3_caps, systemErrors: raw.sys_error_caps }),
      },
      radio: {
        rat: radio.rat,
        mode: radio.rat_mode_active,
        operator: radio.networkoperator,
        mcc: number(radio.mcc),
        mnc: number(radio.mnc),
        roaming: Boolean(radio.roaming),
        coverage: Boolean(radio.has_coverage),
        signalBars: number(radio.signal),
        signalPercent: number(radio.signal_percent),
        band: radio.band,
        channel: number(radio.channel),
        cellId: number(radio.cell_id),
        pci: number(radio.pci),
        lte: { rsrp: number(radio.rsrp), rsrq: number(radio.rsrq), rssi: number(radio.rssi), snr: number(radio.snr) },
        nr: { rsrp: number(radio.rsrp_nr), rsrq: number(radio.rsrq_nr), snr: number(radio.snr_nr) },
        lteCa: Array.isArray(radio.ca_lte) ? radio.ca_lte : [],
        nrCa: Array.isArray(radio.ca_nr) ? radio.ca_nr : [],
        maxDownBps: number(radio.max_bitrate_dl_nr ?? radio.max_bitrate_dl),
        maxUpBps: number(radio.max_bitrate_ul_nr ?? radio.max_bitrate_ul),
        registrationState: radio.registration_state,
        saMode: safeObject(radio["5g_sa_mode"]),
        rxChannel: number(radio.rx_chan),
        txChannel: number(radio.tx_chan),
        currentSlot: number(radio.current_slot),
        ratCapabilities: Array.isArray(radio.rat_caps) ? radio.rat_caps : [],
        supportedLteBands: Array.isArray(radio.lte_bands) ? radio.lte_bands : [],
        supportedNrBands: Array.isArray(radio.nr5g_bands) ? radio.nr5g_bands : [],
        homePlmnServing: Boolean(radio.hplmn_serving),
        homePlmnDenied: Boolean(radio.hplmn_denied),
      },
      sim: {
        active: Boolean(sim.active), slot: number(sim.slot), esim: Boolean(sim.esim), present: Boolean(sim.card_present), state: sim.display_state,
        pinVerified: Boolean(sim.pin_verified), pinTriesRemaining: number(sim.pin_tries_remaining), pukTriesRemaining: number(sim.puk_tries_remaining),
        carrier: sim.spn || radio.networkoperator, iccidMasked: mask(sim.iccid), imeiMasked: mask(mbb.imei), eidMasked: mask(mbb.esim?.eid), apn: apn.apn,
        rxBytes: number(sim.rxbytes), txBytes: number(sim.txbytes), dataLimited: Boolean(sim.data_limited), dataWarning: Boolean(sim.data_warning),
        slots: sims.map((item: Record<string, any>) => safeSimSlot(item)),
        esimProfiles: Array.isArray(mbb.esim?.preload_profiles) ? safeObject(mbb.esim.preload_profiles) as unknown[] : [],
        networkScan: safeObject(mbb.network_scan) as Record<string, unknown>,
      },
      wan: {
        ipv4: ip.ipv4_address, gateway: ip.ipv4_gateway, netmask: ip.ipv4_netmask, dns: [ip.ipv4_dns, ip.ipv4_dns2].filter(Boolean), mtu: number(ip.mtu),
        publicIp: geo.address, isp: geo.isp, asn: number(geo.asn), city: geo.city, country: geo.country_name,
        ipv6: safeObject(mbb.ipv6_settings) as Record<string, unknown>, connectionInfo: safeObject(sim.connection_info) as Record<string, unknown>,
      },
      ethernet: {
        speedMbps: number(eth.speed), fullDuplex: Boolean(eth.full_duplex), up: Boolean(eth.up), rxBytes: number(eth.rx_bytes), txBytes: number(eth.tx_bytes),
        rxPackets: number(eth.rx_packets), txPackets: number(eth.tx_packets), rxErrors: number(eth.rx_errors), txErrors: number(eth.tx_errors),
        rxDropped: number(eth.rx_dropped), txDropped: number(eth.tx_dropped), rxMulticast: number(eth.rx_multicast),
      },
      system: {
        load1: number(raw.sys_stats?.loadavg_1), load5: number(raw.sys_stats?.loadavg_5), load15: number(raw.sys_stats?.loadavg_15),
        memoryTotal: number(raw.sys_stats?.mem_total), memoryUsed: number(raw.sys_stats?.mem_used), memoryBuffer: number(raw.sys_stats?.mem_buffer),
        state: raw.state, modemState: safeObject(mbb.modem_state) as Record<string, unknown>, lastConnectionErrors: safeObject(raw.last_error_conns),
        rebootDuration: number(raw.reboot_duration), upgradeDuration: number(raw.upgrade_duration),
      },
      management: {
        gatewayIp: raw.gateway_ip, informUrl: raw.inform_url, informInterval: number(raw.inform_min_interval), configVersion: raw.cfgversion,
        savedConfigVersion: raw.cfgversion_saved, effectiveConfigVersion: raw.cfgversion_effective, isolated: Boolean(raw.isolated), locating: Boolean(raw.locating),
        lldp: safeObject(raw.lldp_table), sshSessions: safeObject(raw.ssh_session_table), adoptionState: raw.default ? "Default" : raw.state,
        fingerprint: raw.fingerprint,
      },
      sms: { inbox: 0, unread: 0, outbox: 0, failed: 0 },
    };
  } catch (error) {
    return { checkedAt, connected: false, connectionError: error instanceof Error ? error.message : String(error), connection: { gatewayHost: config.connection.gateway.host, modemHost: config.connection.modem.host, mode: "ssh-jump", latencyMs: Date.now() - started }, sms: { inbox: 0, unread: 0, outbox: 0, failed: 0 } };
  }
}

export async function readModemSms(): Promise<Array<{ id: string; from?: string; text?: string; timestamp?: number; [key: string]: unknown }>> {
  const command = `ubus call uiwwand call ${shellQuote(JSON.stringify({ method: "get-sms", params: {} }))}`;
  const result = await withModem((client) => exec(client, command, 12000));
  if (result.code !== 0) throw new Error(result.stderr.trim() || "Unable to read SMS");
  const parsed = JSON.parse(result.stdout) as { result?: { sms?: unknown[] } };
  return Array.isArray(parsed.result?.sms) ? parsed.result.sms.filter((item): item is { id: string; [key: string]: unknown } => Boolean(item && typeof item === "object" && "id" in item)) : [];
}

export async function sendModemSms(number: string, text: string): Promise<{ status: SmsMessage["status"]; output: string }> {
  const command = `send-sms ${shellQuote(number)} ${shellQuote(text)}`;
  try {
    const result = await withModem((client) => exec(client, command, 30000));
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (result.code === 0 && /Message sent/i.test(output)) return { status: "sent", output };
    return { status: "failed", output: output || `send-sms exited ${result.code}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: /timeout/i.test(message) ? "unknown" : "failed", output: message };
  }
}

export async function diagnostics() {
  return withModem(async (client) => {
    const [version, uptime, network, rawDump, modemLog, networkLog, recentSmsLog, systemLog] = await Promise.all([
      exec(client, "cat /etc/version 2>/dev/null; cat /etc/os-release 2>/dev/null", 8000),
      exec(client, "uptime", 8000),
      exec(client, "ip -br addr; ip route", 8000),
      exec(client, "mca-dump", 15000),
      exec(client, "logread | grep -Ei 'mbb|wwan|modem|lte|nr5g|cell|sim' | tail -n 200", 10000),
      exec(client, "logread | grep -Ei 'netifd|udhcpc|ipv6|dns|eth0' | tail -n 200", 10000),
      exec(client, "logread | grep -Ei 'sms|uiwwand' | tail -n 200", 10000),
      exec(client, "logread | tail -n 200", 10000),
    ]);
    const redactLog = (text: string) => text
      .replace(/\b\d{14,22}\b/g, (value) => mask(value) ?? "[redacted]")
      .replace(/((?:password|passwd|token|secret|username)\s*[=:]\s*)\S+/gi, "$1[redacted]");
    const rawStatus: unknown = (() => {
      try { return safeObject(JSON.parse(rawDump.stdout)); }
      catch { return { error: "Unable to parse mca-dump" }; }
    })();
    return {
      generatedAt: new Date().toISOString(), version: redactLog(version.stdout), uptime: uptime.stdout, network: redactLog(network.stdout), rawStatus,
      logs: { modem: redactLog(modemLog.stdout), network: redactLog(networkLog.stdout), sms: redactLog(recentSmsLog.stdout), system: redactLog(systemLog.stdout) },
      fingerprints: observedFingerprints,
    };
  });
}
