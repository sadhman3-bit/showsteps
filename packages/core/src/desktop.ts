/** Windows that show another computer (remote desktop, Citrix): steps there are visual only. */
export const REMOTE_PROCESSES: ReadonlySet<string> = new Set([
  'mstsc',
  'msrdc',
  'wfica32',
  'cdviewer',
  'vmconnect',
  'rdpclient',
]);

/** Browsers: when the extension is connected it records these as web steps. */
export const BROWSER_PROCESSES: ReadonlySet<string> = new Set([
  'chrome',
  'msedge',
  'brave',
  'vivaldi',
  'chromium',
]);

export function isRemoteProcess(processName: string): boolean {
  return REMOTE_PROCESSES.has(processName.toLowerCase().replace(/\.exe$/, ''));
}

export function isBrowserProcess(processName: string): boolean {
  return BROWSER_PROCESSES.has(processName.toLowerCase().replace(/\.exe$/, ''));
}
