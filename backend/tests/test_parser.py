import math

import numpy as np
import pytest

from app.services.equation_parser import EquationError, parse_system, to_latex, parse_expression

LV = (["U", "R"], ["alpha", "beta", "gamma", "delta"], ["alpha*U - beta*U*R", "-gamma*R + delta*U*R"])
P = {"alpha": 40.0, "beta": 160.0, "gamma": 21.2, "delta": 80.0}


def test_numpy_rhs_matches_hand_written():
    ps = parse_system(*LV)
    rhs = ps.rhs_numpy()
    x = [0.5, 0.075]
    expected = [40 * 0.5 - 160 * 0.5 * 0.075, -21.2 * 0.075 + 80 * 0.5 * 0.075]
    np.testing.assert_allclose(rhs(0.0, x, p=P), expected)
    # sequence params ordered like parameter_names (adalib's reference solver passes an array)
    np.testing.assert_allclose(rhs(0.0, x, p=np.array(list(P.values()))), expected)


def test_tf_residual_matches_numpy():
    tf = pytest.importorskip("tensorflow")
    ps = parse_system(["th", "om"], ["g", "k"], ["om", "-k*om - g*sin(th) + exp(-th^2)/sqrt(2)"])
    th = np.linspace(-1, 1, 7)
    om = np.linspace(0.3, 2, 7)
    dth = np.zeros(7)
    dom = np.zeros(7)
    var_list = [(tf.constant(th), tf.constant(dth)), (tf.constant(om), tf.constant(dom))]
    p = [9.81, 0.3]
    rhs_tf = ps.rhs_tensorflow()
    rhs = ps.rhs_numpy()
    for i in range(2):
        res = rhs_tf(var_list, i, p=p).numpy()
        f = np.array([rhs(0, [a, b], p=p)[i] for a, b in zip(th, om)])
        np.testing.assert_allclose(res, -f, rtol=1e-12)


def test_constant_rhs_broadcasts_in_tf():
    tf = pytest.importorskip("tensorflow")
    ps = parse_system(["x"], [], ["2"])
    var_list = [(tf.zeros(5, tf.float64), tf.ones(5, tf.float64))]
    assert ps.rhs_tensorflow()(var_list, 0).shape == (5,)


@pytest.mark.parametrize("expr, msg", [
    ("__import__('os').system('x')", "not allowed"),
    ("U.real", "Unsupported"),
    ("U[0]", "Unsupported"),
    ("lambda: 1", "Unsupported"),
    ("open('f')", "not allowed"),
    ("U if R else 1", "Unsupported"),
    ("'abc'", "numeric"),
    ("U @ R", "not allowed"),
    ("U // R", "not allowed"),
    ("Z * U", "Undefined symbol 'Z'"),
    ("t * U", "time dependence"),
    ("sin", "is a function"),
    ("sin(U, R)", "exactly one"),
    ("U ** 1000", "too large"),
    ("alpha*U -", "Invalid syntax"),
    ("", "empty"),
    ("True", "numeric"),
])
def test_rejects_unsafe_or_invalid(expr, msg):
    with pytest.raises(EquationError, match=msg):
        parse_expression(expr, {"U", "R", "alpha"})


def test_structure_errors():
    with pytest.raises(EquationError, match="equation"):
        parse_system(["x", "y"], [], ["x"])
    with pytest.raises(EquationError, match="more than once"):
        parse_system(["x"], ["x"], ["x"])
    with pytest.raises(EquationError, match="reserved"):
        parse_system(["sin"], [], ["1"])
    with pytest.raises(EquationError, match="identifier"):
        parse_system(["2x"], [], ["1"])


def test_caret_is_power_and_constants():
    ps = parse_system(["x"], [], ["x^2 + pi"])
    assert math.isclose(ps.rhs_numpy()(0, [3.0])[0], 9 + math.pi)


def test_latex():
    assert to_latex(parse_expression("alpha*U - beta*U*R", {"alpha", "beta", "U", "R"})) == \
        r"\alpha \, U - \beta \, U \, R"
    assert to_latex(parse_expression("(a+b)/c", {"a", "b", "c"})) == r"\frac{a + b}{c}"
    assert to_latex(parse_expression("-(a-b)", {"a", "b"})) == r"-\left(a - b\right)"
