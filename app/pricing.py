"""Horizon-aware price forecast with split-conformal intervals (the research core).
Model: ridge regression on K log-price lags, direct h-week-ahead. Interval: conformal quantile of
absolute errors from the last `cal` rolling-origin forecasts. NOTE: time series are not exchangeable,
so report *empirical* coverage in your paper (eval/backtest.py does this)."""
import numpy as np, pandas as pd
from functools import lru_cache

K = 4

@lru_cache(maxsize=2)
def load(csv):
    return pd.read_csv(csv, parse_dates=["date"])  # columns: date, commodity, modal_price (Rs/kg)

def weekly(d, crop):
    s = d[d["commodity"] == crop].set_index("date")["modal_price"].resample("W").mean()
    return s.interpolate(limit=3).dropna()

def _ridge_predict(y, steps, lam=1.0):
    idx = range(K, len(y) - steps + 1)
    X = np.array([y[i - K:i] for i in idx])
    t = np.array([y[i + steps - 1] for i in idx])
    Xb = np.c_[np.ones(len(X)), X]
    w = np.linalg.solve(Xb.T @ Xb + lam * np.eye(K + 1), Xb.T @ t)
    return float(np.r_[1, y[-K:]] @ w)

def forecast(s, h=2, alpha=0.1, cal=26):
    y = np.log(np.asarray(s, dtype=float))
    n = len(y)
    need = K + cal + h + 10
    if n < need:
        raise ValueError(f"need >= {need} weekly points, have {n}")
    errs = [abs(y[e + h - 1] - _ridge_predict(y[:e], h)) for e in range(n - cal - h + 1, n - h + 1)]
    q = float(np.quantile(errs, min(1.0, (1 - alpha) * (1 + 1 / len(errs)))))
    p = _ridge_predict(y, h)
    return {"h_weeks": h, "point": round(float(np.exp(p)), 2), "lo": round(float(np.exp(p - q)), 2),
            "hi": round(float(np.exp(p + q)), 2), "coverage_target": 1 - alpha, "n_cal": len(errs)}

def cold_start(own, proxy, h=2, alpha=0.1):
    """Sparse crop (e.g. dragon fruit): forecast a data-rich proxy series, rescale by recent price ratio."""
    k = float(own.tail(8).mean() / proxy.tail(8).mean())
    f = forecast(proxy, h, alpha)
    f.update({x: round(f[x] * k, 2) for x in ("point", "lo", "hi")}, method="proxy-scaled", scale=round(k, 3))
    return f
