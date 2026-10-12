from __future__ import annotations

import asyncio
import io
import json
import os
import re
import tempfile
from functools import lru_cache
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import store
from .analysis import GROUPS, SR, extract, recommend, synthesize, compare_pair, feature_schema
from .catalog import DISCOVERY
from .graph import song_graph
from .licensed import CATALOG, import_recordings

ROOT = Path(__file__).resolve().parent.parent
MAX_BYTES = 100 * 1024 * 1024
MAX_SECONDS = 15 * 60
analysis_lock = asyncio.Semaphore(1)
app = FastAPI(title="Resonance — explainable music discovery")


@app.middleware("http")
async def local_only(request: Request, call_next):
    # Prevent a third-party page from mutating the local library.
    origin = request.headers.get("origin")
    host = request.headers.get("host", "")
    if host.split(":")[0] not in {"127.0.0.1", "localhost", "testserver"}:
        return JSONResponse({"detail": "This app serves local connections only."}, status_code=403)
    if request.method not in {"GET", "HEAD", "OPTIONS"} and origin and origin != f"http://{host}":
        return JSONResponse({"detail": "Use the app's local browser tab."}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://i.scdn.co https://mosaic.scdn.co; media-src 'self' blob:; connect-src 'self' https://accounts.spotify.com https://api.spotify.com; base-uri 'self'; object-src 'none'; frame-ancestors 'none'"
    return response


@app.get("/api/config")
def config():
    saved = json.loads((ROOT / "spotify_config.json").read_text()) if (ROOT / "spotify_config.json").exists() else {}
    return {"client_id": os.environ.get("SPOTIFY_CLIENT_ID") or saved.get("client_id", ""), "groups": GROUPS, "feature_schema": feature_schema(), "seed": "God Is an Astronaut", "max_upload_mb": 100, "max_duration_minutes": 15}


@app.get("/api/discovery")
def discovery():
    return {"items": DISCOVERY}


@app.get("/api/licensed-recordings")
def licensed_catalog():
    return {"recordings": CATALOG}


class LicensedImport(BaseModel):
    keys: list[str]


@app.post("/api/import-licensed")
async def import_licensed(body: LicensedImport):
    try:
        async with analysis_lock:
            return await asyncio.to_thread(import_recordings, body.keys)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/library")
def library():
    return {"tracks": store.all_tracks()}


@app.post("/api/library")
async def upload(file: UploadFile = File(...), title: str = Form(..., max_length=200), artist: str = Form(..., max_length=200), role: str = Form("candidate"), spotify_uri: str = Form("")):
    if role not in {"reference", "candidate"}:
        raise HTTPException(400, "Choose reference or candidate.")
    if not title.strip() or not artist.strip():
        raise HTTPException(400, "Add a title and artist.")
    if spotify_uri and not re.fullmatch(r"spotify:track:[A-Za-z0-9]{22}", spotify_uri):
        raise HTTPException(400, "Use a Spotify track URI or leave it empty.")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".wav", ".flac", ".mp3", ".ogg", ".m4a", ".aiff", ".aif"}:
        raise HTTPException(400, "Choose WAV, FLAC, MP3, OGG, M4A or AIFF audio.")
    try:
        with tempfile.TemporaryDirectory(prefix="resonance-") as directory:
            path = Path(directory) / ("audio" + suffix)
            total = 0
            with path.open("wb") as target:
                while chunk := await file.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_BYTES:
                        raise HTTPException(413, "Audio files must be smaller than 100 MB.")
                    target.write(chunk)
            if not total:
                raise HTTPException(400, "This file is empty.")
            def analyze_file():
                # Decode at most one sample beyond the limit, even for compressed input.
                y, _ = librosa.load(path, sr=SR, mono=True, duration=MAX_SECONDS + 1)
                if len(y) > SR * MAX_SECONDS:
                    raise ValueError("Use a recording no longer than 15 minutes.")
                return extract(y), y
            async with analysis_lock:
                features, samples = await asyncio.to_thread(analyze_file)
            track_id = store.add_track(title.strip(), artist.strip(), role, spotify_uri, features, samples=samples)
        return {"id": track_id, "features": features}
    except HTTPException:
        raise
    except Exception as exc:
        message = str(exc) if isinstance(exc, ValueError) else "Could not decode this audio. Try a WAV or FLAC file."
        raise HTTPException(400, message) from exc
    finally:
        await file.close()


@app.get("/api/library/{track_id}/audio")
def library_audio(track_id: str):
    path = store.audio_path(track_id)
    if not path:
        raise HTTPException(404, "No saved audio for this recording. Re-add its file to enable playback.")
    return FileResponse(path, media_type="audio/wav")


class RoleChange(BaseModel):
    role: str


@app.patch("/api/library/{track_id}")
def role_change(track_id: str, body: RoleChange):
    if body.role not in {"reference", "candidate"}:
        raise HTTPException(400, "Choose reference or candidate.")
    if not store.change_role(track_id, body.role):
        raise HTTPException(404, "Song not found.")
    return {"ok": True}


@app.delete("/api/library/{track_id}")
def delete(track_id: str):
    if not store.delete_track(track_id):
        raise HTTPException(404, "Song not found.")
    return {"ok": True}


class RankRequest(BaseModel):
    weights: dict[str, float] | None = None
    demo: bool = False


@lru_cache(maxsize=1)
def demo_tracks():
    names = [("reference", "Orbital rise"), ("echo", "Echo bloom"), ("tides", "Slow tides"), ("angular", "Angular motion"), ("glass", "Glass pulse"), ("static", "Static horizon")]
    return [{"id": "demo-" + kind, "title": title, "artist": "Original synthetic signal", "role": "reference" if kind == "reference" else "candidate", "spotify_uri": "", "features": extract(synthesize(kind)), "provenance": "Measured procedural test audio; not a recording by God Is an Astronaut or any other band."} for kind, title in names]


@app.post("/api/recommendations")
async def recommendations(body: RankRequest):
    try:
        async with analysis_lock:
            tracks = await asyncio.to_thread(demo_tracks) if body.demo else store.all_tracks()
            result = await asyncio.to_thread(recommend, tracks, body.weights)
        return {**result, "demo": body.demo}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/example-tracks")
async def example_tracks():
    async with analysis_lock:
        tracks = await asyncio.to_thread(demo_tracks)
    return {"tracks": tracks}


class ComparisonRequest(BaseModel):
    reference_id: str
    candidate_id: str
    weights: dict[str, float] | None = None
    demo: bool = False


class GraphRequest(BaseModel):
    song_id: str
    weights: dict[str, float] | None = None
    demo: bool = False


@app.post("/api/song-graph")
async def graph(body: GraphRequest):
    try:
        async with analysis_lock:
            tracks = await asyncio.to_thread(demo_tracks) if body.demo else store.all_tracks()
            result = await asyncio.to_thread(song_graph, tracks, body.song_id, body.weights)
        return {**result, "demo": body.demo}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/comparison")
async def comparison(body: ComparisonRequest):
    try:
        async with analysis_lock:
            tracks = await asyncio.to_thread(demo_tracks) if body.demo else store.all_tracks()
            result = await asyncio.to_thread(compare_pair, tracks, body.reference_id, body.candidate_id, body.weights)
        return {**result, "demo": body.demo}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/example-audio/{track_id}")
def example_audio(track_id: str, download: bool = False):
    kind = track_id.removeprefix("demo-")
    if kind not in {"reference", "echo", "tides", "angular", "glass", "static"} or not track_id.startswith("demo-"):
        raise HTTPException(404, "Example recording not found.")
    buffer = io.BytesIO()
    samples = synthesize(kind)
    samples /= max(float(np.max(np.abs(samples))), 1e-6)
    sf.write(buffer, samples, SR, format="WAV", subtype="PCM_16")
    return Response(buffer.getvalue(), media_type="audio/wav", headers={"Content-Disposition": f'{"attachment" if download else "inline"}; filename="resonance-{kind}.wav"'})


@app.get("/")
@app.get("/callback")
def index():
    return FileResponse(ROOT / "static" / "index.html")


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
