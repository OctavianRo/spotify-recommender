"""Actual full recordings offered for download by their creator under CC BY."""
import tempfile
from pathlib import Path
from urllib.parse import quote

import httpx
import librosa

from . import store
from .analysis import SR, extract

CATALOG = [
    {"key":"descent", "title":"The Descent", "isrc":"USUAN1200094"},
    {"key":"vortex", "title":"Black Vortex", "isrc":"USUAN1300037"},
    {"key":"darkening", "title":"Darkening Developments", "isrc":"USUAN1100267"},
]
for recording in CATALOG:
    recording.update(artist="Kevin MacLeod", license="CC BY 4.0", license_url="https://creativecommons.org/licenses/by/4.0/", source_url="https://incompetech.com/music/royalty-free/index.html?isrc="+recording["isrc"], audio_url="https://incompetech.com/music/royalty-free/mp3-royaltyfree/"+quote(recording["title"]+".mp3"), attribution=f'"{recording["title"]}" Kevin MacLeod (incompetech.com), licensed under Creative Commons Attribution 4.0.')


def import_recordings(keys):
    requested = [r for r in CATALOG if r["key"] in keys]
    if len(set(keys)) != len(requested):
        raise ValueError("Choose recordings from the licensed catalogue.")
    result = {"added":[], "existing":[], "errors":[]}
    existing = store.all_tracks()
    has_reference = any(t["role"] == "reference" for t in existing)
    for recording in requested:
        cached = next((t for t in existing if t.get("source_url") == recording["source_url"] and t["has_audio"]), None)
        if cached:
            result["existing"].append({"id":cached["id"], "title":recording["title"]})
            continue
        try:
            with tempfile.TemporaryDirectory(prefix="resonance-real-") as folder:
                path = Path(folder) / "recording.mp3"
                with httpx.stream("GET", recording["audio_url"], timeout=45, follow_redirects=False) as response:
                    response.raise_for_status()
                    size = 0
                    with path.open("wb") as file:
                        for chunk in response.iter_bytes():
                            size += len(chunk)
                            if size > 30*1024*1024:
                                raise ValueError("Recording exceeds the download limit.")
                            file.write(chunk)
                samples, _ = librosa.load(path, sr=SR, mono=True, duration=901)
                if len(samples) > SR*900:
                    raise ValueError("Recording exceeds 15 minutes.")
                features = extract(samples)
                role = "candidate" if has_reference else "reference"
                track_id = store.add_track(recording["title"], recording["artist"], role, "", features, samples=samples, source_url=recording["source_url"], license=recording["license"], provenance=recording["attribution"]+" Full creator-provided recording analysed locally; not a Spotify stream or a God Is an Astronaut recording.")
                has_reference = True
                result["added"].append({"id":track_id, "title":recording["title"]})
        except Exception as exc:
            result["errors"].append({"title":recording["title"], "message":"Could not download or decode this recording. Try again later." if not isinstance(exc, ValueError) else str(exc)})
    return result
