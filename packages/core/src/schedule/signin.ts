/**
 * Identity providers whose pages mean "someone needs to sign in". `*.` matches any subdomain
 * (and not the bare domain). Add hosts here to recognise more providers.
 */
export const SIGN_IN_HOSTS: readonly string[] = [
  'login.microsoftonline.com',
  'login.live.com',
  'accounts.google.com',
  '*.okta.com',
  '*.auth0.com',
  '*.onelogin.com',
];

export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = pattern.toLowerCase();
  return p.startsWith('*.') ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p;
}

export function isSignInHost(host: string, hosts: readonly string[] = SIGN_IN_HOSTS): boolean {
  return hosts.some((p) => hostMatches(host, p));
}

/**
 * Whether Run for me should stop for a sign-in: the step's target wasn't found, and the page
 * looks like a sign-in page (a visible password or one-time-code field, or a known identity
 * provider) on a host other than the one the step was recorded on.
 */
export function needsSignIn(page: {
  host: string;
  stepHost: string;
  hasSecretField: boolean;
  hosts?: readonly string[];
}): boolean {
  if (page.host.toLowerCase() === page.stepHost.toLowerCase()) return false;
  return page.hasSecretField || isSignInHost(page.host, page.hosts);
}
