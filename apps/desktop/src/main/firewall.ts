/**
 * Letting the phone through Windows Firewall.
 *
 * Windows treats a network it has not been told about as Public, and on a
 * Public network every incoming connection is refused unless a rule says
 * otherwise. Most home Wi-Fi is left as Public. So the commonest reason a phone
 * "cannot reach" a computer on the same Wi-Fi is not the Wi-Fi at all.
 *
 * The installer is per-user and cannot add a firewall rule, which needs an
 * administrator. Instead the pairing dialog checks, and when the phone would be
 * refused it offers one button that asks Windows (with its own administrator
 * prompt) to add a single rule: this program, its sync ports, TCP, and only
 * from the local network. Nothing broader, and nothing without that prompt.
 */

import { execFile } from 'node:child_process';

import type { NetworkAccessDto } from '../shared/api.js';
import { PORT_ATTEMPTS, PREFERRED_PORT } from './pairing.js';

export const RULE_NAME = 'VaultP (phone sync)';

interface FirewallReport {
  /** NetworkCategory of every connected network: Public, Private, DomainAuthenticated. */
  readonly categories: readonly string[];
  /** Enabled inbound rules naming this program. */
  readonly rules: readonly { readonly action: string; readonly profile: string }[];
}

/** Does a rule's profile ("Any", "Private", "Domain, Public"…) cover this category? */
function covers(profile: string, category: string): boolean {
  if (/\bany\b/i.test(profile)) return true;
  const wanted = /domain/i.test(category) ? 'domain' : category.toLowerCase();
  return profile.toLowerCase().split(/[\s,]+/).includes(wanted);
}

/**
 * Pure, so it can be tested: given what Windows reported, would the phone get in?
 *
 * A Block rule wins over an Allow in Windows Firewall, so one covering any
 * connected network is enough to say blocked. Otherwise every connected
 * network needs an Allow — the phone could be on any of them.
 */
export function evaluate(report: FirewallReport): NetworkAccessDto['state'] {
  if (report.categories.length === 0) return 'unknown';
  for (const category of report.categories) {
    if (report.rules.some((rule) => /block/i.test(rule.action) && covers(rule.profile, category))) {
      return 'blocked';
    }
  }
  const allowed = report.categories.every((category) =>
    report.rules.some((rule) => /allow/i.test(rule.action) && covers(rule.profile, category)),
  );
  return allowed ? 'allowed' : 'blocked';
}

/** PowerShell wants single quotes doubled inside a single-quoted string. */
function quoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runPowerShell(script: string): Promise<string> {
  // -EncodedCommand takes UTF-16LE base64, which sidesteps every quoting rule
  // between here, cmd and PowerShell.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 60_000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

export async function networkAccess(): Promise<NetworkAccessDto> {
  if (process.platform !== 'win32') return { state: 'unknown', publicNetwork: false };
  const program = process.execPath;
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$categories = @(Get-NetConnectionProfile | ForEach-Object { [string]$_.NetworkCategory })
$rules = @(Get-NetFirewallApplicationFilter -Program ${quoted(program)} | Get-NetFirewallRule |
  Where-Object { [string]$_.Direction -eq 'Inbound' -and [string]$_.Enabled -eq 'True' } |
  ForEach-Object { @{ action = [string]$_.Action; profile = [string]$_.Profile } })
@{ categories = $categories; rules = $rules } | ConvertTo-Json -Compress -Depth 4
`;
  try {
    const parsed = JSON.parse((await runPowerShell(script)).trim()) as {
      categories?: string[] | string;
      rules?: FirewallReport['rules'] | FirewallReport['rules'][number];
    };
    // ConvertTo-Json flattens one-element arrays; put them back.
    const categories = parsed.categories === undefined ? [] : ([] as string[]).concat(parsed.categories);
    const rules = parsed.rules === undefined ? [] : ([] as FirewallReport['rules'][number][]).concat(parsed.rules);
    return {
      state: evaluate({ categories, rules }),
      publicNetwork: categories.some((category) => /public/i.test(category)),
    };
  } catch {
    return { state: 'unknown', publicNetwork: false };
  }
}

/**
 * Ask Windows to let the phone in. Shows the administrator prompt; resolves
 * once it has been answered, and reports what the firewall now says.
 *
 * Block rules for this program — left behind when the first-run prompt was
 * dismissed — are disabled rather than deleted, since a Block always beats an
 * Allow and they would make the new rule pointless.
 */
export async function allowNetworkAccess(): Promise<NetworkAccessDto> {
  if (process.platform !== 'win32') return networkAccess();
  const program = process.execPath;
  const ports = `${PREFERRED_PORT}-${PREFERRED_PORT + PORT_ATTEMPTS - 1}`;

  const elevated = `
Get-NetFirewallRule -DisplayName ${quoted(RULE_NAME)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallApplicationFilter -Program ${quoted(program)} | Get-NetFirewallRule |
  Where-Object { [string]$_.Direction -eq 'Inbound' -and [string]$_.Action -eq 'Block' } | Disable-NetFirewallRule
New-NetFirewallRule -DisplayName ${quoted(RULE_NAME)} -Description 'Lets VaultP on your phone sync with this computer over the local network.' -Direction Inbound -Program ${quoted(program)} -Action Allow -Protocol TCP -LocalPort ${ports} -RemoteAddress LocalSubnet -Profile Any | Out-Null
`;
  const encoded = Buffer.from(elevated, 'utf16le').toString('base64');
  // The outer PowerShell only launches the inner one elevated and waits; the
  // UAC prompt is Windows' own, and declining it simply changes nothing.
  await runPowerShell(
    `Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'`,
  ).catch(() => undefined);
  return networkAccess();
}
