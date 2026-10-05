"""Rolling-origin backtest -> the results table for your paper.
Usage (from project root): python -m eval.backtest data/prices.csv Avocado "Dragon fruit" Tomato"""
import sys, numpy as np
from app.pricing import load, weekly, forecast

def run(csv, crops, h=2, alpha=0.1, test=40):
    d = load(csv)
    print(f"{'crop':14}{'naiveMAPE%':>11}{'modelMAPE%':>11}{'cover%':>8}{'width%':>8}   (h={h}w, target cover {100*(1-alpha):.0f}%)")
    for c in crops:
        s = weekly(d, c); n = len(s); nv, md, cv, wd = [], [], [], []
        for end in range(n - test, n - h + 1):
            tr, actual = s.iloc[:end], s.iloc[end + h - 1]
            f = forecast(tr, h, alpha)
            nv.append(abs(tr.iloc[-1] - actual) / actual); md.append(abs(f["point"] - actual) / actual)
            cv.append(f["lo"] <= actual <= f["hi"]); wd.append((f["hi"] - f["lo"]) / actual)
        print(f"{c:14}{100*np.mean(nv):11.1f}{100*np.mean(md):11.1f}{100*np.mean(cv):8.1f}{100*np.mean(wd):8.1f}")

if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2:])
