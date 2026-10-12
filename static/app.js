"use strict";
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const state = {config:null, library:[], discovery:[], analysis:null, selected:null, demo:false, curve:"loudness", busy:false, spotify:null};
const defaults = {timbre:28,harmony:18,rhythm:18,dynamics:16,structure:20};
let toastTimer, refreshing;

function toast(message, error=false) {
  $("toast").textContent=message; $("toast").classList.remove("hidden"); $("toast").classList.toggle("error",error);
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>$("toast").classList.add("hidden"),error?9000:5000);
}
async function api(path, options={}) {
  const response=await fetch(path,options);
  const body=await response.json();
  if(!response.ok) throw new Error(typeof body.detail==="string"?body.detail:"Please check the form and try again.");
  return body;
}
function view(name) {
  document.querySelectorAll(".view").forEach(el=>el.classList.add("hidden"));
  $(`${name}-view`).classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.view===name));
  $("current-view").textContent={discover:"Discover",lab:"Signal lab",library:"Your library",atlas:"Feature atlas",graph:"Song graph"}[name];
  if(name==="atlas"&&typeof refreshAtlasCollection==="function")refreshAtlasCollection();
  if(name==="graph"&&typeof refreshGraphCollection==="function")refreshGraphCollection();
  window.scrollTo({top:0,behavior:"smooth"});
}
function modal(id){$(id).showModal();}
function setBusy(busy,label="Analyzing…") {
  state.busy=busy;
  $("analyze-button").disabled=busy;
  $("demo-mode").disabled=busy;$("real-mode").disabled=busy;
  $("analyze-button").textContent=busy?label:(state.demo?"Analyze example ↗":"Analyze library ↗");
  $("playlist-button").disabled=busy||state.demo||!state.analysis?.recommendations.some(t=>t.spotify_uri);
}
function renderDiscovery() {
  $("discovery-grid").innerHTML=state.discovery.map((d,i)=>`<article class="discovery-card"><div class="cover cover-${i+1}"><span class="cover-index">SIGNAL / 0${i+1}</span><span class="cover-symbol">${["∿","∞","△","◌"][i]}</span><span>POST-ROCK ORBIT</span></div><h3>${esc(d.artist)}</h3><p class="track-title">Start with “${esc(d.track)}”</p><div class="tags">${d.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div><p class="card-note">${esc(d.note)}</p><div class="card-links"><a href="${esc(d.spotify_url)}" target="_blank" rel="noopener">Listen on Spotify ↗</a><button class="text-button discovery-add" data-index="${i}">Compare audio +</button></div><div class="card-links"><a class="source-link" href="${esc(d.source)}" target="_blank" rel="noopener">Artist / label source ↗</a></div></article>`).join("");
  document.querySelectorAll(".cover").forEach((el,i)=>el.style.setProperty("--cover-color",state.discovery[i].colour));
  document.querySelectorAll(".discovery-add").forEach(b=>b.addEventListener("click",()=>{
    const d=state.discovery[Number(b.dataset.index)];prefill({name:d.track,artists:[{name:d.artist}]},"candidate");
  }));
}
function renderWeights() {
  $("weights").innerHTML=Object.entries(state.config.groups).map(([key,g])=>`<label><span class="weight-label">${esc(g.label)} <output id="value-${key}">${defaults[key]}</output></span><input type="range" id="weight-${key}" aria-label="${esc(g.label)} weight" min="0" max="100" value="${defaults[key]}"></label>`).join("");
  Object.keys(defaults).forEach(key=>$("weight-"+key).addEventListener("input",()=>{
    $("value-"+key).textContent=$("weight-"+key).value;
    if(state.analysis){$("lab-notice").textContent="Weights changed. Analyze again to update the map and recommendations.";}
  }));
  $("method-groups").innerHTML=Object.entries(state.config.groups).map(([k,g])=>`<div class="method-group"><strong>${esc(g.label)} · ${defaults[k]}% default</strong><p>${esc(g.description)}</p></div>`).join("");
}
async function loadLibrary(){state.library=(await api("/api/library")).tracks;renderLibrary();if(typeof refreshAtlasCollection==="function")refreshAtlasCollection();}
function renderLibrary() {
  $("library-count").textContent=state.library.length;
  $("library-list").innerHTML=state.library.length?state.library.map(t=>`<div class="library-row"><div><strong>${esc(t.title)}</strong><small>${esc(t.artist)}${t.spotify_uri?" · Spotify linked":""}</small> <button class="text-button inspect-track" data-id="${esc(t.id)}">Explore features ↗</button></div><select class="role-select" data-id="${esc(t.id)}" aria-label="Role for ${esc(t.title)}"><option value="reference" ${t.role==="reference"?"selected":""}>Reference</option><option value="candidate" ${t.role==="candidate"?"selected":""}>Candidate</option></select><small class="library-duration">${Math.round(t.features.duration)} sec</small><button class="delete-track" data-id="${esc(t.id)}" aria-label="Delete ${esc(t.title)}">×</button></div>`).join(""):"<p class='section-intro'>No recordings yet. Add a favourite song above to begin.</p>";
  document.querySelectorAll(".inspect-track").forEach(b=>b.addEventListener("click",()=>openTrackAtlas(b.dataset.id)));
  document.querySelectorAll(".inspect-track").forEach(b=>{const link=document.createElement("button");link.className="text-button library-graph-link";link.textContent="Song graph ↗";link.addEventListener("click",()=>openSongGraph(b.dataset.id,false));b.after(link);});
  document.querySelectorAll(".delete-track").forEach(b=>b.addEventListener("click",async()=>{
    try{await api(`/api/library/${b.dataset.id}`,{method:"DELETE"});if(typeof forgetAudio==="function")forgetAudio(b.dataset.id);invalidateAnalysis();await loadLibrary();toast("Recording features removed.");}catch(e){toast(e.message,true);}
  }));
  document.querySelectorAll(".role-select").forEach(select=>select.addEventListener("change",async()=>{
    try{await api(`/api/library/${select.dataset.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({role:select.value})});invalidateAnalysis();await loadLibrary();}catch(e){toast(e.message,true);await loadLibrary();}
  }));
}
function invalidateAnalysis(){if(!state.demo){state.analysis=null;state.selected=null;renderAnalysis();}}
function setMode(demo) {
  state.demo=demo;state.analysis=null;state.selected=null;
  $("demo-mode").classList.toggle("selected",demo);$("real-mode").classList.toggle("selected",!demo);
  renderAnalysis();
  $("lab-notice").textContent=demo?"Example mode: real measurements of six original synthetic signals. These are not recordings by God Is an Astronaut or the discovery bands.":"Your recordings: add a favourite reference and candidates, then analyze their acoustic signatures.";
  $("analyze-button").textContent=demo?"Analyze example ↗":"Analyze library ↗";
}
async function analyze() {
  if(state.busy)return;
  const weights=Object.fromEntries(Object.keys(defaults).map(k=>[k,Number($("weight-"+k).value)]));
  if(Object.values(weights).every(v=>v===0)){toast("Give at least one feature a weight above zero.",true);return;}
  setBusy(true,state.demo?"Measuring example…":"Comparing signals…");
  try{
    state.analysis=await api("/api/recommendations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({weights,demo:state.demo})});
    state.selected=state.analysis.recommendations[0]?.id;renderAnalysis();
    $("lab-notice").textContent=state.demo?"Example mode · Measurements come from original synthetic audio, not real bands. Switch to your recordings for personal results.":`${state.analysis.references.length} reference recording(s) · ${state.analysis.recommendations.length} candidates · Complete recordings measured locally. Similarity describes resemblance, not the probability you’ll like a song.`;
  }catch(e){toast(e.message,true);}finally{setBusy(false);}
}
function renderAnalysis() {
  const a=state.analysis;
  $("export-button").disabled=!a;
  $("export-map").disabled=!a;
  $("playlist-button").disabled=!a||state.demo||!a.recommendations.some(t=>t.spotify_uri);
  $("timeline-panel").classList.toggle("hidden",!a);
  $("bands").classList.toggle("hidden",!a||state.demo);
  if(!a){
    $("map-label").textContent="Waiting for audio";
    $("map").innerHTML='<div class="empty-map"><div class="empty-rings"></div><span>Every point starts with a real signal.</span><small>Your acoustic map will appear here.</small><button class="outline" id="empty-demo">Try the synthetic example ↗</button></div>';
    $("empty-demo").addEventListener("click",()=>{setMode(true);analyze();});
    $("fingerprint").innerHTML='<div class="fingerprint-empty">⌁<p>Select a measured song<br>to see the connections.</p></div>';
    $("rankings").innerHTML='<p class="section-intro">Your analysed candidates will appear here, ranked by acoustic distance.</p>';
    $("match-count").textContent="0 recordings";$("map-variance").textContent="Weighted principal components · static features";return;
  }
  $("map-label").textContent=state.demo?"Measured synthetic audio":"Measured audio";
  $("match-count").textContent=`${a.recommendations.length} recordings`;
  $("map-variance").textContent=`2D variance: ${Math.round(a.variance.reduce((x,y)=>x+y,0)*100)}% · structure excluded`;
  $("rankings").innerHTML=a.recommendations.map((t,i)=>`<button class="rank-row ${t.id===state.selected?"active":""}" data-id="${esc(t.id)}"><span class="rank-number">${String(i+1).padStart(2,"0")}</span><span><strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></span><span class="rank-score">${t.similarity.toFixed(1)}<small>resemblance / 100</small></span><span class="rank-arrow">↗</span></button>`).join("");
  document.querySelectorAll(".rank-row").forEach(b=>b.addEventListener("click",()=>selectSong(b.dataset.id)));
  renderMap();renderFingerprint();renderTimeline();
  if(!state.demo && a.bands){$("bands").innerHTML='<h3>Bands in your measured collection</h3><p class="chart-note">Average distance of each artist’s up to three closest candidates. More recordings make this estimate more useful.</p>'+a.bands.map(b=>`<div class="band-row"><span>${esc(b.artist)} <small>· ${b.recordings} measured</small></span><span>${b.similarity.toFixed(1)} <small>resemblance</small></span></div>`).join("");}
}
function selectSong(id){state.selected=id;renderAnalysis();}
function renderMap() {
  const points=state.analysis.map;
  const width=Math.max(300,$("map").clientWidth),height=340,pad=35;
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const x=v=>maxX-minX<1e-5?width/2:pad+(v-minX)/(maxX-minX)*(width-2*pad);
  const y=v=>maxY-minY<1e-5?height/2:height-pad-(v-minY)/(maxY-minY)*(height-2*pad);
  const grids=Array.from({length:6},(_,i)=>`<line class="grid-line" x1="${pad+i*(width-2*pad)/5}" y1="25" x2="${pad+i*(width-2*pad)/5}" y2="${height-pad}"/><line class="grid-line" x1="${pad}" y1="${25+i*(height-pad-25)/5}" x2="${width-pad}" y2="${25+i*(height-pad-25)/5}"/>`).join("");
  const links=points.filter(p=>p.role==="candidate").map(p=>{const ref=points.find(r=>r.role==="reference");return `<line x1="${x(ref.x)}" y1="${y(ref.y)}" x2="${x(p.x)}" y2="${y(p.y)}" stroke="#8ba56c" stroke-opacity=".12" stroke-dasharray="3 6"/>`;}).join("");
  const labelBoxes=[];
  const dots=points.map((p,i)=>{
    const px=x(p.x),py=y(p.y),colour=p.role==="reference"?"#cfed9b":"#b6a5d8",selected=p.id===state.selected;
    const limit=width<400?19:27,label=p.title.length>limit?p.title.slice(0,limit-2)+"…":p.title;
    const anchor=px>width*.60?"end":"start",labelX=anchor==="end"?px-10:px+10,labelWidth=label.length*5.4;
    let labelY=py-12;
    for(const offset of [-12,18,-28,34,-44,50]){
      const candidateY=py+offset,box={left:anchor==="end"?labelX-labelWidth:labelX,right:anchor==="end"?labelX:labelX+labelWidth,top:candidateY-10,bottom:candidateY+3};
      if(candidateY>24&&candidateY<height-20&&!labelBoxes.some(b=>box.left<b.right+3&&box.right>b.left-3&&box.top<b.bottom+3&&box.bottom>b.top-3)){labelY=candidateY;labelBoxes.push(box);break;}
    }
    return `<g class="plot-point" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.title)}, ${esc(p.artist)}, ${p.role}"><title>${esc(p.title)} — ${esc(p.artist)}</title>${selected?`<circle cx="${px}" cy="${py}" r="18" fill="${colour}" fill-opacity=".12" stroke="${colour}" stroke-opacity=".3"/>`:""}<circle cx="${px}" cy="${py}" r="${p.role==="reference"?7:5}" fill="${colour}"/>${Math.abs(labelY-py)>20?`<line x1="${px}" y1="${py}" x2="${labelX}" y2="${labelY-3}" stroke="${colour}" stroke-opacity=".3"/>`:""}<text class="plot-text" x="${labelX}" y="${labelY}" text-anchor="${anchor}">${esc(label)}</text></g>`;
  }).join("");
  const variance=state.analysis.variance;
  $("map").innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weighted PCA acoustic map of measured recordings"><rect width="100%" height="100%" fill="#181b18"/>${grids}${links}${dots}<text class="axis-text" x="${width/2}" y="${height-5}" text-anchor="middle">Principal component 1 · ${Math.round((variance[0]||0)*100)}% variance</text><text class="axis-text" x="8" y="16">PC2 · ${Math.round((variance[1]||0)*100)}%</text></svg>`;
  document.querySelectorAll(".plot-point").forEach(el=>{
    const select=()=>{if(points.find(p=>p.id===el.dataset.id)?.role==="candidate")selectSong(el.dataset.id);else toast("This recording anchors your comparisons.");};
    el.addEventListener("click",select);el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();select();}});
  });
}
function renderFingerprint() {
  const t=state.analysis.recommendations.find(t=>t.id===state.selected);if(!t)return;
  $("fingerprint").innerHTML=`<h3 class="selected-title">${esc(t.title)}</h3><p class="selected-artist">${esc(t.artist)}</p><div class="score-row"><span class="score">${t.similarity.toFixed(1)}</span><span class="score-label">acoustic resemblance / 100</span></div>${t.evidence.map(e=>`<div class="evidence-row" title="${esc(e.description)}. Distance: ${e.distance}; weighted contribution: ${e.weighted_distance}"><div class="evidence-label"><span>${esc(e.label)}</span><span>${e.similarity.toFixed(0)}</span></div><div class="evidence-bar"><i data-width="${e.similarity}"></i></div></div>`).join("")}<p class="explanation">${esc(t.explanation)}</p><p class="fine-print">Bars: similarity per feature group. Hover to see weighted distance contributions.</p>`;
  $("fingerprint").querySelectorAll("[data-width]").forEach(el=>el.style.width=el.dataset.width+"%");
  const graphButton=document.createElement("button");graphButton.className="outline full";graphButton.textContent="Explore this song’s graph ↗";graphButton.addEventListener("click",()=>openSongGraph(t.id,state.demo));$("fingerprint").append(graphButton);
}
function renderTimeline() {
  const a=state.analysis,t=a?.recommendations.find(t=>t.id===state.selected);if(!t)return;
  const curve=state.curve,candidate=t.features.timeline[curve];
  const refs=a.references.map(r=>r.features.timeline[curve]);
  const reference=refs[0].map((_,i)=>refs.reduce((s,r)=>s+r[i],0)/refs.length);
  const width=950,height=160,left=35,right=15,top=12,bottom=28;
  const max=Math.max(...reference,...candidate,.01)*(curve==="loudness"?1:1.1);
  const path=arr=>arr.map((v,i)=>`${i?"L":"M"}${(left+i/(arr.length-1)*(width-left-right)).toFixed(1)},${(height-bottom-v/max*(height-bottom-top)).toFixed(1)}`).join(" ");
  const grid=Array.from({length:5},(_,i)=>{const x=left+i/4*(width-left-right);return `<line class="grid-line" x1="${x}" x2="${x}" y1="${top}" y2="${height-bottom}"/><text class="axis-text" x="${x}" y="${height-8}" text-anchor="middle">${i*25}%</text>`;}).join("");
  $("timeline").innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(curve)} over normalized song time"><rect width="100%" height="100%" fill="#181b18"/>${grid}<path d="${path(reference)}" fill="none" stroke="#cfed9b" stroke-width="2"/><path d="${path(candidate)}" fill="none" stroke="#b6a5d8" stroke-width="2"/><text class="axis-text" x="3" y="18">${max.toFixed(2)}</text><text class="axis-text" x="13" y="${height-bottom}">0</text></svg>`;
}
function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportAnalysis(){
  if(!state.analysis)return;
  download("resonance-analysis.json",JSON.stringify(state.analysis,null,2),"application/json");
  toast("Analysis exported, including feature measurements and distance contributions.");
}
function exportMap(){
  if(!state.analysis)return;
  const svg=$("map").querySelector("svg").cloneNode(true);
  const style=document.createElementNS("http://www.w3.org/2000/svg","style");style.textContent=".grid-line{stroke:#323b2d;stroke-width:1;stroke-dasharray:2 5}.axis-text{fill:#77866a;font-size:9px;font-family:Arial}.plot-text{fill:#c4ceba;font-size:10px;font-family:Arial}";svg.prepend(style);
  download("resonance-song-map.svg",new XMLSerializer().serializeToString(svg),"image/svg+xml");
  toast("Song map saved as an SVG image.");
}
function prefill(track,role="candidate") {
  $("song-title").value=track.name||"";$("song-artist").value=track.artists?.map(a=>a.name).join(", ")||"";$("song-uri").value=track.uri||"";$("song-role").value=role;
  view("library");toast("Track details ready. Add its audio file to measure the signature.");
}
function uriFromInput(value){
  const trimmed=value.trim();if(!trimmed)return "";
  const match=trimmed.match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{22})(?:\?.*)?$/);
  return match?"spotify:track:"+match[1]:trimmed;
}
async function uploadRecording(event) {
  event.preventDefault();const file=$("audio-file").files[0];if(!file)return;
  if(file.size>100*1024*1024){toast("Choose audio smaller than 100 MB.",true);return;}
  const form=new FormData($("upload-form"));form.set("spotify_uri",uriFromInput(form.get("spotify_uri")));
  $("upload-submit").disabled=true;$("upload-submit").textContent="Listening to the full recording…";$("upload-status").textContent="Extracting texture, harmony, rhythm, dynamics and structure. The first analysis can take a little longer.";
  try{
    const uploaded=await api("/api/library",{method:"POST",body:form});
    if(typeof rememberAudio==="function")rememberAudio(uploaded.id,file);
    invalidateAnalysis();await loadLibrary();
    $("upload-status").textContent="Audio and musical signature saved locally. Playback and comparisons will remain available after restarting.";
    $("upload-form").reset();$("song-role").value="candidate";$("file-label").textContent="Choose or drop a recording";toast("Musical signature added to your library.");
  }catch(e){$("upload-status").textContent=e.message;toast(e.message,true);}finally{$("upload-submit").disabled=false;$("upload-submit").textContent="Extract its musical signature ↗";}
}

// Spotify OAuth: PKCE + state. No client secret; no tokens reach the local server.
const REDIRECT="http://127.0.0.1:8000/callback";
const SCOPES="user-top-read playlist-modify-private";
function randomString(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");}
async function connectSpotify(event){
  event.preventDefault();const clientId=$("client-id").value.trim();const verifier=randomString()+randomString().slice(0,32),csrf=randomString();
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  sessionStorage.setItem("resonance-oauth",JSON.stringify({clientId,verifier,state:csrf,created:Date.now()}));localStorage.setItem("resonance-client-id",clientId);
  const url=new URL("https://accounts.spotify.com/authorize");url.search=new URLSearchParams({client_id:clientId,response_type:"code",redirect_uri:REDIRECT,scope:SCOPES,state:csrf,code_challenge_method:"S256",code_challenge:challenge});
  window.location.assign(url.href);
}
async function tokenRequest(params){
  const response=await fetch("https://accounts.spotify.com/api/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params)});
  const body=await response.json();if(!response.ok)throw new Error(body.error_description||"Spotify authorization failed. Check the Client ID and redirect URI.");return body;
}
function saveTokens(body,clientId){
  state.spotify={access_token:body.access_token,refresh_token:body.refresh_token||state.spotify?.refresh_token,expires_at:Date.now()+body.expires_in*1000,clientId};
  sessionStorage.setItem("resonance-spotify",JSON.stringify(state.spotify));updateSpotifyButton();
}
async function restoreSpotify(){
  const query=new URLSearchParams(location.search);
  try{
    const saved=sessionStorage.getItem("resonance-spotify");if(saved)state.spotify=JSON.parse(saved);
    if(query.has("code")||query.has("error")){
      const pending=JSON.parse(sessionStorage.getItem("resonance-oauth")||"null");sessionStorage.removeItem("resonance-oauth");history.replaceState({},"","/");
      if(!pending||pending.state!==query.get("state")||Date.now()-pending.created>10*60*1000)throw new Error("Spotify login expired or could not be verified. Connect again.");
      if(query.has("error"))throw new Error("Spotify connection was cancelled.");
      saveTokens(await tokenRequest({client_id:pending.clientId,grant_type:"authorization_code",code:query.get("code"),redirect_uri:REDIRECT,code_verifier:pending.verifier}),pending.clientId);
      toast("Spotify connected. Choose a favourite as your analysis reference.");
    }
    updateSpotifyButton();if(state.spotify)await loadProfile();
  }catch(e){toast(e.message,true);updateSpotifyButton();}
}
function updateSpotifyButton(){
  $("spotify-button").textContent=state.spotify?"Spotify connected · disconnect":"≋  Connect Spotify";
}
async function spotify(path, options={}) {
  if(!state.spotify){modal("connect-dialog");throw new Error("Connect Spotify to use its catalogue.");}
  if(state.spotify.expires_at<Date.now()+60000){
    if(!refreshing)refreshing=tokenRequest({client_id:state.spotify.clientId,grant_type:"refresh_token",refresh_token:state.spotify.refresh_token}).then(b=>saveTokens(b,state.spotify.clientId)).catch(e=>{disconnectSpotify();throw e;}).finally(()=>{refreshing=null;});
    await refreshing;
  }
  const response=await fetch("https://api.spotify.com/v1"+path,{...options,headers:{"Content-Type":"application/json",...options.headers,Authorization:"Bearer "+state.spotify.access_token}});
  if(response.status===429){throw new Error(`Spotify’s request limit was reached. Try again in ${response.headers.get("Retry-After")||"a few"} seconds.`);}
  if(response.status===401){disconnectSpotify();throw new Error("Spotify session expired. Connect again.");}
  const body=response.status===204?{}:await response.json();
  if(!response.ok)throw new Error(response.status===403?"Spotify denied access. Check Premium, your app’s user allowlist and API quota permissions.":body.error?.message||"Spotify request failed.");
  return body;
}
function disconnectSpotify(){state.spotify=null;sessionStorage.removeItem("resonance-spotify");sessionStorage.removeItem("resonance-oauth");$("spotify-profile").classList.add("hidden");$("top-tracks").replaceChildren();$("search-results").innerHTML='<p class="muted">Connect Spotify to search its catalogue.</p>';updateSpotifyButton();}
function trackRows(tracks,container,role) {
  container.innerHTML=tracks.map((t,i)=>`<div class="search-track">${t.album?.images?.[0]?.url?`<img src="${esc(t.album.images[0].url)}" alt="" loading="lazy">`:'<span class="tiny-orbit">◒</span>'}<span><a href="https://open.spotify.com/track/${esc(t.id)}" target="_blank" rel="noopener">${esc(t.name)} ↗</a><small>${esc(t.artists?.map(a=>a.name).join(", "))}</small></span><button class="text-button" data-index="${i}">Add audio +</button></div>`).join("");
  container.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>prefill(tracks[Number(b.dataset.index)],role)));
}
async function loadProfile(){
  try{const data=await spotify("/me/top/tracks?limit=10&time_range=medium_term");$("spotify-profile").classList.remove("hidden");trackRows(data.items||[],$("top-tracks"),"reference");if(!data.items?.length)$("top-tracks").innerHTML='<p class="muted">Spotify has no top tracks to show yet. You can search the catalogue in Your library.</p>';}catch(e){toast(e.message,true);}
}
async function searchSpotify(event){
  event.preventDefault();const button=event.target.querySelector("button");button.disabled=true;
  try{const query=$("search-query").value.trim(),uri=uriFromInput(query);const direct=/^spotify:track:[A-Za-z0-9]{22}$/.test(uri);const data=await spotify(direct?"/tracks/"+uri.split(":")[2]:"/search?"+new URLSearchParams({q:query,type:"track",limit:"10"}));const tracks=direct?[data]:data.tracks?.items||[];trackRows(tracks,$("search-results"),"candidate");if(!tracks.length)$("search-results").innerHTML='<p class="muted">No tracks found. Try a different artist or title.</p>';}catch(e){toast(e.message,true);}finally{button.disabled=false;}
}
async function importRealMusic(){
  $("import-real-music").disabled=true;$("real-music-status").textContent="Downloading full creator-provided recordings and extracting their features. This may take a minute…";
  try{
    const result=await api("/api/import-licensed",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({keys:["descent","vortex","darkening"]})});
    await loadLibrary();const loaded=[...result.added,...result.existing];
    $("real-music-status").textContent=`${loaded.length} actual recording(s) available.${result.errors.length?" "+result.errors.map(e=>e.title+": "+e.message).join(" "):" Audio and features saved locally."}`;
    if(loaded.length){atlas.demo=false;atlas.pair=null;view("atlas");refreshAtlasCollection(loaded[1]?.id||loaded[0].id);if(state.library.length>1)await compareAtlas();toast("Real recordings are ready to play and compare.");}
    else toast("Could not import the recordings. Check your internet connection and try again.",true);
  }catch(e){$("real-music-status").textContent=e.message;toast(e.message,true);}finally{$("import-real-music").disabled=false;}
}
async function createPlaylist(){
  if(!state.analysis||state.demo)return;
  const uris=[...new Set(state.analysis.recommendations.filter(t=>t.spotify_uri).slice(0,20).map(t=>t.spotify_uri))];
  if(!uris.length){toast("Link measured songs to Spotify tracks first.",true);return;}
  if(!state.spotify){modal("connect-dialog");return;}
  $("playlist-button").disabled=true;let playlist;
  try{
    playlist=await spotify("/me/playlists",{method:"POST",body:JSON.stringify({name:"Resonance · God Is an Astronaut orbit",description:"Acoustic matches from my local recordings, ordered by measured similarity. Created with Resonance.",public:false})});
    await spotify(`/playlists/${playlist.id}/items`,{method:"POST",body:JSON.stringify({uris})});
    toast(`Saved ${uris.length} measured tracks to a private Spotify playlist.`);
    const link=document.createElement("a");link.href="https://open.spotify.com/playlist/"+playlist.id;link.target="_blank";link.rel="noopener";link.textContent=" Open playlist ↗";$("toast").append(link);
  }catch(e){toast((playlist?"Playlist created, but tracks could not be added. ":"")+e.message,true);}finally{$("playlist-button").disabled=false;}
}
function bindEvents(){
  window.addEventListener("resize",()=>{if(state.analysis)renderMap();});
  document.querySelectorAll("[data-view]").forEach(el=>el.addEventListener("click",()=>view(el.dataset.view)));
  $("explore-button").addEventListener("click",()=>view("lab"));
  ["upload-start","lab-upload"].forEach(id=>$(id).addEventListener("click",()=>view("library")));
  $("library-analyze").addEventListener("click",()=>{view("lab");setMode(false);analyze();});
  $("demo-mode").addEventListener("click",()=>{setMode(true);analyze();});$("real-mode").addEventListener("click",()=>setMode(false));
  $("analyze-button").addEventListener("click",analyze);$("export-button").addEventListener("click",exportAnalysis);
  $("export-map").addEventListener("click",exportMap);
  $("reset-weights").addEventListener("click",()=>{Object.keys(defaults).forEach(k=>{$("weight-"+k).value=defaults[k];$("value-"+k).textContent=defaults[k];});if(state.analysis)analyze();});
  document.querySelectorAll("[data-curve]").forEach(b=>b.addEventListener("click",()=>{state.curve=b.dataset.curve;document.querySelectorAll("[data-curve]").forEach(el=>el.classList.toggle("selected",el===b));if(state.analysis)renderTimeline();}));
  ["method-button","footer-method"].forEach(id=>$(id).addEventListener("click",()=>modal("method-dialog")));
  document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$(b.dataset.close).close()));
  $("spotify-button").addEventListener("click",()=>{if(state.spotify){disconnectSpotify();toast("Spotify disconnected. Local recordings are still available.");}else{if(location.hostname!=="127.0.0.1"){window.location.assign("http://127.0.0.1:8000/");return;}modal("connect-dialog");}});
  $("redirect-uri").textContent=REDIRECT;$("client-id").value=state.config.client_id||localStorage.getItem("resonance-client-id")||"";
  $("copy-redirect").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(REDIRECT);toast("Redirect URI copied.");}catch{toast("Select and copy the redirect URI shown above.");}});
  $("connect-form").addEventListener("submit",e=>connectSpotify(e).catch(err=>toast(err.message,true)));
  $("search-form").addEventListener("submit",searchSpotify);$("playlist-button").addEventListener("click",createPlaylist);
  $("upload-form").addEventListener("submit",uploadRecording);
  $("import-real-music").addEventListener("click",importRealMusic);
  $("audio-file").addEventListener("change",()=>{const file=$("audio-file").files[0];if(file){$("file-label").textContent=file.name;if(!$("song-title").value)$("song-title").value=file.name.replace(/\.[^.]+$/,"");}});
  const drop=$("file-drop");drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("dragging");});drop.addEventListener("dragleave",()=>drop.classList.remove("dragging"));drop.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("dragging");if(e.dataTransfer.files.length){const transfer=new DataTransfer();transfer.items.add(e.dataTransfer.files[0]);$("audio-file").files=transfer.files;$("audio-file").dispatchEvent(new Event("change"));}});
}
async function init(){
  try{const [config,discovery]=await Promise.all([api("/api/config"),api("/api/discovery")]);state.config=config;state.discovery=discovery.items;renderDiscovery();renderWeights();bindEvents();renderAnalysis();await loadLibrary();await restoreSpotify();initAtlas();initKnowledgeGraph();if(location.hash==="#atlas-example"){view("atlas");loadAtlasExamples();}else if(location.hash==="#atlas"){view("atlas");if(state.library.length>1)compareAtlas();}else if(location.hash==="#library"){view("library");}else if(location.hash==="#graph-example"){view("graph");loadGraphExamples();}else if(location.hash==="#graph"){view("graph");}}catch(e){toast("Could not load the app: "+e.message,true);}
}
init();
