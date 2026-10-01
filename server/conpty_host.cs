// A real terminal for AgentDesk on Windows: runs a shell inside a ConPTY (Windows 10 1809+)
// and relays it over pipes, like server/pty_host.py does with a Unix PTY.
//   stdin  -> keystrokes for the shell (UTF-8); "ESC ] 7799 ; <cols> ; <rows> BEL" resizes instead
//   stdout <- terminal output (UTF-8 with VT sequences)
// usage: conpty_host.exe <cols> <rows> <command line>
// Compiled on first use by server/terminals.ts with the .NET Framework compiler every Windows has
// (C# 5: no string interpolation, no "out var").
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;

static class ConPtyHost
{
    [StructLayout(LayoutKind.Sequential)]
    struct COORD { public short X; public short Y; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern int CreatePseudoConsole(COORD size, SafeFileHandle hInput, SafeFileHandle hOutput, uint dwFlags, out IntPtr phPC);
    [DllImport("kernel32.dll")]
    static extern int ResizePseudoConsole(IntPtr hPC, COORD size);
    [DllImport("kernel32.dll")]
    static extern void ClosePseudoConsole(IntPtr hPC);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CreatePipe(out SafeFileHandle hReadPipe, out SafeFileHandle hWritePipe, IntPtr lpPipeAttributes, int nSize);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string lpApplicationName, string lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFOEX lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);
    [DllImport("kernel32.dll")]
    static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);
    [DllImport("kernel32.dll")]
    static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    const int STARTF_USESTDHANDLES = 0x00000100;
    static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = (IntPtr)0x00020016;

    static IntPtr pty;

    static COORD Size(int cols, int rows)
    {
        COORD c;
        c.X = (short)Math.Max(1, Math.Min(cols, 1000));
        c.Y = (short)Math.Max(1, Math.Min(rows, 1000));
        return c;
    }

    static int Main(string[] args)
    {
        if (args.Length < 3)
        {
            Console.Error.WriteLine("usage: conpty_host <cols> <rows> <command line>");
            return 2;
        }
        int cols = int.Parse(args[0]), rows = int.Parse(args[1]);
        string commandLine = args[2];

        SafeFileHandle inRead, inWrite, outRead, outWrite;
        if (!CreatePipe(out inRead, out inWrite, IntPtr.Zero, 0) || !CreatePipe(out outRead, out outWrite, IntPtr.Zero, 0))
        {
            Console.Error.WriteLine("CreatePipe failed: " + Marshal.GetLastWin32Error());
            return 1;
        }
        int hr = CreatePseudoConsole(Size(cols, rows), inRead, outWrite, 0, out pty);
        if (hr != 0)
        {
            Console.Error.WriteLine("CreatePseudoConsole failed: 0x" + hr.ToString("X"));
            return 1;
        }

        IntPtr size = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
        STARTUPINFOEX si = new STARTUPINFOEX();
        si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
        // no std handles: the shell must talk to the pseudo console, not to our redirected pipes
        si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        si.lpAttributeList = Marshal.AllocHGlobal(size);
        if (!InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, ref size) ||
            !UpdateProcThreadAttribute(si.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, pty, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero))
        {
            Console.Error.WriteLine("ProcThreadAttribute failed: " + Marshal.GetLastWin32Error());
            return 1;
        }
        PROCESS_INFORMATION pi;
        if (!CreateProcess(null, commandLine, IntPtr.Zero, IntPtr.Zero, false, EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, null, ref si, out pi))
        {
            Console.Error.WriteLine("Could not start " + commandLine + " (error " + Marshal.GetLastWin32Error() + ")");
            return 1;
        }
        // the pseudo console holds its own copies now
        inRead.Dispose();
        outWrite.Dispose();

        Stream stdout = Console.OpenStandardOutput();
        FileStream fromPty = new FileStream(outRead, FileAccess.Read, 1, false);
        Thread output = new Thread(delegate ()
        {
            byte[] buf = new byte[65536];
            try
            {
                int n;
                while ((n = fromPty.Read(buf, 0, buf.Length)) > 0)
                {
                    stdout.Write(buf, 0, n);
                    stdout.Flush();
                }
            }
            catch (Exception) { }
        });
        output.IsBackground = true;
        output.Start();

        FileStream toPty = new FileStream(inWrite, FileAccess.Write, 1, false);
        Thread input = new Thread(delegate () { Relay(Console.OpenStandardInput(), toPty); });
        input.IsBackground = true;
        input.Start();

        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        uint code;
        GetExitCodeProcess(pi.hProcess, out code);
        // closing the console flushes the last output and ends the reader
        ClosePseudoConsole(pty);
        output.Join(2000);
        return (int)code;
    }

    // keystrokes go through, except our in-band resize command
    static readonly byte[] Marker = { 0x1b, (byte)']', (byte)'7', (byte)'7', (byte)'9', (byte)'9', (byte)';' };

    static void Relay(Stream from, Stream to)
    {
        byte[] buf = new byte[65536];
        MemoryStream pending = new MemoryStream();
        try
        {
            int n;
            while ((n = from.Read(buf, 0, buf.Length)) > 0)
            {
                pending.Write(buf, 0, n);
                byte[] data = pending.ToArray();
                pending.SetLength(0);
                int start = 0;
                int i = 0;
                while (i < data.Length)
                {
                    if (data[i] != 0x1b) { i++; continue; }
                    // AgentDesk writes a resize in one go, so a lone ESC (vim, menus) is always a key
                    int m = 0;
                    while (m < Marker.Length && i + m < data.Length && data[i + m] == Marker[m]) m++;
                    if (m < Marker.Length) { i++; continue; }
                    int end = Array.IndexOf(data, (byte)7, i);
                    if (end < 0)
                    {
                        // incomplete: keep it for the next read
                        to.Write(data, start, i - start);
                        pending.Write(data, i, data.Length - i);
                        start = data.Length;
                        break;
                    }
                    to.Write(data, start, i - start);
                    string[] parts = System.Text.Encoding.ASCII.GetString(data, i + Marker.Length, end - i - Marker.Length).Split(';');
                    int c, r;
                    if (parts.Length == 2 && int.TryParse(parts[0], out c) && int.TryParse(parts[1], out r)) ResizePseudoConsole(pty, Size(c, r));
                    i = end + 1;
                    start = i;
                }
                if (start < data.Length) to.Write(data, start, data.Length - start);
                to.Flush();
            }
        }
        catch (Exception) { }
        // AgentDesk went away: hang up the shell
        ClosePseudoConsole(pty);
        Environment.Exit(0);
    }
}
