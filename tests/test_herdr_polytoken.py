import json
import os
import pty
import shutil
import subprocess
import time
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "bin/herdr-polytoken"
JQ = shutil.which("jq")
PTY_HANDLES = []


@pytest.fixture
def harness(tmp_path):
    commands = tmp_path / "bin"
    commands.mkdir()
    log = tmp_path / "calls"
    (commands / "hc").write_text('''#!/bin/bash
if [[ $1 == get ]]; then
    [[ ${HC_FAIL:-0} == 0 ]] || exit 1
    printf '%s' "$HC_JSON"
else
    [[ ${HC_SLOW:-0} == 0 ]] || sleep "$HC_SLOW"
    printf '%s\\0' "$@" >> "$CALLS"
    [[ ${HC_FAIL:-0} == 0 ]]
fi
''')
    (commands / "polytoken").write_text('''#!/bin/bash
printf '%s\\0' "$@" > "$ARGS"
env > "$ENV_FILE"
''')
    for path in commands.iterdir():
        path.chmod(0o755)
    if JQ:
        (commands / "jq").symlink_to(JQ)
    for tool in ("env", "sleep"):
        (commands / tool).symlink_to(shutil.which(tool))
    env = {**os.environ, "PATH": str(commands), "CALLS": str(log),
           "ARGS": str(tmp_path / "args"), "ENV_FILE": str(tmp_path / "env"),
           "HC_JSON": '{}'}
    for key in ("HC_TERMINAL_ID", "HPT_REPORTER", "HPT_SESSIONS_DIR", "HERDR_ENV",
                "HERDR_BIN_PATH", "HERDR_PANE_ID"):
        env.pop(key, None)
    yield tmp_path, commands, env
    import signal
    for handle, pid in PTY_HANDLES:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        os.close(handle)
    PTY_HANDLES.clear()


def run(harness, *args, extra=None, cwd=None):
    tmp, _, env = harness
    return subprocess.run([str(SCRIPT), *args], env={**env, **(extra or {})},
                          cwd=cwd or tmp, capture_output=True, timeout=5)


def callback(harness, *args, extra=None, tty=True):
    tmp, _, env = harness
    env = {**env, "HPT_REPORTER": "1", "HC_TERMINAL_ID": "t1", **(extra or {})}
    if not tty:
        proc = subprocess.run([str(SCRIPT), "pane", *args], env=env, cwd=tmp,
                              stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, start_new_session=True, timeout=3)
        return proc.returncode, b"", 0

    import select
    import signal
    pid, master = pty.fork()
    if pid == 0:
        os.chdir(tmp)
        child = os.fork()
        if child == 0:
            null = os.open(os.devnull, os.O_RDWR)
            for fd in (0, 1, 2):
                os.dup2(null, fd)
            os.execve(str(SCRIPT), [str(SCRIPT), "pane", *args], env)
        _, status = os.waitpid(child, 0)
        os.write(1, f"\nCALLBACK_STATUS={os.waitstatus_to_exitcode(status)}\n".encode())
        os.read(0, 1)
        os._exit(0)
    started = time.monotonic()
    output = b""
    try:
        while True:
            ready, _, _ = select.select([master], [], [], 0.02)
            if ready:
                try:
                    output += os.read(master, 4096)
                except OSError:
                    pass
            if b"CALLBACK_STATUS=" in output and output.endswith(b"\n"):
                break
            if time.monotonic() - started > 3:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
                raise TimeoutError("callback did not exit")
        elapsed = time.monotonic() - started
    finally:
        PTY_HANDLES.append((master, pid))
    osc, status = output.split(b"\r\nCALLBACK_STATUS=", 1)
    return int(status.strip()), osc, elapsed


def fields(path):
    return path.read_bytes().decode().rstrip('\0').split('\0')


def wait_labels(tmp):
    deadline = time.monotonic() + 3
    while not (tmp / "calls").exists() and time.monotonic() < deadline:
        time.sleep(0.01)
    return fields(tmp / "calls")


@pytest.mark.parametrize("extra", [{}, {"HERDR_ENV": "legacy", "HERDR_PANE_ID": "old"}])
def test_standalone_passthrough(harness, extra):
    tmp, _, _ = harness
    assert run(harness, "new", "--sessions-dir", "relative path", extra=extra).returncode == 0
    assert fields(tmp / "args") == ["new", "--sessions-dir", "relative path"]
    env = (tmp / "env").read_text()
    assert "HPT_REPORTER=1" not in env
    if extra:
        assert "HERDR_ENV=legacy" in env and "HERDR_PANE_ID=old" in env


@pytest.mark.parametrize("args,expected", [
    (["new", "--sessions-dir", "relative path"], "relative path"),
    (["continue", "abc", "--sessions-dir=relative path"], "relative path"),
    (["new", "--prompt", "--sessions-dir", "--", "--sessions-dir=bad"], None),
    (["new"], None),
])
def test_launch_environment(harness, args, expected):
    tmp, _, _ = harness
    result = run(harness, *args, extra={"HC_TERMINAL_ID": "t1", "HPT_SESSIONS_DIR": "/stale"})
    assert result.returncode == 0
    assert fields(tmp / "args") == args
    env = (tmp / "env").read_text()
    assert "HPT_REPORTER=1" in env and "HERDR_ENV=1" in env
    assert f"HERDR_BIN_PATH={SCRIPT}" in env and "HERDR_PANE_ID=t1" in env
    if expected:
        assert f"HPT_SESSIONS_DIR={tmp / expected}" in env
    else:
        assert "HPT_SESSIONS_DIR=" not in env


@pytest.mark.parametrize("state", ["working", "idle", "blocked"])
def test_report_and_label(harness, state):
    tmp, _, _ = harness
    rc, output, _ = callback(harness, "report-agent", "--source", "polytoken", "--agent", "polytoken",
                              "--state", state, "--message", "--state", "--seq", "4",
                              "--agent-session-id", "a.B_9-z", "--", "polytoken", "continue", "other",
                              extra={"HPT_SESSIONS_DIR": "/space dir/sessions"})
    assert rc == 0, output
    assert output == f"\x1b]7501;state={state}:app=polytoken\x1b\\".encode()
    assert wait_labels(tmp) == ["label", "t1", "polytoken.session=a.B_9-z",
                                "polytoken.sessions_dir=/space dir/sessions"]


@pytest.mark.parametrize("args", [
    ["--state"], ["--state", "--seq", "1"], ["--state", "idle", "--state", "working"],
    ["--state", "idle", "--agent-session-id"],
    ["--state", "idle", "--agent-session-id", "a", "--agent-session-id", "b"],
    ["--message", "--state", "--", "polytoken", "--state", "idle"],
])
def test_reject_bad_reports(harness, args):
    tmp, _, _ = harness
    rc, output, _ = callback(harness, "report-agent", *args)
    assert rc == 2 and output == b""
    assert not (tmp / "calls").exists()


@pytest.mark.parametrize("id_arg", [[], ["--agent-session-id", "-bad"],
                                     ["--agent-session-id", "bad/name"],
                                     ["--agent-session-id", "é"]])
def test_missing_or_invalid_id_keeps_osc_without_label(harness, id_arg):
    tmp, _, _ = harness
    rc, output, _ = callback(harness, "report-agent", "--state", "idle", *id_arg)
    assert rc == 0 and b"state=idle" in output
    assert not (tmp / "calls").exists()


def test_clear_default_directory(harness):
    tmp, _, _ = harness
    assert callback(harness, "report-agent", "--state", "working", "--agent-session-id", "abc")[0] == 0
    assert wait_labels(tmp)[-1] == "polytoken.sessions_dir="


@pytest.mark.parametrize("extra", [{"HC_SLOW": "1"}, {"HC_FAIL": "1"}])
def test_label_writer_does_not_delay_or_change_status(harness, extra):
    rc, output, elapsed = callback(harness, "report-agent", "--state", "idle", "--agent-session-id", "abc", extra=extra)
    assert rc == 0 and b"state=idle" in output and elapsed < 0.8


def test_osc_failure_preserves_status(harness):
    tmp, _, _ = harness
    rc, _, _ = callback(harness, "report-agent", "--state", "idle", "--agent-session-id", "abc", tty=False)
    assert rc != 0
    assert wait_labels(tmp)[2] == "polytoken.session=abc"


@pytest.mark.parametrize("action", ["release-agent", "report-metadata"])
def test_no_label_for_other_callbacks(harness, action):
    tmp, _, _ = harness
    rc, output, _ = callback(harness, action, "--agent-session-id", "abc")
    assert rc == 0
    assert (b"state=clear" in output) == (action == "release-agent")
    assert not (tmp / "calls").exists()


def test_restore_requires_terminal_and_no_extra_args(harness):
    assert b"requires a Herdr terminal" in run(harness, "restore").stderr
    assert run(harness, "restore", "--help", extra={"HC_TERMINAL_ID": "t1"}).returncode == 2


@pytest.mark.parametrize("tool", ["hc", "jq"])
def test_restore_requires_tools(harness, tool):
    _, commands, _ = harness
    (commands / tool).unlink(missing_ok=True)
    result = run(harness, "restore", extra={"HC_TERMINAL_ID": "t1"})
    assert result.returncode != 0 and f"requires {tool}".encode() in result.stderr


@pytest.mark.parametrize("payload", ['{}', '{"labels":{}}', '{"labels":{"polytoken.session":2}}',
                                    '{"labels":{"polytoken.session":"-bad"}}',
                                    '{"labels":{"polytoken.session":"é"}}', 'not json',
                                    json.dumps({"labels": {"polytoken.session": "abc\n"}}),
                                    json.dumps({"labels": {"polytoken.session": "abc", "polytoken.sessions_dir": "/bad\0path"}}),
                                    '{"labels":{"polytoken.session":"abc","polytoken.sessions_dir":"relative"}}'])
def test_restore_rejects_bad_labels(harness, payload):
    result = run(harness, "restore", extra={"HC_TERMINAL_ID": "t1", "HC_JSON": payload})
    assert result.returncode != 0 and b"label" in result.stderr


def test_restore_api_error(harness):
    result = run(harness, "restore", extra={"HC_TERMINAL_ID": "t1", "HC_FAIL": "1"})
    assert result.returncode != 0 and b"could not read" in result.stderr


@pytest.mark.parametrize("directory", [None, "/custom path/sessions", "/custom path/trailing\n"])
def test_restore_launches_continue(harness, directory):
    tmp, _, _ = harness
    labels = {"polytoken.session": "abc-123"}
    if directory is not None:
        labels["polytoken.sessions_dir"] = directory
    result = run(harness, "restore", extra={"HC_TERMINAL_ID": "t1", "HPT_SESSIONS_DIR": "/stale",
                                            "HC_JSON": json.dumps({"labels": labels})})
    assert result.returncode == 0 and b"restoring session abc-123" in result.stderr
    args = ["continue", "abc-123"] + (["--sessions-dir", directory] if directory else [])
    assert fields(tmp / "args") == args
    env = (tmp / "env").read_text()
    assert "HERDR_ENV=1" in env and "HERDR_PANE_ID=t1" in env
    if directory:
        assert f"HPT_SESSIONS_DIR={directory}" in env
    else:
        assert "HPT_SESSIONS_DIR=" not in env
