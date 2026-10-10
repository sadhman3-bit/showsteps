// Trailmark UI Automation helper. Line-delimited JSON over stdin/stdout:
//   in:  {"id":1,"cmd":"elementFromPoint","x":100,"y":200}
//   out: {"id":1,"ok":true,"result":{...}}  or  {"id":1,"ok":false,"error":"..."}
// Built with the C# compiler that ships with the .NET Framework (C# 5), so no SDK is needed.
// Per-monitor DPI aware: every coordinate is in physical screen pixels.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

namespace Trailmark
{
    internal static class Native
    {
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
        [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT rect, int size);
        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
        [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
        [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint x, out uint y);
        [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT p, uint flags);
        [DllImport("user32.dll")] public static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr mod, uint thread);
        [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hook);
        [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] public static extern short GetKeyState(int vk);
        [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll")] public static extern bool PostThreadMessage(uint thread, uint msg, IntPtr w, IntPtr l);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        public delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
        public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
        public delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
        [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc proc, uint pid, uint thread, uint flags);
        [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hook);

        [StructLayout(LayoutKind.Sequential)] public struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData; public uint flags; public uint time; public IntPtr extra; }
        [StructLayout(LayoutKind.Sequential)] public struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr extra; }

        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT { public uint type; public INPUTUNION u; }

        [StructLayout(LayoutKind.Explicit)]
        public struct INPUTUNION
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    }

    internal static class Program
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        static StreamWriter output;
        static readonly object OutLock = new object();

        internal static void Write(object message)
        {
            var line = Json.Serialize(message);
            lock (OutLock) output.WriteLine(line);
        }

        [MTAThread]
        static int Main()
        {
            // Physical pixels everywhere, on every monitor.
            if (!Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) Native.SetProcessDPIAware();
            Console.InputEncoding = new UTF8Encoding(false);
            output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            output.AutoFlush = true;
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (line.Trim().Length == 0) continue;
                object id = null;
                var reply = new Dictionary<string, object>();
                try
                {
                    var req = Json.Deserialize<Dictionary<string, object>>(line);
                    req.TryGetValue("id", out id);
                    reply["result"] = Handle(req);
                    reply["ok"] = true;
                }
                catch (Exception e)
                {
                    reply["ok"] = false;
                    reply["error"] = e.Message;
                }
                reply["id"] = id;
                Write(reply);
            }
            Recorder.Stop();
            return 0;
        }

        static int Int(Dictionary<string, object> req, string key)
        {
            return Convert.ToInt32(req[key]);
        }

        static string Str(IDictionary req, string key)
        {
            return req != null && req.Contains(key) && req[key] != null ? Convert.ToString(req[key]) : null;
        }

        static object Handle(Dictionary<string, object> req)
        {
            var cmd = Str(req, "cmd");
            switch (cmd)
            {
                case "ping":
                    return new Dictionary<string, object> { { "version", 1 } };
                case "elementFromPoint":
                    {
                        var el = AutomationElement.FromPoint(new System.Windows.Point(Int(req, "x"), Int(req, "y")));
                        return Describe(el);
                    }
                case "focused":
                    {
                        var el = AutomationElement.FocusedElement;
                        var info = Describe(el);
                        if (!(bool)info["isPassword"]) info["value"] = ValueOf(el);
                        return info;
                    }
                case "windowAt":
                    return WindowAt(Int(req, "x"), Int(req, "y"));
                case "find":
                    return Find(req["query"] as IDictionary);
                case "screenshot":
                    return Screenshot(Int(req, "x"), Int(req, "y"), Str(req, "path"));
                case "input":
                    SendActions(req["actions"] as ArrayList, Str(req, "requireForeground"), Str(req, "requireTitle"));
                    return true;
                case "foreground":
                    return ForegroundInfo();
                case "activate":
                    return Activate(Str(req, "processName"), Str(req, "windowTitle"));
                case "hook":
                    if (Convert.ToBoolean(req["on"])) Recorder.Start(Str(req, "dir"), req.ContainsKey("ignorePids") ? req["ignorePids"] as ArrayList : null);
                    else Recorder.Stop();
                    return true;
                default:
                    throw new ArgumentException("unknown command: " + cmd);
            }
        }

        // ---------- Elements ----------

        static string ControlTypeName(AutomationElement el)
        {
            var name = el.Current.ControlType.ProgrammaticName ?? "";
            return name.StartsWith("ControlType.") ? name.Substring(12) : name;
        }

        static string ValueOf(AutomationElement el)
        {
            object pattern;
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
                return ((ValuePattern)pattern).Current.Value;
            if (el.TryGetCurrentPattern(TextPattern.Pattern, out pattern))
            {
                var text = ((TextPattern)pattern).DocumentRange.GetText(10000);
                return text;
            }
            return null;
        }

        static AutomationElement TopWindow(AutomationElement el)
        {
            var walker = TreeWalker.ControlViewWalker;
            var root = AutomationElement.RootElement;
            AutomationElement top = el;
            var node = el;
            while (node != null && !Automation.Compare(node, root))
            {
                top = node;
                node = walker.GetParent(node);
            }
            return top;
        }

        static List<object> PathOf(AutomationElement el)
        {
            var parts = new List<object>();
            var walker = TreeWalker.ControlViewWalker;
            var root = AutomationElement.RootElement;
            var node = el;
            while (node != null && !Automation.Compare(node, root) && parts.Count < 30)
            {
                var c = node.Current;
                parts.Insert(0, ControlTypeName(node) + "|" + (c.AutomationId ?? "") + "|" + (c.Name ?? ""));
                node = walker.GetParent(node);
            }
            return parts;
        }

        internal static string ProcessName(int pid)
        {
            try { return Process.GetProcessById(pid).ProcessName; } catch { return ""; }
        }

        static Dictionary<string, object> Rect(System.Windows.Rect r)
        {
            if (r.IsEmpty) return new Dictionary<string, object> { { "x", 0 }, { "y", 0 }, { "w", 0 }, { "h", 0 } };
            return new Dictionary<string, object> {
                { "x", (int)Math.Round(r.X) }, { "y", (int)Math.Round(r.Y) },
                { "w", (int)Math.Round(r.Width) }, { "h", (int)Math.Round(r.Height) } };
        }

        internal static Dictionary<string, object> Describe(AutomationElement el)
        {
            if (el == null) throw new InvalidOperationException("no element");
            var c = el.Current;
            var top = TopWindow(el);
            return new Dictionary<string, object> {
                { "name", c.Name ?? "" },
                { "controlType", ControlTypeName(el) },
                { "automationId", c.AutomationId ?? "" },
                { "className", c.ClassName ?? "" },
                { "helpText", c.HelpText ?? "" },
                { "rect", Rect(c.BoundingRectangle) },
                { "isPassword", c.IsPassword },
                { "isEnabled", c.IsEnabled },
                { "pid", c.ProcessId },
                { "processName", ProcessName(c.ProcessId) },
                { "windowTitle", top.Current.Name ?? "" },
                { "path", PathOf(el) },
            };
        }

        internal static Dictionary<string, object> WindowAt(int x, int y)
        {
            var p = new Native.POINT { X = x, Y = y };
            var hwnd = Native.GetAncestor(Native.WindowFromPoint(p), 2 /* GA_ROOT */);
            var title = new StringBuilder(512);
            Native.GetWindowText(hwnd, title, title.Capacity);
            uint pid;
            Native.GetWindowThreadProcessId(hwnd, out pid);
            return new Dictionary<string, object> {
                { "windowTitle", title.ToString() }, { "pid", (int)pid }, { "processName", ProcessName((int)pid) } };
        }

        /** Windows of a process (by name) or with a title, searched for an element. */
        static object Find(IDictionary q)
        {
            var processName = Str(q, "processName");
            var windowTitle = Str(q, "windowTitle");
            var automationId = Str(q, "automationId");
            var name = Str(q, "name");
            var controlType = Str(q, "controlType");
            var matches = new List<object>();
            var windows = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement w in windows)
            {
                AutomationElement.AutomationElementInformation wc;
                try { wc = w.Current; } catch { continue; }
                if (processName != null && !string.Equals(ProcessName(wc.ProcessId), processName, StringComparison.OrdinalIgnoreCase)) continue;
                if (windowTitle != null && (wc.Name ?? "").IndexOf(windowTitle, StringComparison.OrdinalIgnoreCase) < 0) continue;
                var conds = new List<Condition>();
                if (!string.IsNullOrEmpty(automationId)) conds.Add(new PropertyCondition(AutomationElement.AutomationIdProperty, automationId));
                if (!string.IsNullOrEmpty(name)) conds.Add(new PropertyCondition(AutomationElement.NameProperty, name));
                Condition cond = conds.Count == 0 ? Condition.TrueCondition : conds.Count == 1 ? conds[0] : new AndCondition(conds.ToArray());
                AutomationElementCollection found;
                try { found = w.FindAll(TreeScope.Subtree, cond); } catch { continue; }
                foreach (AutomationElement el in found)
                {
                    if (matches.Count >= 20) break;
                    try
                    {
                        if (controlType != null && !string.Equals(ControlTypeName(el), controlType, StringComparison.OrdinalIgnoreCase)) continue;
                        if (el.Current.IsOffscreen) continue;
                        matches.Add(Describe(el));
                    }
                    catch { }
                }
            }
            return new Dictionary<string, object> { { "matches", matches } };
        }

        // ---------- Screenshots ----------

        static object Screenshot(int x, int y, string path)
        {
            var screen = Screen.FromPoint(new Point(x, y));
            var b = screen.Bounds;
            using (var bmp = new Bitmap(b.Width, b.Height, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(bmp))
                    g.CopyFromScreen(b.X, b.Y, 0, 0, b.Size, CopyPixelOperation.SourceCopy);
                bmp.Save(path, ImageFormat.Png);
            }
            uint dx = 96, dy = 96;
            try
            {
                var mon = Native.MonitorFromPoint(new Native.POINT { X = x, Y = y }, 2);
                Native.GetDpiForMonitor(mon, 0, out dx, out dy);
            }
            catch { }
            return new Dictionary<string, object> {
                { "path", path },
                { "monitor", new Dictionary<string, object> { { "x", b.X }, { "y", b.Y }, { "w", b.Width }, { "h", b.Height } } },
                { "scale", dx / 96.0 } };
        }

        // ---------- Input (tests and desktop playback) ----------

        static Dictionary<string, object> ForegroundInfo()
        {
            var hwnd = Native.GetForegroundWindow();
            uint pid;
            Native.GetWindowThreadProcessId(hwnd, out pid);
            var title = new StringBuilder(512);
            Native.GetWindowText(hwnd, title, title.Capacity);
            return new Dictionary<string, object> {
                { "processName", ProcessName((int)pid) }, { "pid", (int)pid }, { "windowTitle", title.ToString() } };
        }

        /**
         * Synthetic input (tests and desktop playback). With requireForeground set, every action
         * first checks that this app is in front, so input never lands in someone else's window.
         */
        static void SendActions(ArrayList actions, string requireForeground, string requireTitle)
        {
            foreach (IDictionary a in actions)
            {
                if (requireForeground != null && Str(a, "type") != "wait")
                {
                    var front = ForegroundInfo();
                    var fg = (string)front["processName"];
                    if (!string.Equals(fg, requireForeground, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("input refused: " + fg + " is in front, not " + requireForeground);
                    if (requireTitle != null && ((string)front["windowTitle"]).IndexOf(requireTitle, StringComparison.OrdinalIgnoreCase) < 0)
                        throw new InvalidOperationException("input refused: another " + fg + " window is in front");
                }
                var type = Str(a, "type");
                if (requireForeground != null && (type == "click" || type == "down"))
                {
                    // The window under the pointer must belong to the app too (always-on-top
                    // windows of other apps can cover it).
                    Native.POINT at;
                    Native.GetCursorPos(out at);
                    var under = (string)WindowAt(at.X, at.Y)["processName"];
                    if (!string.Equals(under, requireForeground, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("input refused: the pointer is over " + under + ", not " + requireForeground);
                }
                if (type == "move") Native.SetCursorPos(Convert.ToInt32(a["x"]), Convert.ToInt32(a["y"]));
                else if (type == "down") Mouse(0x0002);
                else if (type == "up") Mouse(0x0004);
                else if (type == "click") { Mouse(0x0002); Mouse(0x0004); }
                else if (type == "text") Text(Str(a, "text"));
                else if (type == "key") Key((ushort)Convert.ToInt32(a["vk"]));
                else if (type == "wait") System.Threading.Thread.Sleep(Convert.ToInt32(a["ms"]));
            }
        }

        static void Send(Native.INPUT input)
        {
            Native.SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Native.INPUT)));
        }

        static void Mouse(uint flags)
        {
            Send(new Native.INPUT { type = 0, u = new Native.INPUTUNION { mi = new Native.MOUSEINPUT { dwFlags = flags } } });
            System.Threading.Thread.Sleep(15);
        }

        static void Key(ushort vk)
        {
            Send(new Native.INPUT { type = 1, u = new Native.INPUTUNION { ki = new Native.KEYBDINPUT { wVk = vk } } });
            Send(new Native.INPUT { type = 1, u = new Native.INPUTUNION { ki = new Native.KEYBDINPUT { wVk = vk, dwFlags = 2 } } });
            System.Threading.Thread.Sleep(15);
        }

        static void Text(string text)
        {
            foreach (var ch in text ?? "")
            {
                Send(new Native.INPUT { type = 1, u = new Native.INPUTUNION { ki = new Native.KEYBDINPUT { wScan = ch, dwFlags = 4 } } });
                Send(new Native.INPUT { type = 1, u = new Native.INPUTUNION { ki = new Native.KEYBDINPUT { wScan = ch, dwFlags = 4 | 2 } } });
                System.Threading.Thread.Sleep(5);
            }
        }

        /** Visible top-level windows of an app (every window, not just its "main" one). */
        static List<IntPtr> TopWindows(string processName, string windowTitle)
        {
            var pids = new HashSet<int>();
            foreach (var p in Process.GetProcessesByName(processName ?? "")) pids.Add(p.Id);
            var found = new List<IntPtr>();
            Native.EnumWindows((hwnd, _) =>
            {
                uint pid;
                Native.GetWindowThreadProcessId(hwnd, out pid);
                if (!pids.Contains((int)pid) || !Native.IsWindowVisible(hwnd)) return true;
                if (Native.GetWindow(hwnd, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
                var title = new StringBuilder(512);
                Native.GetWindowText(hwnd, title, title.Capacity);
                if (title.Length == 0) return true;
                if (windowTitle != null && title.ToString().IndexOf(windowTitle, StringComparison.OrdinalIgnoreCase) < 0) return true;
                found.Add(hwnd);
                return true;
            }, IntPtr.Zero);
            return found;
        }

        static object Activate(string processName, string windowTitle)
        {
            foreach (var hwnd in TopWindows(processName, windowTitle))
            {
                if (Native.IsIconic(hwnd)) Native.ShowWindow(hwnd, 9 /* SW_RESTORE */);
                // Windows only lets the foreground thread hand over focus: borrow its input
                // state for the switch.
                uint ignored;
                var fgThread = Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out ignored);
                var me = Native.GetCurrentThreadId();
                // A zero-distance relative mouse move makes this process the last to send input,
                // which Windows requires before it lets a background process change the
                // foreground window. It moves nothing and clicks nothing.
                Mouse(0x0001 /* MOUSEEVENTF_MOVE */);
                var attached = fgThread != me && Native.AttachThreadInput(me, fgThread, true);
                Native.BringWindowToTop(hwnd);
                var ok = Native.SetForegroundWindow(hwnd);
                if (attached) Native.AttachThreadInput(me, fgThread, false);
                for (var i = 0; i < 20 && Native.GetForegroundWindow() != hwnd; i++) System.Threading.Thread.Sleep(50);
                return ok && Native.GetForegroundWindow() == hwnd;
            }
            return false;
        }
    }
    /**
     * Capture hooks (only while a capture runs). A low-level mouse hook holds each button press
     * just long enough to copy the screen, so the picture shows the screen before the click
     * lands; the element under the pointer is looked up on another thread. The keyboard hook
     * reports Enter, Tab, Esc, function keys and shortcuts by name, and only "a character was
     * typed" for everything else: keystrokes are never logged.
     */
    internal static class Recorder
    {
        static Thread hookThread;
        static uint hookThreadId;
        static IntPtr mouseHook, keyHook;
        static Native.HookProc mouseProc, keyProc; // kept alive while hooked
        static Native.WinEventProc foregroundProc;
        static IntPtr foregroundHook;
        static string dir;
        static HashSet<int> ignore = new HashSet<int>();
        static int seq;
        static readonly System.Collections.Concurrent.BlockingCollection<Action> work =
            new System.Collections.Concurrent.BlockingCollection<Action>();
        static Thread worker;

        public static void Start(string folder, ArrayList ignorePids)
        {
            Stop();
            dir = folder ?? Path.GetTempPath();
            Directory.CreateDirectory(dir);
            ignore = new HashSet<int>();
            if (ignorePids != null) foreach (var p in ignorePids) ignore.Add(Convert.ToInt32(p));
            if (worker == null)
            {
                worker = new Thread(() => { foreach (var job in work.GetConsumingEnumerable()) { try { job(); } catch { } } });
                worker.IsBackground = true;
                worker.SetApartmentState(ApartmentState.MTA);
                worker.Start();
            }
            var ready = new ManualResetEvent(false);
            hookThread = new Thread(() =>
            {
                hookThreadId = Native.GetCurrentThreadId();
                mouseProc = OnMouse;
                keyProc = OnKey;
                var mod = Native.GetModuleHandle(null);
                mouseHook = Native.SetWindowsHookEx(14 /* WH_MOUSE_LL */, mouseProc, mod, 0);
                keyHook = Native.SetWindowsHookEx(13 /* WH_KEYBOARD_LL */, keyProc, mod, 0);
                foregroundProc = OnForeground;
                foregroundHook = Native.SetWinEventHook(3, 3 /* EVENT_SYSTEM_FOREGROUND */, IntPtr.Zero, foregroundProc, 0, 0, 0 /* OUTOFCONTEXT */);
                ready.Set();
                Application.Run(); // message loop for the hooks
                Native.UnhookWinEvent(foregroundHook);
                Native.UnhookWindowsHookEx(mouseHook);
                Native.UnhookWindowsHookEx(keyHook);
            });
            hookThread.IsBackground = true;
            hookThread.SetApartmentState(ApartmentState.STA);
            hookThread.Start();
            ready.WaitOne(2000);
        }

        public static void Stop()
        {
            if (hookThread == null) return;
            Native.PostThreadMessage(hookThreadId, 0x0012 /* WM_QUIT */, IntPtr.Zero, IntPtr.Zero);
            hookThread.Join(2000);
            hookThread = null;
        }

        static IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0)
            {
                var msg = wParam.ToInt32();
                string button = msg == 0x0201 ? "left" : msg == 0x0204 ? "right" : null;
                if (button != null)
                {
                    var info = (Native.MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.MSLLHOOKSTRUCT));
                    var x = info.pt.X;
                    var y = info.pt.Y;
                    var window = Program.WindowAt(x, y);
                    if (!ignore.Contains((int)window["pid"]))
                    {
                        // Copy the clicked app's window now, before the press reaches the app;
                        // encode later. Other apps on screen stay out of the guide.
                        var b = CaptureBounds(x, y);
                        var bmp = new Bitmap(b.Width, b.Height, PixelFormat.Format32bppArgb);
                        using (var g = Graphics.FromImage(bmp))
                            g.CopyFromScreen(b.X, b.Y, 0, 0, b.Size, CopyPixelOperation.SourceCopy);
                        var n = Interlocked.Increment(ref seq);
                        var at = DateTime.UtcNow.ToString("o");
                        work.Add(() => Report(n, button, x, y, b, bmp, window, at));
                    }
                }
            }
            return Native.CallNextHookEx(mouseHook, code, wParam, lParam);
        }

        /** Visible bounds of a window, without the invisible resize borders. */
        static Rectangle WindowBounds(IntPtr hwnd)
        {
            Native.RECT r;
            if (Native.DwmGetWindowAttribute(hwnd, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, out r, Marshal.SizeOf(typeof(Native.RECT))) != 0)
                Native.GetWindowRect(hwnd, out r);
            return Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
        }

        /**
         * What a click's screenshot shows: the window clicked plus its owner (so a menu or dialog
         * keeps its app around it), clipped to that monitor. Maximised windows fill the monitor.
         */
        internal static Rectangle CaptureBounds(int x, int y)
        {
            var screen = Screen.FromPoint(new Point(x, y)).Bounds;
            var root = Native.GetAncestor(Native.WindowFromPoint(new Native.POINT { X = x, Y = y }), 2 /* GA_ROOT */);
            if (root == IntPtr.Zero) return screen;
            var owner = Native.GetAncestor(root, 3 /* GA_ROOTOWNER */);
            if (Native.IsZoomed(root) || (owner != IntPtr.Zero && Native.IsZoomed(owner))) return screen;
            var b = WindowBounds(root);
            if (owner != IntPtr.Zero && owner != root) b = Rectangle.Union(b, WindowBounds(owner));
            b.Intersect(screen);
            return b.Width < 40 || b.Height < 40 ? screen : b;
        }

        /** Another app came to the front (switching apps ends typing in the previous one). */
        static void OnForeground(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
        {
            uint pid;
            Native.GetWindowThreadProcessId(hwnd, out pid);
            var at = DateTime.UtcNow.ToString("o");
            work.Add(() => Program.Write(new Dictionary<string, object> {
                { "event", "foreground" }, { "pid", (int)pid }, { "processName", Program.ProcessName((int)pid) }, { "at", at } }));
        }

        static void Report(int n, string button, int x, int y, Rectangle b, Bitmap bmp, Dictionary<string, object> window, string at)
        {
            var path = Path.Combine(dir, "shot-" + n + ".png");
            using (bmp) bmp.Save(path, ImageFormat.Png);
            uint dx = 96, dy = 96;
            try
            {
                var mon = Native.MonitorFromPoint(new Native.POINT { X = x, Y = y }, 2);
                Native.GetDpiForMonitor(mon, 0, out dx, out dy);
            }
            catch { }
            object element = null;
            try { element = Program.Describe(AutomationElement.FromPoint(new System.Windows.Point(x, y))); } catch { }
            Program.Write(new Dictionary<string, object> {
                { "event", "mouse" }, { "button", button }, { "x", x }, { "y", y }, { "at", at },
                { "shot", path },
                { "monitor", new Dictionary<string, object> { { "x", b.X }, { "y", b.Y }, { "w", b.Width }, { "h", b.Height } } },
                { "scale", dx / 96.0 }, { "window", window }, { "element", element } });
        }

        static readonly Dictionary<uint, string> Named = new Dictionary<uint, string> {
            { 0x0D, "Enter" }, { 0x09, "Tab" }, { 0x1B, "Esc" }, { 0x2E, "Delete" },
            { 0x26, "Up" }, { 0x28, "Down" }, { 0x25, "Left" }, { 0x27, "Right" },
            { 0x21, "PageUp" }, { 0x22, "PageDown" }, { 0x24, "Home" }, { 0x23, "End" } };

        static IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam)
        {
            var msg = wParam.ToInt32();
            if (code >= 0 && (msg == 0x0100 || msg == 0x0104))
            {
                var k = (Native.KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.KBDLLHOOKSTRUCT));
                var vk = k.vkCode;
                var ctrl = (Native.GetKeyState(0x11) & 0x8000) != 0;
                var alt = (Native.GetKeyState(0x12) & 0x8000) != 0 || msg == 0x0104;
                var shift = (Native.GetKeyState(0x10) & 0x8000) != 0;
                bool modifier = vk == 0x10 || vk == 0x11 || vk == 0x12 || (vk >= 0xA0 && vk <= 0xA5) || vk == 0x5B || vk == 0x5C;
                if (!modifier)
                {
                    string name = null;
                    if (Named.ContainsKey(vk)) name = Named[vk];
                    else if (vk >= 0x70 && vk <= 0x87) name = "F" + (vk - 0x6F);
                    if ((ctrl || alt) && name == null && ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5A)))
                        name = ((char)vk).ToString();
                    if (name != null)
                    {
                        var parts = new List<string>();
                        if (ctrl) parts.Add("Ctrl");
                        if (alt) parts.Add("Alt");
                        if (shift && (ctrl || alt)) parts.Add("Shift");
                        parts.Add(name);
                        var key = string.Join("+", parts.ToArray());
                        var at = DateTime.UtcNow.ToString("o");
                        work.Add(() => Program.Write(new Dictionary<string, object> { { "event", "key" }, { "key", key }, { "at", at } }));
                    }
                    else
                    {
                        work.Add(() => Program.Write(new Dictionary<string, object> { { "event", "typing" } }));
                    }
                }
            }
            return Native.CallNextHookEx(keyHook, code, wParam, lParam);
        }
    }
}
