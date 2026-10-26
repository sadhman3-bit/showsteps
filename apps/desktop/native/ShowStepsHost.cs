// ShowSteps native messaging host. Chrome starts it for the extension (chrome.runtime.connectNative)
// and talks over stdio with 4-byte length-prefixed JSON. This host only relays: each message
// becomes one line on the desktop app's named pipe, and each line from the app becomes one
// message to Chrome. If the desktop app is not running it says so and exits.
// H7: the pipe is named by the account's SID, and the host relays only to a pipe served by this
// account's ShowSteps.exe from the install folder; anything else gets "offline" / "untrusted".
using System;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace ShowSteps
{
    internal static class Host
    {
        static readonly object WriteLock = new object();
        const int MaxToChrome = 1024 * 1024; // Chrome's limit for messages from a host

        static int Main()
        {
            var stdin = Console.OpenStandardInput();
            var stdout = Console.OpenStandardOutput();
            var me = WindowsIdentity.GetCurrent().User;
            if (me == null)
            {
                ToChrome(stdout, "{\"type\":\"offline\"}");
                return 0;
            }
            var pipeName = "showsteps-" + me.Value;
            var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            try
            {
                pipe.Connect(1500);
            }
            catch (Exception)
            {
                ToChrome(stdout, "{\"type\":\"offline\"}");
                return 0;
            }
            if (!TrustedServer(pipe, me.Value))
            {
                ToChrome(stdout, "{\"type\":\"offline\",\"reason\":\"untrusted\"}");
                return 0;
            }
            var reader = new StreamReader(pipe, new UTF8Encoding(false));
            var writer = new StreamWriter(pipe, new UTF8Encoding(false)) { AutoFlush = true };

            // App → Chrome
            var pump = new Thread(() =>
            {
                try
                {
                    string line;
                    while ((line = reader.ReadLine()) != null)
                    {
                        if (Encoding.UTF8.GetByteCount(line) > MaxToChrome) continue; // the app chunks
                        ToChrome(stdout, line);
                    }
                }
                catch (IOException) { }
                Environment.Exit(0);
            });
            pump.IsBackground = true;
            pump.Start();

            // Chrome → App
            var len = new byte[4];
            while (ReadExactly(stdin, len, 4))
            {
                var n = BitConverter.ToInt32(len, 0);
                if (n <= 0 || n > 64 * 1024 * 1024) break;
                var body = new byte[n];
                if (!ReadExactly(stdin, body, n)) break;
                var json = Encoding.UTF8.GetString(body).Replace("\r", "").Replace("\n", "");
                try { writer.WriteLine(json); } catch (IOException) { break; }
            }
            return 0;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);

        [DllImport("advapi32.dll", SetLastError = true)]
        static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr handle);

        const uint ProcessQueryLimitedInformation = 0x1000;
        const uint TokenQuery = 0x0008;

        /// <summary>The pipe's server runs as this account and is ShowSteps itself.</summary>
        static bool TrustedServer(NamedPipeClientStream pipe, string sid)
        {
            uint pid;
            if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle, out pid)) return false;
            var process = OpenProcess(ProcessQueryLimitedInformation, false, pid);
            if (process == IntPtr.Zero) return false;
            try
            {
                IntPtr token;
                if (!OpenProcessToken(process, TokenQuery, out token)) return false;
                try
                {
                    using (var owner = new WindowsIdentity(token))
                        if (owner.User == null || owner.User.Value != sid) return false;
                }
                finally { CloseHandle(token); }
                var name = new StringBuilder(1024);
                var size = (uint)name.Capacity;
                if (!QueryFullProcessImageName(process, 0, name, ref size)) return false;
                return ExpectedServer(name.ToString());
            }
            finally { CloseHandle(process); }
        }

        /// <summary>
        /// ShowSteps.exe in the install folder (the host is in its resourcesin). Run from source
        /// (development and the desktop e2e tests), the app is Electron from the repository's
        /// node_modules, beside the app's package.json.
        /// </summary>
        static bool ExpectedServer(string exe)
        {
            var install = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
            var full = Path.GetFullPath(exe);
            if (string.Equals(full, Path.Combine(install, "ShowSteps.exe"), StringComparison.OrdinalIgnoreCase))
                return true;
            var repo = Path.GetFullPath(Path.Combine(install, "..", ".."));
            return File.Exists(Path.Combine(install, "package.json"))
                && string.Equals(Path.GetFileName(full), "electron.exe", StringComparison.OrdinalIgnoreCase)
                && full.StartsWith(Path.Combine(repo, "node_modules") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }

        static bool ReadExactly(Stream s, byte[] buf, int n)
        {
            var read = 0;
            while (read < n)
            {
                var got = s.Read(buf, read, n - read);
                if (got <= 0) return false;
                read += got;
            }
            return true;
        }

        static void ToChrome(Stream stdout, string json)
        {
            var body = Encoding.UTF8.GetBytes(json);
            lock (WriteLock)
            {
                stdout.Write(BitConverter.GetBytes(body.Length), 0, 4);
                stdout.Write(body, 0, body.Length);
                stdout.Flush();
            }
        }
    }
}
