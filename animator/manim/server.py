"""
Manim sandbox: renders AI-written Manim Community code to MP4.

  GET  /health                         -> {"ok": true, "manim": "<version>"}
  POST /render {code, duration_s}      -> 200 video/mp4
                                          422 {"error": "..."} when the code fails (fed back to the model)
                                          504 {"error": "..."} on timeout

The code must define `class GeneratedScene(Scene)` (or MovingCameraScene /
ThreeDScene). It is wrapped so the clip lasts exactly `duration_s`: the scene
is padded with a wait if it ends early. This container holds no secrets and
sits on a network with no internet access; each render runs in its own temp
dir under a time limit.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PORT", "8001"))
TIMEOUT_S = int(os.environ.get("RENDER_TIMEOUT_S", "300"))
SLOTS = threading.BoundedSemaphore(int(os.environ.get("MAX_PARALLEL", "2")))
MAX_BODY = 256 * 1024
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

WRAPPER = """from manim import *
config.background_color = "#000000"

{code}

class Explainer(GeneratedScene):
    def construct(self):
        super().construct()
        remaining = {duration} - self.renderer.time
        if remaining > 0.05:
            self.wait(remaining)
"""


def manim_version() -> str:
    try:
        out = subprocess.run(["manim", "--version"], capture_output=True, text=True, timeout=30).stdout
        return out.strip().splitlines()[-1] if out.strip() else "unknown"
    except Exception as e:  # noqa: BLE001
        return f"unavailable: {e}"


def error_tail(text: str) -> str:
    """The useful end of a failure: the Python traceback or LaTeX error, without progress noise."""
    lines = [ANSI.sub("", l).rstrip() for l in text.splitlines()]
    lines = [l.strip("│ ").rstrip() for l in lines]
    lines = [l for l in lines if l.strip() and "%|" not in l and not l.startswith("Animation ") and not re.fullmatch(r"[─━╭╮╰╯│ ]+", l)]
    return "\n".join(lines[-40:])[-4000:]


def render(code: str, duration: float) -> tuple[int, bytes, str]:
    if "class GeneratedScene(" not in code:
        return 422, b"", "The code must define `class GeneratedScene(Scene)` (or MovingCameraScene / ThreeDScene)."
    work = Path(tempfile.mkdtemp(prefix="manim-"))
    try:
        (work / "scene.py").write_text(WRAPPER.format(code=code, duration=round(duration, 3)))
        cmd = [
            "manim", "render", "scene.py", "Explainer",
            "-r", "1920,1080", "--fps", "30", "--format", "mp4",
            "--disable_caching", "--progress_bar", "none", "-v", "WARNING",
            "--media_dir", str(work / "media"),
        ]
        try:
            p = subprocess.run(cmd, cwd=work, capture_output=True, text=True, timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return 504, b"", f"Rendering took longer than {TIMEOUT_S}s; simplify the animation (fewer objects, no heavy updaters)."
        outs = [f for f in (work / "media").rglob("Explainer.mp4") if "partial_movie_files" not in f.parts]
        if p.returncode != 0 or not outs:
            return 422, b"", error_tail(p.stderr + "\n" + p.stdout) or f"manim exited with code {p.returncode}"
        return 200, outs[0].read_bytes(), ""
    finally:
        shutil.rmtree(work, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            return self._json(200, {"ok": True, "engine": "manim", "manim": VERSION})
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/render":
            return self._json(404, {"error": "not found"})
        length = int(self.headers.get("content-length", "0"))
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "body too large"})
        try:
            req = json.loads(self.rfile.read(length))
            code, duration = str(req["code"]), float(req["duration_s"])
        except Exception:  # noqa: BLE001
            return self._json(400, {"error": "expected {code, duration_s}"})
        if not 1 <= duration <= 90:
            return self._json(400, {"error": "duration_s must be 1–90"})
        with SLOTS:
            status, video, err = render(code, duration)
        if status != 200:
            return self._json(status, {"error": err})
        self.send_response(200)
        self.send_header("content-type", "video/mp4")
        self.send_header("content-length", str(len(video)))
        self.end_headers()
        self.wfile.write(video)

    def log_message(self, fmt: str, *args) -> None:  # quieter logs
        print(f"[manim] {self.address_string()} {fmt % args}", flush=True)


VERSION = manim_version()

if __name__ == "__main__":
    print(f"[manim] {VERSION} listening on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
