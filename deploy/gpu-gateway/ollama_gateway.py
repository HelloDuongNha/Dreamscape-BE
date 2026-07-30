#!/usr/bin/env python3
"""Small authenticated reverse proxy for a private Ollama process.

The gateway intentionally exposes only the Ollama endpoints DreamScape uses.
TLS is terminated by the platform tunnel in front of this process.
"""

from __future__ import annotations

import http.client
import json
import os
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


UPSTREAM_HOST = os.getenv("OLLAMA_UPSTREAM_HOST", "127.0.0.1")
UPSTREAM_PORT = int(os.getenv("OLLAMA_UPSTREAM_PORT", "11434"))
LISTEN_HOST = os.getenv("GATEWAY_HOST", "127.0.0.1")
LISTEN_PORT = int(os.getenv("GATEWAY_PORT", "18080"))
API_KEY = os.environ["GPU_API_KEY"]
MAX_BODY_BYTES = int(os.getenv("GATEWAY_MAX_BODY_BYTES", str(16 * 1024 * 1024)))
MAX_CONCURRENCY = int(os.getenv("GATEWAY_MAX_CONCURRENCY", "2"))
ALLOWED_PATHS = {
    "/api/chat",
    "/api/generate",
    "/api/embed",
    "/api/embeddings",
    "/api/tags",
    "/api/version",
}
SLOTS = threading.BoundedSemaphore(MAX_CONCURRENCY)


class GatewayHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:  # noqa: N802
        self._proxy()

    def do_POST(self) -> None:  # noqa: N802
        self._proxy()

    def _proxy(self) -> None:
        path = self.path.split("?", 1)[0]
        if path not in ALLOWED_PATHS:
            self._json_error(404, "not_found")
            return
        if not secrets.compare_digest(
            self.headers.get("Authorization", ""),
            f"Bearer {API_KEY}",
        ):
            self._json_error(401, "unauthorized")
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json_error(400, "invalid_content_length")
            return
        if content_length > MAX_BODY_BYTES:
            self._json_error(413, "request_too_large")
            return
        if not SLOTS.acquire(blocking=False):
            self._json_error(429, "gpu_busy")
            return

        try:
            body = self.rfile.read(content_length) if content_length else None
            connection = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=3600)
            connection.request(
                self.command,
                self.path,
                body=body,
                headers={"Content-Type": self.headers.get("Content-Type", "application/json")},
            )
            response = connection.getresponse()
            self.send_response(response.status)
            for name, value in response.getheaders():
                if name.lower() not in {"connection", "keep-alive", "transfer-encoding"}:
                    self.send_header(name, value)
            self.send_header("Connection", "close")
            self.end_headers()
            while chunk := response.read(64 * 1024):
                self.wfile.write(chunk)
                self.wfile.flush()
            connection.close()
            self.close_connection = True
        except (BrokenPipeError, ConnectionError, TimeoutError):
            return
        finally:
            SLOTS.release()

    def _json_error(self, status: int, code: str) -> None:
        body = json.dumps({"error": code}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, pattern: str, *args: object) -> None:
        print(f"{self.address_string()} - {pattern % args}", flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), GatewayHandler)
    print(f"Ollama gateway listening on {LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    server.serve_forever()
