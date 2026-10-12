"""Typed song relations, backed by local metadata and measured DSP evidence."""
import hashlib
import numpy as np

from .analysis import GROUPS, feature_schema, normalized_catalog, dtw_distance


def song_graph(tracks: list[dict], song_id: str, weights: dict | None = None, limit: int = 8) -> dict:
    lookup = {t["id"]: i for i, t in enumerate(tracks)}
    if song_id not in lookup:
        raise ValueError("Choose a song from the current collection.")
    values = np.array([float((weights or {}).get(k, g["weight"])) for k, g in GROUPS.items()])
    if not np.isfinite(values).all() or np.any(values < 0) or values.sum() <= 0:
        raise ValueError("Choose non-negative weights, with at least one above zero.")
    w = dict(zip(GROUPS, (values / values.sum()).tolist()))
    normalized = normalized_catalog(tracks)
    focus = tracks[lookup[song_id]]
    root = "song:" + song_id
    nodes, edges = [], []
    artists = {}
    def artist_node(artist):
        if artist not in artists:
            artist_id = "artist:" + hashlib.sha256(artist.encode()).hexdigest()[:16]
            artists[artist] = artist_id
            nodes.append({"id": artist_id, "kind": "artist", "label": artist, "recordings": [{"id": t["id"], "title": t["title"]} for t in tracks if t["artist"] == artist], "provenance": "Artist name supplied with the recording; not inferred from sound."})
        return artists[artist]
    def add_song(t, central=False, evidence=None, distance=None):
        sid = "song:" + t["id"]
        node = {"id": sid, "kind": "song", "label": t["title"], "artist": t["artist"], "track_id": t["id"], "central": central, "summary": t["features"]["summary"], "duration": t["features"]["duration"], "spotify_uri": t.get("spotify_uri", ""), "provenance": t.get("provenance", "Audio measurements from an independently uploaded local recording.")}
        if evidence is not None:
            node.update(evidence=evidence, distance=distance, similarity=float(100*np.exp(-distance)))
        nodes.append(node)
        aid = artist_node(t["artist"])
        edges.append({"source": sid, "target": aid, "relation": "performed_by", "label": "performed by", "provenance": "Recording metadata"})
    add_song(focus, central=True)
    for key, group in GROUPS.items():
        gid = "group:" + key
        count = int(np.size(focus["features"]["groups"][key]))
        nodes.append({"id": gid, "kind": "group", "group": key, "label": group["label"], "count": count, "description": group["description"], "weight": w[key]})
        edges.append({"source": root, "target": gid, "relation": "measured_in", "label": "measured in", "provenance": "DSP extraction"})
    for d in feature_schema():
        fid = f'feature:{d["group"]}:{d["index"]}'
        nodes.append({**d, "id": fid, "kind": "feature", "value": float(focus["features"]["groups"][d["group"]][d["index"]]), "z": float(normalized[d["group"]][lookup[song_id], d["index"]]), "provenance": "Measured static descriptor"})
        edges.append({"source": "group:" + d["group"], "target": fid, "relation": "has_measurement", "label": "has measurement", "provenance": "DSP extraction"})
    for channel, label in [("loudness", "Loudness progression"), ("brightness", "Brightness progression"), ("onsets", "Onset progression")]:
        tid = "trajectory:" + channel
        nodes.append({"id": tid, "kind": "trajectory", "group": "structure", "label": label, "values": focus["features"]["timeline"][channel], "provenance": "64-bin trajectory across the full recording"})
        edges.append({"source": "group:structure", "target": tid, "relation": "has_trajectory", "label": "has trajectory", "provenance": "DSP extraction"})
    candidates = []
    r = lookup[song_id]
    for i, t in enumerate(tracks):
        if i == r:
            continue
        distances = {k: dtw_distance(normalized[k][r], normalized[k][i]) if k == "structure" else float(np.sqrt(np.mean((normalized[k][r]-normalized[k][i])**2))) for k in GROUPS}
        distance = sum(w[k]*distances[k] for k in GROUPS)
        evidence = [{"key": k, "label": GROUPS[k]["label"], "distance": distances[k], "weight": w[k], "weighted_distance": w[k]*distances[k], "similarity": float(100*np.exp(-distances[k]))} for k in GROUPS]
        candidates.append((distance, t, evidence))
    candidates.sort(key=lambda row: row[0])
    for distance, track, evidence in candidates[:limit]:
        add_song(track, evidence=evidence, distance=distance)
        sid = "song:" + track["id"]
        edges.append({"source": root, "target": sid, "relation": "acoustic_neighbour", "label": "acoustic neighbour", "distance": distance, "similarity": float(100*np.exp(-distance)), "evidence": evidence, "provenance": "Weighted grouped distance using the full collection's scaling; not a preference probability."})
        for e in sorted((e for e in evidence if e["weight"] > 0), key=lambda e: e["distance"])[:2]:
            edges.append({"source": "group:" + e["key"], "target": sid, "relation": "closest_group", "label": "closest group", "evidence": e, "similarity": e["similarity"], "provenance": "One of this pair's two closest enabled feature groups. It may still be a weak absolute match."})
    return {"root": root, "nodes": nodes, "edges": edges, "weights": w, "collection_size": len(tracks), "neighbours_shown": min(limit, len(candidates)), "method": "Metadata relations plus measured audio descriptors and pairwise acoustic distances. Graph positions organize relations; they do not represent distance. No inferred emotion, instrumentation or genre claims."}
