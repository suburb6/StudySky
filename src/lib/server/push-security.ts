import { lookup as dnsLookup } from 'node:dns';
import { Agent } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

const defaultHostRules = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  '.notify.windows.com',
  '.push.apple.com'
];

const blockedNetworks = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  blockedNetworks.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
] as const) {
  blockedNetworks.addSubnet(network, prefix, 'ipv6');
}

export function normalizePushEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Push endpoint must be a valid URL.');
  }
  if (url.protocol !== 'https:') throw new Error('Push endpoint must use HTTPS.');
  if (url.username || url.password) throw new Error('Push endpoint cannot contain credentials.');
  if (url.port && url.port !== '443') throw new Error('Push endpoint must use port 443.');
  if (url.hash) throw new Error('Push endpoint cannot contain a fragment.');

  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!hostname || isIP(hostname)) throw new Error('Push endpoint must use an approved host name.');
  if (!pushHostRules().some((rule) => hostMatchesRule(hostname, rule))) {
    throw new Error('Push endpoint host is not approved by this installation.');
  }
  return url.href;
}

export function isPublicPushAddress(address: string): boolean {
  if (address.toLowerCase().startsWith('::ffff:')) return false;
  const version = isIP(address);
  if (!version) return false;
  return !blockedNetworks.check(address, version === 4 ? 'ipv4' : 'ipv6');
}

const safeLookup: LookupFunction = (hostname, _options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, '');
      return;
    }
    const safeAddress = addresses.find((address) => isPublicPushAddress(address.address));
    if (!safeAddress) {
      const blocked = Object.assign(new Error('Push endpoint resolved to a blocked network.'), {
        code: 'EHOSTUNREACH'
      }) as NodeJS.ErrnoException;
      callback(blocked, '');
      return;
    }
    callback(null, safeAddress.address, safeAddress.family);
  });
};

const pushAgent = new Agent({
  keepAlive: true,
  maxSockets: 10,
  lookup: safeLookup
});

export function getPushDeliveryAgent(): Agent {
  return pushAgent;
}

function pushHostRules(): string[] {
  const configured = (process.env.PUSH_ENDPOINT_ALLOWLIST ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => (value.startsWith('*.') ? `.${value.slice(2)}` : value))
    .filter((value) => /^\.?[a-z0-9.-]+$/.test(value));
  return [...defaultHostRules, ...configured];
}

function hostMatchesRule(hostname: string, rule: string): boolean {
  if (rule.startsWith('.')) {
    return hostname.length > rule.length && hostname.endsWith(rule);
  }
  return hostname === rule;
}
