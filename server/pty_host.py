"""Run a login shell inside a pseudo-terminal and relay it over pipes.

AgentDesk uses this instead of a native Node PTY module (nothing to compile):
  stdin  -> keystrokes for the shell
  stdout <- terminal output (raw bytes, ANSI included)
  fd 3   <- control lines: "<cols> <rows>\\n" to resize

usage: python3 pty_host.py <cols> <rows>
"""
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

cols, rows = int(sys.argv[1]), int(sys.argv[2])
shell = os.environ.get("SHELL") or "/bin/zsh"

pid, master = pty.fork()
if pid == 0:
    os.execvp(shell, [shell, "-l"])


def set_size(c, r):
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))


def hang_up(*_):
    # the shell leads its own session: SIGHUP its whole group (dev servers included)
    try:
        os.killpg(pid, signal.SIGHUP)
    except OSError:
        pass
    sys.exit(0)


signal.signal(signal.SIGTERM, hang_up)
set_size(cols, rows)

CTL = 3
inputs = [0, master, CTL]
ctl_buf = b""
while True:
    try:
        ready, _, _ = select.select(inputs, [], [])
    except InterruptedError:
        continue
    if master in ready:
        try:
            data = os.read(master, 65536)
        except OSError:
            break  # shell exited
        if not data:
            break
        os.write(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if not data:  # AgentDesk went away
            hang_up()
        os.write(master, data)
    if CTL in ready:
        data = os.read(CTL, 1024)
        if not data:
            inputs.remove(CTL)
            continue
        ctl_buf += data
        while b"\n" in ctl_buf:
            line, ctl_buf = ctl_buf.split(b"\n", 1)
            try:
                c, r = map(int, line.split())
                set_size(c, r)
                os.kill(pid, signal.SIGWINCH)
            except (ValueError, OSError):
                pass

_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
