"use strict";
const atlas = {demo:false, examples:[], pair:null, busy:false, request:0, audio:new Map(), descriptor:0};
const atlasColours={timbre:"#a7c9ad",harmony:"#b6a5d8",rhythm:"#dda985",dynamics:"#cfed9b",structure:"#89b8c9"};
const atlasTracks=()=>atlas.demo?atlas.examples:state.library;
const formatValue=v=>v===null||v===undefined?"—":Math.abs(v)<.001&&v!==0?v.toExponential(2):Number(v).toFixed(Math.abs(v)>=100?1:3);

function rememberAudio(id,file){if(atlas.audio.has(id))URL.revokeObjectURL(atlas.audio.get(id));atlas.audio.set(id,URL.createObjectURL(file));}
function forgetAudio(id){if(atlas.audio.has(id)){URL.revokeObjectURL(atlas.audio.get(id));atlas.audio.delete(id);}}
function atlasWeights(){return Object.fromEntries(Object.keys(defaults).map(k=>[k,Number($("weight-"+k).value)]));}
function initAtlas(){
  ["atlas-example","atlas-demo-mode","atlas-empty-example"].forEach(id=>$(id).addEventListener("click",loadAtlasExamples));
  ["atlas-add","atlas-search"].forEach(id=>$(id).addEventListener("click",()=>view("library")));
  $("atlas-real-mode").addEventListener("click",()=>{atlas.demo=false;atlas.pair=null;refreshAtlasCollection();});
  $("atlas-compare").addEventListener("click",compareAtlas);
  ["atlas-reference","atlas-candidate"].forEach(id=>$(id).addEventListener("change",()=>{
    atlas.request++;atlas.pair=null;
    const tracks=atlasTracks();
    if(tracks.length>1&&$("atlas-reference").value===$("atlas-candidate").value){const other=tracks.find(t=>t.id!==$(id).value);$(id==="atlas-reference"?"atlas-candidate":"atlas-reference").value=other.id;}
    updateAtlasPlayers();if(tracks.length>1)compareAtlas();else if(tracks.length===1)renderSingleSong(tracks[0]);
  }));
  $("atlas-matrix-song").addEventListener("change",renderAnatomy);
  $("descriptor-filter").addEventListener("input",renderDescriptorTable);
  $("atlas-export").addEventListener("click",()=>{
    const svg=$("radial-signature").querySelector("svg");if(!svg)return;
    download("resonance-feature-signature.svg",new XMLSerializer().serializeToString(svg),"image/svg+xml");
    toast("Feature signature saved as an SVG image.");
  });
  $("atlas-open-graph").addEventListener("click",()=>openSongGraph(atlas.pair.candidate.id,atlas.demo));
  window.addEventListener("beforeunload",()=>atlas.audio.forEach(url=>URL.revokeObjectURL(url)));
  refreshAtlasCollection();
}
async function loadAtlasExamples(){
  if(atlas.busy)return;
  atlas.busy=true;$("atlas-notice").textContent="Extracting the playable examples’ full acoustic signatures…";$("atlas-example").disabled=true;
  try{
    if(!atlas.examples.length)atlas.examples=(await api("/api/example-tracks")).tracks;
    atlas.demo=true;atlas.pair=null;refreshAtlasCollection();
  }catch(e){toast(e.message,true);}finally{atlas.busy=false;$("atlas-example").disabled=false;}
  if(atlas.demo)await compareAtlas();
}
function refreshAtlasCollection(preferredId){
  const tracks=atlasTracks(),previousRef=$("atlas-reference").value,previousCandidate=preferredId||$("atlas-candidate").value;
  if(atlas.pair&&(!tracks.some(t=>t.id===atlas.pair.candidate.id)||(atlas.pair.reference&&!tracks.some(t=>t.id===atlas.pair.reference.id))))atlas.pair=null;
  const options=tracks.map(t=>`<option value="${esc(t.id)}">${esc(t.title)} · ${esc(t.artist)}</option>`).join("");
  $("atlas-reference").innerHTML=tracks.length>1?options:'<option value="">Add another recording to compare</option>';
  $("atlas-candidate").innerHTML=options||'<option value="">Add a recording first</option>';
  if(tracks.length>1){
    $("atlas-reference").value=tracks.find(t=>t.id===previousRef)?.id||tracks.find(t=>t.role==="reference")?.id||tracks[0].id;
    $("atlas-candidate").value=tracks.find(t=>t.id===previousCandidate&&t.id!==$("atlas-reference").value)?.id||tracks.find(t=>t.role==="candidate"&&t.id!==$("atlas-reference").value)?.id||tracks.find(t=>t.id!==$("atlas-reference").value).id;
  }
  $("atlas-compare").disabled=tracks.length<2||atlas.busy;
  $("atlas-real-mode").classList.toggle("selected",!atlas.demo);$("atlas-demo-mode").classList.toggle("selected",atlas.demo);
  $("atlas-notice").textContent=atlas.demo?"Original examples · These are real measurements of original procedural recordings, not songs by the discovery bands. Play or download them below.":"Your audio and extracted features are saved in your local library. You can return to play and compare these recordings at any time.";
  updateAtlasPlayers();
  if(tracks.length===1)renderSingleSong(tracks[0]);
  else if(!atlas.pair){$("atlas-content").classList.add("hidden");$("atlas-empty").classList.remove("hidden");$("atlas-export").disabled=true;$("atlas-open-graph").disabled=true;}
}
function openTrackAtlas(id){atlas.demo=false;atlas.pair=null;view("atlas");refreshAtlasCollection(id);if(atlasTracks().length>1)compareAtlas();}
function updateAtlasPlayers(){
  for(const side of ["reference","candidate"]){
    const track=atlasTracks().find(t=>t.id===$("atlas-"+side).value),player=$(side+"-audio"),note=$(side+"-audio-note");
    $(side+"-player-title").textContent=track?track.title+" · "+track.artist:"Choose a recording";
    const source=track?(atlas.demo?"/api/example-audio/"+track.id:track.audio_url||atlas.audio.get(track.id)):null;
    if(player.getAttribute("src")!==source){player.pause();if(source)player.src=source;else player.removeAttribute("src");player.load();}
    player.classList.toggle("hidden",!source);
    note.replaceChildren();
    if(atlas.demo&&track){const link=document.createElement("a");link.href="/api/example-audio/"+track.id+"?download=true";link.textContent="Download this original recording ↓";note.append(link);}
    else if(track?.license){note.textContent=track.provenance+" ";const link=document.createElement("a");link.href=track.source_url;link.target="_blank";link.rel="noopener";link.textContent="Creator / licence ↗";note.append(link);}
    else note.textContent=source?"Saved local audio · available after restarting the app.":"This older entry has no saved audio. Re-add its file to enable playback.";
  }
}
async function compareAtlas(){
  if(atlas.busy)return;
  const reference=$("atlas-reference").value,candidate=$("atlas-candidate").value;if(!reference||!candidate||reference===candidate)return;
  const request=++atlas.request;atlas.busy=true;$("atlas-compare").disabled=true;$("atlas-compare").textContent="Aligning recordings…";
  try{
    const pair=await api("/api/comparison",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reference_id:reference,candidate_id:candidate,demo:atlas.demo,weights:atlasWeights()})});
    if(request!==atlas.request)return;
    atlas.pair=pair;atlas.descriptor=0;renderAtlas();
  }catch(e){if(request===atlas.request)toast(e.message,true);}finally{atlas.busy=false;$("atlas-compare").disabled=atlasTracks().length<2;$("atlas-compare").textContent="Compare signatures ↗";if(request!==atlas.request&&atlasTracks().length>1)compareAtlas();}
}
function renderSingleSong(track){
  atlas.pair={candidate:track,reference:null,evidence:[],alignment:null,similarity:null,descriptors:state.config.feature_schema.map(d=>({...d,candidate:track.features.groups[d.group][d.index],reference:null,candidate_z:null,reference_z:null,gap:null}))};
  renderAtlas();
}
function renderAtlas(){
  $("atlas-content").classList.remove("hidden");$("atlas-empty").classList.add("hidden");$("atlas-export").disabled=false;
  const pair=atlas.pair;$("atlas-pair-score").textContent=pair.reference?pair.similarity.toFixed(1)+" / 100 resemblance":"Single recording";
  $("atlas-open-graph").disabled=false;
  renderRadialSignature();renderAnatomy();renderBridge();renderDescriptorTable();
}
function renderRadialSignature(){
  const descriptors=atlas.pair.descriptors,n=descriptors.length,cx=280,cy=250,inner=82,outer=197;
  const xy=(index,r)=>{const a=index/n*Math.PI*2-Math.PI/2;return [cx+Math.cos(a)*r,cy+Math.sin(a)*r];};
  const radius=z=>inner+(Math.max(-4,Math.min(4,z))+4)/8*(outer-inner);
  const curve=key=>descriptors.map((d,i)=>{const [x,y]=xy(i,radius(d[key]));return `${i?"L":"M"}${x.toFixed(2)},${y.toFixed(2)}`;}).join(" ")+" Z";
  const rings=[-4,-2,0,2,4].map(z=>`<circle cx="${cx}" cy="${cy}" r="${radius(z)}" fill="none" stroke="#394532" stroke-opacity="${z===0?.85:.5}" stroke-dasharray="${z===0?"0":"2 5"}"/><text x="${cx+4}" y="${cy-radius(z)+11}" fill="#7d9070" font-size="8">${z>0?"+":""}${z}z</text>`).join("");
  const spokes=descriptors.map((d,i)=>{const a=xy(i,inner),b=xy(i,outer+7),tick=xy(i,outer+14),ref=xy(i,radius(d.reference_z??0)),candidate=xy(i,radius(d.candidate_z??0));return `<g class="descriptor-spoke" data-descriptor="${i}" tabindex="0" role="button" aria-label="${esc(d.label)}: comparison ${formatValue(d.candidate)}, reference ${formatValue(d.reference)}"><title>${esc(d.label)} · ${esc(d.unit)}\nReference: ${formatValue(d.reference)}\nComparison: ${formatValue(d.candidate)}\nScaled gap: ${formatValue(d.gap)}</title><line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#48553c" stroke-opacity=".25"/><line x1="${b[0]}" y1="${b[1]}" x2="${tick[0]}" y2="${tick[1]}" stroke="${atlasColours[d.group]}" stroke-width="2.5"/><line x1="${a[0]}" y1="${a[1]}" x2="${tick[0]}" y2="${tick[1]}" stroke="transparent" stroke-width="8"/>${atlas.pair.reference?`<circle cx="${ref[0]}" cy="${ref[1]}" r="2.1" fill="#cfed9b"/><circle cx="${candidate[0]}" cy="${candidate[1]}" r="2.1" fill="#b6a5d8"/>`:""}</g>`;}).join("");
  let offset=0;const groupLabels=Object.keys(atlasColours).filter(g=>g!=="structure").map(group=>{const count=descriptors.filter(d=>d.group===group).length,middle=offset+(count-1)/2;offset+=count;const [x,y]=xy(middle,233);return `<text x="${x}" y="${y}" fill="${atlasColours[group]}" font-size="10" text-anchor="middle">${{timbre:"TEXTURE · 47",harmony:"HARMONY · 9",rhythm:"PULSE · 27",dynamics:"DYNAMICS · 4"}[group]}</text>`;}).join("");
  const pairCurves=atlas.pair.reference?`<path d="${curve("reference_z")}" fill="#cfed9b" fill-opacity=".05" stroke="#cfed9b" stroke-width="1.4"/><path d="${curve("candidate_z")}" fill="#b6a5d8" fill-opacity=".04" stroke="#b6a5d8" stroke-width="1.4"/>`:"";
  $("radial-signature").innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 500" role="img" aria-label="87-dimensional acoustic feature signature with individual interactive spokes" font-family="Arial, sans-serif"><rect width="560" height="500" fill="#181b18"/>${atlas.pair.reference?rings:`<circle cx="${cx}" cy="${cy}" r="${outer}" stroke="#394532" fill="none"/>`}${pairCurves}${spokes}${groupLabels}<circle cx="${cx}" cy="${cy}" r="66" fill="#181b18" stroke="#45523a"/><text x="${cx}" y="${cy-5}" text-anchor="middle" fill="#cfed9b" font-size="38">87</text><text x="${cx}" y="${cy+17}" text-anchor="middle" fill="#9fac95" font-size="9" letter-spacing="2">${atlas.pair.reference?"SHARED SIGNALS":"MEASUREMENTS"}</text><text x="${cx}" y="${cy+35}" text-anchor="middle" fill="#718264" font-size="8">${atlas.pair.reference?"+ temporal alignment":"add a song to compare"}</text></svg>`;
  $("radial-signature").querySelectorAll(".descriptor-spoke").forEach(el=>{
    const inspect=()=>{atlas.descriptor=Number(el.dataset.descriptor);inspectDescriptor();};
    el.addEventListener("mouseenter",inspect);el.addEventListener("focus",inspect);el.addEventListener("click",inspect);el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();inspect();}});
  });inspectDescriptor();
}
function inspectDescriptor(){
  const d=atlas.pair.descriptors[atlas.descriptor];
  $("descriptor-inspector").innerHTML=`<div><span class="eyebrow">${esc(state.config.groups[d.group].label)}</span><strong>${esc(d.label)}</strong><p>${esc(d.meaning)}</p></div><div class="descriptor-values"><span>Reference <b>${formatValue(d.reference)}</b></span><span>Comparison <b>${formatValue(d.candidate)}</b></span><small>${esc(d.unit)} · scaled gap ${formatValue(d.gap)}</small></div>`;
}
function colourScale(value,low,high,diverging=false){
  const t=Math.max(0,Math.min(1,(value-low)/Math.max(high-low,1e-9)));
  const stops=diverging?[[91,113,150],[22,29,24],[213,233,161]]:[[15,22,20],[48,62,80],[137,99,156],[234,163,103],[229,243,183]];
  const pos=t*(stops.length-1),index=Math.min(stops.length-2,Math.floor(pos)),mix=pos-index;
  return "rgb("+stops[index].map((v,i)=>Math.round(v*(1-mix)+stops[index+1][i]*mix)).join(",")+")";
}
function matrixSvg(matrix,{label,low,high,rows,unit,duration,height=155,diverging=false,path=null,band=false,allowed=null}){
  const w=550,left=48,top=12,right=12,bottom=24,rowCount=matrix.length,colCount=matrix[0].length,cw=(w-left-right)/colCount,ch=(height-top-bottom)/rowCount;
  const cells=matrix.map((row,r)=>row.map((v,c)=>`<rect x="${left+c*cw}" y="${top+(rowCount-1-r)*ch}" width="${cw+.15}" height="${ch+.15}" fill="${colourScale(v,low,high,diverging)}"><title>${esc(rows?.[r]??"Candidate time "+Math.round(r/(rowCount-1)*100)+"%")}; ${band?"reference time "+Math.round(c/(colCount-1)*100)+"%":(c/colCount*duration).toFixed(2)+" s"}; ${formatValue(v)} ${esc(unit)}</title></rect>`).join("")).join("");
  const rowLabels=Array.from({length:rowCount},(_,i)=>i).filter(i=>rowCount<=13||i%Math.ceil(rowCount/5)===0||i===rowCount-1).map(r=>`<text x="${left-6}" y="${top+(rowCount-r-.5)*ch+3}" text-anchor="end" fill="#9ba991" font-size="8">${esc(rows?.[r]??Math.round(r/(rowCount-1)*100)+"%")}</text>`).join("");
  const ticks=Array.from({length:5},(_,i)=>`<text x="${left+i/4*(w-left-right)}" y="${height-6}" text-anchor="middle" fill="#899b7d" font-size="8">${band?i*25+"%":(duration*i/4).toFixed(1)+"s"}</text>`).join("");
  const shaded=band?matrix.map((row,r)=>row.map((_,c)=>(allowed?!allowed[r][c]:Math.abs(r-c)>Math.floor(rowCount*.2))?`<rect x="${left+c*cw}" y="${top+(rowCount-1-r)*ch}" width="${cw+.15}" height="${ch+.15}" fill="#101211" fill-opacity=".75"/>`:"").join("")).join(""):"";
  const alignment=path?`<polyline points="${path.map(([r,c])=>`${left+(r+.5)*cw},${top+(rowCount-1-c+.5)*ch}`).join(" ")}" fill="none" stroke="#cfed9b" stroke-width="2"/>`:"";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${height}" role="img" aria-label="${esc(label)}" font-family="Arial"><rect width="${w}" height="${height}" fill="#181b18"/>${cells}${shaded}${rowLabels}${ticks}${alignment}<text x="${left}" y="9" fill="#899b7d" font-size="7">${formatValue(low)} → ${formatValue(high)} ${esc(unit)}</text></svg>`;
}
function renderAnatomy(){
  if(!atlas.pair)return;const track=$("atlas-matrix-song").value==="reference"&&atlas.pair.reference?atlas.pair.reference:atlas.pair.candidate;
  const visuals=track.features.visuals;
  if(!visuals){["atlas-waveform","atlas-spectrogram","atlas-chroma","atlas-mfcc"].forEach(id=>$(id).innerHTML='<p class="muted">This recording was added before the feature atlas. Re-add its audio to extract these plots.</p>');return;}
  const duration=track.features.duration,n=visuals.waveform_max.length,w=550,h=80,x=i=>48+i/(n-1)*490,y=v=>35-v*27;
  const line=(array,reverse)=>Array.from({length:n},(_,i)=>{const j=reverse?n-1-i:i;return`${x(j).toFixed(2)},${y(array[j]).toFixed(2)}`;}).join(" ");
  $("atlas-waveform").innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Peak-normalized waveform of ${esc(track.title)}"><line x1="48" x2="538" y1="35" y2="35" stroke="#48543e"/><polygon points="${line(visuals.waveform_max,false)} ${line(visuals.waveform_min,true)}" fill="#cfed9b" fill-opacity=".65"/><text x="48" y="76" fill="#8b9e7d" font-family="Arial" font-size="9">${esc(track.title)} · ${duration.toFixed(1)}s · peak-normalized amplitude</text></svg>`;
  $("atlas-spectrogram").innerHTML=matrixSvg(visuals.mel_db,{label:"Mel-frequency spectrogram of "+track.title,low:-80,high:0,rows:visuals.mel_frequencies_hz.map(f=>f>=1000?(f/1000).toFixed(1)+"k":Math.round(f)+"Hz"),unit:"dB",duration,height:168});
  $("atlas-chroma").innerHTML=matrixSvg(visuals.chroma,{label:"Harmonic pitch-class chromagram of "+track.title,low:0,high:1,rows:visuals.pitch_classes,unit:"strength",duration,height:145});
  const bound=Math.max(...visuals.mfcc.flat().map(Math.abs),1);
  $("atlas-mfcc").innerHTML=matrixSvg(visuals.mfcc,{label:"MFCC texture heatmap of "+track.title,low:-bound,high:bound,rows:Array.from({length:13},(_,i)=>"C"+(i+1)),unit:"coefficient",duration,height:145,diverging:true});
}
function renderBridge(){
  const pair=atlas.pair;
  if(!pair.reference){$("atlas-bridge-title").textContent="Add another band to find the connection";$("atlas-evidence").innerHTML='<p class="muted">All 87 raw values are available below. Add another recording for scaled differences and recommendation evidence.</p>';$("atlas-alignment").replaceChildren();$("atlas-reason").textContent="A single recording can be inspected, but cannot establish resemblance to another band.";return;}
  $("atlas-bridge-title").textContent=pair.reference.artist===pair.candidate.artist?pair.reference.title+" → "+pair.candidate.title:pair.reference.artist+" → "+pair.candidate.artist;
  $("atlas-evidence").innerHTML=`<p class="bridge-song-names">${esc(pair.reference.title)} <span>⇄</span> ${esc(pair.candidate.title)}</p>`+pair.evidence.map(e=>`<div class="bridge-evidence"><div><strong>${esc(e.label)}</strong><span>${e.similarity.toFixed(1)} resemblance</span></div><div class="bridge-bar"><i data-fill="${e.similarity}" data-colour="${atlasColours[e.key]}"></i></div><small>${(e.weight*100).toFixed(0)}% emphasis · distance ${e.distance.toFixed(3)} · contributes ${e.weighted_distance.toFixed(3)} to the total</small></div>`).join("")+`<div class="bridge-total"><span>Total weighted distance</span><b>${pair.distance.toFixed(3)}</b></div>`;
  $("atlas-evidence").querySelectorAll("[data-fill]").forEach(el=>{el.style.width=el.dataset.fill+"%";el.style.background=el.dataset.colour;});
  // API matrix is reference rows / candidate columns. Display reference on X.
  const matrix=pair.alignment.cost[0].map((_,c)=>pair.alignment.cost.map(row=>row[c])),high=Math.max(...matrix.flat(),.001);
  const allowed=pair.alignment.allowed?.[0].map((_,c)=>pair.alignment.allowed.map(row=>row[c]));
  $("atlas-alignment").innerHTML=matrixSvg(matrix,{label:"Dynamic time warping cost and optimal alignment path",low:0,high,unit:"frame distance",duration:100,height:260,path:pair.alignment.path,band:true,allowed});
  const closest=pair.evidence.filter(e=>e.weight>0).sort((a,b)=>a.distance-b.distance).slice(0,2),different=[...pair.evidence].sort((a,b)=>b.weighted_distance-a.weighted_distance)[0];
  const lead=pair.similarity<30?`${esc(pair.candidate.title)} has limited overall acoustic resemblance to ${esc(pair.reference.title)}.`:`${esc(pair.candidate.title)} is a listening lead when you value ${closest.map(e=>esc(e.label.toLowerCase())).join(" and ")}.`;
  $("atlas-reason").innerHTML=`<strong>${lead}</strong><p>The closest measured groups are ${closest.map(e=>esc(e.label.toLowerCase())+" ("+e.similarity.toFixed(0)+" / 100)").join(" and ")}. ${esc(different.label)} adds the largest weighted difference (${different.weighted_distance.toFixed(3)}) to the match. Listen to both recordings to decide whether that difference is interesting to you.</p><small>This is evidence for these two recordings. Band rankings average across your favourite references and up to three candidates per artist. A resemblance score is not a probability of liking a band or a causal explanation of taste.</small>`;
}
function renderDescriptorTable(){
  if(!atlas.pair)return;const filter=$("descriptor-filter").value.toLowerCase();
  const rows=atlas.pair.descriptors.filter(d=>(d.label+" "+d.meaning+" "+d.group).toLowerCase().includes(filter));
  $("descriptor-table").innerHTML=rows.map(d=>`<tr><td><span class="feature-group-dot" data-group="${d.group}"></span>${esc(d.label)}<small>${esc(d.unit)}</small></td><td>${formatValue(d.reference)}</td><td>${formatValue(d.candidate)}</td><td>${formatValue(d.gap)}</td><td>${esc(d.meaning)}</td></tr>`).join("")||'<tr><td colspan="5">No matching descriptors.</td></tr>';
  $("descriptor-table").querySelectorAll("[data-group]").forEach(el=>el.style.background=atlasColours[el.dataset.group]);
}
