"use strict";
const kg={demo:false,data:null,focus:null,selected:null,expanded:new Set(),positions:new Map(),zoom:1,pan:{x:0,y:0},request:0,busy:false,drag:null};
const graphCollection=()=>kg.demo?atlas.examples:state.library;
function initKnowledgeGraph(){
  ["graph-example","graph-empty-example"].forEach(id=>$(id).addEventListener("click",loadGraphExamples));
  $("graph-real-mode").addEventListener("click",()=>{kg.demo=false;kg.data=null;kg.focus=null;refreshGraphCollection();});
  $("graph-add").addEventListener("click",()=>view("library"));
  $("graph-song").addEventListener("change",()=>{kg.focus=$("graph-song").value;loadSongGraph();});
  $("graph-all-features").addEventListener("change",()=>{kg.expanded=new Set($("graph-all-features").checked?Object.keys(defaults):[]);renderKnowledgeGraph();});
  $("graph-artists").addEventListener("change",renderKnowledgeGraph);
  $("graph-min").addEventListener("input",()=>{$("graph-min-value").textContent=$("graph-min").value;renderKnowledgeGraph();if(kg.data)renderGraphPaths();});
  $("graph-search").addEventListener("input",()=>{
    const q=$("graph-search").value.trim().toLowerCase();
    if(q&&kg.data){const match=kg.data.nodes.find(n=>(n.label+" "+(n.artist||"")).toLowerCase().includes(q));if(match){if(match.group)kg.expanded.add(match.group);kg.selected=match.id;}}
    renderKnowledgeGraph();renderGraphInspector();
  });
  $("graph-zoom-in").addEventListener("click",()=>graphZoom(kg.zoom*1.25));
  $("graph-zoom-out").addEventListener("click",()=>graphZoom(kg.zoom/1.25));
  $("graph-reset").addEventListener("click",()=>{kg.zoom=1;kg.pan={x:0,y:0};kg.positions.clear();renderKnowledgeGraph();});
  $("graph-export").addEventListener("click",()=>{const svg=$("knowledge-graph").querySelector("svg");if(svg)download("resonance-song-graph.svg",new XMLSerializer().serializeToString(svg),"image/svg+xml");});
}
async function loadGraphExamples(){
  $("graph-notice").textContent="Measuring the original example recordings and their connections…";
  try{if(!atlas.examples.length)atlas.examples=(await api("/api/example-tracks")).tracks;kg.demo=true;kg.data=null;refreshGraphCollection();}catch(e){toast(e.message,true);}
}
function refreshGraphCollection(){
  const tracks=graphCollection();
  $("graph-example").classList.toggle("selected",kg.demo);$("graph-real-mode").classList.toggle("selected",!kg.demo);
  $("graph-song").innerHTML=tracks.map(t=>`<option value="${esc(t.id)}">${esc(t.title)} · ${esc(t.artist)}</option>`).join("")||'<option value="">Add a recording or load examples</option>';
  kg.focus=tracks.find(t=>t.id===kg.focus)?.id||tracks[0]?.id||null;$("graph-song").value=kg.focus||"";
  if(kg.focus)loadSongGraph();
  else{kg.request++;kg.data=null;$("knowledge-graph").innerHTML='<div class="graph-placeholder">⠿<p>A recording is the beginning of a constellation.</p><button class="outline" id="graph-empty-example">Explore an example graph ↗</button></div>';$("graph-empty-example").addEventListener("click",loadGraphExamples);$("graph-counts").textContent="No song selected";$("graph-export").disabled=true;$("graph-inspector").innerHTML='<h2>Select a recording</h2><p class="muted">A single song already has an artist, five feature groups and 90 measured feature / trajectory nodes. Add recordings to reveal acoustic neighbours.</p>';$("graph-paths").replaceChildren();}
}
function openSongGraph(id,demo=false){kg.demo=demo;kg.focus=id;kg.data=null;view("graph");}
async function loadSongGraph(){
  if(!kg.focus)return;const request=++kg.request;kg.busy=true;$("graph-export").disabled=true;
  $("graph-notice").textContent="Building measured connections for this song…";
  try{
    const data=await api("/api/song-graph",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({song_id:kg.focus,demo:kg.demo,weights:atlasWeights()})});
    if(request!==kg.request)return;
    kg.data=data;kg.selected=data.root;kg.positions.clear();kg.zoom=1;kg.pan={x:0,y:0};
    $("graph-notice").textContent=kg.demo?"Original example recordings · Artist names are metadata, and acoustic connections come from measured signals. These are not recordings by the discovery bands.":`Measured local audio · ${data.collection_size} recording(s) · Click a feature group to expand it, or select a neighbour to inspect its evidence.`;
    renderKnowledgeGraph();renderGraphInspector();renderGraphPaths();$("graph-export").disabled=false;
  }catch(e){if(request===kg.request)toast(e.message,true);}finally{if(request===kg.request)kg.busy=false;}
}
function graphVisibleData(data,expanded,minSimilarity,showArtists){
  const visible=data.nodes.filter(n=>n.central||n.kind==="group"||((n.kind==="feature"||n.kind==="trajectory")&&expanded.has(n.group))||(n.kind==="song"&&n.similarity>=minSimilarity)||(n.kind==="artist"&&showArtists));
  const initial=new Set(visible.map(n=>n.id));
  const relevantArtists=new Set(data.edges.filter(e=>e.relation==="performed_by"&&initial.has(e.source)).map(e=>e.target));
  const nodes=visible.filter(n=>n.kind!=="artist"||relevantArtists.has(n.id));
  const ids=new Set(nodes.map(n=>n.id));
  return {nodes,edges:data.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))};
}
function graphNodePositions(nodes){
  const groupPositions={timbre:[350,145],harmony:[310,275],rhythm:[330,410],dynamics:[425,520],structure:[610,530]};
  const clusterPositions={timbre:[155,130,105],harmony:[105,300,70],rhythm:[155,500,100],dynamics:[360,610,43],structure:[730,600,50]};
  const songs=nodes.filter(n=>n.kind==="song"&&!n.central),artists=nodes.filter(n=>n.kind==="artist");
  for(const n of nodes){
    if(kg.positions.has(n.id))continue;
    let x,y;
    if(n.central){x=560;y=310;}
    else if(n.kind==="group"){[x,y]=groupPositions[n.group];}
    else if(n.kind==="song"){const i=songs.indexOf(n);y=105+(songs.length===1?205:i/(songs.length-1)*415);x=810+Math.sin((i+1)/(songs.length+1)*Math.PI)*60;}
    else if(n.kind==="artist"){const rootArtist=kg.data.nodes.find(v=>v.central)?.artist;const others=artists.filter(v=>v.label!==rootArtist);if(n.label===rootArtist){x=560;y=55;}else{x=1035;y=90+(others.length===1?215:others.indexOf(n)/(others.length-1)*450);}}
    else{const children=kg.data.nodes.filter(v=>(v.kind==="feature"||v.kind==="trajectory")&&v.group===n.group);const i=children.findIndex(v=>v.id===n.id),a=i/children.length*Math.PI*2;const [cx,cy,r]=clusterPositions[n.group];x=cx+Math.cos(a)*r;y=cy+Math.sin(a)*r;}
    kg.positions.set(n.id,{x,y});
  }
}
function graphColour(n){return n.central?"#cfed9b":n.kind==="song"?"#b6a5d8":n.kind==="artist"?"#dba8b4":atlasColours[n.group]||"#89b8c9";}
function graphEdgePath(e){const a=kg.positions.get(e.source),b=kg.positions.get(e.target);return `M ${a.x} ${a.y} Q ${(a.x+b.x)/2} ${(a.y+b.y)/2-(e.relation==="closest_group"?30:0)} ${b.x} ${b.y}`;}
function renderKnowledgeGraph(){
  if(!kg.data)return;
  const visible=graphVisibleData(kg.data,kg.expanded,Number($("graph-min").value),$("graph-artists").checked);graphNodePositions(visible.nodes);
  const q=$("graph-search").value.trim().toLowerCase(),selected=kg.selected;
  const connected=new Set([selected]);visible.edges.filter(e=>e.source===selected||e.target===selected).forEach(e=>{connected.add(e.source);connected.add(e.target);});
  const lines=visible.edges.map((e,i)=>{const active=e.source===selected||e.target===selected;const colour=e.relation==="performed_by"?"#dba8b4":e.relation==="closest_group"?"#89b8c9":"#91a978";const width=e.relation==="acoustic_neighbour"?1+e.similarity/50:1;return `<g class="graph-edge" data-edge="${i}" tabindex="0" role="button" aria-label="${esc(e.label)} connection"><title>${esc(e.label)}${e.similarity!==undefined?" · resemblance "+e.similarity.toFixed(1)+" / 100":""}</title><path d="${graphEdgePath(e)}" fill="none" stroke="${colour}" stroke-width="${active?width+1:width}" stroke-opacity="${active?.7:.2}" stroke-dasharray="${e.relation==="closest_group"?"4 7":"0"}"/><path d="${graphEdgePath(e)}" fill="none" stroke="transparent" stroke-width="10"/>${e.relation==="acoustic_neighbour"?`<text x="${(kg.positions.get(e.source).x+kg.positions.get(e.target).x)/2}" y="${(kg.positions.get(e.source).y+kg.positions.get(e.target).y)/2-8}" fill="#b8caa7" font-size="10" text-anchor="middle">${e.similarity.toFixed(1)}</text>`:""}</g>`;}).join("");
  const circles=visible.nodes.map(n=>{const p=kg.positions.get(n.id),colour=graphColour(n),leaf=n.kind==="feature"||n.kind==="trajectory",r=n.central?38:n.kind==="song"?23:n.kind==="group"?20:n.kind==="artist"?18:5;const hit=!q||(n.label+" "+(n.artist||"")).toLowerCase().includes(q),opacity=q&&!hit?.22:connected.has(n.id)||selected===kg.data.root?1:.48;const label=n.label.length>(leaf?23:26)?n.label.slice(0,leaf?21:24)+"…":n.label;const showLabel=!leaf||selected===n.id||!!q||kg.zoom>1.4;return `<g class="graph-node" data-node="${esc(n.id)}" transform="translate(${p.x} ${p.y})" opacity="${opacity}" tabindex="0" role="button" aria-label="${esc(n.kind+": "+n.label)}"><title>${esc(n.label)}${n.value!==undefined?" · "+formatValue(n.value)+" "+esc(n.unit):""}</title>${n.id===selected?`<circle r="${r+9}" fill="${colour}" fill-opacity=".07" stroke="${colour}" stroke-opacity=".55"/>`:""}<circle class="node-outline" r="${r}" fill="${leaf?colour:"#1d261a"}" stroke="${colour}" stroke-width="${n.central?2:1.2}"/>${!leaf?`<text text-anchor="middle" y="4" fill="${colour}" font-size="${n.central?23:16}">${n.central?"◒":n.kind==="group"?(kg.expanded.has(n.group)?"−":"+"):n.kind==="artist"?"◇":"♪"}</text>`:""}${showLabel?`<text x="0" y="${r+20}" text-anchor="middle" fill="${colour}" font-size="${leaf?11:13}">${esc(label)}</text>`:""}${n.kind==="group"?`<text y="${r+35}" text-anchor="middle" fill="#889c78" font-size="9">${n.count} values</text>`:""}${n.central?`<text y="${r+38}" text-anchor="middle" fill="#8fa17f" font-size="10">${esc(n.artist)}</text>`:""}</g>`;}).join("");
  $("knowledge-graph").innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 680" font-family="Arial,sans-serif" aria-label="Interactive song knowledge graph" role="group"><defs><pattern id="graph-grid" width="30" height="30" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#425338" fill-opacity=".5"/></pattern></defs><rect width="1120" height="680" fill="#161c14"/><rect width="1120" height="680" fill="url(#graph-grid)"/><g id="graph-transform" transform="translate(${kg.pan.x} ${kg.pan.y}) scale(${kg.zoom})">${lines}${circles}</g></svg>`;
  $("graph-counts").textContent=`${visible.nodes.length} visible nodes · ${visible.edges.length} connections${q?" · "+visible.nodes.filter(n=>(n.label+" "+(n.artist||"")).toLowerCase().includes(q)).length+" search hits":""}`;
  $("knowledge-graph").querySelectorAll("[data-node]").forEach(el=>el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();selectGraphNode(el.dataset.node);}}));
  $("knowledge-graph").querySelectorAll("[data-edge]").forEach(el=>{const select=()=>inspectGraphEdge(visible.edges[Number(el.dataset.edge)]);el.addEventListener("click",select);el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();select();}});});
  bindGraphGestures();
}
function selectGraphNode(id){const n=kg.data.nodes.find(n=>n.id===id);if(!n)return;kg.selected=id;if(n.kind==="group"){if(kg.expanded.has(n.group))kg.expanded.delete(n.group);else kg.expanded.add(n.group);$("graph-all-features").checked=Object.keys(defaults).every(k=>kg.expanded.has(k));}renderKnowledgeGraph();renderGraphInspector();}
function graphZoom(next,point={x:560,y:340}){const bounded=Math.max(.5,Math.min(3.5,next));kg.pan={x:point.x-(point.x-kg.pan.x)*bounded/kg.zoom,y:point.y-(point.y-kg.pan.y)*bounded/kg.zoom};kg.zoom=bounded;renderKnowledgeGraph();}
function bindGraphGestures(){
  const svg=$("knowledge-graph").querySelector("svg");
  const point=e=>{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(svg.getScreenCTM().inverse());};
  svg.addEventListener("wheel",e=>{e.preventDefault();graphZoom(kg.zoom*Math.exp(-e.deltaY*.0015),point(e));},{passive:false});
  svg.addEventListener("pointerdown",e=>{if(e.button!==0||e.target.closest("[data-edge]"))return;const p=point(e),node=e.target.closest("[data-node]")?.dataset.node;kg.drag={node,start:p,position:node?{...kg.positions.get(node)}:{...kg.pan},moved:false,pointer:e.pointerId};svg.setPointerCapture(e.pointerId);e.preventDefault();});
  svg.addEventListener("pointermove",e=>{if(!kg.drag)return;const p=point(e),dx=p.x-kg.drag.start.x,dy=p.y-kg.drag.start.y;if(Math.hypot(dx,dy)>3)kg.drag.moved=true;if(!kg.drag.moved)return;
    if(kg.drag.node){const pos={x:kg.drag.position.x+dx/kg.zoom,y:kg.drag.position.y+dy/kg.zoom};kg.positions.set(kg.drag.node,pos);svg.querySelectorAll("[data-node]").forEach(el=>{if(el.dataset.node===kg.drag.node)el.setAttribute("transform",`translate(${pos.x} ${pos.y})`);});const visible=graphVisibleData(kg.data,kg.expanded,Number($("graph-min").value),$("graph-artists").checked);svg.querySelectorAll("[data-edge]").forEach(el=>{const edge=visible.edges[Number(el.dataset.edge)];el.querySelectorAll("path").forEach(path=>path.setAttribute("d",graphEdgePath(edge)));const label=el.querySelector("text");if(label){const a=kg.positions.get(edge.source),b=kg.positions.get(edge.target);label.setAttribute("x",(a.x+b.x)/2);label.setAttribute("y",(a.y+b.y)/2-8);}});}else{kg.pan={x:kg.drag.position.x+dx,y:kg.drag.position.y+dy};svg.querySelector("#graph-transform").setAttribute("transform",`translate(${kg.pan.x} ${kg.pan.y}) scale(${kg.zoom})`);}
  });
  const end=e=>{if(!kg.drag)return;const drag=kg.drag;kg.drag=null;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);if(!drag.moved&&drag.node)selectGraphNode(drag.node);};svg.addEventListener("pointerup",end);svg.addEventListener("pointercancel",()=>{kg.drag=null;});
}
function graphEvidence(evidence){return evidence.map(e=>`<div class="evidence-row"><div class="evidence-label"><span>${esc(e.label)}</span><span>${e.similarity.toFixed(1)} / 100</span></div><small class="graph-match-note">Distance ${e.distance.toFixed(3)} · contribution ${e.weighted_distance.toFixed(3)} · ${(e.weight*100).toFixed(0)}% emphasis</small></div>`).join("");}
function graphSummary(n){return `<dl><dt>Duration</dt><dd>${n.duration.toFixed(1)} s</dd><dt>Estimated tempo</dt><dd>${n.summary.tempo} BPM</dd><dt>Loudness range</dt><dd>${n.summary.dynamic_range_db} dB</dd><dt>Harmonic energy share</dt><dd>${(n.summary.harmonic_ratio*100).toFixed(1)}%</dd><dt>Onset density</dt><dd>${n.summary.onsets_per_second} / s</dd></dl>`;}
function renderGraphInspector(){
  if(!kg.data)return;const n=kg.data.nodes.find(n=>n.id===kg.selected);if(!n)return;
  let html=`<h2>${esc(n.label)}</h2><span class="pill">${esc(n.kind)}</span>`;
  if(n.kind==="song"){html+=`<p>${esc(n.artist)}</p>${graphSummary(n)}${n.evidence?`<p>Pairwise resemblance to the centre: <strong>${n.similarity.toFixed(1)} / 100</strong>. ${n.similarity<30?"This is a weak acoustic neighbour in the available collection.":"Inspect the group contributions below."}</p>${graphEvidence(n.evidence)}`:""}<p class="fine-print">${esc(n.provenance)}</p><div class="graph-inspector-actions">${!n.central?'<button class="primary small" id="graph-recentre">Centre this song ↗</button><button class="outline" id="graph-compare">Compare with centre ↗</button>':'<button class="outline" id="graph-inspect-audio">Open feature atlas ↗</button>'}</div>`;}
  else if(n.kind==="group"){const descriptors=kg.data.nodes.filter(v=>v.group===n.group&&(v.kind==="feature"||v.kind==="trajectory"));html+=`<p>${esc(n.description)}</p><dl><dt>Measured values</dt><dd>${n.count}</dd><dt>Ranking emphasis</dt><dd>${(n.weight*100).toFixed(0)}%</dd></dl><div class="graph-node-list">${descriptors.map(d=>`<button data-inspect="${esc(d.id)}">${esc(d.label)}</button>`).join("")}</div>`;}
  else if(n.kind==="feature"){html+=`<dl><dt>Measured value</dt><dd>${formatValue(n.value)}</dd><dt>Unit</dt><dd>${esc(n.unit)}</dd><dt>Standardized value</dt><dd>${formatValue(n.z)}</dd></dl><p>${esc(n.meaning)}</p><p class="fine-print">The standardized value uses the current collection. A feature value alone does not establish why you like a song.</p>`;}
  else if(n.kind==="trajectory"){const points=n.values.map((v,i)=>`${i/63*420},${90-v/Math.max(...n.values,.001)*75}`).join(" ");html+=`<p>${esc(n.provenance)}</p><svg class="graph-sparkline" viewBox="0 0 420 100" role="img" aria-label="${esc(n.label)} across normalized song time"><polyline points="${points}" fill="none" stroke="#89b8c9" stroke-width="2"/></svg><p>Compared using constrained time alignment together with the other two trajectories.</p>`;}
  else if(n.kind==="artist"){html+=`<p>${esc(n.provenance)}</p><div class="graph-node-list">${n.recordings.map(t=>`<button data-root="${esc(t.id)}">${esc(t.title)} ↗</button>`).join("")}</div><p class="fine-print">Connections describe analysed recordings, not the artist's entire discography.</p>`;}
  $("graph-inspector").innerHTML=html;
  if($("graph-recentre"))$("graph-recentre").addEventListener("click",()=>{kg.focus=n.track_id;$("graph-song").value=kg.focus;loadSongGraph();});
  if($("graph-compare"))$("graph-compare").addEventListener("click",()=>compareGraphSong(n.track_id));
  if($("graph-inspect-audio"))$("graph-inspect-audio").addEventListener("click",()=>{atlas.demo=kg.demo;atlas.pair=null;view("atlas");refreshAtlasCollection(n.track_id);if(graphCollection().length>1)compareAtlas();});
  $("graph-inspector").querySelectorAll("[data-inspect]").forEach(b=>b.addEventListener("click",()=>{kg.expanded.add(n.group);kg.selected=b.dataset.inspect;renderKnowledgeGraph();renderGraphInspector();}));
  $("graph-inspector").querySelectorAll("[data-root]").forEach(b=>b.addEventListener("click",()=>{kg.focus=b.dataset.root;$("graph-song").value=kg.focus;loadSongGraph();}));
}
function inspectGraphEdge(e){
  const source=kg.data.nodes.find(n=>n.id===e.source),target=kg.data.nodes.find(n=>n.id===e.target);
  $("graph-inspector").innerHTML=`<h2>${esc(e.label)}</h2><p>${esc(source.label)} → ${esc(target.label)}</p>${e.similarity!==undefined?`<dl><dt>Acoustic resemblance</dt><dd>${e.similarity.toFixed(1)} / 100</dd></dl>`:""}<p>${esc(e.provenance)}</p>${e.evidence?graphEvidence(Array.isArray(e.evidence)?e.evidence:[e.evidence]):""}<div class="graph-node-list"><button id="edge-source">Inspect ${esc(source.label)}</button><button id="edge-target">Inspect ${esc(target.label)}</button></div>`;
  $("edge-source").addEventListener("click",()=>selectGraphNode(source.id));$("edge-target").addEventListener("click",()=>selectGraphNode(target.id));
}
function compareGraphSong(id){atlas.demo=kg.demo;atlas.pair=null;view("atlas");$("atlas-reference").value=kg.focus;$("atlas-candidate").value=id;updateAtlasPlayers();compareAtlas();}
function renderGraphPaths(){
  const songs=kg.data.nodes.filter(n=>n.kind==="song"&&!n.central&&n.similarity>=Number($("graph-min").value)).slice(0,3);
  $("graph-paths").innerHTML=songs.map(n=>{const groups=n.evidence.filter(e=>e.weight>0).sort((a,b)=>a.distance-b.distance).slice(0,2);return `<button class="graph-path" data-path="${esc(n.id)}"><span>${esc(kg.data.nodes.find(v=>v.central).label)} → ${groups.map(e=>esc(e.label.toLowerCase())).join(" + ")} → ${esc(n.label)}</span><small>${esc(n.artist)} · ${n.similarity.toFixed(1)} / 100 overall resemblance${n.similarity<30?" · weak match":""}. Select to inspect the measured evidence.</small></button>`;}).join("")||(kg.data.neighbours_shown?'<p class="muted">No neighbours meet this resemblance filter. Lower the threshold to explore the available recordings.</p>':'<p class="muted">Add another recording to discover measured paths from this song.</p>');
  $("graph-paths").querySelectorAll("[data-path]").forEach(b=>b.addEventListener("click",()=>{kg.selected=b.dataset.path;renderKnowledgeGraph();renderGraphInspector();}));
}
