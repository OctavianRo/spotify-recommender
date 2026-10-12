"""Deterministic, inspectable DSP. Spotify streams are never downloaded."""
from __future__ import annotations

import warnings
import numpy as np
import librosa
from scipy.spatial.distance import cdist
from scipy.signal import find_peaks

SR = 22050
HOP = 512
GROUPS = {
    "timbre": {"label": "Sound texture", "weight": 0.28, "description": "MFCC shape, texture variation, brightness and spectral flatness"},
    "harmony": {"label": "Harmonic colour", "weight": 0.18, "description": "Transposition-invariant pitch-class intervals, harmonic entropy and chord movement"},
    "rhythm": {"label": "Rhythm & pulse", "weight": 0.18, "description": "Onset density, estimated tempo and onset autocorrelation"},
    "dynamics": {"label": "Dynamic contrast", "weight": 0.16, "description": "Loudness range, crest factor, harmonic/percussive balance and build slope"},
    "structure": {"label": "The way it builds", "weight": 0.20, "description": "Dynamic time warping of loudness, brightness and onset trajectories"},
}


def timeline(values: np.ndarray, n: int = 64) -> np.ndarray:
    """Average entire track into normalized-time bins; no first-30s shortcut."""
    return np.array([float(np.mean(v)) if len(v) else 0.0 for v in np.array_split(values, n)])


def feature_schema() -> list[dict]:
    """Labels follow the exact ordering of the ranking vectors."""
    descriptors = []
    def add(group, label, unit, meaning):
        descriptors.append({"group": group, "index": sum(d["group"] == group for d in descriptors), "label": label, "unit": unit, "meaning": meaning})
    for statistic, meaning in [("mean", "Average spectral envelope; a coarse measure of sound texture."), ("variation", "How much spectral texture varies across the whole recording."), ("movement", "Average absolute texture change between adjacent analysis frames.")]:
        for i in range(1, 14):
            add("timbre", f"MFCC {i:02d} · {statistic}", "coefficient", meaning)
    for feature, meaning in [("Centroid", "Centre of spectral energy; a brightness cue."), ("Bandwidth", "Spread of energy around the spectral centroid."), ("Rolloff", "Frequency below which 85% of spectral energy sits."), ("Flatness", "How noise-like rather than tone-like the spectrum is.")]:
        for stat in ["mean", "variation"]:
            add("timbre", f"{feature} · {stat}", "fraction", meaning + (" Frequencies are fractions of the 11,025 Hz Nyquist limit." if feature != "Flatness" else ""))
    for i in range(1, 7):
        add("harmony", f"Pitch interval · {i} semitones", "correlation", "Circular pitch-class autocorrelation captures interval colour without requiring the same key.")
    for label, meaning in [("Pitch-class entropy", "How evenly energy spreads across pitch classes; not an emotion score."), ("Chord movement · mean", "Mean frame-to-frame change in harmonic chroma; not a chord transcription."), ("Chord movement · variation", "Variation in frame-to-frame harmonic change.")]:
        add("harmony", label, "index", meaning)
    add("rhythm", "Tempo · log ratio", "octaves vs 120 BPM", "Estimated pulse rate on a logarithmic scale; half/double-time errors are possible.")
    add("rhythm", "Onset density", "events / second", "Detected attack peaks per second of recording.")
    add("rhythm", "Pulse strength", "correlation", "Maximum onset autocorrelation over the sampled lags.")
    for lag in np.linspace(.18, 1.5, 24):
        add("rhythm", f"Pulse lag · {lag:.3f} s", "correlation", "Onset-pattern recurrence after this time lag; related pulses can share a rhythmic feel.")
    for label, unit, meaning in [("Loudness range", "dB", "95th minus 5th percentile frame loudness; a contrast cue."), ("Crest factor", "dB", "Peak-to-RMS ratio; relates to transient strength and compression."), ("Harmonic energy share", "fraction", "HPSS harmonic energy divided by harmonic plus percussive energy; not an instrument detector."), ("Build slope", "dB / song", "Linear loudness slope across normalized song time; not a measure of emotion.")]:
        add("dynamics", label, unit, meaning)
    return descriptors


def extract(y: np.ndarray, sr: int = SR) -> dict:
    y = np.asarray(y, dtype=np.float32)
    if y.ndim != 1 or len(y) < sr * 3 or not np.isfinite(y).all():
        raise ValueError("Use a valid audio file at least 3 seconds long.")
    if np.max(np.abs(y)) < 1e-5:
        raise ValueError("This recording is silent; there is no musical signal to compare.")
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
    # Normalize global gain, retaining relative dynamics within the recording.
    y = y / max(float(np.max(np.abs(y))), 1e-6)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=UserWarning)
        S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
        power = S ** 2
        mel = librosa.feature.melspectrogram(S=power, sr=SR, n_mels=64)
        mfcc = librosa.feature.mfcc(S=librosa.power_to_db(mel), n_mfcc=14)[1:]
        delta = np.diff(mfcc, axis=1)
        centroid = librosa.feature.spectral_centroid(S=S, sr=SR)[0] / (SR / 2)
        bandwidth = librosa.feature.spectral_bandwidth(S=S, sr=SR)[0] / (SR / 2)
        rolloff = librosa.feature.spectral_rolloff(S=S, sr=SR)[0] / (SR / 2)
        flatness = librosa.feature.spectral_flatness(S=S)[0]
        harmonic, percussive = librosa.decompose.hpss(S)
        chroma = librosa.feature.chroma_stft(S=harmonic ** 2, sr=SR, hop_length=HOP)
        p = np.mean(chroma, axis=1)
        p /= max(p.sum(), 1e-8)
        # Circular autocorrelation preserves interval colour when the key changes.
        intervals = np.array([np.dot(p, np.roll(p, i)) for i in range(1, 7)])
        chord_change = np.linalg.norm(np.diff(chroma, axis=1), axis=0)
        entropy = -np.sum(p * np.log2(p + 1e-10)) / np.log2(12)
        onset = librosa.onset.onset_strength(S=librosa.power_to_db(mel), sr=SR, hop_length=HOP)
        ac = librosa.autocorrelate(onset, max_size=min(len(onset), int(2.5 * SR / HOP)))
        ac /= max(float(ac[0]), 1e-8)
        lags = np.linspace(0.18, 1.5, 24) * SR / HOP
        pulse = np.interp(lags, np.arange(len(ac)), ac)
        tempo = float(librosa.feature.tempo(onset_envelope=onset, sr=SR, hop_length=HOP)[0])
        peaks, _ = find_peaks(onset, distance=max(1, int(0.1 * SR / HOP)), prominence=max(float(np.std(onset)) * .5, 1e-5))
        rms = librosa.feature.rms(S=S, frame_length=2048)[0]
        db = 20 * np.log10(rms + 1e-7)
        rms_curve = timeline(db)
        relative_db = np.clip((rms_curve - np.percentile(db, 5)) / max(float(np.ptp(rms_curve)), 6), 0, 1)
        onset_curve = timeline(onset)
        onset_curve /= max(float(np.percentile(onset, 95)), 1e-7)
        structure = np.stack([relative_db, timeline(centroid), np.clip(onset_curve, 0, 2)], axis=1)
        hp_ratio = float(np.sum(harmonic ** 2) / max(float(np.sum(harmonic ** 2) + np.sum(percussive ** 2)), 1e-8))
        duration = len(y) / SR
        features = {
            "timbre": np.concatenate([mfcc.mean(axis=1), mfcc.std(axis=1), np.abs(delta).mean(axis=1), *[[x.mean(), x.std()] for x in (centroid, bandwidth, rolloff, flatness)]]),
            "harmony": np.concatenate([intervals, [entropy, np.mean(chord_change), np.std(chord_change)]]),
            "rhythm": np.concatenate([[np.log2(max(tempo, 1) / 120), len(peaks) / duration, float(np.max(pulse))], pulse]),
            "dynamics": np.array([np.percentile(db, 95) - np.percentile(db, 5), 20 * np.log10(1 / max(float(np.sqrt(np.mean(y ** 2))), 1e-7)), hp_ratio, np.polyfit(np.linspace(0, 1, 64), rms_curve, 1)[0]]),
            "structure": structure,
        }
        visuals = {
            "mel_db": [timeline(row, 128).tolist() for row in librosa.power_to_db(mel, ref=np.max, top_db=80)],
            "mel_frequencies_hz": librosa.mel_frequencies(n_mels=66, fmin=0, fmax=SR/2)[1:-1].tolist(),
            "mfcc": [timeline(row, 128).tolist() for row in mfcc],
            "chroma": [timeline(row, 128).tolist() for row in chroma],
            "waveform_min": [float(chunk.min()) for chunk in np.array_split(y, 256)],
            "waveform_max": [float(chunk.max()) for chunk in np.array_split(y, 256)],
            "loudness_db": timeline(db, 128).tolist(),
            "pitch_classes": ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"],
        }
    return {
        "groups": {k: np.nan_to_num(v).tolist() for k, v in features.items()},
        "duration": round(duration, 2),
        "summary": {"tempo": round(tempo, 1), "brightness": round(float(centroid.mean()), 4), "dynamic_range_db": round(float(np.percentile(db, 95) - np.percentile(db, 5)), 2), "harmonic_ratio": round(hp_ratio, 4), "onsets_per_second": round(len(peaks) / duration, 2)},
        "timeline": {"loudness": relative_db.tolist(), "brightness": timeline(centroid).tolist(), "onsets": np.clip(onset_curve, 0, 2).tolist()},
        "visuals": visuals,
        "version": "dsp-v2",
    }


def dtw_distance(a: np.ndarray, b: np.ndarray) -> float:
    """Constrained DTW, with distance per alignment step, symmetric in inputs."""
    cost = cdist(a, b) / np.sqrt(a.shape[1])
    accumulated, path = librosa.sequence.dtw(C=cost, global_constraints=True, band_rad=.20)
    return float(accumulated[-1, -1] / len(path))


def compare_pair(tracks: list[dict], reference_id: str, candidate_id: str, weights: dict | None = None) -> dict:
    """Pair evidence uses the same full-library scaling as recommendations."""
    index = {t["id"]: i for i, t in enumerate(tracks)}
    if reference_id not in index or candidate_id not in index:
        raise ValueError("Choose recordings from the current collection.")
    if reference_id == candidate_id:
        raise ValueError("Choose two different recordings for comparison.")
    values = np.array([float((weights or {}).get(k, g["weight"])) for k, g in GROUPS.items()])
    if not np.isfinite(values).all() or np.any(values < 0) or values.sum() <= 0:
        raise ValueError("Choose non-negative weights, with at least one above zero.")
    w = dict(zip(GROUPS, (values / values.sum()).tolist()))
    X = normalized_catalog(tracks)
    r, c = index[reference_id], index[candidate_id]
    descriptors = [{**d, "reference": float(tracks[r]["features"]["groups"][d["group"]][d["index"]]), "candidate": float(tracks[c]["features"]["groups"][d["group"]][d["index"]]), "reference_z": float(X[d["group"]][r, d["index"]]), "candidate_z": float(X[d["group"]][c, d["index"]]), "gap": float(abs(X[d["group"]][r, d["index"]] - X[d["group"]][c, d["index"]]))} for d in feature_schema()]
    cost = cdist(X["structure"][r], X["structure"][c]) / np.sqrt(3)
    # Retain the unmasked heatmap and use the library's exact constraint geometry.
    allowed = np.ones_like(cost, dtype=bool)
    librosa.util.fill_off_diagonal(allowed, radius=.20, value=False)
    accumulated, path = librosa.sequence.dtw(C=cost.copy(), global_constraints=True, band_rad=.20)
    distances = {k: float(accumulated[-1, -1] / len(path)) if k == "structure" else float(np.sqrt(np.mean((X[k][r] - X[k][c]) ** 2))) for k in GROUPS}
    distance = sum(w[k] * distances[k] for k in GROUPS)
    evidence = [{"key": k, "label": GROUPS[k]["label"], "weight": w[k], "distance": distances[k], "weighted_distance": w[k]*distances[k], "similarity": float(100*np.exp(-distances[k])), "description": GROUPS[k]["description"]} for k in GROUPS]
    return {"reference": tracks[r], "candidate": tracks[c], "descriptors": descriptors, "evidence": evidence, "distance": distance, "similarity": float(100*np.exp(-distance)), "alignment": {"cost": cost.tolist(), "path": path[::-1].tolist(), "allowed": allowed.tolist(), "band_fraction": .20}, "weights": w, "scope": "Pairwise comparison; band recommendations average candidate distances across all favourite references."}


def normalized_catalog(tracks: list[dict]):
    normalized = {}
    for key in GROUPS:
        if key == "structure":
            X = np.array([t["features"]["groups"][key] for t in tracks])
            frames = X.reshape(-1, X.shape[-1])
            center = np.median(frames, axis=0)
            mad = np.median(np.abs(frames - center), axis=0) * 1.4826
            scale = np.maximum(mad, np.maximum(np.std(frames, axis=0) * .5, 1e-3))
            normalized[key] = np.clip((X - center) / scale, -8, 8)
            continue
        X = np.array([t["features"]["groups"][key] for t in tracks])
        center = np.median(X, axis=0)
        mad = np.median(np.abs(X - center), axis=0) * 1.4826
        # Std fallback avoids amplifying almost constant dimensions in small libraries.
        scale = np.maximum(mad, np.maximum(np.std(X, axis=0) * .5, 1e-3))
        normalized[key] = np.clip((X - center) / scale, -8, 8)
    return normalized


def recommend(tracks: list[dict], weights: dict | None = None) -> dict:
    chosen = weights or {k: g["weight"] for k, g in GROUPS.items()}
    values = np.array([float(chosen.get(k, GROUPS[k]["weight"])) for k in GROUPS])
    if not np.isfinite(values).all() or np.any(values < 0) or values.sum() <= 0:
        raise ValueError("Choose non-negative weights, with at least one above zero.")
    w = dict(zip(GROUPS, (values / values.sum()).tolist()))
    refs = [i for i, t in enumerate(tracks) if t["role"] == "reference"]
    if not refs:
        raise ValueError("Add at least one reference song you like first.")
    if not any(t["role"] == "candidate" for t in tracks):
        raise ValueError("Add a candidate song to compare with your reference.")
    X = normalized_catalog(tracks)
    recommendations = []
    for i, track in enumerate(tracks):
        if track["role"] != "candidate":
            continue
        distances = {}
        for key in GROUPS:
            distances[key] = float(np.mean([dtw_distance(X[key][r], X[key][i]) if key == "structure" else np.sqrt(np.mean((X[key][r] - X[key][i]) ** 2)) for r in refs]))
        distance = sum(w[k] * distances[k] for k in GROUPS)
        # An uncalibrated resemblance index, never a probability of liking a song.
        similarity = 100 * np.exp(-distance)
        evidence = [{"key": k, "label": GROUPS[k]["label"], "distance": round(distances[k], 5), "similarity": round(100 * np.exp(-distances[k]), 1), "weighted_distance": round(w[k] * distances[k], 5), "weight": w[k], "description": GROUPS[k]["description"]} for k in GROUPS]
        strongest = sorted(evidence, key=lambda e: e["distance"])[:2]
        recommendations.append({**track, "distance": round(distance, 5), "similarity": round(float(similarity), 1), "evidence": evidence, "explanation": "Closest acoustic matches: " + " and ".join(e["label"].lower() for e in strongest) + ". These describe resemblance, not the cause of your taste."})
    recommendations.sort(key=lambda t: t["distance"])
    # Weighted PCA of static descriptors. Structure contributes to ranking, not this projection.
    matrix = np.concatenate([X[k] * np.sqrt(w[k] / X[k].shape[1]) for k in GROUPS if k != "structure"], axis=1)
    matrix -= matrix.mean(axis=0)
    U, s, _ = np.linalg.svd(matrix, full_matrices=False)
    coords = np.zeros((len(tracks), 2))
    count = min(2, len(s))
    coords[:, :count] = U[:, :count] * s[:count]
    variance = s ** 2 / max(float(np.sum(s ** 2)), 1e-12)
    bands = []
    for artist in dict.fromkeys(t["artist"] for t in recommendations):
        artist_tracks = [t for t in recommendations if t["artist"] == artist]
        average = float(np.mean([t["distance"] for t in artist_tracks[:3]]))
        bands.append({"artist": artist, "recordings": len(artist_tracks), "distance": average, "similarity": float(100 * np.exp(-average))})
    bands.sort(key=lambda b: b["distance"])
    return {"recommendations": recommendations, "bands": bands, "weights": w, "references": [tracks[i] for i in refs], "map": [{"id": t["id"], "title": t["title"], "artist": t["artist"], "role": t["role"], "x": float(coords[i, 0]), "y": float(coords[i, 1])} for i, t in enumerate(tracks)], "variance": variance[:2].tolist(), "dimensions": {k: int(np.prod(X[k].shape[1:])) for k in GROUPS}, "method": "Robust-scaled grouped distances + constrained DTW; weighted PCA map excludes temporal structure. Similarity is 100 × exp(−distance), not a calibrated preference probability."}


def synthesize(kind: str, seconds: float = 18) -> np.ndarray:
    """Original procedural test signals; never presented as recordings by real bands."""
    configs = {"reference": (110, 94, .8, 0), "echo": (116.54, 96, .8, 1), "tides": (98, 72, .9, 2), "angular": (146.83, 135, .5, 3), "glass": (220, 120, .4, 4), "static": (65.4, 160, .2, 5)}
    base, bpm, build, seed = configs[kind]
    rng = np.random.default_rng(seed)
    t = np.arange(int(SR * seconds)) / SR
    chords = np.array([1, 2 ** (3 / 12), 2 ** (-5 / 12), 2 ** (-2 / 12)])
    root = base * chords[np.minimum((t / seconds * 4).astype(int), 3)]
    y = np.zeros_like(t)
    for interval in [1, 2 ** (7 / 12), 2]:
        phase = 2 * np.pi * np.cumsum(root * interval) / SR
        y += np.sin(phase) * (.18 + .08 * np.sin(2 * np.pi * .2 * t))
        y += .06 * np.sin(phase * 3)
    envelope = (.15 + build * (t / seconds) ** 1.6)
    y *= envelope
    delay = int(.32 * SR)
    y[delay:] += .25 * y[:-delay]
    beat = 60 / bpm
    for start in np.arange(0, seconds, beat):
        idx = int(start * SR)
        n = min(int(.10 * SR), len(y) - idx)
        tau = np.arange(n) / SR
        drum = .25 * np.sin(2 * np.pi * (65 * tau - 110 * tau ** 2)) * np.exp(-tau * 45)
        drum += rng.normal(0, .08 if kind != "static" else .35, n) * np.exp(-tau * 35)
        y[idx:idx+n] += drum * (.4 + envelope[idx])
    y += rng.normal(0, .004 if kind != "static" else .12, len(y))
    fade = np.minimum(np.minimum(t / .1, (seconds - t) / .3), 1)
    return (y * fade).astype(np.float32)
