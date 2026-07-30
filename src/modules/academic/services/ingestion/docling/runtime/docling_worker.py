#!/usr/bin/env python3
"""Authenticated HTTP transport for DreamScape's existing Docling parser."""

import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = os.environ.get("DOCLING_WORKER_HOST", "0.0.0.0")
PORT = int(os.environ.get("DOCLING_WORKER_PORT", "8000"))
TOKEN = os.environ.get("DOCLING_WORKER_TOKEN", "").strip()
MAX_INPUT_BYTES = int(os.environ.get("DOCLING_WORKER_MAX_INPUT_BYTES", str(250 * 1024 * 1024)))
EXTRACTION_TIMEOUT_SECONDS = int(os.environ.get("DOCLING_WORKER_EXTRACTION_TIMEOUT_SECONDS", "1800"))
OCR_TIMEOUT_SECONDS = int(os.environ.get("DOCLING_WORKER_OCR_TIMEOUT_SECONDS", "14400"))
PARSER_PATH = Path(__file__).with_name("docling_parser.py").resolve()
EXTRACTION_LOCK = threading.BoundedSemaphore(
    value=max(1, int(os.environ.get("DOCLING_WORKER_CONCURRENCY", "1")))
)
PROCESS_LOCK = threading.Lock()
ACTIVE_PROCESSES = {}
ACTIVE_REQUESTS = set()
CANCELLED_REQUESTS = set()
REQUEST_ID_PATTERN = re.compile(r"^[a-f0-9-]{36}$")
COMPLETED_RUNS = {}
RUN_TTL_SECONDS = int(os.environ.get("DOCLING_WORKER_RUN_TTL_SECONDS", "3600"))


class WorkerHandler(BaseHTTPRequestHandler):
    server_version = "DreamScapeDoclingWorker/1.0"

    def do_GET(self):
        if not self._authorized():
            return self._json(401, {"error": "unauthorized"})
        if self.path.startswith("/artifacts/"):
            return self._send_artifact()
        if self.path != "/health":
            return self._json(404, {"error": "not_found"})
        available = PARSER_PATH.is_file() and importlib.util.find_spec("docling") is not None
        return self._json(
            200 if available else 503,
            {"ok": available, "parser": "docling"},
        )

    def do_POST(self):
        if self.path != "/extract":
            return self._json(404, {"error": "not_found"})
        if not self._authorized():
            return self._json(401, {"error": "unauthorized"})
        if self.headers.get("content-type", "").split(";", 1)[0] != "application/pdf":
            return self._json(415, {"error": "pdf_required"})
        request_id = self.headers.get("x-docling-request-id", "").strip().lower()
        if not REQUEST_ID_PATTERN.fullmatch(request_id):
            return self._json(400, {"error": "invalid_request_id"})

        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_INPUT_BYTES:
            return self._json(413, {"error": "invalid_pdf_size"})

        with PROCESS_LOCK:
            ACTIVE_REQUESTS.add(request_id)
        workspace = Path(tempfile.mkdtemp(prefix="dreamscape-docling-worker-"))
        preserve_workspace = False
        try:
            pdf_path = workspace / "document.pdf"
            run_dir = workspace / "output"
            run_dir.mkdir(mode=0o700)
            with pdf_path.open("wb") as output:
                remaining = length
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("incomplete_request_body")
                    output.write(chunk)
                    remaining -= len(chunk)

            do_ocr = self.headers.get("x-docling-ocr", "false").lower() == "true"
            timeout_seconds = OCR_TIMEOUT_SECONDS if do_ocr else EXTRACTION_TIMEOUT_SECONDS
            with EXTRACTION_LOCK:
                if self._is_cancelled(request_id):
                    return self._json(409, {"error": "cancelled"})
                process = subprocess.Popen(
                    [sys.executable, str(PARSER_PATH), str(pdf_path), str(run_dir), str(do_ocr)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                self._register_process(request_id, process)
                try:
                    stdout, stderr = process.communicate(timeout=timeout_seconds)
                except subprocess.TimeoutExpired:
                    process.kill()
                    stdout, stderr = process.communicate()
                    return self._json(504, {"error": "parser_timeout"})
                finally:
                    self._unregister_process(request_id)
            if self._is_cancelled(request_id):
                return self._json(409, {"error": "cancelled"})
            try:
                result = json.loads(stdout.strip())
            except json.JSONDecodeError:
                return self._json(500, {
                    "error": "malformed_parser_output",
                    "detail": stderr[-2000:],
                })

            artifacts, artifact_paths = self._collect_artifacts(result, run_dir)
            with PROCESS_LOCK:
                COMPLETED_RUNS[request_id] = {
                    "workspace": workspace,
                    "artifacts": artifact_paths,
                    "completedAt": time.time(),
                }
            preserve_workspace = True
            return self._json(200, {"result": result, "artifacts": artifacts})
        except Exception as error:
            return self._json(500, {"error": "worker_failed", "detail": str(error)[:2000]})
        finally:
            self._finish_request(request_id if 'request_id' in locals() else "")
            if not preserve_workspace:
                shutil.rmtree(workspace, ignore_errors=True)

    def do_DELETE(self):
        if not self._authorized():
            return self._json(401, {"error": "unauthorized"})
        if self.path.startswith("/runs/"):
            request_id = self.path.removeprefix("/runs/").strip().lower()
            if not REQUEST_ID_PATTERN.fullmatch(request_id):
                return self._json(400, {"error": "invalid_request_id"})
            return self._delete_completed_run(request_id)
        if not self.path.startswith("/extract/"):
            return self._json(404, {"error": "not_found"})
        request_id = self.path.removeprefix("/extract/").strip().lower()
        if not REQUEST_ID_PATTERN.fullmatch(request_id):
            return self._json(400, {"error": "invalid_request_id"})
        with PROCESS_LOCK:
            if request_id not in ACTIVE_REQUESTS:
                return self._json(404, {"error": "request_not_active"})
            CANCELLED_REQUESTS.add(request_id)
            process = ACTIVE_PROCESSES.get(request_id)
            if process and process.poll() is None:
                process.kill()
        return self._json(202, {"cancelled": True})

    def _register_process(self, request_id, process):
        with PROCESS_LOCK:
            ACTIVE_PROCESSES[request_id] = process
            if request_id in CANCELLED_REQUESTS and process.poll() is None:
                process.kill()

    def _unregister_process(self, request_id):
        with PROCESS_LOCK:
            ACTIVE_PROCESSES.pop(request_id, None)

    def _is_cancelled(self, request_id):
        with PROCESS_LOCK:
            return request_id in CANCELLED_REQUESTS

    def _finish_request(self, request_id):
        if not request_id:
            return
        with PROCESS_LOCK:
            ACTIVE_REQUESTS.discard(request_id)
            CANCELLED_REQUESTS.discard(request_id)

    def _collect_artifacts(self, result, run_dir: Path):
        artifacts = []
        artifact_paths = {}
        real_run_dir = run_dir.resolve()
        for item in result.get("items", []):
            if item.get("type") != "figure":
                continue
            descriptor = {
                "itemId": item.get("id"),
                "fileName": item.get("fileName"),
                "format": item.get("format"),
                "width": item.get("width"),
                "height": item.get("height"),
                "pageNumber": item.get("pageNumber", 0),
                "bbox": item.get("bbox"),
                "figureType": item.get("figureType", "region_only"),
                "caption": item.get("caption"),
            }
            file_path = item.get("filePath")
            if file_path:
                resolved = Path(file_path).resolve()
                if real_run_dir not in resolved.parents or not resolved.is_file():
                    raise ValueError("artifact_path_outside_workspace")
                artifact_id = str(item.get("id", ""))
                descriptor["artifactId"] = artifact_id
                artifact_paths[artifact_id] = resolved
                item.pop("filePath", None)
            artifacts.append({key: value for key, value in descriptor.items() if value is not None})
        return artifacts, artifact_paths

    def _send_artifact(self):
        parts = self.path.split("/", 3)
        if len(parts) != 4:
            return self._json(404, {"error": "not_found"})
        request_id, artifact_id = parts[2].lower(), parts[3]
        if not REQUEST_ID_PATTERN.fullmatch(request_id):
            return self._json(400, {"error": "invalid_request_id"})
        with PROCESS_LOCK:
            run = COMPLETED_RUNS.get(request_id)
            artifact_path = run and run["artifacts"].get(artifact_id)
        if not artifact_path or not Path(artifact_path).is_file():
            return self._json(404, {"error": "artifact_not_found"})
        data = Path(artifact_path).read_bytes()
        suffix = Path(artifact_path).suffix.lower()
        content_type = "image/jpeg" if suffix in (".jpg", ".jpeg") else "image/png"
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _delete_completed_run(self, request_id):
        with PROCESS_LOCK:
            run = COMPLETED_RUNS.pop(request_id, None)
        if not run:
            return self._json(404, {"error": "run_not_found"})
        shutil.rmtree(run["workspace"], ignore_errors=True)
        return self._json(200, {"deleted": True})

    def _authorized(self):
        if not TOKEN:
            return False
        supplied = self.headers.get("authorization", "")
        expected = f"Bearer {TOKEN}"
        return hmac.compare_digest(supplied, expected)

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, message, *args):
        sys.stderr.write("[docling-worker] " + (message % args) + "\n")


def main():
    if not TOKEN:
        raise RuntimeError("DOCLING_WORKER_TOKEN is required")
    if not PARSER_PATH.is_file():
        raise RuntimeError("docling_parser.py is missing")
    threading.Thread(target=_cleanup_expired_runs, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), WorkerHandler)
    print(f"Docling worker listening on {HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def _cleanup_expired_runs():
    while True:
        time.sleep(min(300, max(30, RUN_TTL_SECONDS // 4)))
        cutoff = time.time() - RUN_TTL_SECONDS
        expired = []
        with PROCESS_LOCK:
            for request_id, run in list(COMPLETED_RUNS.items()):
                if run["completedAt"] < cutoff:
                    expired.append(COMPLETED_RUNS.pop(request_id))
        for run in expired:
            shutil.rmtree(run["workspace"], ignore_errors=True)


if __name__ == "__main__":
    main()
