"""Conservative landmark clean-up.

A swing moves the hands and bat through the frame in a few hundredths of a
second. A normal low-pass filter would flatten exactly the motion we care
about, so this only removes isolated single-frame spikes: a point that jumps
away and straight back. Continuous fast movement passes through untouched.

Gaps are NOT filled. A joint the model could not see stays unavailable (NaN);
inventing anatomy between two good frames is how a measurement gets made up.
"""

from __future__ import annotations

import numpy as np


def despike(series: np.ndarray, scale: float, k: float = 0.08) -> np.ndarray:
    """Replace single-frame spikes in an (n, d) series.

    A sample counts as a spike when it is more than `k * scale` away from BOTH
    neighbours while the neighbours agree with each other to within that same
    distance. `scale` is a body length in the same units (so the rule is the
    same for a close-up and a wide shot). NaNs are left alone.
    """
    out = series.copy()
    n = len(series)
    if n < 3 or not np.isfinite(scale) or scale <= 0:
        return out
    tol = k * scale
    for t in range(1, n - 1):
        a, b, c = series[t - 1], series[t], series[t + 1]
        if not (np.all(np.isfinite(a)) and np.all(np.isfinite(b)) and np.all(np.isfinite(c))):
            continue
        if (np.linalg.norm(b - a) > tol and np.linalg.norm(b - c) > tol
                and np.linalg.norm(a - c) <= tol):
            out[t] = (a + c) / 2.0
    return out
