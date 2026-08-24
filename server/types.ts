export type SshTarget = {
  host: string;
  port: number;
  user: string;
  password?: string;
  privateKeyPath?: string;
  hostFingerprint?: string;
};

export type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: "incoming_sms" | "scheduled";
  senderContains?: string;
  textContains?: string;
  schedule?: string;
  action: "reply" | "send_sms" | "notify" | "mqtt";
  destination?: string;
  message?: string;
  cooldownMs: number;
  maxPerDay: number;
  lastRunAt?: string;
  lastMatchedSmsId?: string;
};

export type AppConfig = {
  server: { host: string; port: number; pollIntervalMs: number };
  connection: {
    gateway: SshTarget;
    modem: SshTarget & { authMode: "unifi" | "manual" };
  };
  auth: { enabled: boolean; adminHash: string; viewerHash: string; viewerEnabled: boolean; seededDefault: boolean };
  retention: { metricsDays: number; eventsDays: number; auditDays: number; maxMetrics: number };
  automation: { enabled: boolean; rules: AutomationRule[] };
  notifications: {
    enabled: boolean;
    incomingSms: boolean;
    connectionLost: boolean;
    ntfy: { enabled: boolean; url: string; topic: string };
    telegram: { enabled: boolean; botToken: string; chatId: string };
    email: { enabled: boolean; host: string; port: number; secure: boolean; user: string; password: string; from: string; to: string };
  };
  mqtt: { enabled: boolean; url: string; username: string; password: string; baseTopic: string; homeAssistantDiscovery: boolean; discoveryPrefix: string };
};

export type U5gStatus = {
  checkedAt: string;
  connected: boolean;
  connectionError?: string;
  connection: { gatewayHost: string; modemHost: string; mode: "ssh-jump"; latencyMs?: number };
  device?: {
    model?: string;
    modelDisplay?: string;
    hostname?: string;
    version?: string;
    firmwareVersion?: string;
    serial?: string;
    mac?: string;
    architecture?: string;
    kernelVersion?: string;
    uptime?: number;
    uptimeText?: string;
    cpuPercent?: number;
    memoryPercent?: number;
    emmcWearLevel?: number;
    ip?: string;
    ipv6?: string[];
    bootId?: string;
    bootReason?: string;
    dualBoot?: unknown;
    everCrash?: boolean;
    boardRevision?: string;
    bomRevision?: string;
    bootromVersion?: string;
    requiredVersion?: string;
    manufacturerId?: string;
    systemId?: string;
    hardwareCapabilities?: unknown;
    firmwareCapabilities?: unknown;
  };
  radio?: {
    rat?: string;
    mode?: string;
    operator?: string;
    mcc?: number;
    mnc?: number;
    roaming?: boolean;
    coverage?: boolean;
    signalBars?: number;
    signalPercent?: number;
    band?: string;
    channel?: number;
    cellId?: number;
    pci?: number;
    lte?: { rsrp?: number; rsrq?: number; rssi?: number; snr?: number };
    nr?: { rsrp?: number; rsrq?: number; snr?: number };
    lteCa?: Array<Record<string, unknown>>;
    nrCa?: Array<Record<string, unknown>>;
    maxDownBps?: number;
    maxUpBps?: number;
    registrationState?: string;
    saMode?: unknown;
    rxChannel?: number;
    txChannel?: number;
    currentSlot?: number;
    ratCapabilities?: unknown[];
    supportedLteBands?: unknown[];
    supportedNrBands?: unknown[];
    homePlmnServing?: boolean;
    homePlmnDenied?: boolean;
  };
  sim?: {
    active?: boolean;
    slot?: number;
    esim?: boolean;
    present?: boolean;
    state?: string;
    pinVerified?: boolean;
    pinTriesRemaining?: number;
    pukTriesRemaining?: number;
    carrier?: string;
    iccidMasked?: string;
    imeiMasked?: string;
    eidMasked?: string;
    apn?: string;
    rxBytes?: number;
    txBytes?: number;
    dataLimited?: boolean;
    dataWarning?: boolean;
    slots?: Array<Record<string, unknown>>;
    esimProfiles?: unknown[];
    networkScan?: Record<string, unknown>;
  };
  wan?: {
    ipv4?: string;
    gateway?: string;
    netmask?: string;
    dns?: string[];
    mtu?: number;
    publicIp?: string;
    isp?: string;
    asn?: number;
    city?: string;
    country?: string;
    ipv6?: Record<string, unknown>;
    connectionInfo?: Record<string, unknown>;
  };
  ethernet?: { speedMbps?: number; fullDuplex?: boolean; up?: boolean; rxBytes?: number; txBytes?: number; rxPackets?: number; txPackets?: number; rxErrors?: number; txErrors?: number; rxDropped?: number; txDropped?: number; rxMulticast?: number };
  system?: { load1?: number; load5?: number; load15?: number; memoryTotal?: number; memoryUsed?: number; memoryBuffer?: number; state?: string; modemState?: Record<string, unknown>; lastConnectionErrors?: unknown; rebootDuration?: number; upgradeDuration?: number };
  management?: { gatewayIp?: string; informUrl?: string; informInterval?: number; configVersion?: string; savedConfigVersion?: string; effectiveConfigVersion?: string; isolated?: boolean; locating?: boolean; lldp?: unknown; sshSessions?: unknown; adoptionState?: string; fingerprint?: string };
  sms?: { inbox: number; unread: number; outbox: number; failed: number };
};

export type SmsMessage = {
  id: string;
  direction: "in" | "out";
  peer: string;
  text: string;
  timestamp: string;
  status: "received" | "queued" | "sending" | "sent" | "failed" | "unknown";
  read: boolean;
  source: "modem" | "manual" | "automation";
  error?: string;
};

export type AppEvent = { id?: number; ts: string; level: "info" | "warn" | "error" | "action"; kind: string; message: string; data?: unknown };
