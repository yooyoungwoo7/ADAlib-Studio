"""Compatibility of the installed adalib-IFL with what the adapter relies on."""
import dataclasses
import inspect

import pytest

from app.config import SUPPORTED_ADALIB_VERSIONS
from app.schemas.forward import ForwardOptionsModel
from app.services.package_info import adalib_version, forward_option_defaults


def test_installed_version_supported():
    assert adalib_version() in SUPPORTED_ADALIB_VERSIONS


def test_forward_defaults_mirror_package():
    pkg = forward_option_defaults()
    ours = ForwardOptionsModel().model_dump()
    assert set(ours) == set(pkg) - {"verbose"}
    for k, v in ours.items():
        assert pkg[k] == v, k


def test_public_api_signatures():
    adalib = pytest.importorskip("adalib")
    assert list(inspect.signature(adalib.run_forward).parameters)[:5] == \
        ["system", "x0", "t_span", "params", "options"]
    init = inspect.signature(adalib.CallableODESystem.__init__).parameters
    assert {"name", "rhs", "state_names", "parameter_names", "rhs_tf"} <= set(init)
    fields = {f.name for f in dataclasses.fields(adalib.ForwardOptions)}
    assert set(ForwardOptionsModel.model_fields) <= fields
    from adalib.utils.reference import solve_reference_ivp  # noqa: F401
    assert hasattr(adalib.ForwardResult, "to_arrays")


def test_operator_defaults_mirror_package():
    adalib = pytest.importorskip("adalib")
    from app.schemas.operator import OperatorOptionsModel
    pkg = {f.name: f.default for f in dataclasses.fields(adalib.OperatorOptions)}
    for k, v in OperatorOptionsModel().model_dump().items():
        assert pkg[k] == v, k
