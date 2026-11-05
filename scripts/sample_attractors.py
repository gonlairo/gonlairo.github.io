"""Sample ensembles of several dysts attractors and write the page data.

Every system gets the same number of trajectories and points so the page can
morph trajectory i of one system into trajectory i of the next. For each system
a long reference orbit picks the starting points; each is nudged slightly and
integrated for the same number of periods, so the curves share a clock.

Coordinates are stored in a common frame: screen-up is the system's chosen
vertical axis, the horizontal plane is rotated so its widest direction faces
the viewer, and everything is scaled to fit the unit cylinder. Values are
quantised to int16 and base64-encoded to keep the file small.
"""

import base64
import json
from pathlib import Path

import numpy as np
import dysts.flows as flows

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "attractors.js"

N_TRAJ = 30
POINTS = 520

# name, label, vertical axis index, points per period (520 / 130 = 4 periods)
SYSTEMS = [
    ("Aizawa", "Aizawa", 2, 130),
    ("NoseHoover", "Nosé–Hoover", 2, 130),
    ("Rucklidge", "Rucklidge", 2, 130),
]


def sample(name, pts_per_period, rng):
    model = getattr(flows, name)()
    reference = model.make_trajectory(3000, resample=True, pts_per_period=60)
    if reference is None:
        raise RuntimeError(f"{name}: reference trajectory failed")
    spread = reference.std(axis=0)
    indices = np.linspace(400, len(reference) - 1, N_TRAJ).astype(int)
    starts = reference[indices] + rng.normal(0.0, 0.015, size=(N_TRAJ, 3)) * spread

    bundle = getattr(flows, name)().make_trajectory(
        POINTS,
        resample=True,
        pts_per_period=pts_per_period,
        init_cond=starts,
    )
    if bundle is None or bundle.ndim != 3 or not np.isfinite(bundle).all():
        raise RuntimeError(f"{name}: ensemble trajectory failed")
    return bundle


def to_frame(bundle, vertical):
    horizontal = [axis for axis in range(3) if axis != vertical]
    h = bundle[..., horizontal]
    v = bundle[..., vertical]

    center_h = h.reshape(-1, 2).mean(axis=0)
    h = h - center_h
    _, _, vt = np.linalg.svd(h.reshape(-1, 2), full_matrices=False)
    h = h @ vt.T

    v_mid = 0.5 * (v.max() + v.min())
    v = v - v_mid
    # A percentile rather than the max, so a few far excursions don't shrink the whole figure.
    extent = np.maximum(np.linalg.norm(h, axis=-1), np.abs(v))
    scale = np.percentile(extent, 99.5)
    return np.stack([h[..., 0], v, h[..., 1]], axis=-1) / scale


def main():
    rng = np.random.default_rng(7)
    half = N_TRAJ // 2
    groups = [0] * half + [1] * (N_TRAJ - half)
    widths = np.round(0.75 + 0.4 * rng.random(N_TRAJ), 3).tolist()

    systems = []
    for name, label, vertical, pts_per_period in SYSTEMS:
        frame = to_frame(sample(name, pts_per_period, rng), vertical)
        # Lower trajectories take the first colour, so colours stay put while morphing.
        order = np.argsort(frame[:, :, 1].mean(axis=1))
        frame = frame[order]
        quantised = np.clip(np.round(frame * 32767), -32767, 32767).astype("<i2")
        systems.append({
            "name": name,
            "label": label,
            "data": base64.b64encode(quantised.tobytes()).decode("ascii"),
        })
        print(f"{name}: ok")

    payload = {
        "count": N_TRAJ,
        "points": POINTS,
        "groups": groups,
        "widths": widths,
        "systems": systems,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "window.ATTRACTORS = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
