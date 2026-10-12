# Resonance

A local music discovery app built around **God Is an Astronaut**, with Spotify OAuth, an inspectable audio comparison engine, an interactive acoustic map, feature explanations and whole-song trajectory plots.

## Run

Requires Python 3.11+ (tested with 3.13). Optional FFmpeg helps decode MP3/M4A; WAV and FLAC are the most reliable inputs. `requirements.lock.txt` records the exact tested dependency versions; `requirements.txt` supports fresh installs across supported Python versions.

```sh
bash run.sh
```

Open **http://127.0.0.1:8000**. The first run creates a virtual environment and installs dependencies. If an environment exists but its packages are missing, run:

```sh
.venv/bin/python -m pip install -r requirements.txt
```

The app is local; no hosting account is needed. Stop the server with Ctrl+C.

## Connect your Spotify

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Register the exact redirect URI **http://127.0.0.1:8000/callback**.
3. Add your account to the app's allowed users. [Development-mode app owners need Premium; up to five users can be allowlisted](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).
4. Click **Connect Spotify** and enter the app's Client ID. A client secret is not needed. Alternatively set `SPOTIFY_CLIENT_ID` before starting the app.

To pre-fill your Client ID every time, copy `spotify_config.example.json` to `spotify_config.json` and enter your own ID there. The local configuration is excluded from Git. A Client ID is a public application identifier, not a client secret. `SPOTIFY_CLIENT_ID` can override it. Register **http://127.0.0.1:8000/callback** in that app's settings before connecting.

OAuth uses Authorization Code with PKCE, a random state value, an expiring login attempt and token refresh. Access/refresh tokens remain in this browser tab's session storage; the backend does not receive them. Disconnect removes them. The public Client ID is remembered locally for convenience.

Permissions are `user-top-read` and `playlist-modify-private`. Spotify supplies top tracks and catalogue search. Selecting a Spotify song pre-fills its title, artist and track URI in the audio upload form. Spotify searches use at most 10 results. Playlist saving is an explicit button action and uses current `/me/playlists` and `/playlists/{id}/items` endpoints.

## Get real mathematical recommendations

1. Add a full audio recording of a God Is an Astronaut song you particularly like. Choose **favourite / reference**. Add more favourites to represent different aspects of your taste.
2. Explore the editorial shortlist: If These Trees Could Talk, pg.lost, Caspian and This Will Destroy You. The shortlist comes from genre tags on artist/label sources, **not** from measured audio similarity.
3. Add candidate recordings from those bands or any other music you want to compare. Use **discovery / candidate**. Adding an optional Spotify URI links results to the catalogue.
4. Open **Signal lab → Your recordings → Analyze library**.
5. Select a song in the map or ranking to inspect its feature resemblance and trajectory. Tune the five weights and analyze again. Artist rankings aggregate the up to three closest measured candidates per artist, with recording counts displayed.
6. Export the analysis as JSON and its acoustic map as SVG. Linked candidates can be saved in order to a private Spotify playlist.

Files are decoded locally and their uploaded temporary copies are deleted after extraction, including on errors. A listening copy is saved as peak-normalized mono 22,050 Hz PCM-16 WAV in `data/audio/`, with metadata and features in `data/library.sqlite3`. Playback and comparison survive page reloads and app restarts. Files must be 3 seconds to 15 minutes long and at most 100 MB. The server binds to loopback and rejects off-origin mutations and unexpected Host headers. Deleting a recording removes both its retained features and saved audio. Entries added before this update need their original audio re-added for persistent playback.

### Import actual recordings immediately

**Your library → Import & analyse real songs** downloads three full, creator-provided recordings: *The Descent*, *Black Vortex*, and *Darkening Developments* by Kevin MacLeod, under CC BY 4.0 from Incompetech. Attribution and source links are retained and displayed beside playback. These are actual music recordings, not synthetic examples, Spotify downloads, or God Is an Astronaut recordings. Repeating the import reuses already saved recordings. The first imported track becomes a comparison reference only if the library has no reference yet. Partial download failures are reported per song.

For God Is an Astronaut and other Spotify artists, use an independently obtained audio file with the corresponding Spotify metadata. Spotify catalogue search cannot supply the underlying recording for DSP extraction. The app does not record Spotify playback or bypass its streaming protections.

**Spotify does not give this app the underlying recordings.** New apps cannot use its [audio features, audio analysis, recommendations or related-artists endpoints](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api). Consequently this project cannot automatically compute acoustic matches across the entire Spotify catalogue. It uses audio files you independently provide; it does not download or analyze Spotify streams. Catalogue metadata alone is never presented as extracted audio features.

The built-in **Synthetic example** is immediately usable without Spotify or uploads. It generates original test signals, runs the same real extraction engine and plots them. Its signals are not recordings by real bands and its scores are not assertions about those bands.

## Feature atlas: hear, inspect and compare a recording

Open **Feature atlas → Try playable examples** for an immediately usable, audible comparison. Both original recordings can be played or downloaded as WAV files. Switch either song selector to compare different arrangements.

The atlas includes an interactive 87-spoke signature; waveform envelope; 64-band mel spectrogram; 12-row harmonic chromagram; 13-row MFCC texture map; a constrained DTW cost heatmap and alignment path; five additive distance contributions; and a searchable inventory of all 87 static descriptors, with raw values, standardized gaps, units and explanations. Select or focus a radial spoke to inspect it. The heatmaps summarize the entire recording into 128 time bins rather than showing only its introduction.

Radial values are robust-scaled using the same full collection as the recommender. Display radii clip values to ±4; ranking still uses its own ±8 clipping. The radial area's size has no acoustic meaning. Temporal structure is represented separately by the alignment plot. Pairwise evidence is not the multi-reference artist ranking: the atlas explicitly explains this distinction.

For real music, search Spotify by title, artist, track URI or track link to label the audio. Artist download links are provided on the atlas. Upload the recording to measure it; audio copies and features now remain in the local library after closing/reloading the tab. A single recording can be inspected without a comparison, with no invented resemblance score. Older library entries keep their existing rankings; re-add audio to obtain missing audio copies or spectral visualizations.

The atlas shows **all features this app extracts**, not every conceivable music descriptor. It does not infer emotion, instruments or preference causality from spectral shapes. Examples and band recordings are clearly distinguished.

## The mathematics

### Interactive song knowledge graph

Open **Song graph**, select any analysed recording, or choose **Original examples**. The feature atlas and each library entry also link directly to that recording's graph.

Each graph contains typed relations: a song is **performed by** an artist, is **measured in** five feature groups, each group **has measurements** or **has trajectories**, and the song has **acoustic neighbours** in your analysed collection. Dashed links identify a pair's two closest enabled feature groups; they are not claims of shared instrumentation or emotion. The graph retains all 87 descriptors plus three 64-bin trajectories, expandable by group or all at once. Each relation states its provenance.

Click a node or edge to inspect evidence. Drag nodes, pan the background, scroll or use buttons to zoom, search nodes, hide artists, or filter neighbours by resemblance. Centre a neighbouring song to generate its own graph, or open its pairwise comparison in the feature atlas. Graph export saves the currently displayed SVG. The nearest eight available recordings are considered; even the nearest can be a weak match. The layout organizes relationships and does not encode acoustic distance. Artist names come from supplied metadata, not audio inference. A single song has measured-feature relations without invented recommendation edges.

All audio is downmixed to mono, resampled to 22,050 Hz, and normalized by peak amplitude. An STFT with a 2,048-sample window and 512-sample hop covers the full recording.

| Group | Measurements | Default weight |
|---|---|---:|
| Sound texture | 13 MFCC means, standard deviations and mean absolute first differences; centroid, bandwidth, rolloff and flatness means/stds (47 descriptors) | 28% |
| Harmonic colour | HPSS harmonic chroma circular autocorrelation at six interval lags; normalized chroma entropy; chroma-change mean/std (9 descriptors) | 18% |
| Rhythm & pulse | Log estimated tempo, onset density, max pulse autocorrelation, and 24 sampled autocorrelation lags (27 descriptors) | 18% |
| Dynamic contrast | 95th–5th percentile loudness range, crest factor, harmonic/percussive energy ratio, loudness build slope (4 descriptors) | 16% |
| The way it builds | Three 64-bin trajectories: relative loudness, spectral brightness and onset activity; constrained DTW | 20% |

Harmonic interval features are invariant to a circular shift in pitch class, so a similar harmonic palette in a different key can still match. This is a coarse whole-track descriptor, not a transcription of chord progressions. MFCC differences measure frame-to-frame texture change, not a formal beat-synchronous derivative. Tempo is an estimate and can be ambiguous by factors of two.

For each static feature, subtract the library median and divide by:

```text
scale = max(1.4826 × median absolute deviation, 0.5 × standard deviation, 0.001)
```

Standardized values are clipped to ±8. A group's distance is root-mean-square feature difference. Dividing by feature count prevents groups with more descriptors dominating solely through dimensionality.

Structure's three channels are robust-scaled using the same scale formula across all 64-bin trajectories in the collection. It uses Euclidean frame cost divided by √3 and dynamic time warping with a 20% Sakoe–Chiba band, normalized by alignment path length. It tolerates modest differences in build timing, rather than treating two shifted crescendos as unrelated. No standardized static feature enters this structure distance.

Distances are averaged across all references. Non-negative group weights are normalized to sum to one:

```text
D(candidate) = Σg wg × mean_reference(distanceg(reference, candidate))
resemblance = 100 × exp(−D)
```

Explanations expose each group's unweighted distance, resemblance and additive weighted contribution. Those contributions sum to the total distance, subject to displayed rounding. References have equal influence. More references represent a broader taste profile, but a candidate has to match that profile on average.

The map is a two-dimensional **weighted PCA projection of static features** with group weights and dimension compensation. Temporal structure contributes to ranking but not to the map. Explained variance is shown. Points that overlap in two dimensions can differ in unshown dimensions or temporal structure. Rankings should be preferred over visual proximity.

## What the scores mean

- Scores quantify acoustic resemblance, **not** the probability of enjoyment and **not** a causal explanation of taste.
- They are relative to the current analysed collection. Adding songs changes scaling, scores, and the map. Very small libraries are unstable.
- Recordings of different lengths are compared using normalized time. Duration itself is not a ranking feature.
- Mix/master differences, vocals, recording noise and partial excerpts can affect measurements. The engine does not directly classify instrumentation, emotional valence, vocal presence, or reverb.
- The band score uses up to three closest candidates, not a claim about the band's complete discography. Coverage and candidate selection matter.
- There is no learned preference model or validation against your feedback yet. Listening is the final test.

## Checks

```sh
.venv/bin/python -m pytest -q
node --check static/app.js
node --test tests/test_frontend.cjs
node --test tests/test_graph_frontend.cjs
```

Tests exercise signal sensitivity, global-gain invariance, transposition invariance, DTW behaviour, ranking contributions, weight validation, audio upload, persistence, deletion and local request protection. Frontend tests verify PKCE challenges, OAuth state rejection, token storage/disconnection and Spotify track-link parsing with mocked network responses. Live Spotify OAuth requires your own app registration and account and cannot be validated without them.

Feature documentation: [librosa](https://librosa.org/doc/0.11.0/feature.html), [constrained DTW](https://librosa.org/doc/0.11.0/generated/librosa.sequence.dtw.html). Spotify integration follows [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), [redirect URI rules](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri) and the [2026 development-mode changes](https://developer.spotify.com/documentation/web-api/references/changes/february-2026).
