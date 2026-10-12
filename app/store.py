import json
import os
import sqlite3
import uuid
import re
from pathlib import Path

DB_PATH = Path(os.environ.get("RESONANCE_DB", str(Path(__file__).resolve().parent.parent / "data" / "library.sqlite3")))


def connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, title TEXT, artist TEXT, role TEXT, spotify_uri TEXT, features TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)")
    columns = {row[1] for row in conn.execute("PRAGMA table_info(tracks)")}
    for column in ["audio_file", "source_url", "license", "provenance"]:
        if column not in columns:
            conn.execute(f"ALTER TABLE tracks ADD COLUMN {column} TEXT DEFAULT ''")
    return conn


def all_tracks():
    with connection() as conn:
        rows = conn.execute("SELECT * FROM tracks ORDER BY created_at, rowid").fetchall()
    tracks = []
    for row in rows:
        track = dict(row)
        filename = track.pop("audio_file", "")
        has_audio = bool(filename and re.fullmatch(r"[a-f0-9]{32}\.wav", filename) and (DB_PATH.parent / "audio" / filename).is_file())
        track.update(features=json.loads(row["features"]), has_audio=has_audio, audio_url=f'/api/library/{track["id"]}/audio' if has_audio else None)
        tracks.append(track)
    return tracks


def add_track(title, artist, role, spotify_uri, features, samples=None, source_url="", license="", provenance=""):
    track_id = uuid.uuid4().hex
    filename = ""
    if samples is not None:
        import numpy as np
        import soundfile as sf
        directory = DB_PATH.parent / "audio"
        directory.mkdir(parents=True, exist_ok=True)
        filename = track_id + ".wav"
        samples = samples / max(float(np.max(np.abs(samples))), 1e-6)
        sf.write(directory / filename, samples, 22050, subtype="PCM_16")
    with connection() as conn:
        conn.execute("INSERT INTO tracks (id,title,artist,role,spotify_uri,features,audio_file,source_url,license,provenance) VALUES (?,?,?,?,?,?,?,?,?,?)", (track_id, title, artist, role, spotify_uri, json.dumps(features, allow_nan=False), filename, source_url, license, provenance or "Measured independently supplied local audio."))
    return track_id


def delete_track(track_id):
    with connection() as conn:
        row = conn.execute("SELECT audio_file FROM tracks WHERE id=?", (track_id,)).fetchone()
        removed = conn.execute("DELETE FROM tracks WHERE id=?", (track_id,)).rowcount > 0
    if row and re.fullmatch(r"[a-f0-9]{32}\.wav", row["audio_file"] or ""):
        (DB_PATH.parent / "audio" / row["audio_file"]).unlink(missing_ok=True)
    return removed


def audio_path(track_id):
    with connection() as conn:
        row = conn.execute("SELECT audio_file FROM tracks WHERE id=?", (track_id,)).fetchone()
    if row and re.fullmatch(r"[a-f0-9]{32}\.wav", row["audio_file"] or ""):
        path = DB_PATH.parent / "audio" / row["audio_file"]
        return path if path.is_file() else None
    return None


def change_role(track_id, role):
    with connection() as conn:
        return conn.execute("UPDATE tracks SET role=? WHERE id=?", (role, track_id)).rowcount > 0
