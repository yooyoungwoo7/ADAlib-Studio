# ADALib Studio

**Physics-Informed ODE Simulation & Control.** ADALib Studio is a local browser
workspace for [ADALib](https://github.com/yooyoungwoo7/ADAF_Library), the
Anti-Derivative Approximator library.

- Define an ODE system by typing its equations.
- Configure the solver.
- Run the real ADALib computation in a background process.
- Inspect and export the results.

ADALib Studio is a separate application. It depends on the published package
[`adalib-IFL`](https://pypi.org/project/adalib-IFL/) (import name `adalib`),
calls it unmodified, and never replaces its computations with another solver.

| Module | adalib call | What you can do |
|---|---|---|
| Forward Solver | `run_forward` | Solve your own ODE system (ADA-F or LPA). Live progress, trajectories, phase portrait, training history, comparison with a labelled numerical reference, CSV/JSON/PNG export |
| Operator Learning | `run_operator` | Train a reusable surrogate, either for your own equations (generic physics-residual path, with control inputs) or for a built-in benchmark (CSTR, triple tank, fed-batch bioreactor). Then predict from the saved model with sliders (no retraining), with training-range warnings, a reference comparison and an overlay of past predictions |
| Inverse Solver | `run_inverse` | Estimate unknown parameters (initial guess and bounds) from an uploaded CSV with column mapping and validation, or from synthetic test data. Shows the parameter table, fit vs observations, parameter history, loss and residuals |
| Model Predictive Control | `run_mpc` | Tracking MPC on your own system (states to track, references, weights, control bounds), built-in CSTR and triple-tank tracking, and fed-batch bioreactor economic MPC. Shows closed-loop states with targets, controls with bounds, the per-step objective and a summary |

## Install from PyPI (users)

ADALib Studio ships inside `adalib-IFL` (0.1.1 and later):

```bash
pip install adalib-IFL         # in a virtual environment; includes TensorFlow and ADALib Studio
adalib-studio                  # starts the server and opens http://127.0.0.1:8000
```

Results go to `~/adalib-studio/runs` (`--runs DIR` to change). Run
`adalib-studio --help` for the other options. On Windows,
`scripts\ADAlib-Studio.bat` can be handed out on its own: double-clicking it
creates `%USERPROFILE%\adalib-studio\venv`, installs adalib-IFL on the first
run and starts the app (`ADAlib-Studio.bat update` upgrades).

The sections below are for working on the source.

## Requirements

- Windows, macOS or Linux, with Python 3.10+ (tested on 3.13.5) and Node.js 20+
  (tested on 24.19).
- About 2 GB of disk space for TensorFlow, which adalib installs.

## Install

```powershell
# from the project root
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

The script runs these steps, which you can also run by hand:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt   # adalib-IFL==0.1.0, FastAPI, ...
cd ..\frontend
npm install
npm run build
```

## Run

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

Open <http://127.0.0.1:8000>. The API server also serves the built frontend.

## Release inside adalib-IFL

This repo is the source of the GUI; adalib-IFL carries a generated copy as its
top-level package `adalib_studio` (separate from `adalib`, so the server never
imports TensorFlow). To release a GUI change:

```powershell
$lib = "C:\Users\young\Desktop\python codes\ADAF_Library"
backend\.venv\Scripts\python scripts\sync_to_adalib.py $lib   # npm run build, copy backend/app + frontend/dist
# in ADAF_Library: bump version (pyproject.toml, adalib/__init__.py, docs/source/conf.py), then
cd $lib; python -m build; python -m twine upload dist\adalib_ifl-<version>*
```

In this repo the package is still imported as `app`, so the scripts and tests
above are unchanged. Add each new adalib version to
`SUPPORTED_ADALIB_VERSIONS` in `backend/app/config.py`.

For development, `scripts\dev.ps1` starts the API with auto-reload on :8000
and the Vite dev server on <http://localhost:5173>. The dev server proxies
`/api` to the API.

## Walkthroughs

All four modules work the same way: pick a module and an example on the left,
edit the system in the centre, choose options on the right, and press the
toolbar's run button (**Run**, **Train**, **Estimate** or **Run MPC**;
Ctrl+Enter). The console streams adalib's own output, and the result tabs fill
in when the job finishes.

### Forward Solver

1. The app opens on **Lotka–Volterra (paper scaling)**. Its equations, parameters
   (α = 40, β = 160, γ = 21.2, δ = 80), x₀ = (0.5, 0.075) and t ∈ [0, 1] come from
   ADALib's own example. Two more examples are in the left panel.
2. Edit equations in plain text, for example `alpha*U - beta*U*R`. Each one is
   checked by the backend parser as you type. A formatted preview or a precise
   error message appears under it.
3. Adjust the solver options in the right panel. Defaults come from the installed
   package's `ForwardOptions`. Rarely used options are under **Advanced**.
4. Press **Run** (or Ctrl+Enter). The console streams adalib's output. Progress
   ("segment 12 / 50 · L-BFGS", current loss) comes from that output.
   **Stop** terminates the job's worker process.
5. The result tabs are:
   - Trajectories (ADA solid, reference dashed)
   - Phase portrait
   - Training history (per-segment residual loss as adalib logged it)
   - Error vs reference
   - Data table
   - Run summary (accuracy, adalib's metadata, warnings)
6. Exports:
   - **CSV** gives the full-resolution trajectory.
   - **Config JSON** gives the exact request.
   - The camera icon on any chart saves a PNG.
   - **Save** in the toolbar stores the whole project as `.adalib-studio.json`,
     which **Open** loads back.

Every run is kept in `runs/<job_id>/`, together with its request, log and
result. **Run history** reopens it, and **Restore inputs** loads its settings
back into the editor.

### Operator Learning

1. Choose **Custom equations** or **Built-in benchmark** in the right panel.
   - **Custom:** each state needs a training range, and inputs held constant over
     the rollout go under **Control inputs**. Examples: damped pendulum with
     torque, mass-spring-damper with force.
   - **Built-in:** CSTR, triple tank or fed-batch bioreactor. adalib supplies the
     equations, time grid and ranges.
2. Choose a training size.
   - **adalib defaults:** about 20 s for custom systems, with about 1-2 % error
     in our tests.
   - **Standard:** 5-16 s for the built-ins.
   - **Quick look:** a few seconds, to check a setup only.
3. Press **Train**. The model is saved in its run directory together with
   `model.json`, which records the training domain, time grid and network size.
4. **Predict** tab: set x₀ and the inputs with sliders or numbers, then press
   **Predict**. Each prediction reloads the trained model through adalib's reuse
   path; nothing is retrained.
   - Values outside the training range are allowed but flagged.
   - The dashed line is the reference: scipy for custom systems, adalib's own
     `solve_reference` for built-ins.
5. **Compare** overlays up to 8 predictions. **Training** shows the loss history
   and the model card.

### Inverse Solver

1. Define the model as in the Forward solver. Under **Unknown parameters**, tick
   the parameters to estimate and give each an initial guess and optional bounds.
   The other parameters stay fixed at their values.
2. Observations:
   - **Upload CSV:** comma, semicolon or tab separated, header optional. Map a time
     column and one column per observed state; not every state needs to be
     observed. The app checks numeric content, strictly increasing time, the time
     range and missing values (incomplete rows are dropped and reported).
   - **Synthetic (test):** generated from an independent scipy Radau solution with
     the parameter values entered, plus Gaussian noise. This follows adalib's own
     example and avoids fitting ADA-generated data with ADA.
3. Press **Estimate**. The console shows each segment's loss and the current
   parameter values.
4. Result tabs:
   - Parameters (estimate, guess, bounds, reference, error)
   - Fit vs observations (with a scipy re-integration using the estimated
     parameters)
   - Parameter history
   - Training loss (total, physics, data)
   - Residuals
   - CSV exports

### Model Predictive Control

1. **Custom (tracking):**
   - Define the plant equations with state ranges (the surrogate's training box)
     and control inputs with bounds.
   - Set the control interval dt.
   - Under **Tracking objective**, tick the states to track and set references
     and weights.
   - adalib's objective form is fixed: Σ w_Q (y − y_ref)² + w_R u².
2. **Built-in:**
   - CSTR temperature tracking and triple-tank level regulation (x₀ and targets
     from adalib's MPC example).
   - Fed-batch bioreactor economic MPC (maximise the final Ps × Vs).
   - x₀, targets and control bounds are editable.
3. **Train the surrogate once** (MPC panel → *1 · Surrogate* → **Train surrogate**).
   The trained surrogate is saved like an Operator model and listed for the
   system it was trained on. A custom surrogate matches only the same equations,
   parameter values, state/control ranges and dt. Surrogates that earlier
   one-shot MPC runs trained are listed too.
4. **Run MPC** runs only the closed loop on the selected surrogate
   (`run_mpc(..., reuse_existing_operator=True)`); nothing is retrained.
   Closed-loop options: steps, horizon, and the controllers to compare on the
   same surrogate:
   - FD: SLSQP with a finite-difference gradient
   - AD: SLSQP with the autodiff gradient through the surrogate
   - CEM / MPPI: batched sampling (built-in systems only in adalib 0.1.0)
5. Result tabs (all selected controllers overlaid):
   - Closed-loop plant states with targets
   - Piecewise-constant controls with bounds
   - Per-step objective
   - Controller comparison (tracking errors or economic value, optimizer
     ms/step, cost evaluations per step, closed-loop time)

### Equation syntax

- Operators: `+ - * / ^` (or `**`) and parentheses.
- Functions: `sin cos tan asin acos atan sinh cosh tanh exp log sqrt abs`.
- Constants: `pi`, `e`.
- Symbols: every symbol must be a declared state, parameter or (Operator / MPC)
  control input.

Input is parsed with a strict allowlist. Nothing typed in the UI is
executed as Python.

## Known limitations

- **Autonomous systems only.** adalib 0.1.0's TensorFlow residual interface
  does not receive `t`, so equations cannot use time explicitly.
- **Coarse settings give wrong answers.** For example, Lotka–Volterra with
  10 segments has a relative error of about 0.7. Keep the reference comparison
  on. It is there to show this.
- **Operator accuracy depends on the training size.** Custom "Standard" models
  were coarse in tests (20–30 % of the range after 25 rollout steps); adalib
  defaults reached about 1–2 %.
- **Built-in operator time grids and ranges are fixed by adalib.** For example,
  CSTR training initial states stay within 5 % of the nominal state.
- **Inverse estimates can be unreliable.** In the Lotka–Volterra example (taken
  from adalib), alpha is recovered reproducibly. gamma, however, is sometimes
  driven to its lower bound 0 by the first segment's L-BFGS step; this also
  happens with adalib's own example script. The parameter-history tab shows when
  this happens.
- **MPC:**
  - Custom systems support tracking only, with adalib's fixed objective.
  - Economic MPC exists only for the built-in bioreactor.
  - A barely trained surrogate ("Quick look") may not move the plant at all.
  - Conventional NMPC (the ODE integrator inside the optimizer) is not part of
    adalib 0.1.0, so it is not offered as a controller.
- **Trajectories are float32.** adalib returns them in float32, whatever the
  training precision.
- **Training history comes from the log.** adalib has no progress callback or
  forward history object, so live progress and the loss chart come from its
  printed log.
- **Jobs start slowly.** Each job is a fresh Python process (adalib keeps
  process-global state), so loading TensorFlow adds 2–3 s.
- **One job at a time by default.** Set `ADALIB_STUDIO_MAX_PARALLEL` to run more.
  Jobs submitted while another runs wait as *pending*.
- **Server restarts keep running jobs.** Workers write their own results; a
  restarted server re-attaches to workers that are still alive and re-queues
  pending jobs.
- **No authentication.** This is a local application, so bind it to 127.0.0.1
  only.

## Tests

```powershell
cd backend
.\.venv\Scripts\python -m pytest -m "not integration"   # parser, API, package compatibility
.\.venv\Scripts\python -m pytest -m integration         # real adalib runs via worker processes (~3 min)
cd ..\frontend
npm test                                                 # components, project files, chart builders
```

## Project layout

```
backend/   FastAPI app (app/), worker entry point, tests
  app/api/routes.py              REST endpoints
  app/services/equation_parser.py  restricted parser -> NumPy rhs + TF rhs_tf
  app/services/adalib_*.py         the only modules that call adalib (forward / operator / inverse / mpc; run in workers)
  app/services/job_manager.py      process-per-job execution, logs, cancellation
  app/examples/catalog.py          built-in examples with provenance
frontend/  React + TypeScript + Vite + Tailwind + Plotly
docs/      api_integration.md (Phase 0 report), architecture.md, adalib_operator_inverse_mpc.md
scripts/   setup / start / dev
runs/      job directories (created at runtime, git-ignored)
```

See [docs/architecture.md](docs/architecture.md) for the design and
[docs/api_integration.md](docs/api_integration.md) for how each input maps
onto adalib.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `ADALIB_STUDIO_RUNS` | `./runs` | Job storage directory |
| `ADALIB_STUDIO_PYTHON` | backend interpreter | Python used for workers (must have adalib-IFL) |
| `ADALIB_STUDIO_MAX_PARALLEL` | 1 | Concurrent worker processes |
| `ADALIB_STUDIO_CORS` | localhost:5173 | Allowed dev origins |

## License

MIT; see [LICENSE](LICENSE). ADALib itself (`adalib-IFL`) is also MIT. The
built frontend bundles React, Plotly.js and KaTeX, all under the MIT license.
