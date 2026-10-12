"""Keep tests away from the real job store: the app's lifespan creates a
JobManager on RUNS_DIR at startup, which would re-attach or start the user's
jobs. This must run before app.config is imported."""
import os
import tempfile

os.environ["ADALIB_STUDIO_RUNS"] = tempfile.mkdtemp(prefix="adalib_studio_test_runs_")
