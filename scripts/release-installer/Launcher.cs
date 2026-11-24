using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal sealed class Launcher : Form
{
    const string PluginId = "WfArtAssistant";
    const string MarkerName = "launcher-panel-ready.txt";
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly string SystemUxp = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles), "Adobe", "UXP");
    static readonly string UserUxp = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Adobe", "UXP");
    readonly Label installed = new Label();
    readonly Label photoshop = new Label();
    readonly Label panel = new Label();
    readonly Button open = new Button();
    readonly Timer timer = new Timer();

    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window, int command);

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--status")
        {
            using (var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)))
                output.WriteLine(Json.Serialize(ReadStatus()));
            return;
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new Launcher());
    }

    Launcher()
    {
        Text = "WF 美工助手启动器";
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Font;
        Font = new Font("Microsoft YaHei UI", 10);
        ClientSize = new Size(450, 235);
        MinimumSize = new Size(430, 270);
        BackColor = Color.FromArgb(245, 248, 255);
        ForeColor = Color.FromArgb(25, 38, 73);

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22), ColumnCount = 1, RowCount = 6 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
        for (int i = 0; i < 5; i++) layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));
        var title = new Label { Text = "WF 美工助手", AutoSize = true, Font = new Font(Font.FontFamily, 16, FontStyle.Bold), Margin = new Padding(0, 0, 0, 10) };
        layout.Controls.Add(title, 0, 0);
        Label[] labels = { installed, photoshop, panel };
        for (int i = 0; i < labels.Length; i++)
        {
            labels[i].AutoSize = true;
            labels[i].Margin = new Padding(0, 0, 0, 6);
            layout.Controls.Add(labels[i], 0, i + 1);
        }
        layout.Controls.Add(new Label { Text = "在 Photoshop 中选择「增效工具 → WF美工助手」。", AutoSize = true, Margin = new Padding(0, 4, 0, 7) }, 0, 4);
        open.AutoSize = true;
        open.MinimumSize = new Size(145, 36);
        open.BackColor = Color.FromArgb(41, 72, 154);
        open.ForeColor = Color.White;
        open.FlatStyle = FlatStyle.Flat;
        open.Click += delegate { OpenPhotoshop(); };
        layout.Controls.Add(open, 0, 5);
        Controls.Add(layout);
        AcceptButton = open;
        timer.Interval = 1500;
        timer.Tick += delegate { RefreshStatus(); };
        FormClosed += delegate { timer.Dispose(); };
        RefreshStatus();
        timer.Start();
    }

    internal sealed class Status
    {
        public string Version { get; set; }
        public bool Registered { get; set; }
        public bool PhotoshopRunning { get; set; }
        public bool PanelOpened { get; set; }
        public string PhotoshopPath { get; set; }
        public string LoadedVersion { get; set; }
    }

    static string ReadVersion(string root)
    {
        var plugin = Path.Combine(root, "Plugins", "External", PluginId);
        if (!File.Exists(Path.Combine(plugin, "app.js")) || !File.Exists(Path.Combine(plugin, "host.js"))) return "";
        var manifest = ReadJson(Path.Combine(plugin, "manifest.json"));
        return TextValue(manifest, "id") == PluginId ? TextValue(manifest, "version") : "";
    }

    static IDictionary<string, object> ReadJson(string path)
    {
        try { return Json.DeserializeObject(File.ReadAllText(path)) as IDictionary<string, object>; }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
        catch (ArgumentException) { return null; }
        catch (InvalidOperationException) { return null; }
    }

    static string TextValue(IDictionary<string, object> source, string key)
    {
        object value;
        return source != null && source.TryGetValue(key, out value) ? value as string ?? "" : "";
    }

    static bool IsRegistered(string root, string version, string prefix)
    {
        var data = ReadJson(Path.Combine(root, "PluginsInfo", "v1", "PS.json"));
        object entries;
        if (data == null || !data.TryGetValue("plugins", out entries) || !(entries is IEnumerable)) return false;
        return ((IEnumerable)entries).OfType<IDictionary<string, object>>().Any(entry =>
            TextValue(entry, "pluginId") == PluginId && TextValue(entry, "versionString") == version &&
            TextValue(entry, "status") == "enabled" &&
            TextValue(entry, "path") == prefix + "\\External\\" + PluginId);
    }

    static string ReadPanelVersion(Process process)
    {
        try
        {
            var major = process.MainModule.FileVersionInfo.FileMajorPart;
            var storage = Path.Combine(UserUxp, "PluginsStorage", "PHSP", major.ToString());
            var marker = new FileInfo(Path.Combine(storage, "External", PluginId, "PluginData", MarkerName));
            if (!marker.Exists || marker.Length > 32 || marker.LastWriteTimeUtc < process.StartTime.ToUniversalTime()) return "";
            var text = File.ReadAllText(marker.FullName).Trim();
            Version version;
            return Version.TryParse(text, out version) ? text : "";
        }
        catch (IOException) { return ""; }
        catch (UnauthorizedAccessException) { return ""; }
    }

    static Process FindPhotoshopProcess()
    {
        var candidates = Process.GetProcessesByName("Photoshop");
        Process selected = candidates.FirstOrDefault(p => p.MainWindowHandle != IntPtr.Zero) ?? candidates.FirstOrDefault();
        foreach (var candidate in candidates) if (candidate != selected) candidate.Dispose();
        return selected;
    }

    static string FindPhotoshop()
    {
        using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe"))
        {
            var value = key == null ? null : key.GetValue(null) as string;
            if (!String.IsNullOrEmpty(value) && File.Exists(value.Trim('"'))) return value.Trim('"');
        }
        var adobe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Adobe");
        try
        {
            if (Directory.Exists(adobe))
                return Directory.EnumerateDirectories(adobe, "Adobe Photoshop*")
                    .Select(path => Path.Combine(path, "Photoshop.exe"))
                    .Where(File.Exists)
                    .OrderByDescending(path => FileVersionInfo.GetVersionInfo(path).FileMajorPart)
                    .ThenByDescending(path => path, StringComparer.OrdinalIgnoreCase)
                    .FirstOrDefault() ?? "";
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        return "";
    }

    static Status ReadStatus()
    {
        var systemVersion = ReadVersion(SystemUxp);
        var userVersion = ReadVersion(UserUxp);
        var status = new Status {
            Version = systemVersion == "" ? userVersion : systemVersion,
            Registered = (systemVersion != "" && IsRegistered(SystemUxp, systemVersion, "$systemPlugins")) ||
                (systemVersion == "" && userVersion != "" && IsRegistered(UserUxp, userVersion, "$localPlugins")),
            PhotoshopPath = FindPhotoshop(), LoadedVersion = "",
        };
        using (var process = FindPhotoshopProcess())
        {
            if (process == null) return status;
            status.PhotoshopRunning = true;
            try { status.LoadedVersion = ReadPanelVersion(process); }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
            status.PanelOpened = status.LoadedVersion.Length > 0;
        }
        return status;
    }

    void RefreshStatus()
    {
        var status = ReadStatus();
        installed.Text = status.Version == "" ? "插件：未找到安装文件" : "插件：v" + status.Version + (status.Registered ? " · 已登记" : " · 登记未确认");
        photoshop.Text = "Photoshop：" + (status.PhotoshopRunning ? "运行中" : status.PhotoshopPath == "" ? "未找到安装" : "未运行");
        panel.Text = "本次 Photoshop 会话：" + (status.PanelOpened ? "已打开插件面板 v" + status.LoadedVersion : "尚未确认打开插件面板");
        open.Text = status.PhotoshopRunning ? "切换到 Photoshop" : "启动 Photoshop";
        open.Enabled = status.PhotoshopRunning || status.PhotoshopPath != "";
    }

    void OpenPhotoshop()
    {
        try
        {
            using (var process = FindPhotoshopProcess())
            {
                if (process != null)
                {
                    var window = process.MainWindowHandle;
                    if (window != IntPtr.Zero)
                    {
                        if (IsIconic(window)) ShowWindowAsync(window, 9);
                        SetForegroundWindow(window);
                    }
                    return;
                }
            }
            var path = FindPhotoshop();
            if (path != "") Process.Start(new ProcessStartInfo(path) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(path) });
        }
        catch (Exception error)
        {
            if (!(error is IOException || error is InvalidOperationException ||
                error is System.ComponentModel.Win32Exception)) throw;
            MessageBox.Show(this, "无法打开 Photoshop：" + error.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally { RefreshStatus(); }
    }
}
