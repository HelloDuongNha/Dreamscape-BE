# DreamScape Docling worker

This worker runs the same `docling_parser.py` used by the local backend. The
HTTP layer changes transport only; parsing, normalization, figures, reader
compilation, and persistence remain in the existing backend pipeline.

## Start on GraphicsMiner

From the backend repository and inside the Python environment where Docling is
already installed:

```bash
sudo apt-get install -y libglib2.0-0 libgl1
python -m pip install -r src/modules/academic/services/ingestion/docling/runtime/requirements.txt
export DOCLING_WORKER_TOKEN='<a separate random secret>'
export DOCLING_WORKER_PORT=8000
export DOCLING_WORKER_CONCURRENCY=1
python src/modules/academic/services/ingestion/docling/runtime/docling_worker.py
```

`libglib2.0-0` supplies `libgthread-2.0.so.0`, which OpenCV/EasyOCR requires on
Debian and Ubuntu. The worker health endpoint also verifies both Docling and
PyMuPDF because Render delegates PDF text-layer inspection to this worker as
well as the heavier Docling extraction.

Expose port `8000` through an HTTPS tunnel. Do not expose Ollama's port for this
job: Render needs this authenticated worker endpoint, not direct access to the
model server.

```bash
ngrok http 8000
```

Verify the worker before updating Render:

```bash
curl -H "Authorization: Bearer $DOCLING_WORKER_TOKEN" https://<worker-tunnel-host>/health
```

Configure the Render backend with:

```text
DOCLING_WORKER_URL=https://<current-worker-tunnel-host>
DOCLING_WORKER_TOKEN=<the exact same secret>
```

`GET /health` and `POST /extract` both require the bearer token. The worker
accepts PDF bodies only, limits input to 250 MB, stores each run in a private
temporary directory, serializes heavy work by default, and deletes the run
directory after the backend downloads its figures. Abandoned runs are removed
automatically after one hour.

The backend POST endpoint only validates and queues a build, then returns HTTP
202. Progress and the terminal result are persisted in MongoDB and polled by
the frontend, so a long Docling run does not keep the browser request open.
Cancellation propagates to the worker and terminates the matching Python
subprocess.

The free tunnel URL changes after a restart. Update `DOCLING_WORKER_URL` on
Render and redeploy whenever that happens. For a durable production setup, use
a reserved tunnel domain or a persistent worker host.
