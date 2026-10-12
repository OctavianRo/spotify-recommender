"""Editorial leads only: these are not measured acoustic matches."""
from urllib.parse import quote

DISCOVERY = [
    {"artist": "If These Trees Could Talk", "track": "Barren Lands of the Modern Dinosaur", "album": "Red Forest", "tags": ["Instrumental", "Post-rock", "Post-metal"], "note": "A lead to test if you want instrumental guitar music with a heavier edge.", "source": "https://ifthesetreescouldtalk.bandcamp.com/album/red-forest", "colour": "#84b59c"},
    {"artist": "pg.lost", "track": "Ikaros", "album": "Versus", "tags": ["Instrumental", "Post-rock", "Experimental"], "note": "A lead to test for instrumental rock textures and longer-form arrangements.", "source": "https://pglost.bandcamp.com/album/versus", "colour": "#b3a1d2"},
    {"artist": "Caspian", "track": "Arcs of Command", "album": "Dust and Disquiet", "tags": ["Instrumental rock", "Post-rock", "Post-metal"], "note": "A lead to test for layered instrumental rock; compare its dynamics with your favourite song.", "source": "https://caspiantheband.bandcamp.com/album/dust-and-disquiet", "colour": "#d4ab81"},
    {"artist": "This Will Destroy You", "track": "Quiet", "album": "Young Mountain", "tags": ["Instrumental", "Post-rock", "Experimental"], "note": "A lead to test on the atmospheric side of instrumental rock.", "source": "https://thiswilldestroyyou.bandcamp.com/album/young-mountain", "colour": "#88a9c7"},
]
for item in DISCOVERY:
    item["spotify_url"] = "https://open.spotify.com/search/" + quote(item["artist"] + " " + item["track"], safe="")
    item["provenance"] = "Editorial shortlist based on artist/label genre tags; no audio measured."
