// Compiles the two small Windows helpers with the C# compiler that ships with the .NET Framework
// (present on every Windows 10/11 machine), so building needs no .NET SDK:
//   resources/bin/uia-helper.exe      UI Automation, screenshots and input
//   resources/bin/trailmark-host.exe  Chrome native messaging relay to the desktop app
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const out = join(here, 'resources', 'bin');

if (process.platform !== 'win32') {
  console.log('build-native: skipped (Windows only)');
  process.exit(0);
}

const fw = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const csc = join(fw, 'csc.exe');
if (!existsSync(csc)) {
  console.error(`build-native: ${csc} not found (needs the .NET Framework 4.8, part of Windows).`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const wpf = join(fw, 'WPF');
const common = ['/nologo', '/optimize+', '/platform:x64', '/target:exe', '/nowarn:1607'];

execFileSync(
  csc,
  [
    ...common,
    `/out:${join(out, 'uia-helper.exe')}`,
    `/reference:${join(wpf, 'UIAutomationClient.dll')}`,
    `/reference:${join(wpf, 'UIAutomationTypes.dll')}`,
    `/reference:${join(wpf, 'WindowsBase.dll')}`,
    `/reference:${join(fw, 'System.Web.Extensions.dll')}`,
    `/reference:${join(fw, 'System.Drawing.dll')}`,
    `/reference:${join(fw, 'System.Windows.Forms.dll')}`,
    join(here, 'native', 'UiaHelper.cs'),
  ],
  { stdio: 'inherit' },
);
execFileSync(
  csc,
  [
    ...common,
    `/out:${join(out, 'trailmark-host.exe')}`,
    `/reference:${join(fw, 'System.Core.dll')}`,
    join(here, 'native', 'TrailmarkHost.cs'),
  ],
  { stdio: 'inherit' },
);
console.log(`build-native: wrote ${out}`);
