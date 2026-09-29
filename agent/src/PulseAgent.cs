// Pulse Attendance — Windows desktop agent.
// Runs in the system tray and reports Windows logon, lock/unlock, sleep/resume and shutdown to the
// attendance server, which turns them into check-ins and check-outs. Built with the C# compiler that
// ships with .NET Framework 4.x, so it needs nothing installed on office PCs.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Pulse Attendance Agent")]
[assembly: System.Reflection.AssemblyProduct("Pulse Attendance")]
[assembly: System.Reflection.AssemblyVersion("1.1.0.0")]

namespace PulseAgent
{
    internal static class Program
    {
        public const string Version = "1.1.0";
        public const string Server = "https://pulse-attendance.onrender.com";
        private static string UserKey { get { return System.Security.Principal.WindowsIdentity.GetCurrent().User.Value; } }
        private static string StopName { get { return "Local\\PulseAttendanceStop-" + UserKey; } }
        private static bool Install()
        {
            string target = Path.Combine(Config.Dir, "PulseAgent.exe");
            if (string.Equals(Application.ExecutablePath, target, StringComparison.OrdinalIgnoreCase)) return false;
            Directory.CreateDirectory(Config.Dir);
            try
            {
                if (File.Exists(target))
                {
                    var existing = new Version(FileVersionInfo.GetVersionInfo(target).FileVersion);
                    if (existing > new Version(Version)) throw new Exception("A newer version is already installed.");
                }
                try { using (var stop = EventWaitHandle.OpenExisting(StopName)) stop.Set(); } catch (WaitHandleCannotBeOpenedException) { }
                for (int i = 0; ; i++)
                {
                    try { File.Copy(Application.ExecutablePath, target, true); break; }
                    catch (IOException) { if (i >= 30) throw; Thread.Sleep(500); }
                }
                Process.Start(target);
            }
            catch (Exception ex) { MessageBox.Show("Could not install Pulse Attendance. Close the old app and try again.\n" + ex.Message); }
            return true;
        }

        [STAThread]
        private static void Main(string[] args)
        {
            try {
                using (var legacy = Mutex.OpenExisting("Global\\PulseAttendanceAgent")) {
                    MessageBox.Show("An older Pulse Attendance app is running. Right-click its tray icon, choose Exit, then open this installer again.");
                    return;
                }
            } catch (WaitHandleCannotBeOpenedException) { }
            if (Install()) return;
            bool created;
            using (var mutex = new Mutex(true, "Local\\PulseAttendanceAgent-" + UserKey, out created))
            {
                if (!created) return; // already running for this Windows user
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (var stop = new EventWaitHandle(false, EventResetMode.AutoReset, StopName))
                {
                    var context = new AgentContext();
                    var watcher = new System.Windows.Forms.Timer { Interval = 500 };
                    watcher.Tick += delegate { if (stop.WaitOne(0)) { watcher.Stop(); Application.Exit(); } };
                    watcher.Start();
                    Application.Run(context);
                    watcher.Dispose();
                }
            }
        }
    }

    // ───────────────────────────── Config & queue storage ─────────────────────────────

    internal class Config
    {
        public string Server;
        public string ProtectedToken; // DPAPI, current Windows user only
        public string Employee;
        public bool AutoStart = true;

        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        public static string Dir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PulseAgent"); }
        }
        private static string FilePath { get { return Path.Combine(Dir, "config.json"); } }

        public static Config Load()
        {
            try
            {
                if (File.Exists(FilePath))
                {
                    var text = File.ReadAllText(FilePath);
                    var raw = Json.Deserialize<Dictionary<string, object>>(text);
                    var c = new Config
                    {
                        Server = raw.ContainsKey("Server") ? Convert.ToString(raw["Server"]) : null,
                        ProtectedToken = raw.ContainsKey("ProtectedToken") ? Convert.ToString(raw["ProtectedToken"]) : null,
                        Employee = raw.ContainsKey("Employee") ? Convert.ToString(raw["Employee"]) : null,
                        AutoStart = !raw.ContainsKey("AutoStart") || Convert.ToBoolean(raw["AutoStart"])
                    };
                    // Older builds also wrote the token in plain text — rewrite the file without it.
                    if (raw.ContainsKey("Token") || raw.ContainsKey("Paired")) c.Save();
                    return c;
                }
            }
            catch { }
            return new Config();
        }

        public void Save()
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(FilePath, Json.Serialize(this));
        }

        [ScriptIgnore] // never written to disk in plain text; only ProtectedToken is saved
        public string Token
        {
            get
            {
                if (string.IsNullOrEmpty(ProtectedToken)) return null;
                try
                {
                    var raw = ProtectedData.Unprotect(Convert.FromBase64String(ProtectedToken), null, DataProtectionScope.CurrentUser);
                    return Encoding.UTF8.GetString(raw);
                }
                catch { return null; }
            }
            set
            {
                ProtectedToken = value == null ? null : Convert.ToBase64String(
                    ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser));
            }
        }

        [ScriptIgnore]
        public bool Paired { get { return !string.IsNullOrEmpty(Server) && Token != null; } }
    }

    internal class QueuedEvent
    {
        public string Id;
        public string Type;      // IN | OUT
        public string Reason;
        public long Utc;         // DateTime.UtcNow.Ticks when it happened (used only after a restart)
        public long Mono;        // monotonic ms in this process (clock changes cannot affect it)
        public string Session;   // process session id, tells whether Mono is still valid
    }

    internal static class EventQueue
    {
        private static readonly object Gate = new object();
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static List<QueuedEvent> _items;
        private static string FilePath { get { return Path.Combine(Config.Dir, "queue.json"); } }

        public static List<QueuedEvent> Items
        {
            get
            {
                lock (Gate)
                {
                    if (_items == null)
                    {
                        try { _items = File.Exists(FilePath) ? Json.Deserialize<List<QueuedEvent>>(File.ReadAllText(FilePath)) : null; }
                        catch { _items = null; }
                        if (_items == null) _items = new List<QueuedEvent>();
                        bool migrated = false;
                        foreach (var item in _items) if (string.IsNullOrEmpty(item.Id)) { item.Id = Guid.NewGuid().ToString("N"); migrated = true; }
                        if (migrated) Persist();
                    }
                    return _items;
                }
            }
        }

        public static void Add(QueuedEvent e)
        {
            lock (Gate) { if (string.IsNullOrEmpty(e.Id)) e.Id = Guid.NewGuid().ToString("N"); Items.Add(e); Persist(); }
        }

        public static List<QueuedEvent> Snapshot()
        {
            lock (Gate) { return new List<QueuedEvent>(Items); }
        }

        public static void Remove(int count)
        {
            lock (Gate) { Items.RemoveRange(0, Math.Min(count, Items.Count)); Persist(); }
        }

        public static void Clear()
        {
            lock (Gate) { Items.Clear(); Persist(); }
        }

        private static void Persist()
        {
            try {
                Directory.CreateDirectory(Config.Dir);
                string temp = FilePath + ".tmp";
                File.WriteAllText(temp, Json.Serialize(_items));
                if (File.Exists(FilePath)) File.Replace(temp, FilePath, null); else File.Move(temp, FilePath);
            } catch { }
        }
    }

    // ───────────────────────────── HTTP API ─────────────────────────────

    internal class ApiException : Exception
    {
        public int Status;
        public ApiException(int status, string message) : base(message) { Status = status; }
    }

    internal static class Api
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        public static Dictionary<string, object> Send(string server, string path, string token, object body, int timeoutMs)
        {
            var req = (HttpWebRequest)WebRequest.Create(server.TrimEnd('/') + path);
            req.Method = body == null ? "GET" : "POST";
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            req.UserAgent = "PulseAgent/" + Program.Version;
            if (token != null) req.Headers["Authorization"] = "Bearer " + token;
            if (body != null)
            {
                var bytes = Encoding.UTF8.GetBytes(Json.Serialize(body));
                req.ContentType = "application/json";
                req.ContentLength = bytes.Length;
                using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            }
            try
            {
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var r = new StreamReader(resp.GetResponseStream()))
                {
                    string text = r.ReadToEnd();
                    try { return Json.Deserialize<Dictionary<string, object>>(text); }
                    catch { throw new ApiException(0, "That address is not a Pulse Attendance server. Use only the address, e.g. http://192.168.1.10:3300"); }
                }
            }
            catch (WebException ex)
            {
                var resp = ex.Response as HttpWebResponse;
                if (resp == null) throw new ApiException(0, "Cannot reach the server. Check the address and that the server PC is on. (" + ex.Message + ")");
                if (resp.StatusCode == HttpStatusCode.NotFound) throw new ApiException(404, "That address is not a Pulse Attendance server. Use only the address, e.g. http://192.168.1.10:3300");
                string msg = "HTTP " + (int)resp.StatusCode;
                try
                {
                    using (var r = new StreamReader(resp.GetResponseStream()))
                    {
                        var d = Json.Deserialize<Dictionary<string, object>>(r.ReadToEnd());
                        if (d != null && d.ContainsKey("error")) msg = Convert.ToString(d["error"]);
                    }
                }
                catch { }
                throw new ApiException((int)resp.StatusCode, msg);
            }
        }
    }

    // ───────────────────────────── Tray application ─────────────────────────────

    internal class AgentContext : ApplicationContext
    {
        private static readonly string ProcessSession = Guid.NewGuid().ToString("N");
        private static readonly Stopwatch Mono = Stopwatch.StartNew();

        private readonly Config _config = Config.Load();
        private readonly NotifyIcon _tray;
        private readonly ToolStripMenuItem _statusItem;
        private readonly ToolStripMenuItem _employeeItem;
        private readonly System.Windows.Forms.Timer _timer;
        private readonly object _sendGate = new object();

        private long _lockedAtMono = -1;
        private long _lastTickMono;   // detects sleep/hibernate: the timer cannot fire while the PC sleeps
        private long _maxGapMs;       // longest gap between ticks since the last successful sync
        private long _serverOffsetMs; // serverNow - local UTC now
        private long _breakStart, _breakEnd;
        private string _breakNotifiedFor = "";
        private string _breakEndNotifiedFor = "";
        private bool _authFailedShown;

        public AgentContext()
        {
            _statusItem = new ToolStripMenuItem("Starting…") { Enabled = false };
            _employeeItem = new ToolStripMenuItem("") { Enabled = false };
            var menu = new ContextMenuStrip();
            menu.Items.Add(_employeeItem);
            menu.Items.Add(_statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Open dashboard", null, delegate { OpenDashboard(); });
            menu.Items.Add("Check for updates (v" + Program.Version + ")", null, delegate { CheckUpdate(); });
            menu.Items.Add("Sync now", null, delegate { ThreadPool.QueueUserWorkItem(delegate { Tick(true); }); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Sign out this PC…", null, delegate { Unpair(); });
            menu.Items.Add("Exit", null, delegate { ExitAgent(); });

            _tray = new NotifyIcon { Icon = MakeIcon(), Text = "Pulse Attendance", ContextMenuStrip = menu, Visible = true };
            _tray.DoubleClick += delegate { OpenDashboard(); };

            SystemEvents.SessionSwitch += OnSessionSwitch;
            SystemEvents.PowerModeChanged += OnPowerModeChanged;
            SystemEvents.SessionEnding += OnSessionEnding;

            _timer = new System.Windows.Forms.Timer { Interval = 60000 };
            _lastTickMono = Mono.ElapsedMilliseconds;
            _timer.Tick += delegate
            {
                long nowMono = Mono.ElapsedMilliseconds;
                long gap = nowMono - _lastTickMono;
                _lastTickMono = nowMono;
                if (gap > Interlocked.Read(ref _maxGapMs)) Interlocked.Exchange(ref _maxGapMs, gap);
                ThreadPool.QueueUserWorkItem(delegate { Tick(false); });
            };
            _timer.Start();

            // Internet came back → send everything recorded while offline right away.
            System.Net.NetworkInformation.NetworkChange.NetworkAvailabilityChanged += delegate(object s, System.Net.NetworkInformation.NetworkAvailabilityEventArgs a)
            {
                if (a.IsAvailable) ThreadPool.QueueUserWorkItem(delegate { Thread.Sleep(3000); Tick(true); });
            };

            if (!_config.Paired)
            {
                if (!ShowPairing()) { ExitThread(); return; }
            }
            ApplyAutoStart();
            Enqueue("IN", "logon");
            ThreadPool.QueueUserWorkItem(delegate { Tick(true); });
        }

        // ── Windows events ──

        private void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
        {
            switch (e.Reason)
            {
                case SessionSwitchReason.SessionLock:
                case SessionSwitchReason.ConsoleDisconnect:
                case SessionSwitchReason.RemoteDisconnect:
                    if (_lockedAtMono < 0) _lockedAtMono = Mono.ElapsedMilliseconds;
                    ThreadPool.QueueUserWorkItem(delegate { Tick(false); });
                    break;
                case SessionSwitchReason.SessionUnlock:
                case SessionSwitchReason.ConsoleConnect:
                case SessionSwitchReason.RemoteConnect:
                case SessionSwitchReason.SessionLogon:
                    _lockedAtMono = -1;
                    Enqueue("IN", "unlock"); // ignored by the server if the session is still open
                    ThreadPool.QueueUserWorkItem(delegate { Tick(true); });
                    break;
            }
        }

        private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
        {
            if (e.Mode == PowerModes.Suspend)
            {
                Enqueue("OUT", "sleep");
                Tick(true, 3000);
            }
            else if (e.Mode == PowerModes.Resume)
            {
                _lockedAtMono = -1;
                Interlocked.Exchange(ref _maxGapMs, long.MaxValue / 2); // never restore sessions across a sleep
                Enqueue("IN", "resume");
                // Network usually needs a few seconds after resume.
                ThreadPool.QueueUserWorkItem(delegate { Thread.Sleep(8000); Tick(true); });
            }
        }

        private void OnSessionEnding(object sender, SessionEndingEventArgs e)
        {
            Enqueue("OUT", e.Reason == SessionEndReasons.Logoff ? "logoff" : "shutdown");
            Tick(true, 4000); // best effort; if it fails the event stays queued and the server auto-closes
        }

        // ── Sync ──

        private void Enqueue(string type, string reason)
        {
            if (!_config.Paired) return;
            EventQueue.Add(new QueuedEvent
            {
                Type = type,
                Reason = reason,
                Utc = DateTime.UtcNow.Ticks,
                Mono = Mono.ElapsedMilliseconds,
                Session = ProcessSession
            });
        }

        private void Tick(bool force, int timeoutMs = 8000)
        {
            if (!_config.Paired) return;
            if (!Monitor.TryEnter(_sendGate, force ? timeoutMs : 0)) return;
            try
            {
                var pending = EventQueue.Snapshot();
                if (pending.Count > 199) pending = pending.GetRange(0, 199);
                var events = new List<Dictionary<string, object>>();
                long nowMono = Mono.ElapsedMilliseconds;
                foreach (var q in pending)
                {
                    bool sameProcess = q.Session == ProcessSession;
                    long age = sameProcess
                        ? nowMono - q.Mono
                        : (long)(DateTime.UtcNow - new DateTime(q.Utc, DateTimeKind.Utc)).TotalMilliseconds;
                    events.Add(new Dictionary<string, object>
                    {
                        { "id", q.Id }, { "type", q.Type }, { "reason", q.Reason }, { "ageMs", Math.Max(0, age) },
                        { "queued", !sameProcess || age > 120000 },
                        { "trusted", sameProcess }
                    });
                }
                bool locked = _lockedAtMono >= 0;
                long maxGap = Interlocked.Read(ref _maxGapMs);
                events.Add(new Dictionary<string, object>
                {
                    { "type", "HEARTBEAT" }, { "reason", "heartbeat" }, { "ageMs", 0 },
                    { "locked", locked }, { "lockedMs", locked ? nowMono - _lockedAtMono : 0 },
                    { "upMs", nowMono }, { "maxGapMs", maxGap }
                });

                var resp = Api.Send(_config.Server, "/api/agent/event", _config.Token,
                    new Dictionary<string, object> { { "events", events } }, timeoutMs);
                if (!resp.ContainsKey("accepted") || Convert.ToInt32(resp["accepted"]) != events.Count) throw new Exception("Attendance acknowledgement missing; retrying safely.");
                EventQueue.Remove(pending.Count);
                Interlocked.Exchange(ref _maxGapMs, 0);
                _authFailedShown = false;
                if (resp.ContainsKey("status")) UpdateStatus(resp["status"] as Dictionary<string, object>);
            }
            catch (ApiException ex)
            {
                if (ex.Status == 401)
                {
                    SetStatus("Not connected — PC was signed out by admin");
                    if (!_authFailedShown)
                    {
                        _authFailedShown = true;
                        Balloon("Pulse Attendance", "This PC is no longer linked. Right-click the tray icon → Sign out, then sign in again.", ToolTipIcon.Warning);
                    }
                }
                else SetStatus("Offline — will sync when connected (" + EventQueue.Snapshot().Count + " waiting)");
            }
            catch (Exception ex)
            {
                SetStatus("Error: " + ex.Message);
            }
            finally
            {
                Monitor.Exit(_sendGate);
            }
        }

        private void UpdateStatus(Dictionary<string, object> s)
        {
            if (s == null) return;
            long serverNow = Convert.ToInt64(s["serverNow"]);
            _serverOffsetMs = serverNow - (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
            _breakStart = s["breakStart"] == null ? 0 : Convert.ToInt64(s["breakStart"]);
            _breakEnd = s["breakEnd"] == null ? 0 : Convert.ToInt64(s["breakEnd"]);

            string status = Convert.ToString(s["status"]);
            int worked = Convert.ToInt32(s["workedMin"]);
            string label;
            switch (status)
            {
                case "WORKING": label = "Checked in"; break;
                case "ON_BREAK": label = "On break"; break;
                case "NOT_STARTED": label = "Not checked in"; break;
                default: label = status.Replace('_', ' ').ToLowerInvariant(); break;
            }
            string text = label + " · " + (worked / 60) + "h " + (worked % 60) + "m";
            if (Convert.ToBoolean(s["late"])) text += " · late " + Convert.ToInt32(s["lateMin"]) + "m";
            _config.Employee = Convert.ToString(s["employee"]);
            SetStatus(text);
            CheckBreakReminder(status);
        }

        private void CheckBreakReminder(string status)
        {
            if (_breakStart == 0) return;
            long now = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds + _serverOffsetMs;
            string day = DateTime.Now.ToString("yyyy-MM-dd");
            bool active = status == "WORKING" || status == "ON_BREAK";
            if (active && now >= _breakStart && now < _breakEnd && _breakNotifiedFor != day)
            {
                _breakNotifiedFor = day;
                Balloon("Break started", "Lunch break until " + LocalTime(_breakEnd) + ". It is deducted automatically.", ToolTipIcon.Info);
            }
            else if (active && now >= _breakEnd && now < _breakEnd + 10 * 60000 && _breakNotifiedFor == day && _breakEndNotifiedFor != day)
            {
                _breakEndNotifiedFor = day;
                Balloon("Break over", "Welcome back.", ToolTipIcon.Info);
            }
        }

        private string LocalTime(long serverMs)
        {
            var t = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(serverMs - _serverOffsetMs).ToLocalTime();
            return t.ToString("h:mm tt");
        }

        // ── UI helpers ──

        private void SetStatus(string text)
        {
            RunOnUi(delegate
            {
                _statusItem.Text = text;
                _employeeItem.Text = string.IsNullOrEmpty(_config.Employee) ? "Pulse Attendance" : _config.Employee;
                string tip = "Pulse · " + text;
                _tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
            });
        }

        private void Balloon(string title, string text, ToolTipIcon icon)
        {
            RunOnUi(delegate { _tray.ShowBalloonTip(8000, title, text, icon); });
        }

        private void RunOnUi(MethodInvoker action)
        {
            var strip = _tray.ContextMenuStrip;
            if (strip.IsHandleCreated && strip.InvokeRequired) strip.BeginInvoke(action);
            else action();
        }

        private void CheckUpdate()
        {
            ThreadPool.QueueUserWorkItem(delegate {
                try {
                    var release = Api.Send(Program.Server, "/api/agent/release", null, null, 60000);
                    if (new Version(Convert.ToString(release["windowsVersion"])) <= new Version(Program.Version)) {
                        Balloon("Pulse Attendance", "You have the latest version.", ToolTipIcon.Info); return;
                    }
                    RunOnUi(delegate {
                        if (MessageBox.Show("A new version is available. Download and install it now?", "Pulse Attendance", MessageBoxButtons.YesNo) != DialogResult.Yes) return;
                        ThreadPool.QueueUserWorkItem(delegate {
                            try {
                                string file = Path.Combine(Path.GetTempPath(), "PulseAgent-" + Guid.NewGuid().ToString("N") + ".exe");
                                using (var client = new WebClient()) client.DownloadFile(Program.Server + "/api/agent/download", file);
                                string digest;
                                using (var sha = SHA256.Create()) using (var stream = File.OpenRead(file)) digest = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                                if (digest != Convert.ToString(release["windowsSha256"])) { File.Delete(file); throw new Exception("Download verification failed. Please try again."); }
                                Process.Start(file);
                            } catch (Exception ex) { Balloon("Update failed", ex.Message, ToolTipIcon.Warning); }
                        });
                    });
                } catch (Exception ex) { Balloon("Update check failed", ex.Message, ToolTipIcon.Warning); }
            });
        }

        private void OpenDashboard()
        {
            if (string.IsNullOrEmpty(_config.Server)) return;
            try { Process.Start(_config.Server.TrimEnd('/') + "/dashboard"); } catch { }
        }

        private bool ShowPairing()
        {
            using (var f = new PairForm(_config.Server))
            {
                if (f.ShowDialog() != DialogResult.OK) return false;
                _config.Server = f.ServerUrl;
                _config.Token = f.Token;
                _config.Employee = f.Employee;
                _config.AutoStart = f.AutoStart;
                _config.Save();
                EventQueue.Clear();
                Balloon("Pulse Attendance", "This PC is linked to " + f.Employee + ". Attendance is now automatic.", ToolTipIcon.Info);
                return true;
            }
        }

        private void Unpair()
        {
            if (MessageBox.Show("Unlink this PC from " + (_config.Employee ?? "your account") + "?\nAttendance will no longer be recorded automatically.",
                "Pulse Attendance", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            try { Api.Send(_config.Server, "/api/agent/unpair", _config.Token, new Dictionary<string, object>(), 25000); }
            catch { MessageBox.Show("Connect to the internet and try again. This PC has not been unlinked yet."); return; }
            _config.Token = null;
            _config.Employee = null;
            _config.Save();
            EventQueue.Clear();
            SetStatus("Not linked");
            if (!ShowPairing()) ExitAgent();
            else { ApplyAutoStart(); Enqueue("IN", "logon"); ThreadPool.QueueUserWorkItem(delegate { Tick(true); }); }
        }

        private void ApplyAutoStart()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key == null) return;
                    if (_config.AutoStart) key.SetValue("PulseAttendanceAgent", "\"" + Application.ExecutablePath + "\"");
                    else key.DeleteValue("PulseAttendanceAgent", false);
                }
            }
            catch { }
        }

        private void ExitAgent()
        {
            // Exiting stops heartbeats; the server will close the session after the offline limit.
            _tray.Visible = false;
            SystemEvents.SessionSwitch -= OnSessionSwitch;
            SystemEvents.PowerModeChanged -= OnPowerModeChanged;
            SystemEvents.SessionEnding -= OnSessionEnding;
            ExitThread();
        }

        private static Icon MakeIcon()
        {
            using (var bmp = new Bitmap(32, 32))
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (var bg = new LinearGradientBrush(new Rectangle(0, 0, 32, 32), Color.FromArgb(124, 124, 255), Color.FromArgb(34, 211, 238), 45f))
                using (var path = RoundedRect(new Rectangle(0, 0, 31, 31), 8))
                    g.FillPath(bg, path);
                using (var pen = new Pen(Color.White, 3.2f) { LineJoin = LineJoin.Round, StartCap = LineCap.Round, EndCap = LineCap.Round })
                    g.DrawLines(pen, new[] { new PointF(4, 16), new PointF(10, 16), new PointF(13, 8), new PointF(19, 24), new PointF(22, 16), new PointF(28, 16) });
                return Icon.FromHandle(bmp.GetHicon());
            }
        }

        private static GraphicsPath RoundedRect(Rectangle r, int radius)
        {
            var p = new GraphicsPath();
            int d = radius * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }
    }

    // ───────────────────────────── Pairing window ─────────────────────────────

    internal class PairForm : Form
    {
        public string ServerUrl, Token, Employee;
        public bool AutoStart = true;
        private readonly Label _message = new Label { Location = new Point(24, 65), Size = new Size(390, 120) };
        private readonly Button _retry = new Button { Text = "Connect using browser", Location = new Point(24, 220), Size = new Size(230, 36) };
        private volatile bool _closed;
        public PairForm(string ignored)
        {
            Text = "Pulse Attendance - Connect this PC";
            ClientSize = new Size(445, 280);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Controls.Add(new Label { Text = "Connect your account", Font = new Font("Segoe UI", 16f), AutoSize = true, Location = new Point(24, 20) });
            _message.Text = "Your browser will open. If you are already signed in, just confirm your account - no password needed.";
            Controls.Add(_message); Controls.Add(_retry);
            _retry.Click += delegate { Pair(); };
            FormClosed += delegate { _closed = true; };
            Shown += delegate { Pair(); };
        }
        private void Ui(MethodInvoker action) { if (!_closed && IsHandleCreated) { try { BeginInvoke(action); } catch (InvalidOperationException) { } } }
        private void Pair()
        {
            _retry.Enabled = false;
            _message.Text = "Opening your browser...";
            ThreadPool.QueueUserWorkItem(delegate {
                try {
                    string secret;
                    using (var rng = RandomNumberGenerator.Create()) { byte[] bytes = new byte[32]; rng.GetBytes(bytes); secret = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
                    var request = Api.Send(Program.Server, "/api/agent/link", null, new Dictionary<string, object> {
                        { "secret", secret }, { "device", Environment.MachineName + " / " + Environment.UserName }, { "version", Program.Version }
                    }, 60000);
                    string code = Convert.ToString(request["code"]);
                    Ui(delegate { _message.Text = "In your browser, choose Continue as your name.\n\nMatching code: " + code.Substring(0, 8).ToUpperInvariant() + "\n\nWaiting for your approval (up to 5 minutes)..."; });
                    Process.Start(Program.Server + "/link-device?code=" + Uri.EscapeDataString(code));
                    var deadline = DateTime.UtcNow.AddMinutes(5);
                    while (!_closed && DateTime.UtcNow < deadline) {
                        Thread.Sleep(2000);
                        Dictionary<string, object> result;
                        try { result = Api.Send(Program.Server, "/api/agent/link", null, new Dictionary<string, object> { { "code", code }, { "secret", secret } }, 25000); }
                        catch (ApiException ex) { if (ex.Status == 0) continue; throw; }
                        if (result.ContainsKey("error")) throw new Exception(Convert.ToString(result["error"]));
                        if (!result.ContainsKey("token")) continue;
                        var status = result["status"] as Dictionary<string, object>;
                        Ui(delegate {
                            ServerUrl = Program.Server; Token = Convert.ToString(result["token"]);
                            Employee = Convert.ToString(status["employee"]); DialogResult = DialogResult.OK; Close();
                        });
                        return;
                    }
                    throw new Exception("Link expired. Click Connect using browser to try again.");
                } catch (Exception ex) { Ui(delegate { _message.Text = ex.Message; _retry.Enabled = true; }); }
            });
        }
    }
}
