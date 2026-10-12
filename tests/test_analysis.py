import numpy as np
import pytest

from app.analysis import GROUPS, SR, dtw_distance, extract, recommend, synthesize, feature_schema, compare_pair


@pytest.fixture(scope="module")
def signals():
    ref = synthesize("reference", seconds=6)
    return ref, extract(ref), extract(synthesize("static", seconds=6))


def track(track_id, features, role="candidate", artist="Test"):
    return {"id": track_id, "title": track_id, "artist": artist, "role": role, "spotify_uri": "", "features": features}


def test_gain_invariance(signals):
    audio, features, _ = signals
    quieter = extract(audio * .05)
    for key in GROUPS:
        np.testing.assert_allclose(features["groups"][key], quieter["groups"][key], atol=2e-4, rtol=1e-4)


def test_measured_signal_changes_ranking(signals):
    _, ref, different = signals
    result = recommend([track("ref", ref, "reference"), track("same", ref), track("noise", different)])
    assert result["recommendations"][0]["id"] == "same"
    assert result["recommendations"][0]["similarity"] == 100
    assert result["recommendations"][1]["similarity"] < 95
    for candidate in result["recommendations"]:
        assert sum(e["weighted_distance"] for e in candidate["evidence"]) == pytest.approx(candidate["distance"], abs=5e-5)
    assert sum(result["weights"].values()) == pytest.approx(1)
    assert all(np.isfinite([p["x"], p["y"]]).all() for p in result["map"])


def test_dtw_matches_time_shifted_build():
    t = np.linspace(0, 1, 64)
    a = np.stack([t, t ** 2, np.sin(t * 3) ** 2], axis=1)
    b = np.stack([t ** 1.2, t ** 2.4, np.sin(t ** 1.2 * 3) ** 2], axis=1)
    assert dtw_distance(a, a) == pytest.approx(0)
    assert dtw_distance(a, b) == pytest.approx(dtw_distance(b, a))
    assert dtw_distance(a, b) < np.sqrt(np.mean((a - b) ** 2))


def test_interval_colour_survives_octave_transposition():
    t = np.arange(SR * 6) / SR
    low = extract(np.sin(2 * np.pi * 220 * t))
    high = extract(np.sin(2 * np.pi * 440 * t))
    # Pitch-class intervals retain their colour despite a new register.
    # Finite STFT resolution introduces small chroma leakage differences.
    np.testing.assert_allclose(low["groups"]["harmony"][:6], high["groups"]["harmony"][:6], atol=.04)
    assert high["summary"]["brightness"] > low["summary"]["brightness"] * 1.5


@pytest.mark.parametrize("weights", [{k: 0 for k in GROUPS}, {"timbre": -1}, {"timbre": float("nan")}])
def test_bad_weights_rejected(signals, weights):
    _, ref, different = signals
    with pytest.raises(ValueError, match="weights"):
        recommend([track("ref", ref, "reference"), track("candidate", different)], weights)


def test_missing_reference_rejected(signals):
    with pytest.raises(ValueError, match="reference"):
        recommend([track("candidate", signals[1])])


def test_reference_never_recommended_and_multiple_references(signals):
    _, ref, different = signals
    result = recommend([track("ref1", ref, "reference"), track("ref2", different, "reference"), track("candidate", ref)])
    assert len(result["references"]) == 2
    assert [t["id"] for t in result["recommendations"]] == ["candidate"]
    assert result["bands"][0]["recordings"] == 1


def test_silent_and_short_audio_rejected():
    with pytest.raises(ValueError, match="silent"):
        extract(np.zeros(SR * 4))
    with pytest.raises(ValueError, match="3 seconds"):
        extract(np.ones(SR))


def test_feature_visuals_measure_whole_signal(signals):
    _, measured, noisy = signals
    assert np.shape(measured["visuals"]["mel_db"]) == (64, 128)
    assert np.shape(measured["visuals"]["mfcc"]) == (13, 128)
    assert np.shape(measured["visuals"]["chroma"]) == (12, 128)
    assert len(measured["visuals"]["waveform_min"]) == 256
    assert np.isfinite(measured["visuals"]["mel_db"]).all()
    assert not np.allclose(measured["visuals"]["mel_db"], noisy["visuals"]["mel_db"])
    assert np.all(np.array(measured["visuals"]["waveform_min"]) <= np.array(measured["visuals"]["waveform_max"]))


def test_pair_evidence_agrees_with_ranker(signals):
    _, ref, different = signals
    tracks = [track("ref", ref, "reference"), track("other", different), track("same", ref)]
    pair = compare_pair(tracks, "ref", "other")
    rank = next(t for t in recommend(tracks)["recommendations"] if t["id"] == "other")
    assert pair["distance"] == pytest.approx(rank["distance"], abs=1e-5)
    assert sum(e["weighted_distance"] for e in pair["evidence"]) == pytest.approx(pair["distance"])
    assert len(pair["descriptors"]) == 87
    assert np.isfinite(pair["alignment"]["cost"]).all()
    assert pair["alignment"]["path"][0] == [0, 0]
    assert pair["alignment"]["path"][-1] == [63, 63]
    assert all(pair["alignment"]["allowed"][r][c] for r, c in pair["alignment"]["path"])
    assert compare_pair(tracks, "ref", "same")["similarity"] == pytest.approx(100)
    assert {k: sum(d["group"] == k for d in feature_schema()) for k in GROUPS if k != "structure"} == {"timbre":47, "harmony":9, "rhythm":27, "dynamics":4}


def test_pair_rejects_same_track_and_invalid_weights(signals):
    tracks = [track("ref", signals[1], "reference"), track("candidate", signals[2])]
    with pytest.raises(ValueError, match="different"):
        compare_pair(tracks, "ref", "ref")
    with pytest.raises(ValueError, match="collection"):
        compare_pair(tracks, "ref", "missing")
    with pytest.raises(ValueError, match="weights"):
        compare_pair(tracks, "ref", "candidate", {k: 0 for k in GROUPS})
