# adalib-IFL 0.1.0 — Operator, Inverse and MPC reference (Phase 0)

Detailed findings for the modules planned in Phases 2–4. The summary and the Forward
integration are in [api_integration.md](api_integration.md).

Package root (`PKG`): the installed `adalib` package (`backend/.venv/Lib/site-packages/adalib`).
Legacy operator backend (`LEG`): `PKG\_vendor\legacy\operator_mpc_original\cstr_mpc_op`
All file:line references are relative to `PKG` unless prefixed with `LEG/`.
Everything below was checked by reading the code, and smoke tests confirmed the key points (see §7). Python is the venv interpreter with TF 2.21, on Windows.

## 0. Installed package vs GitHub source

`diff -rq` shows that the code is identical. The only differences are:
- `utils/paths.py:7` has a docstring difference (`pip install adalib-IFL` vs `adalib-ode`).
- `LEG/problems/bioreactor_problem.py:62` has a comment difference only.
- The GitHub copy also contains extra non-code files: zips, `results/`, `figures/`, `CLAUDE.md`, `README.md`, `WORKFLOW*.md`, `requirements.txt`, `.vscode`.

The behaviour is the same in both copies.

---

## 1. Operator learning

### 1.1 Signatures
- `run_operator(system, x0=None, t_span=None, params=None, controls=None, options=None, **kwargs) -> OperatorResult` (`workflows/operator_workflow.py:409`)
  - `options` can be an `OperatorOptions`, a `dict`, or `None`. Each kwarg that matches an option field overrides it (`:446-455`, `:464-474`). Kwargs that don't match are **silently ignored**. The option object is shallow-copied, so the caller's object is not mutated.
  - **`controls` is unused in both paths.**
  - The alias `p=` is accepted through kwargs.
- `predict_step(learner, x, theta) -> x_end (n_state,)` (`operator/rollout.py:12`). It builds `z=[x,theta]` and calls `learner.predict_segment(z)["x_end"][0]`.
- `predict_rollout(learner, x0, theta_seq (H,param_dim)) -> (H+1, n_state)` (`operator/rollout.py:31`).
- `OperatorLearner(problem, hidden=256, n_layers=3, lr=1e-3, x_mean=None, x_std=None, basis_name=None)` (`LEG/models/learner.py:68`). It is re-exported from the legacy package (`operator/model.py:13`). It needs a legacy *Problem* object, not an `ODESystem`.
  - Methods: `fit(train_ds, val_ds, epochs, checkpoint_dir, print_every=10, use_lr_schedule=True, ...)` (`:256`), `save_weights(dir, epoch, tag)` (`:306`), `load_weights(path)` (`:315`), `predict_segment(X)` returns a dict with `x`, `xdot`, `x_end` (`:322`), `rollout_full_trajectory(x_input, n_seg)` (`:329`), and `history` = `{"phys_loss", "val_phys_loss", "lr"}` (`:94`).

### 1.2 `OperatorOptions` (`operator/options.py:10-68`)
| field | default | meaning |
|---|---|---|
| basis | "lpa" | "lpa" or "adaf". Only applies to built-in systems. The generic path is always LPA. |
| n_train | 2000 | Number of training full-cases (built-in) or (x0,u) samples (generic). |
| n_val | 200 | Number of validation cases or samples. |
| seed | 42 | Data RNG seed. |
| generate_data | True | Generate new data. |
| reuse_existing_data | False | Load `*_segments.npz` / `generic_data.npz` from `data_dir`. Raises an error if missing. |
| force_rebuild_data | False | Regenerate even when reusing. |
| train | True | Train the model. |
| reuse_existing_checkpoint | False | Load a checkpoint instead of training. |
| epochs | 1000 | Training epochs. |
| batch_size | 256 | Batch size. |
| lr | 3e-3 | Peak learning rate. |
| hidden | 128 | MLP width. **Must match the checkpoint when reloading.** |
| n_layers | 3 | MLP depth. **Must match the checkpoint when reloading.** |
| use_lr_schedule | True | Cosine warm-up schedule (built-in path only). |
| infer | True | Run a rollout from `x0` after training. Skipped when `x0` is None. |
| work_dir | None | Defaults to `./runs/{legacy_name}_operator`, **relative to the CWD** (`:385`). |
| data_dir / checkpoint_dir / log_dir / result_dir | None | Default to `work_dir/data`, `work_dir/checkpoints`, `work_dir/logs`, `work_dir/results`. |
| verbose | True | Print progress. |
| dt | None | **Generic only.** Segment duration. Falls back to `(t1-t0)/n_seg` when `t_span` is given. If both are missing, a `ValueError` is raised. |
| n_seg | 25 | **Generic only.** Number of rollout segments. |
| lpa_n_panels / lpa_max_order / lpa_nt_seg | 8 / 6 / 20 | **Generic only.** LPA basis size. |
| res_scale | None | **Generic only.** `{state_name: scale}` overriding the per-state residual normalisation. The default is `state_bounds span / dt`. |

### 1.3 Supported systems and dispatch
- The `CallableODESystem` check runs first (`:444-458`), then `_run_generic_operator` (`:706`).
- Built-in systems are matched by **substring** against the `_OPERATOR_PROBLEM_MAP` (`:39-45`):

| system | legacy problem |
|---|---|
| `lotka_volterra` | `lotka` |
| `fedbatch_bioreactor` | `bioreactor` |
| `cstr` | `cstr` |
| `triple_tank` | `triple_tank` |

- `euler` raises `NotImplementedError`. `damped_pendulum` and `lotka_volterra_ur`, as well as any registered non-Callable class, end up as `ValueError` or a mis-mapping (because of the substring match: `lotka_volterra_ur` maps to `lotka`). This was verified for euler.
- **On the built-in path, the time grid, ranges and physics come from the legacy config, not from the user.** Values from `LEG/config.py:79-169`:

| system | N_SEG | T_FINAL | DT_SEG |
|---|---|---|---|
| cstr | 25 | 0.5 h | 0.02 h |
| triple_tank | 10 | 300 s | 30 s |
| bioreactor | 50 | 100 | 2 |
| lotka | 20 | 1.0 | n/a |

  `t_span` is ignored. Training data is sampled from hard-coded ranges, for example the CSTR ranges in `LEG/problems/cstr_problem.py:72-79`.
- **On the built-in path, `params` = the legacy θ vector, which differs from the `ODESystem` parameter list.** Each θ is held constant over all segments (`:633-642`). If `params` is None, `problem.nominal_input()` is used.

| system | legacy θ | nominal |
|---|---|---|
| CSTR | `[alpha, beta, F, Q]` (4-D, Q is the control) | `[1, 1, 50, -2000]` |
| triple_tank | `[Q1, Q2]` | `[60, 60]` |
| bioreactor | `[Yx, Sin, inp]` | `[0.4, 0.8, 0.05]` |
| lotka | `[alpha, beta, gamma, delta]` | n/a |

- **Generic `CallableODESystem` path** (physics-residual only, no `solve_ivp` reference):
  - `rhs_tf` is **not needed**. Only `rhs(t, x, u=..., p=None)` is called, and **`p` is never passed** (`mpc/_generic_mpc.py:433,455`). Model parameters must therefore be closed over or have defaults inside `rhs`.
  - `rhs` is first called vectorised, with `x` as a `(n_state, B*Nt)` array and `u` as `(n_control, B*Nt)`. If that raises, it falls back to a per-sample loop and issues a warning (`:410-456`).
  - `control_names` is optional. When it is empty, `n_control` = 0.
  - `state_bounds` are strongly recommended. Missing bounds default to `(-10, 10)`, and missing control bounds default to `(-1e6, 1e6)` (`operator_workflow.py:743-751`). The bounds define the training distribution and the residual scale.
  - **The `params` argument is reinterpreted as a constant control vector** for the inference rollout: `u_const = params[:n_control]`, or zeros if None (`:827-828`).

### 1.4 `OperatorResult` (dataclass, `:49-81`)
| attr | type and shape |
|---|---|
| `t` | `float32 (n_seg+1,)` segment boundaries (built-in: hours for CSTR). `None` if `infer=False` or `x0` is None. |
| `y` | `float32 (n_seg+1, n_state)`, or None. |
| `learner` | `models.learner.OperatorLearner` (built-in). **`None` for the generic path**, which uses a numpy surrogate stored on disk. |
| `train_info` | Built-in: `{"best_checkpoint": path, "best_val_phys_loss": float}`. On reuse: `{"best_checkpoint", "reused": True}`. Generic: `{"best_checkpoint": .../lpa_operator.npz}`, with **no loss value**. |
| `metadata` | Built-in keys: system_name, legacy_problem_name, basis, n_train, n_val, epochs, hidden, n_layers, lr, best_val_loss, best_checkpoint, n_seg, dt_seg, t_final. Generic adds training="physics" and lpa_*, and has no val loss. |
| `paths` | work_dir, data_dir, segment_dir, stats_dir, checkpoint_dir, best_checkpoint, log_dir, result_dir. All are absolute. The checkpoint path mixes `\` and `/`. |
| `system` | The `ODESystem` object. |

Methods:
- `plot(reference="solve_ivp", ...)` returns `(fig, axes, metrics)`.
- `infer(x0=, params=, controls=, cases=, n_cases=, n_steps=, save=True)` returns a list of dicts `{t, y_op, y_ref, u, x0, case_id}` and writes `result_dir/inference.npz`.
- `inference_plot` / `operator_infer` return `(fig, axes)`.
- `load_inference`, `save_inference`, `list_artifacts()`.

**Loss history:**
- Built-in: `result.learner.history` (lists per epoch), also saved to `logs/training_log.npz` with keys `phys_loss`, `val_phys_loss`, `lr` (`:586-592`).
- Generic: **not returned at all**. It is only printed to stdout.

### 1.5 Artifacts and reload
Built-in run (verified):
```
work_dir/metadata.json
work_dir/data/{p}_train_fullcases.npz, {p}_val_fullcases.npz, {p}_train_segments.npz, {p}_val_segments.npz
work_dir/checkpoints/epoch_00001_best.weights.h5 ...   (one file each time val improves; never pruned)
work_dir/logs/training_log.npz
work_dir/results/rollout.npz   (t, y, x0)
```
Generic run: `work_dir/data/generic_data.npz`, `work_dir/checkpoints/lpa_operator.npz` (a pure-numpy surrogate), `results/rollout.npz` and `metadata.json`.

**Reloading for inference without retraining (verified, 0.3 s, bit-identical output):**
```python
run_operator("cstr", x0=..., params=..., options=OperatorOptions(
    work_dir=SAME, generate_data=False, reuse_existing_data=True,
    train=False, reuse_existing_checkpoint=True, hidden=SAME, n_layers=SAME))
```
- On the built-in path the segment data files **must still exist**: `load_segments` is always called to get `X_mean` and `X_std` (`:544`).
- The checkpoint is chosen as `sorted(glob("*best*.weights.h5"))[-1]` (`:599-606`), which is the highest epoch number. **Stale checkpoints from an earlier, longer run in the same directory win.** Use a fresh `work_dir` per training job.
- Generic reload uses `reuse_existing_checkpoint=True`, which loads `lpa_operator.npz` (`:811-819`). Alternatively, load it directly with `adalib.mpc._generic_mpc._NumpyLPASurrogate.load(path).predict_next(x, u)`.
- After a reload, `result.infer(...)` and `predict_step(result.learner, x, theta)` work.

### 1.6 Progress output
Built-in, stdout:
```
[run_operator] system=cstr  legacy=cstr  basis=lpa
[run_operator] work_dir=...
[run_operator] Generating 4 train / 2 val full-case trajectories...
[SAVE] full-case -> <path>  X0=(4, 8)  Y_ref=(4, 1001, 4)
[run_operator] Slicing into segments...
[SAVE] segments -> <path>  X=(100, 8)  Y=(100, 41, 4)
[run_operator] Train segs: 100  Val segs: 50
[run_operator] Training OperatorLearner  epochs=3  hidden=16  n_layers=2  lr=3.00e-03
[LR] cosine warmup: peak=3.0e-03, warmup=0, total=6, min=1.0e-06
[   1/3] phys=1.462648e+03 | val=1.017383e+03 lr=2.25e-03 | 1.93s
[   3/3] phys=1.458670e+03 | val=1.016796e+03 lr=1.00e-06 | 0.02s
[LOAD] weights <- <ckpt>
[run_operator] Loaded best checkpoint: ...
[run_operator] Best val loss: 1016.79...
[run_operator] Rollout: 25 segments, T=0.500 h
```
- The epoch line is printed by `tqdm.write` (`LEG/models/learner.py:298-300`) at epoch 1, every 10th epoch (`print_every=10` is not configurable) and the last epoch.
  - Regex: `^\[\s*(\d+)/(\d+)\] phys=([\d.e+-]+)(?: \| val=([\d.e+-]+))?(?: lr=([\d.e+-]+))? \| ([\d.]+)s$`
- A **tqdm bar goes to stderr every epoch**, using `\r` updates, with postfix `phys=, val=, lr=, ep_s=`. Parse stdout, or parse the tqdm postfix to get per-epoch values.

Generic, stdout (`mpc/_generic_mpc.py:594-596`), printed at epoch 1 and every `max(1, epochs//10)` epochs:
```
[run_operator/generic] Sampling 64 train / 16 val (x0,u) inputs  dt=1.000e-01 s  Nt=20  (physics-only — ...)
  [LPA op-physics    1/3]  loss=2.3199e-03  val=2.4431e-03
[run_operator/generic] LPA operator saved → <path>
```
- Regex: `\[LPA op-physics\s+(\d+)/(\d+)\]\s+loss=(\S+)\s+val=(\S+)`
- Setting `verbose=False` suppresses the `[run_operator]` lines. It does **not** suppress the legacy `[SAVE]`, `[LR]`, epoch lines, `[LOAD]` or the tqdm bar (built-in path).

---

## 2. Inverse

### 2.1 Signatures
- `run_inverse(system, x0, t_span, params: dict, data: ObservationData, options: InverseOptions=None, **kwargs) -> InverseResult` (`workflows/inverse_workflow.py:26`)
  - **`options` must be an `InverseOptions` object, not a dict.**
  - kwargs are applied with `setattr` **onto the caller's options object, which mutates it** (`:95-98`).
  - `system` must be an object. A string is not resolved; call `get_system()` first.
- `ObservationData(t, y, state_indices)` (`inverse/observation.py:15`). `t` has shape `(N,)` and must be strictly increasing and finite. `y` has shape `(N, k)`; a 1-D `y` becomes `(N, 1)`. `state_indices` is a list of k non-negative ints, and column j of `y` corresponds to state `state_indices[j]`. Validation is at `:55-90`. Properties: `n_obs`, `n_observed_states`, `time_range()`.
- `data_gen(result, n_points=None, times=None, state_indices=None, noise_std=0.0, seed=None, source="prediction") -> ObservationData` (`:115`)
  - Takes a `ForwardResult`, whose `y` has shape **`(n_state, N_t)`**. It does not run a solver.
  - It linearly interpolates `result.y` at `n_points` uniform times, or at explicit `times`, or at 50 points by default.
  - It adds Gaussian noise: `noise_std` is a scalar or one value per observed state, using `np.random.default_rng(seed)`.
  - `n_points` and `times` are mutually exclusive.
- `InverseParameter(initial, lower=None, upper=None, name=None)` (`inverse/parameter.py:22`). Bounds are enforced by a transform: lower only uses softplus, upper only uses softplus, and both use sigmoid. **It holds a `tf.Variable` after `.build()`, and building again is a no-op.** Reusing the same object in a second run starts from the previously trained value. Create fresh objects per job, or call `.reset()`.

**Unknowns, fixed values and initial guesses:**
- `params` is an *ordered* dict `{name: float | InverseParameter}`.
- `list(params.values())` is passed positionally as `p` to `system.rhs_tf(var_list, i, p=...)`. The order must therefore match `system.parameter_names`.
- Floats are fixed. Each `InverseParameter` is an unknown, with `initial` as the initial guess and `lower`/`upper` as bounds.
- At least one `InverseParameter` is required, otherwise a `ValueError` is raised (`:119`).

### 2.2 `InverseOptions` (`inverse/options.py:91-137`)
| field | default | meaning |
|---|---|---|
| lambda_physics | 1.0 | Weight of the physics residual. |
| lambda_data | 10.0 | Weight of the data loss. |
| basis | "adaf" | **Only "adaf" is supported** (`solver.py:107`). |
| n_seg | 20 | Number of sequential time segments. |
| N_p | 5 | ADA panels. |
| N_m | 100 | Fourier modes. |
| Nt_total | 1000 | Total collocation points. Truncated to a multiple of `n_seg`. |
| gamma, L | 0.8, 1.0 | ADA geometry. |
| epochs | 5 | Adam steps per segment = `epochs * adam_inner`. |
| adam_inner | 200 | See `epochs`. |
| adam_lr | 1e-3 | Adam learning rate. |
| use_lbfgs | True | Joint L-BFGS-B polish per segment, maxiter 200. **This dominates runtime.** |
| n_passes | 1 | Full sequential passes. |
| warm_seg_passes, n_warm_segs | 1, 3 | Extra passes over the first segments. |
| training_strategy | "joint" | "joint" or "alternating". These are the only methods. |
| data_prefit_steps | 0 | W-only data-fit warm start. |
| normalize_data_loss | True | Normalise the data loss. |
| normalize_physics_loss | False | Normalise the physics loss. |
| verbose | True | Print progress. |
| log_every | 0 | **Dead option.** `run_inverse` never forwards it to `solver.solve`, so per-step lines never print. |
| param_log_every | 1 | Parameter-history sampling interval. |
| dtype | "float64" | Floating-point precision. |
| output_dir | None | If set, `save_all()` writes files there; a relative path is resolved against the CWD. |
| true_params | None | Used only for the reference line in the parameter plot. |

There is only one inverse algorithm: piecewise ADA-F sequential PINN-style training.
- "joint" runs an optional data prefit, then joint Adam on (W, θ), then joint L-BFGS.
- "alternating" alternates W-only and θ-only Adam, then L-BFGS (`solver.py:350-500`).

### 2.3 Supported systems
- Any object whose **`rhs_tf(var_list, i, u=None, p=list_of_tensors)` keeps gradients with respect to `p`.**
  - Built-in: LotkaVolterra, EulerRigidBody, DampedPendulum and LotkaVolterraUR use `tf.cast(p[k])`, which is fine.
  - CSTR and FedBatch use `float(p[k])`. The CSTR smoke test still ran and alpha moved, but this is fragile. TripleTank has no parameters.
- No controls are passed (`u=None`), so systems fall back to their built-in default control.
- **A `CallableODESystem` without `rhs_tf` FAILS** (verified): the numpy bridge inside `tf.function` raises `InvalidArgumentError` from PyFunc, and it could not give θ gradients anyway. **For custom systems, a native `rhs_tf` is required for inverse.**

### 2.4 `InverseResult` (`inverse/result.py:38-63`)
| attr | content |
|---|---|
| `t` | `(Nt_total,)` |
| `y` | `(n_state, Nt_total)`. This is the same orientation as ForwardResult and **the transpose of `MPCResult.x`**. |
| `estimated_params` | `{name: float}` for the unknowns only. |
| `parameter_history` | `{name: [float]}` with one entry per Adam step plus one per L-BFGS stage. |
| `loss_history` | List with one entry per Adam step, plus one per segment's L-BFGS. In "alternating" mode it has one entry per segment. |
| `physics_loss_history`, `data_loss_history` | Same length as `loss_history`. |
| `runtime_sec` | float. |
| `metadata` | system_name, state_names, t_span, x0 (a list of np.float64, **not JSON-safe as-is**), basis, n_seg, lambda_physics, lambda_data. |

Methods: `to_arrays()`, `plot()`, `plot_params()`, `plot_loss()`, `save_npz(path="inverse_result.npz")` (**the default path is in the CWD**), and `save_all(output_dir, ...)`.

`save_all` writes the following files (verified):
- `{system}_trajectory.npz` (t, y, param_*)
- `{system}_loss_history.csv` (step, total_loss, physics_loss, data_loss)
- `{system}_param_history.csv`
- `{system}_trajectory.png`, `{system}_params.png`, `{system}_loss.png`
- `run_metadata.json`

It uses `matplotlib.pyplot`, so set `matplotlib.use("Agg")`.

No model is saved, and the trained ADA weights are not reloadable. The result is just the estimates and the trajectory.

### 2.5 Progress output (stdout)
```
[InverseSolver] Nt_total adjusted to N (divisible by n_seg=K).      (only if adjusted)
[seg   0/3] loss=7.605e+00  phys=4.331e-01  data=7.172e-01  |  alpha=1.4846  gamma=1.1858
...
[InverseSolver] total elapsed: 2.03 s
[run_inverse] outputs saved → ./runs/inv_lv
```
- Multi-pass runs prefix the line with `pass i/n` or `warm i/n`, and print a `=== Pass i/n ===` header.
- Regex: `\[(?:(?:pass|warm) \d+/\d+\s+)?seg\s+(\d+)/(\d+)\] loss=(\S+)\s+phys=(\S+)\s+data=(\S+)\s+\|\s+(.*)$`. The last group is `name=value` pairs separated by two spaces.
- Only per-segment granularity is available live. The full step history is in the result.

---

## 3. MPC

### 3.1 Signature
`run_mpc(system, x0, t_span=None, options=None, **kwargs) -> MPCResult` (`workflows/mpc_workflow.py:307`)
- `options` can be an `MPCOptions`, a dict or None.
- Kwargs override option fields, and unknown kwargs are ignored.
- The options object is copied.
- Each MPC run **trains its own operator surrogate**. It does not reuse `run_operator` results; the CSTR and triple-tank MPC problems are different legacy problems from the operator ones.

### 3.2 `MPCOptions` (`mpc/options.py:10-110`)
| field | default | meaning |
|---|---|---|
| mode | "tracking" | Bioreactor is forced to "economic" (`:389-391`). **This field is ignored on the generic path**, which always does tracking (verified). |
| basis | "lpa" | Basis for the built-in surrogate. |
| n_steps | 20 | Closed-loop steps. |
| horizon | None | Prediction horizon. Built-in default/legacy loops: 1 for CSTR/triple tank, 10 for bioreactor. Surrogate loop and generic: `horizon or 1`. |
| target | None | Built-in CSTR: `{"T_R": v}`, a scalar, or a list where the first non-None entry is used. Default 136.0. Triple tank: a dict by `h1/h2/h3`, or a list with None for the default. Default `[150, 150, 150]` cm in the legacy loop and `{"h3": 150}` in the surrogate loop. **Generic: required**, either a dict `{state: ref}` or a list aligned with `controlled_variables`. |
| control_bounds | None | CSTR: `(lo, hi)` or `{"Q_lo", "Q_hi"}`, default [-8500, 0]. Triple tank: `{"Q1_lo", "Q1_hi", "Q2_lo", "Q2_hi"}`, default [0, 100] each. Bioreactor: `(lo, hi)` or `{"inp_min", "inp_max"}`, default [0.005, 0.2]. Generic: `{ctrl_name: (lo, hi)}`, falling back to `system.control_bounds`, otherwise ±1e6. |
| state_bounds | None | **Generic only.** `{state: (lo, hi)}`, falling back to `system.state_bounds`, otherwise ±10. Defines the training sample range. |
| gradient | None | `None` or "autodiff" or "fd". On built-in systems, any non-None value switches to the horizon-H surrogate loop (`mpc/_surrogate_mpc.py`). On generic, "autodiff" gives an analytic Jacobian to SLSQP. |
| cem_samples, cem_elites, cem_iters, cem_alpha | 512, 64, 8, 0.7 | Used when `optimizer="CEM"` (built-in only). |
| mppi_samples, mppi_iters, mppi_lambda, mppi_noise | 512, 4, 1.0, 0.2 | Used when `optimizer="MPPI"` (built-in only). |
| n_train | 200 | Training samples. |
| n_val | 50 | Validation samples. |
| seed | 42 | Random seed. |
| generate_data / reuse_existing_data / force_rebuild_data | True / False / False | Same as for Operator. |
| train_operator | True | Train the surrogate. |
| reuse_existing_operator | False | Load an existing surrogate instead of training. |
| epochs | 300 | Training epochs. |
| batch_size | 256 | Batch size. |
| lr | 3e-3 | Learning rate. |
| hidden | 256 | MLP width. |
| n_layers | 4 | MLP depth. |
| use_lr_schedule | True | LR schedule. |
| run_closed_loop | True | If False, the run returns after training with empty arrays. |
| work_dir | None | Built-in default: `./runs/{system}_mpc`. Generic default: `./runs/{name}_generic_mpc`. **Both are relative to the CWD.** |
| operator_work_dir | None | Defaults to `work_dir/operator`. |
| mpc_result_dir | None | Defaults to `work_dir/mpc`. |
| checkpoint_dir, data_dir, log_dir | None | Default to subdirectories under `operator_work_dir`. |
| verbose | True | Print progress. |
| control_inputs | None | **Generic.** Overrides `system.control_names`. |
| controlled_variables | None | **Generic.** Tracked states, defaulting to all states. Also used by the built-in surrogate loop. |
| parameter_bounds | None | Unused. |
| dt | None | **Generic.** MPC step and segment length. Otherwise `(t1-t0)/n_steps` from `t_span`. Required. |
| tracking_weights | None | Q weights. Generic default 1; surrogate default 1. |
| control_weights | None | R weights. Generic default 0.01; **surrogate default 0**. |
| terminal_weights | None | P weights. Generic only, defaulting to Q. |
| optimizer | "SLSQP" | "SLSQP", "CEM" or "MPPI". **CEM and MPPI are built-in only; generic always uses SLSQP.** |
| plant_solver | "RK45" | Generic plant `solve_ivp` method. |
| lpa_n_panels / lpa_max_order / lpa_nt_seg | 8 / 6 / 20 | Generic LPA size. |

### 3.3 Supported systems and dispatch
- `CallableODESystem` goes to `run_generic_mpc` (`mpc_workflow.py:343-356`, `mpc/_generic_mpc.py:769`).
- Otherwise the system is matched by substring against `_MPC_PROBLEM_MAP` (`:45-54`):

| system | legacy problem | mode | default loop (`gradient=None`, SLSQP) | surrogate loop (`gradient` set, or CEM/MPPI) |
|---|---|---|---|---|
| cstr | cstr_mpc | tracking T_R | 1-step `minimize_scalar` (`:720`) | horizon-H SLSQP-AD/FD, CEM, MPPI |
| triple_tank | triple_tank_mpc | tracking h | 1-step SLSQP over 2-D Q (`:795`) | same as above |
| fedbatch_bioreactor | bioreactor | **economic** (max Ps·Vs) | shrinking-horizon SLSQP (`:873`) | `_run_economic_mpc` |
| lotka, euler, pendulum | n/a | n/a | `NotImplementedError` (verified for pendulum) | n/a |

- **Economic MPC is built-in only (bioreactor).** The generic path is tracking-only, and its objective is fixed to $\sum_k w_Q\,(y-y_{\mathrm{ref}})^2 + w_R\,u^2$, with $w_P$ on the last step (`_generic_mpc.py:645-655`). There is no custom-objective hook.
- **Built-in plant and units come from the legacy MPC problems, not from `adalib.systems`:**
  - Triple-tank MPC uses heights of 5-300 cm and Q in [0, 100], while `TripleTank.state_bounds` is 1-55 and Q is 0-150.
  - CSTR MPC uses alpha=beta=1, F=50 fixed, and the control Q.
  - Bioreactor uses Yx=0.4, Sin=0.8 fixed.
  - The step length is DT_SEG from config, so `t_span` is ignored: CSTR 1.2 min, triple tank 12 s, bioreactor 2.
  - `t` is in display units: CSTR in minutes (×60), others ×1.
- **Generic requirements:**
  - `control_names` (or `opts.control_inputs`) must be non-empty, otherwise a `ValueError` is raised (`:791-798`).
  - `opts.target` must be non-empty (verified ValueError).
  - `dt` or `t_span` must be given.
  - State bounds are strongly recommended.
  - `rhs_tf` is **not** needed.
  - `rhs(t, x, u=list)` is called with **no `p`** for both data generation and the plant.
  - The surrogate is **data-driven**: `solve_ivp` RK45 segments with trajectory-MSE loss (`_generic_mpc.py:219-380`). This differs from generic `run_operator`, which is physics-only.
  - The target list length must equal the number of tracked states.

### 3.4 `MPCResult` (`mpc_workflow.py:58-88`)
| attr | type and shape |
|---|---|
| `t` | `float32 (n_steps+1,)` |
| `x` | `float32 (n_steps+1, n_state)`: plant states, row-major in time. |
| `u` | `float32`. **`(n_steps,)` for scalar built-in controls (CSTR, bioreactor)**, `(n_steps, 2)` for triple tank, and **`(n_steps, n_control)` always for generic** (even when n_control is 1). |
| `cost` | `float32 (n_steps,)`: per-step optimiser objective. |
| `operator_result` | A dict, not an `OperatorResult`. Built-in: `{"train_info": {best_checkpoint, best_val_phys_loss}, "best_checkpoint", "best_val_loss"}`. Generic: `{"train_info": {"elapsed_s"}, "best_checkpoint": lpa_operator.npz, "best_val_loss": None}`. **No learner object, and no loss history.** |
| `metadata` | system_name, mpc_problem_name, mode, basis, n_steps, n_train, epochs, hidden, n_layers, lr, best_checkpoint, `elapsed_s`, `ms_per_step` (MPC loop only, excluding training), final_state. The surrogate loop adds mpc_optimizer, mpc_horizon, opt_ms_first_step, opt_ms_per_step_mean, nfev/nit stats, and rollouts_per_step. Generic adds surrogate, lpa_*, horizon and dt. |
| `paths` | work_dir, operator_work_dir, mpc_result_dir, operator_dir, mpc_dir, data_dir, checkpoint_dir, log_dir, trajectory_path, control_path, cost_path, closed_loop_path. |
| `system` | The system object. |

Methods: `plot()` and `MPC_result()` return `(fig, axes)`, and `to_arrays()`, `save_npz()`, `load_npz()` and `list_artifacts()` are available.

**`MPC_infer` / `operator_inference_plot` are broken for built-in systems.** No learner is stored, so the method returns `[]` and then raises `ValueError: cases is empty` (verified). For generic systems they work, but use the wrong `dt` (0.02) and `n_seg` (25) because the metadata lacks `dt_seg`/`n_seg` (verified: `t=[0, .02, .04]` while the real dt is 0.2).

**Training-loss history for MPC is not kept in memory.** Parse stdout, or load the checkpoints. There is also no `training_log.npz`, and the `log_dir` is left empty.

Artifacts (verified):
```
work_dir/metadata.json
work_dir/mpc/closed_loop.npz (t, x, u, cost, x0)
work_dir/mpc/trajectories/trajectory.npz, work_dir/mpc/controls/controls.npz, work_dir/mpc/costs/costs.npz
work_dir/operator/data/{cstr_mpc|triple_tank_mpc|bioreactor}_{train,val}_{fullcases,segments}.npz   (generic: generic_data.npz)
work_dir/operator/checkpoints/epoch_XXXXX_best.weights.h5   (generic: lpa_operator.npz)
```

**Reusing the surrogate:**
- Use `generate_data=False, train_operator=False, reuse_existing_operator=True` with the same `work_dir`, plus the same `hidden`/`n_layers` on the built-in path.
- Built-in reuse requires the segments npz to exist.
- Generic reuse verified at 0.01 s for 3 steps.
- Training only: `run_closed_loop=False` returns after saving the surrogate (empty `t/x/u/cost`).
- Studio uses exactly this split: `mpc_train` jobs train once and write `model.json`; `mpc` jobs pass
  `checkpoint_dir`/`data_dir` of that job with `train_operator=False, reuse_existing_operator=True,
  generate_data=False` and a fresh `work_dir`, once per selected controller (`app/services/adalib_mpc.py`).

### 3.5 Progress output (stdout)
Header lines:
```
[run_mpc] system=cstr  mpc_problem=cstr_mpc  mode=tracking
[run_mpc] work_dir=...
[run_mpc] Generating ... / Slicing ... / Training Operator surrogate  epochs=2  hidden=16  n_layers=2
```
These are followed by the same legacy `[SAVE]`, `[LR]`, `[   1/2] phys=... | val=...` and `[LOAD]` lines as Operator, plus the tqdm bar on stderr. Then:
```
[run_mpc] Closed-loop MPC  n_steps=3  T_seg=1.20 min
```
Per-step lines differ by loop:
- CSTR default: `  T_ref=136.0°C  Q_bounds=[-8500, 0] kJ/h` then `  [step   1]  Q*=   -8494 kJ/h  T_R=132.89°C  J=3.337e+00`
- Triple tank: `  [step   1]  Q=[50.0,50.0]  h=[102.9, 94.8, 99.7]  J=7.481e+03`
- Bioreactor: `  [step   1]  inp=0.0050 L/min  Ps=0.008  Vs=1.010  Ps×Vs=0.008 g`
- Surrogate AD/FD: `[run_mpc/surrogate] mode=SLSQP-autodiff  horizon=3  tracked=['T_R']  y_ref=[136.0]` then `  [step   1]  Q=-0.0  y=[135.06]  J=8.933e+00  nit=9  nfev=9  518 ms`
- CEM/MPPI: `  [step   1]  Q=-4085.3  y=[134.01]  J=9.535e+00  (64x2 rollouts, 234 ms)`
- Generic training: `  [LPA op    1/3]  loss=4.9053e-02  val=5.1139e-02`
- Generic step: `  [step   1]  u=[0.0]  y_tracked=[0.0]  J=2.992e+00`

The run ends with `[run_mpc] Completed 3 steps in 0.41s (137.1 ms/step)` (generic: `[run_mpc/generic] Completed ...`).

A generic regex for step lines is `^\s+\[step\s+(\d+)\].*J=([\d.e+-]+)`.

---

## 4. Process-global state and side effects (multi-job safety)

1. **Top-level module names are injected into `sys.path[0]`.** `LEG` (`cstr_mpc_op`) is inserted at import (`operator/model.py:8-10`, `systems/fedbatch_bioreactor.py:12-14`), and `forward_problem_original` is inserted by `inverse/solver.py:39-41`. After `import adalib`, `sys.modules` contains **`config`, `models`, `data`, `utils`, `problems`, `pinn_lib`** (verified).
   - **Do not name any backend module or package `config`, `models`, `data`, `utils` or `problems`**, and do not import your own under those names. The legacy imports would collide.
   - `reload_legacy_chain` calls `importlib.reload(sys.modules["config"])` on whatever object is registered under that name (`utils/legacy_context.py:53-84`).
2. **Process environment and global module constants.** `run_operator` and `run_mpc` set `os.environ["PROBLEM"]` and `os.environ["BASIS"]` and **reload** the legacy `config`, `problems.*`, `data.dataset_builder` and `models.*` modules (`operator_workflow.py:493`, `mpc_workflow.py:431`). Constants such as `N_SEG`, `DT_SEG`, `INPUT_DIM` and `RES_SCALE` are module globals.
   - Two concurrent built-in operator or MPC jobs in one process (threads) **will corrupt each other.**
   - Running them sequentially is fine (verified: CSTR operator, then MPC for cstr/triple_tank/bioreactor, then CSTR operator again, all in one process).
   - The env vars are **not restored** after a run (`PROBLEM=cstr` remained).
   - A learner object from an earlier run still references a reloaded module's `INPUT_DIM`/`RES_SCALE`, so reuse it only before the next job reconfigures, or re-load it.
3. **TF global state.** `tf.function` traces, Keras name counters, `tf.get_logger().setLevel('ERROR')` (generic), and the setting of `TF_CPP_MIN_LOG_LEVEL`. The legacy forward solvers call `np.random.seed` and `tf.random.set_seed`. Run each job in its **own subprocess** (recommended: a process pool with max_workers=1 per job, or `multiprocessing` spawn).
4. **CWD-relative writes.** Default `work_dir` values are `./runs/...` (operator, MPC built-in and generic), `InverseOptions.output_dir` is relative, and `InverseResult.save_npz()` defaults to `./inverse_result.npz`.
   - Always pass absolute `work_dir` and `output_dir` values.
   - There is no `os.chdir` in any workflow; `utils.paths.temporary_working_directory` exists but is unused.
   - Smoke runs from the scratch directory wrote nothing outside `work_dir` (verified).
5. **Encoding.** Prints contain `—`, `→`, `°`, `×` and `…`. With stdout redirected to a pipe on this Korean-locale Windows (cp949), **`run_operator` generic crashed with `UnicodeEncodeError`** (verified). Launch job subprocesses with `PYTHONUTF8=1` (or `PYTHONIOENCODING=utf-8`), or reconfigure `sys.stdout` to UTF-8.
6. **Mutated or stateful inputs.** `run_inverse` mutates the passed `InverseOptions`, and `InverseParameter` objects keep their trained `tf.Variable`. `register_system` mutates the global registry.
7. **Matplotlib.** Inverse `save_all` and every `plot()` use pyplot. Set `matplotlib.use("Agg")` before importing adalib in workers.
8. **stderr noise.** The tqdm bar (built-in training) and a TF "GPU not supported on native Windows" warning go to stderr.

---

## 5. Supported-system matrix

| system (string) | forward | operator | inverse | MPC |
|---|---|---|---|---|
| cstr | yes | yes (legacy θ=[α,β,F,Q]) | runs (`float(p)` in rhs_tf, fragile) | tracking T_R (default, AD/FD, CEM, MPPI) |
| triple_tank | yes | yes (θ=[Q1,Q2]) | no params | tracking h (default, AD/FD, CEM, MPPI) |
| fedbatch_bioreactor | yes | yes (θ=[Yx,Sin,inp]) | fragile (`float(p)`) | **economic only** |
| lotka_volterra | yes | yes (θ=[α,β,γ,δ]) | **yes** (reference example) | no |
| euler | yes | NotImplementedError | **yes** (example: I2, I3) | no |
| damped_pendulum | yes | ValueError | yes (tf.cast) | NotImplementedError |
| CallableODESystem | yes | **yes (generic, physics-only; `rhs` only, no `p`; `params`=constant u)** | **only with a native `rhs_tf`** | **tracking only (generic, data-driven, SLSQP; `control_names`, `target` and `dt` required)** |

---

## 6. Other gotchas

- `OperatorResult.infer(n_cases=N)` on built-in systems looks for keys `x0_cases`/`params_cases` in the val npz. These keys don't exist (the real keys are `x0` and `theta`), so it silently falls back to ±5 % perturbations of `y[0]` (`operator_workflow.py:1074-1099`).
- Generic `infer()` without `u_seq` uses a random U(-5, 5) control rather than the system bounds (`:969-974`).
- Built-in data generation solves `n_train + n_val` reference ODEs with BDF or RK45 at tight tolerances. With the defaults this is 2000+200 CSTR cases for operator and 200+50 for MPC, which takes minutes. The CSTR operator creates 25 segments per case (`segment_sampling_strategy="all"`).
- The CSTR MPC default loop clips states to `X_MIN`/`X_MAX` silently.
- Generic MPC warm-starts at `u=0`. With a weakly trained surrogate, SLSQP can stay at `u≈0` (observed with 3 epochs).
- `OperatorOptions.use_lr_schedule` has no effect on generic paths, which always use `CosineDecay`.

---

## 7. Smoke-test timings

These were measured on this machine (CPU, TF 2.21). `import adalib` takes about 1.9 s.

| run | config | wall time |
|---|---|---|
| Operator built-in cstr | n_train=4, n_val=2, epochs=3, hidden=16, n_layers=2 | **2.6 s** (first epoch about 1.9 s for XLA/tf.function compile, then about 0.02 s per epoch) |
| Operator reload | reuse data + checkpoint | 0.3 s |
| Operator generic (mass-spring-damper) | n_train=64, epochs=3, dt=0.1, n_seg=10 | 0.65 s |
| Inverse LV | n_seg=4, N_m=50, Nt_total=200, epochs=1, adam_inner=20, no L-BFGS | 3.0 s (solver 2.0 s, the rest is PNG saving) |
| Inverse LV with L-BFGS | same as above | 10.5 s |
| MPC cstr default | 4/2 cases, 2 epochs, 3 steps | 3.4 s |
| MPC cstr autodiff H=3 | same | 3.0 s |
| MPC cstr CEM 64×2 | same | 2.8 s |
| MPC triple_tank | same | 1.6 s |
| MPC bioreactor economic | H=3 | 2.3 s |
| MPC generic | n_train=64, 3 epochs, 3 steps, autodiff | 0.7 s |

**Defaults are expensive.**
- Operator CSTR defaults (2000 BDF trajectories plus about 100k segments × 1000 epochs) take tens of minutes to hours.
- MPC defaults (200 cases, 300 epochs, hidden 256×4) take minutes.
- Inverse defaults (20 segments × 1000 Adam steps plus L-BFGS) take several minutes.

Expose `n_train`, `epochs`, `hidden`, `n_layers`, `n_steps`, `use_lbfgs` and `adam_inner` in the GUI with small presets.

Smoke tests were run on 2026-10-08 during Phase 0; their scripts were throwaway and are not part of this repository.
