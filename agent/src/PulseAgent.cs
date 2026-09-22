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
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

namespace PulseAgent
{
    internal static class Program
    {
        public const string Version = "1.0.0";

        [STAThread]
        private static void Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, "Global\\PulseAttendanceAgent", out created))
            {
                if (!created) return; // already running for this Windows user
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new AgentContext());
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
                    }
                    return _items;
                }
            }
        }

        public static void Add(QueuedEvent e)
        {
            lock (Gate) { Items.Add(e); if (Items.Count > 500) Items.RemoveAt(0); Persist(); }
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
            try { Directory.CreateDirectory(Config.Dir); File.WriteAllText(FilePath, Json.Serialize(_items)); } catch { }
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
                        { "type", q.Type }, { "reason", q.Reason }, { "ageMs", Math.Max(0, age) },
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
        public bool AutoStart;

        private readonly TextBox _server = new TextBox();
        private readonly TextBox _email = new TextBox();
        private readonly TextBox _password = new TextBox { UseSystemPasswordChar = true };
        private readonly CheckBox _autostart = new CheckBox { Text = "Start automatically with Windows", Checked = true, AutoSize = true };
        private readonly Button _ok = new Button { Text = "Link this PC", Width = 140, Height = 34 };
        private readonly Label _error = new Label { ForeColor = Color.FromArgb(240, 82, 82), AutoSize = false, Height = 36 };

        public PairForm(string server)
        {
            Text = "Pulse Attendance — Link this PC";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(420, 360);
            BackColor = Color.FromArgb(15, 17, 23);
            ForeColor = Color.FromArgb(243, 245, 250);
            Font = new Font("Segoe UI", 9.5f);
            TopMost = true;

            var title = new Label { Text = "Automatic attendance", Font = new Font("Segoe UI Semibold", 15f), AutoSize = true, Location = new Point(24, 18) };
            var sub = new Label
            {
                Text = "Sign in once. After that, check-in and check-out happen when you log on, lock and shut down this PC.",
                ForeColor = Color.FromArgb(125, 132, 151), Location = new Point(26, 52), Size = new Size(370, 40)
            };
            Controls.Add(title);
            Controls.Add(sub);

            _server.Text = string.IsNullOrEmpty(server) ? DefaultServer() : server;
            AddField("Server address", _server, 100);
            AddField("Email", _email, 155);
            AddField("Password", _password, 210);

            _autostart.Location = new Point(26, 262);
            _autostart.ForeColor = Color.FromArgb(180, 186, 203);
            Controls.Add(_autostart);

            _error.Location = new Point(26, 286);
            _error.Width = 370;
            Controls.Add(_error);

            _ok.Location = new Point(256, 314);
            _ok.FlatStyle = FlatStyle.Flat;
            _ok.FlatAppearance.BorderSize = 0;
            _ok.BackColor = Color.FromArgb(124, 124, 255);
            _ok.ForeColor = Color.White;
            _ok.Click += delegate { Pair(); };
            Controls.Add(_ok);
            AcceptButton = _ok;
        }

        private void AddField(string label, TextBox box, int y)
        {
            Controls.Add(new Label { Text = label, Location = new Point(26, y), AutoSize = true, ForeColor = Color.FromArgb(180, 186, 203) });
            box.Location = new Point(26, y + 22);
            box.Width = 368;
            box.BorderStyle = BorderStyle.FixedSingle;
            box.BackColor = Color.FromArgb(22, 25, 35);
            box.ForeColor = Color.White;
            Controls.Add(box);
        }

        // An admin can place "server.txt" next to PulseAgent.exe so employees don't type the address.
        private static string DefaultServer()
        {
            try
            {
                var f = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "server.txt");
                if (File.Exists(f)) return File.ReadAllText(f).Trim();
            }
            catch { }
            return "http://";
        }

        // Keeps only scheme + host + port, so "localhost:3300/login" or a pasted dashboard URL still works.
        private static string NormalizeServer(string text)
        {
            string s = (text ?? "").Trim();
            if (s.Length == 0 || s == "http://" || s == "https://") return null;
            if (!s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !s.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) s = "http://" + s;
            Uri uri;
            if (!Uri.TryCreate(s, UriKind.Absolute, out uri) || string.IsNullOrEmpty(uri.Host)) return null;
            return uri.GetLeftPart(UriPartial.Authority);
        }

        private void Pair()
        {
            _error.Text = "";
            string server = NormalizeServer(_server.Text);
            if (server == null)
            {
                _error.Text = "Enter the server address, e.g. http://192.168.1.10:3300";
                return;
            }
            _server.Text = server;
            _ok.Enabled = false;
            _ok.Text = "Linking…";
            string email = _email.Text.Trim(), password = _password.Text, device = Environment.MachineName + " \\ " + Environment.UserName;
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    var resp = Api.Send(server, "/api/agent/pair", null, new Dictionary<string, object>
                    {
                        { "email", email }, { "password", password }, { "device", device }, { "version", Program.Version }
                    }, 10000);
                    var status = resp["status"] as Dictionary<string, object>;
                    BeginInvoke((MethodInvoker)delegate
                    {
                        ServerUrl = server;
                        Token = Convert.ToString(resp["token"]);
                        Employee = status == null ? email : Convert.ToString(status["employee"]);
                        AutoStart = _autostart.Checked;
                        DialogResult = DialogResult.OK;
                        Close();
                    });
                }
                catch (Exception ex)
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        _error.Text = ex.Message;
                        _ok.Enabled = true;
                        _ok.Text = "Link this PC";
                    });
                }
            });
        }
    }
}
