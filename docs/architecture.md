# Architecture

```
Browser (React + TypeScript)                 FastAPI process (never imports adalib)
┌──────────────────────────────┐   REST    ┌──────────────────────────────────────┐
│ Toolbar · Module navigator   │ ───────▶  │ api/routes.py                         │
│ System editor · Config panel │           │  ├─ schemas/ (Pydantic validation)    │
│ Results (Plotly) · Console   │ ◀───────  │  ├─ services/equation_parser.py       │
└──────────────────────────────┘  polling  │  ├─ services/job_manager.py ──┐       │
                                            └───────────────────────────────│───────┘
                                                spawn one process per job   ▼
                                            ┌──────────────────────────────────────┐
                                            │ python -m app.worker runs/<job_id>    │
                                            │  services/adalib_{adapter,operator,   │
                                            │           inverse,mpc}.py             │
                                            │  services/system_builder.py           │
                                            │        │                              │
                                            │        ▼  adalib-IFL (PyPI)           │
                                            │  stdout+stderr ──▶ runs/<id>/log.txt  │
                                            │  result.json, trajectory.csv          │
                                            └──────────────────────────────────────┘
```

## Separation of concerns

| Layer | Responsibility | Knows about adalib? |
|---|---|---|
| Frontend | Editing, validation display, job monitoring, plots, export | No. It sees only JSON schemas |
| API (`app/api`, `app/schemas`) | Validation, job submission, status, log tail, files | Only package *metadata* (version, option defaults read by file path) |
| Parser (`equation_parser.py`) | Safe expression grammar → NumPy and TensorFlow callables, LaTeX | No |
| Worker + adapters (`adalib_*.py`) | Build adalib objects, call the public API, serialise results | **Yes. These are the only places** |
| Job manager | Process lifecycle, queue, cancellation, recovery after restart | No |

## Why polling, not WebSockets

Progress is the worker's log file, so the frontend asks for
`/api/jobs/{id}` (status and the last parsed stage line) and
`/api/jobs/{id}/log?offset=n` (new bytes only) once a second. That is enough
for training stages that last seconds. It also has no connection state to lose
when the server restarts, and later phases can swap in SSE without changing the
worker.

## Job lifecycle

`pending → running → completed | failed | cancelled`

- `MAX_PARALLEL_JOBS` (default 1) limits concurrent workers. Extra jobs wait as
  `pending`.
- Cancel kills the worker's process tree (`taskkill /T /F` on Windows,
  `terminate()` elsewhere).
- When the server starts, it re-attaches to `running` jobs whose worker process
  is still alive. It checks the PID together with the process start time, to
  guard against PID reuse. Jobs whose worker is gone are marked `failed`, and
  `pending` jobs are queued again. Workers write their own log and result files,
  so nothing is lost while the server is down.
- A normal shutdown (Ctrl+C, `--reload`) leaves running workers alone.
- Each job directory is self-contained. A persistent queue (Redis/RQ, Celery)
  can replace the in-memory scheduler without changing the worker contract
  (`request.json` in, `result.json` / `error.json` out).

## Equation safety

`ast.parse(mode="eval")` builds the tree, and a validator walks it. It accepts
only these node types:

- numeric literals and declared names
- `+ - * / **`, unary `+ -`
- calls to allowlisted functions with one argument

Expressions are limited to 2000 characters, 500 nodes and literal exponents
≤ 100. Evaluation is a small interpreter over the validated tree. `eval`/`exec`
are never used.

## Adding a module (Phases 2–4)

1. Add a Pydantic request schema in `app/schemas/`.
2. Add `run_<module>_job(req, job_dir)` in a new `adalib_<module>.py`.
3. Dispatch on the new `kind` in `app/worker.py`.
4. Add a route that validates the request and calls `jobs.submit(kind, payload)`.
5. Add a log parser for the module's stdout format (see
   `adalib_operator_inverse_mpc.md` §1.6, 2.5, 3.5).
6. Frontend: a config panel, a results view and an entry in the module navigator.
