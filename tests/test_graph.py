import numpy as np
import pytest
from app.analysis import extract, synthesize, compare_pair
from app.graph import song_graph


@pytest.fixture(scope="module")
def tracks():
    ref = extract(synthesize("reference", seconds=4))
    other = extract(synthesize("static", seconds=4))
    return [{"id":"first", "title":"First", "artist":"Band A", "role":"reference", "features":ref}, {"id":"same", "title":"Same", "artist":"Band B", "role":"candidate", "features":ref}, {"id":"other", "title":"Other", "artist":"Band B", "role":"candidate", "features":other}]


def test_graph_relations_have_measured_evidence(tracks):
    graph = song_graph(tracks, "first")
    ids = {n["id"] for n in graph["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in graph["edges"])
    assert len([n for n in graph["nodes"] if n["kind"] == "feature"]) == 87
    assert len([n for n in graph["nodes"] if n["kind"] == "trajectory"]) == 3
    assert len([n for n in graph["nodes"] if n["kind"] == "artist"]) == 2
    songs = [n for n in graph["nodes"] if n["kind"] == "song" and not n["central"]]
    assert songs[0]["track_id"] == "same" and songs[0]["similarity"] == 100
    pair = compare_pair(tracks, "first", "other")
    assert songs[1]["distance"] == pytest.approx(pair["distance"])
    assert sum(e["weighted_distance"] for e in songs[1]["evidence"]) == pytest.approx(songs[1]["distance"])
    assert np.isfinite([n["value"] for n in graph["nodes"] if n["kind"] == "feature"]).all()


def test_each_song_can_be_the_root_and_single_song_has_no_invented_matches(tracks):
    assert song_graph(tracks, "other")["root"] == "song:other"
    single = song_graph(tracks[:1], "first")
    assert single["neighbours_shown"] == 0
    assert not any(e["relation"] == "acoustic_neighbour" for e in single["edges"])
    with pytest.raises(ValueError):
        song_graph(tracks, "missing")
    with pytest.raises(ValueError):
        song_graph(tracks, "first", {"timbre": -1})
