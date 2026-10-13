// ShowSteps native messaging host. Chrome starts it for the extension (chrome.runtime.connectNative)
// and talks over stdio with 4-byte length-prefixed JSON. This host only relays: each message
// becomes one line on the desktop app's named pipe, and each line from the app becomes one
// message to Chrome. If the desktop app is not running it says so and exits.
using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;

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
            var pipeName = "showsteps-" + Environment.UserName.ToLowerInvariant();
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
