# ADALib API integration report

Phase 0 deliverable. Everything here was checked against the installed
**adalib-IFL 0.1.0** from PyPI (import name `adalib`) on 2026-10-08, by reading
the code and running it. Python 3.13.5, TensorFlow 2.21.0, NumPy 2.5.3,
SciPy 1.18.1, Windows 11. The installed package and the GitHub source
(`yooyoungwoo7/ADAF_Library`) contain identical code. They differ only in one
docstring and one comment.

Operator, Inverse and MPC details (signatures, option tables, result shapes,
log formats, artifacts) are in
[adalib_operator_inverse_mpc.md](adalib_operator_inverse_mpc.md).

## 1. Public API

`adalib/__init__.py` exports:

| Area | Names |
|---|---|
| Systems | `ODESystem`, `CallableODESystem`, `LotkaVolterra`, `EulerRigidBody`, `CSTR`, `TripleTank`, `FedBatchBioreactor`, `get_system`, `list_systems`, `register_system` |
| Forward | `run_forward`, `ForwardSolver`, `ForwardOptions`, `ForwardResult` |
| Operator | `run_operator`, `OperatorOptions`, `OperatorResult`, `OperatorLearner`, `predict_step`, `predict_rollout` |
| Inverse | `run_inverse`, `ObservationData`, `InverseParameter`, `InverseOptions`, `InverseResult`, `data_gen` |
| MPC | `run_mpc`, `MPCOptions`, `MPCResult` |
| Dispatcher | `run(feature, system, ...)` |
| Numerical reference | `adalib.utils.reference.solve_reference_ivp` (scipy `solve_ivp`) |

`DampedPendulum` and `LotkaVolterraUR` exist in `adalib.systems` and the
registry but are not exported at the top level.

## 2. Capability matrix (what the Studio can rely on)

| | Forward | Operator | Inverse | MPC |
|---|---|---|---|---|
| Custom equations (`CallableODESystem`) | **full** (needs TF `rhs_tf` for L-BFGS) | generic physics-residual-only path; `rhs` called **without parameters** | only with a native `rhs_tf` | tracking only; needs controls, target, `dt` |
| Built-in systems | all | cstr, triple_tank, fedbatch_bioreactor, lotka_volterra | lotka_volterra, euler, pendulum (cstr/bioreactor fragile) | cstr, triple_tank (tracking); fedbatch_bioreactor (**economic only**) |
| Progress callback | none | none | none | none |
| Live progress source | stdout, per segment / epoch | stdout, every 10th epoch (built-in) | stdout, per segment | stdout, per MPC step |
| History after completion | **not returned** (log only) | built-in: `learner.history`, `training_log.npz`; generic: log only | `loss_history`, `parameter_history` | not returned (log only) |
| Model artifact reusable | no | yes (same `work_dir`, `reuse_existing_checkpoint`) | no | yes (`reuse_existing_operator`) |
| **Studio status** | **implemented (Phase 1)** | **implemented (Phase 2)** | **implemented (Phase 3)** | **implemented (Phase 4)** |

## 3. Forward solver

### 3.1 Call

```python
run_forward(system, x0, t_span, params=None, options: ForwardOptions | None = None, **kwargs) -> ForwardResult
```

The Studio calls it with a `CallableODESystem`. The parameter values go in as a
list ordered like `parameter_names`, and `ForwardOptions(**fields, verbose=True)`.

### 3.2 `ForwardOptions` (defaults read from the installed package)

| Field | Default | Studio control |
|---|---|---|
| `basis` | `"adaf"` | Basis (ADA-F / LPA) |
| `n_seg` | 50 | Segments (ADA-F only) |
| `N_p` | 5 | Advanced → Modes |
| `N_m` | 100 | Advanced → Truncation (ADA-F only) |
| `Nt_total` | 2500 | Grid points |
| `epochs` | 5 | Adam epochs |
| `adam_inner` | 100 | Adam steps / epoch |
| `adam_lr` | 1e-3 | Advanced |
| `use_lbfgs` | True | L-BFGS checkbox |
| `dtype` | `"float64"` | Advanced → Precision |
| `gamma` | 0.8 | Advanced |
| `L` | 1.0 | Advanced (ADA-F only) |
| `order` | 3 | Advanced (LPA only) |
| `verbose` | True | always on (the console needs the log) |

The API server reads these defaults from `adalib/forward/options.py` *without
importing adalib*, which would load TensorFlow (`app/services/package_info.py`).
`tests/test_package.py` asserts that the request schema still mirrors them.

Constraint found in the vendored solver: for ADA-F, `Nt_total % n_seg == 0` is
required. Otherwise the run raises `ValueError`. The Studio validates this
before submitting.

### 3.3 System representation

`CallableODESystem(name, rhs, state_names, parameter_names=..., rhs_tf=...)`:

- `rhs(t, x, u=None, p=None) -> array` (NumPy) is used by the reference solver.
- `rhs_tf(var_list, i, u=None, p=None) -> tensor` returns the **residual**
  `dy_i/dt − f_i(y)`. Here `var_list[k] = (y_k, dy_k/dt)`, and each entry is a
  tensor over one segment's collocation points.
- Without `rhs_tf`, adalib bridges `rhs` through `tf.numpy_function`. That bridge
  silently **disables L-BFGS and XLA** (with a warning). Inverse runs fail
  outright with it.

The Studio's restricted parser (`app/services/equation_parser.py`) compiles
each equation once and evaluates the same validated tree two ways: with NumPy
functions for `rhs`, and with TensorFlow functions for `rhs_tf`. The run keeps
L-BFGS. A parsed Lotka–Volterra system gave **bit-identical** trajectories to
the built-in `adalib.LotkaVolterra` (max difference 0.0).

`rhs_tf` receives no time argument, so **only autonomous systems** can be
expressed. The parser rejects `t` with an explanation.

### 3.4 Result

`ForwardResult`:

| Attribute | Content |
|---|---|
| `t` | `(Nt_total,)` float32 |
| `y` | `(n_state, Nt_total)` **float32**, even when training ran in float64 |
| `solution.meta` | `runtime_sec`, `basis_name`, `n_seg`, `Nt_seg`, `gamma`, `L`, `use_lbfgs`, `lbfgs_method`, … |
| `metadata` | system name, state names, `t_span`, `x0`, params |
| `plot()`, `forward_plot()`, `save_npz()` | matplotlib / file helpers (unused by the Studio) |

There is **no training-history object**. The per-segment `seg_meta` built
inside the solver is discarded. The Studio's training-history chart therefore
plots the losses adalib prints.

### 3.5 Progress lines (parsed by `app/services/log_parser.py`)

```
[seg 3/49] Adam done in 0.264s | loss=5.121e+02 | parts=['3.120e+02', '2.002e+02']
[seg 3/49] L-BFGS done in 0.252s | loss=2.865e-02 | parts=[...] | CONVERGENCE: ...
[epoch 2/5] Adam done in 1.020s | loss=... | parts=[...]          (LPA)
[full] L-BFGS done in 3.100s | loss=... | parts=[...] | ...       (LPA)
```

`loss` is the sum of the per-equation mean-squared residuals, and `parts` are the
individual terms.

### 3.6 Numerical reference

`solve_reference_ivp(system, x0, t_eval, params, method="BDF", rtol=1e-8, atol=1e-10)`
returns `(T, n_state)`. It converts `params` with `np.asarray(params, float)`, so
parameters must be a sequence, not a dict. The Studio passes a list and labels
the result "reference (scipy BDF)" everywhere. The reference never replaces the
ADA result.

### 3.7 Measured results (Studio end-to-end, this machine)

| Example | Settings | Wall time | Relative L2 vs BDF |
|---|---|---|---|
| Lotka–Volterra (paper scaling) | n_seg 50, Nt 2500, epochs 5 | 26–29 s | U 4.7e-3, R 3.4e-3 |
| Euler rigid body | n_seg 20, Nt 500, N_p 10 | ~20 s | 3.3e-3 / 7.8e-3 / 1.2e-2 |
| Damped pendulum | n_seg 50, Nt 2500 | ~30 s | 2.6e-3 / 2.5e-3 |
| LV, coarse grid | n_seg 10, Nt 500, epochs 3 | 7 s | 0.72 (visibly wrong) |
| Pendulum, LPA | N_p 20, Nt 500, epochs 3 | – | ≈1 (did not converge) |

The last two rows matter for users: settings that are too coarse produce a wrong
ADA solution. The Studio does not hide this. It shows the reference
comparison and its error metrics by default.

adalib also emits `OptimizeWarning: Unknown solver options: iprint` with SciPy
1.18. This comes from its L-BFGS options, is harmless, and is shown in the Run
summary as reported.

## 4. Execution constraints that shaped the architecture

1. **One job = one process.**
   - `run_operator` and `run_mpc` set `os.environ["PROBLEM"/"BASIS"]` and reload
     legacy module globals.
   - Importing adalib puts vendored top-level modules (`config`, `models`,
     `data`, `utils`, `problems`, `pinn_lib`) at the front of `sys.path`.
   - TensorFlow seeds and traces are process-wide.

   The API server therefore never imports adalib. Each job runs as
   `python -m app.worker <job_dir>`, and Stop terminates that process.
2. **No progress callbacks.** The worker's stdout and stderr go to `log.txt`,
   which the UI tails. Progress is the last stage line that adalib printed.
3. **Encoding.** On Korean-locale Windows, piped output crashed generic
   `run_operator` with `UnicodeEncodeError`. Workers start with
   `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8`.
4. **CWD-relative writes.** Several defaults write to `./runs/...`. Workers run
   with the job directory as CWD, and later phases will pass absolute
   `work_dir`s.
5. **Start-up cost.** `import adalib` (TensorFlow) takes about 2–3 s per job. The
   console says so while it waits.

## 5. Inputs → adalib objects (Forward)

| UI | Request field | adalib |
|---|---|---|
| State names, x(t₀) | `system.states[].name/initial` | `state_names`, `x0` |
| Parameters | `system.parameters[].name/value` | `parameter_names`, `params` (ordered list) |
| dx/dt equations | `system.equations[i]` | parsed → `rhs` + `rhs_tf` |
| t_start, t_end | `time.t0/t1` | `t_span` |
| Solver options | `options.*` | `ForwardOptions` |
| Reference toggle | `reference` | `solve_reference_ivp(..., method="BDF")` |

## 6. Saved per job (`runs/<job_id>/`)

| File | Content |
|---|---|
| `request.json` | The validated request, so a run can be reproduced or restored |
| `status.json` | Lifecycle and timestamps, return code, error |
| `log.txt` | Full adalib output |
| `result.json` | `t`, `y`, reference, metrics, `solution.meta`, warnings (≤ 20 000 points; downsampled beyond) |
| `trajectory.csv` | Full-resolution `t`, states and reference columns |
| `error.json` | Exception type, message and traceback on failure |

## 7. Operator, Inverse and MPC in the Studio (Phases 2–4)

Each module has its own worker-side adapter
(`app/services/adalib_operator.py`, `adalib_inverse.py`, `adalib_mpc.py`).

### Operator learning
- **Training and prediction are separate jobs.**
  - A training job keeps adalib's work directory under `runs/<id>/model/` and
    writes a manifest, `model.json`. It records the source, the system (and its
    spec for custom models), the training domain, the nominal inputs, the time
    grid, the network size and the adalib version.
  - Prediction calls `run_operator` again with `train=False`,
    `reuse_existing_checkpoint=True` and the same `hidden`/`n_layers`. The model's
    checkpoint and data directories are passed explicitly, while outputs go to the
    prediction's own job directory, so a prediction never rewrites the model's
    files.
- **Custom systems** use the generic path.
  - adalib calls `rhs(t, x, u)` without `p`, so the Studio closes the parameter
    values into the callable (`system_builder.build_operator_system`).
  - The parser's NumPy `rhs` is vectorised over `(n_state, N)`, which keeps
    adalib on its fast batched path.
  - Control inputs are the `params` argument, held constant over the rollout.
- **Built-in systems** read their sampling ranges from the legacy problem class
  at training time and put them in the manifest.
  - Their reference is the problem's own `solve_reference(theta, x0, t)`, which
    adalib uses to generate training data.
  - `OperatorResult.infer(reference=...)` would integrate
    `adalib.systems.CSTR` with the 4-element θ, which does not match the 3
    parameters plus 1 control of that class, so it is not used.
- **Measured** (this machine):
  - Custom pendulum with adalib defaults: about 18 s, about 1–2 % of the range.
  - "Standard" sizes: CSTR 16 s, triple tank 5 s, bioreactor 7 s; worst state
    errors 9 %, 3.5 % and 113 % (Ps) of the range respectively.

### Inverse
- **Parameters.**
  - Unknowns become `InverseParameter(initial, lower, upper)`; the others are
    floats, in `parameter_names` order.
  - adalib passes `InverseParameter.constrained` tensors to `rhs_tf`, so the
    parser binds tensors with `tf.cast` and plain numbers with
    `tf.constant(v, dtype)`. Casting a Python float would go through float32.
- **Observations.**
  - Uploads are validated server-side (`schemas/inverse.clean_observations`).
  - Synthetic data come from scipy Radau (rtol 1e-11) plus Gaussian noise
    relative to each state's RMS, as in adalib's
    `examples/inverse/lotka_volterra_inverse.py`.
- **Results.** Per-state fit RMSE is computed at the observation times, and the
  ODE is re-integrated with the estimated parameters (scipy BDF) as a check.
- **Measured** on the LV example:
  - alpha = 1.99374 every time, identical to adalib's own script.
  - gamma is unreliable: 1.126 in one run, but driven to its lower bound 0 by the
    first segment's L-BFGS in others. This also happens with adalib's own script.

### MPC
- **Custom systems.**
  - Tracking via the generic path: `target={state: ref}`,
    `controlled_variables` = the tracked states (otherwise adalib tracks every
    state), `tracking_weights` and `control_weights` as lists in state/control
    order, and `dt`.
  - Control bounds come from the system's `control_bounds`.
- **Built-in systems.**
  - Studio bounds are translated to the legacy key formats: CSTR
    `{Q_lo, Q_hi}`, triple tank `{Q1_lo, …}`, bioreactor `{inp_min, inp_max}`.
  - The bioreactor is always economic.
- **Results.** `u` is reshaped to `(n_steps, n_controls)`. Tracking errors are
  computed against the targets; the economic value is the final Ps·Vs.
- **Measured.** Pendulum, hold theta = 0.2 (example): theta → 0.194 with
  tau → 1.89 (holding needs 1.95). Closed loop 0.16 s, about 7 s in total
  including surrogate training.

## 8. Missing in adalib 0.1.0 (documented, not simulated)

- No progress callback, and no forward training history object.
- No time-dependent (non-autonomous) right-hand sides for ADA training.
- Forward trajectories are returned as float32.
- Operator (generic path) never passes parameters to `rhs`.
- Economic MPC is limited to the built-in bioreactor, and the MPC objective is
  not configurable.
- `MPCResult.MPC_infer` fails for built-in systems. `OperatorResult.infer(n_cases=…)`
  on built-in systems silently uses ±5 % perturbations of x0.

## 9. Version compatibility

`app/config.py: SUPPORTED_ADALIB_VERSIONS = ("0.1.0",)`. `/api/health`
reports the installed version, and the toolbar marks any other version as
"untested". To adopt a new release:

1. Install it.
2. Run `pytest` (unit tests, then `-m integration`).
3. Update this report and the version tuple.
