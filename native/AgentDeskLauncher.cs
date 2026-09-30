// AgentDesk.exe for the Windows package: starts the bundled Node server without a console window.
// The server opens the app window itself (Edge/Chrome --app) and quits when that window closes.
// Built by scripts/package-win.ps1 with the .NET Framework compiler (csc /target:winexe).
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Launcher
{
    [STAThread]
    static void Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(dir, "node.exe");
        string script = Path.Combine(dir, "app", "bin", "agentdesk.js");
        // optional: a project folder passed by "Open with" / drag-and-drop onto the exe
        string project = args.Length > 0 ? " \"" + args[0].TrimEnd('\\') + "\"" : "";
        var psi = new ProcessStartInfo(node, "\"" + script + "\"" + project)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        };
        psi.EnvironmentVariables["AGENTDESK_PACKAGED"] = "1";
        try
        {
            Process.Start(psi);
        }
        catch (Exception e)
        {
            MessageBox.Show("Không khởi động được AgentDesk:\n" + e.Message, "AgentDesk", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
