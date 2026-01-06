import os from "os";
import { execFileSync } from "child_process";
import dgram from "dgram";
import { COLORS } from "./contants.js";

type InterfaceKind = "physical" | "vpn" | "hypervisor" | "container" | "bridge" | "loopback" | "unknown";

type PrimaryInterface = {
  name: string;
  address?: string;
  netmask?: string;
  mac?: string;
  gateway?: string;
  family: "IPv4";
  kind: InterfaceKind;
  isVirtual: boolean;
  source: "iproute2" | "route" | "powershell" | "socket-fallback";
  extra?: Record<string, any>;
};

const DEST_IP = "1.1.1.1";

function classifyInterface(
  name: string,
  description?: string
): { kind: InterfaceKind; isVirtual: boolean; reason: string } {
  const n = (name || "").toLowerCase();
  const d = (description || "").toLowerCase();

  if (n === "lo" || n === "lo0" || n.includes("loopback") || d.includes("loopback")) {
    return { kind: "loopback", isVirtual: true, reason: "loopback name/description" };
  }

  const vpnNamePatterns = [
    /^tun\d+$/,
    /^tap\d+$/,
    /^wg\d+$/,
    /^tailscale\d+$/,
    /^zt[a-z0-9]+$/,
    /^utun\d+$/,
    /^ppp\d+$/,
    /^ipsec.*$/,
    /^anonvpn.*$/,
    /^grace?vpn.*$/,
    /^npf.*$/,
    /^utun$/,
    /^utun[0-9]+$/,
  ];
  const vpnDescPatterns = [
    /wireguard/,
    /wintun/,
    /vpn/,
    /anyconnect/,
    /openvpn/,
    /nordlynx/,
    /expressvpn/,
    /pan\-gps/,
    /pulse secure/,
  ];
  if (vpnNamePatterns.some((rx) => rx.test(n)) || vpnDescPatterns.some((rx) => rx.test(d))) {
    return { kind: "vpn", isVirtual: true, reason: "matches VPN/tunnel patterns" };
  }

  const hypervisorNamePatterns = [/^vboxnet/, /^vmnet/, /^veth/, /^virbr/, /^br-/, /^hyper-v/i, /^vEthernet/i];
  const hypervisorDescPatterns = [/hyper\-v/, /vmware/, /virtualbox/, /parallels/, /virtual ethernet/];
  if (hypervisorNamePatterns.some((rx) => rx.test(n)) || hypervisorDescPatterns.some((rx) => rx.test(d))) {
    return {
      kind: "hypervisor",
      isVirtual: true,
      reason: "matches hypervisor/virtual NIC patterns",
    };
  }

  const containerBridgePatterns = [/^docker/, /^cni/, /^flannel/, /^br-/, /^veth/];
  if (containerBridgePatterns.some((rx) => rx.test(n))) {
    const kind: InterfaceKind = n.startsWith("br-") ? "bridge" : "container";
    return { kind, isVirtual: true, reason: "matches container/bridge patterns" };
  }

  try {
    if (process.platform === "linux") {
      const fs = require("fs");
      const devicePath = `/sys/class/net/${name}/device`;
      if (!fs.existsSync(devicePath)) {
        return { kind: "unknown", isVirtual: true, reason: "no /sys/class/net/${iface}/device" };
      }
    }
  } catch {}
  return { kind: "physical", isVirtual: false, reason: "default assumption" };
}

function findInterfaceByAddress(addr: string): { name: string; net: os.NetworkInterfaceInfo } | undefined {
  const nets = os.networkInterfaces();
  for (const [name, infos] of Object.entries(nets)) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family === "IPv4" && info.address === addr) {
        return { name, net: info };
      }
    }
  }
  return undefined;
}

function findPrimaryFromOSInterfaces(name: string, address?: string) {
  const nets = os.networkInterfaces();
  const infos = nets[name];
  let best = undefined as os.NetworkInterfaceInfo | undefined;
  if (address && infos) {
    best = infos.find((i) => i.family === "IPv4" && i.address === address);
  }
  if (!best && infos) {
    best = infos.find((i) => i.family === "IPv4");
  }
  return best;
}

function getPrimaryLinux(): PrimaryInterface | undefined {
  try {
    const j = execFileSync("ip", ["-j", "route", "get", DEST_IP], { encoding: "utf8" }).trim();
    const data = JSON.parse(j);
    if (Array.isArray(data) && data.length > 0) {
      const r = data[0] || {};
      const dev = r.dev as string | undefined;
      const src = (r.prefsrc || r.src) as string | undefined;
      const gateway = (r.gateway || r.via) as string | undefined;

      if (dev) {
        const osInfo = findPrimaryFromOSInterfaces(dev, src);
        const { kind, isVirtual } = classifyInterface(dev);
        return {
          name: dev,
          address: osInfo?.address || src,
          netmask: osInfo?.netmask,
          mac: osInfo?.mac,
          gateway,
          family: "IPv4",
          kind,
          isVirtual,
          source: "iproute2",
          extra: {
            table: r.table,
            metric: r.metric,
            priority: r.priority,
            uid: r.uid,
          },
        };
      }
    }
  } catch {
    try {
      const out = execFileSync("ip", ["route", "get", DEST_IP], { encoding: "utf8" }).trim();
      const devMatch = out.match(/\bdev\s+(\S+)/);
      const srcMatch = out.match(/\bsrc\s+(\S+)/);
      const viaMatch = out.match(/\bvia\s+(\S+)/);

      const dev = devMatch?.[1];
      const src = srcMatch?.[1];
      const gateway = viaMatch?.[1];

      if (dev) {
        const osInfo = findPrimaryFromOSInterfaces(dev, src);
        const { kind, isVirtual } = classifyInterface(dev);
        return {
          name: dev,
          address: osInfo?.address || src,
          netmask: osInfo?.netmask,
          mac: osInfo?.mac,
          gateway,
          family: "IPv4",
          kind,
          isVirtual,
          source: "iproute2",
        };
      }
    } catch {}
  }
  return undefined;
}

function getPrimaryDarwin(): PrimaryInterface | undefined {
  try {
    const out = execFileSync("route", ["-n", "get", DEST_IP], { encoding: "utf8" }).trim();
    const map = new Map<string, string>();
    for (const line of out.split("\n")) {
      const idx = line.indexOf(":");
      if (idx > -1) {
        const key = line.slice(0, idx).trim().toLowerCase();
        const val = line.slice(idx + 1).trim();
        map.set(key, val);
      }
    }
    const iface = map.get("interface");
    const gateway = map.get("gateway");
    if (iface) {
      const osInfo = findPrimaryFromOSInterfaces(iface);
      const { kind, isVirtual } = classifyInterface(iface);
      return {
        name: iface,
        address: osInfo?.address,
        netmask: osInfo?.netmask,
        mac: osInfo?.mac,
        gateway: gateway,
        family: "IPv4",
        kind,
        isVirtual,
        source: "route",
      };
    }
  } catch {}

  return undefined;
}

function getPrimaryWindows(): PrimaryInterface | undefined {
  try {
    const ps = `
$ErrorActionPreference = "Stop";
$dest = "${DEST_IP}/32";
$r = Get-NetRoute -DestinationPrefix $dest -ErrorAction SilentlyContinue |
     Sort-Object -Property RouteMetric, InterfaceMetric |
     Select-Object -First 1;
if (-not $r) {
  # fallback to default route
  $r = Get-NetRoute -DestinationPrefix "0.0.0.0/0" |
       Sort-Object -Property RouteMetric, InterfaceMetric |
       Select-Object -First 1;
}
if ($r) {
  $i = Get-NetIPInterface -InterfaceIndex $r.InterfaceIndex -AddressFamily IPv4;
  $ip = Get-NetIPAddress -InterfaceIndex $r.InterfaceIndex -AddressFamily IPv4 |
        Sort-Object -Property SkipAsSource, PrefixLength |
        Select-Object -First 1;
  [pscustomobject]@{
    InterfaceAlias = $i.InterfaceAlias
    InterfaceIndex = $r.InterfaceIndex
    InterfaceDescription = $i.InterfaceDescription
    NextHop = $r.NextHop
    RouteMetric = $r.RouteMetric
    InterfaceMetric = $i.InterfaceMetric
    Address = $ip.IPAddress
    PrefixLength = $ip.PrefixLength
  } | ConvertTo-Json -Compress
} else {
  "{}"
}
`.trim();

    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], {
      encoding: "utf8",
    }).trim();
    const data = JSON.parse(out || "{}");
    if (data && data.InterfaceAlias) {
      const ifaceName: string = data.InterfaceAlias;
      const address: string | undefined = data.Address;
      const gateway: string | undefined = data.NextHop;

      const osInfo = address ? findInterfaceByAddress(address)?.net : findPrimaryFromOSInterfaces(ifaceName);

      const { kind, isVirtual } = classifyInterface(ifaceName, data.InterfaceDescription);
      let netmask = osInfo?.netmask;
      if (!netmask && typeof data.PrefixLength === "number") {
        netmask = prefixLengthToNetmask(data.PrefixLength);
      }

      return {
        name: ifaceName,
        address: address || osInfo?.address,
        netmask,
        mac: osInfo?.mac,
        gateway,
        family: "IPv4",
        kind,
        isVirtual,
        source: "powershell",
        extra: {
          interfaceIndex: data.InterfaceIndex,
          routeMetric: data.RouteMetric,
          interfaceMetric: data.InterfaceMetric,
          description: data.InterfaceDescription,
        },
      };
    }
  } catch {}

  return undefined;
}

function prefixLengthToNetmask(prefix: number): string {
  let mask = 0xffffffff << (32 - prefix);
  if (prefix === 0) mask = 0;
  return [24, 16, 8, 0].map((shift) => (mask >>> shift) & 255).join(".");
}

async function getPrimaryViaSocketFallback(): Promise<PrimaryInterface | undefined> {
  return new Promise((resolve) => {
    try {
      const sock = dgram.createSocket("udp4");
      let resolved = false;
      sock.on("error", () => {
        if (!resolved) {
          resolved = true;
          sock.close();
          resolve(undefined);
        }
      });

      sock.connect(53, DEST_IP, () => {
        const addrInfo = sock.address();
        sock.close();
        const local = typeof addrInfo === "object" ? (addrInfo as any).address : undefined;
        if (local) {
          const found = findInterfaceByAddress(local);
          if (found) {
            const { name, net } = found;
            const { kind, isVirtual } = classifyInterface(name);
            resolved = true;
            resolve({
              name,
              address: net.address,
              netmask: net.netmask,
              mac: net.mac,
              gateway: undefined,
              family: "IPv4",
              kind,
              isVirtual,
              source: "socket-fallback",
            });
            return;
          }
        }
        if (!resolved) {
          resolved = true;
          resolve(undefined);
        }
      });

      setTimeout(() => {
        try {
          sock.close();
        } catch {}
        if (!resolved) resolve(undefined);
      }, 800);
    } catch {
      resolve(undefined);
    }
  });
}

export async function getPrimaryInternetInterface(): Promise<PrimaryInterface | undefined> {
  const platform = process.platform;
  let result: PrimaryInterface | undefined;

  if (platform === "linux") {
    result = getPrimaryLinux();
  } else if (platform === "darwin") {
    result = getPrimaryDarwin();
  } else if (platform === "win32") {
    result = getPrimaryWindows();
  }

  if (!result) {
    result = await getPrimaryViaSocketFallback();
  }

  if (result && result.kind === "loopback") {
    const fb = await getPrimaryViaSocketFallback();
    if (fb && fb.kind !== "loopback") return fb;
  }

  return result || undefined;
}

function makeId(length: number): string {
  var result = "";
  var characters = "abcdefghijklmnopqrstuvwxyz";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export async function PublishService(domain: string): Promise<string> {
  var mdns = require("mdns-server")({
    reuseAddr: true,
    loopback: true,
    noInit: true,
  });

  const mainInterface = await getPrimaryInternetInterface();

  if (!mainInterface || !mainInterface.address) {
    console.log(
      `${COLORS.RED}Sikertelen mDNS szolgáltatás közzététele, mert nem található elsődleges internetes interfész.\n${COLORS.RESET}`
    );

    process.exit(1);
  }

  let finalDomain = domain + "-" + makeId(4);

  mdns.on("query", function (query: any) {
    if (query.questions[0] && query.questions[0].name === finalDomain + ".local" && query.questions[0].type === "A") {
      mdns.respond([
        {
          name: finalDomain + ".local",
          type: "A",
          data: mainInterface.address,
        },
      ]);
    }
  });

  mdns.initServer();

  return finalDomain;
}
