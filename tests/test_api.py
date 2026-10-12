import io
import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app import store
from app.main import app
from app.analysis import SR


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "library.sqlite3")
    with TestClient(app, base_url="http://127.0.0.1:8000") as c:
        yield c


def audio_bytes():
    stream = io.BytesIO()
    t = np.arange(SR * 3) / SR
    sf.write(stream, .5 * np.sin(2 * np.pi * 220 * t), SR, format="WAV")
    return stream.getvalue()


def test_full_upload_rank_role_delete_flow(client):
    payload = audio_bytes()
    data = {"title": "Favourite", "artist": "Test band", "role": "reference"}
    response = client.post("/api/library", data=data, files={"file": ("ref.wav", payload, "audio/wav")})
    assert response.status_code == 200, response.text
    ref_id = response.json()["id"]
    saved = client.get("/api/library").json()["tracks"][0]
    assert saved["has_audio"] is True
    assert client.get(saved["audio_url"]).content[:4] == b"RIFF"
    graph = client.post("/api/song-graph", json={"song_id": ref_id}).json()
    assert graph["neighbours_shown"] == 0
    assert sum(n["kind"] == "feature" for n in graph["nodes"]) == 87
    assert client.post("/api/song-graph", json={"song_id": "missing"}).status_code == 400
    data.update(title="Candidate", role="candidate")
    response = client.post("/api/library", data=data, files={"file": ("candidate.wav", payload, "audio/wav")})
    candidate_id = response.json()["id"]
    result = client.post("/api/recommendations", json={}).json()
    assert result["recommendations"][0]["id"] == candidate_id
    assert result["recommendations"][0]["similarity"] == 100
    pair = client.post("/api/comparison", json={"reference_id":ref_id,"candidate_id":candidate_id}).json()
    assert len(pair["descriptors"]) == 87
    assert pair["similarity"] == 100
    assert client.post("/api/comparison", json={"reference_id":ref_id,"candidate_id":ref_id}).status_code == 400
    assert len(client.get("/api/library").json()["tracks"]) == 2
    assert client.patch(f"/api/library/{candidate_id}", json={"role": "reference"}).status_code == 200
    assert client.post("/api/recommendations", json={}).status_code == 400
    assert client.delete(f"/api/library/{candidate_id}").status_code == 200
    assert client.delete(f"/api/library/{ref_id}").status_code == 200
    assert client.get(f"/api/library/{ref_id}/audio").status_code == 404
    assert not list(store.DB_PATH.parent.glob("audio/*.wav"))
    assert client.get("/api/library").json()["tracks"] == []


def test_invalid_audio_and_metadata(client):
    assert client.post("/api/library", data={"title": "x", "artist": "y"}, files={"file": ("x.txt", b"bad")}).status_code == 400
    assert client.post("/api/library", data={"title": "x", "artist": "y", "role": "nope"}, files={"file": ("x.wav", audio_bytes())}).status_code == 400
    assert client.post("/api/library", data={"title": "x", "artist": "y", "spotify_uri": "bogus"}, files={"file": ("x.wav", audio_bytes())}).status_code == 400
    assert client.post("/api/library", data={"title": "x", "artist": "y"}, files={"file": ("x.wav", b"not audio")}).status_code == 400


def test_cross_origin_and_unexpected_host_rejected(client):
    assert client.post("/api/recommendations", json={}, headers={"origin": "https://another-site.example"}).status_code == 403
    assert client.get("/api/library", headers={"host": "another-site.example"}).status_code == 403


def test_pages_and_missing_records(client):
    assert client.get("/").status_code == 200
    assert client.get("/callback").status_code == 200
    assert client.get("/static/app.js").status_code == 200
    assert client.delete("/api/library/missing").status_code == 404
    assert client.patch("/api/library/missing", json={"role": "candidate"}).status_code == 404
    assert client.post("/api/recommendations", json={}).status_code == 400
    assert len(client.get("/api/discovery").json()["items"]) == 4


def test_example_audio_is_accessible_and_downloadable(client):
    response = client.get("/api/example-audio/demo-reference?download=true")
    assert response.status_code == 200
    assert response.content[:4] == b"RIFF"
    assert "attachment" in response.headers["content-disposition"]
    samples, sample_rate = sf.read(io.BytesIO(response.content))
    assert sample_rate == SR
    assert len(samples) / sample_rate == 18
    assert np.max(np.abs(samples)) > .9
    assert client.get("/api/example-audio/invalid").status_code == 404
    assert "media-src 'self' blob:" in client.get("/").headers["content-security-policy"]


def test_saved_client_id_and_licensed_catalog(client, monkeypatch, tmp_path):
    from app import main
    monkeypatch.setattr(main, "ROOT", tmp_path)
    monkeypatch.delenv("SPOTIFY_CLIENT_ID", raising=False)
    assert client.get("/api/config").json()["client_id"] == ""
    (tmp_path / "spotify_config.json").write_text('{"client_id":"0123456789abcdef0123456789abcdef"}')
    assert client.get("/api/config").json()["client_id"] == "0123456789abcdef0123456789abcdef"
    monkeypatch.setenv("SPOTIFY_CLIENT_ID", "test-env-override")
    assert client.get("/api/config").json()["client_id"] == "test-env-override"
    recordings = client.get("/api/licensed-recordings").json()["recordings"]
    assert len(recordings) == 3
    assert all(r["license"] == "CC BY 4.0" for r in recordings)
    assert client.post("/api/import-licensed", json={"keys":["not-in-catalog"]}).status_code == 400
