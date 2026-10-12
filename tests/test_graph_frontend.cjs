const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync('static/graph.js','utf8'),ctx);
const data={nodes:[{id:'root',kind:'song',central:true},{id:'near',kind:'song',similarity:80},{id:'far',kind:'song',similarity:10},{id:'artistA',kind:'artist'},{id:'artistB',kind:'artist'},{id:'group',kind:'group',group:'timbre'},{id:'descriptor',kind:'feature',group:'timbre'}],edges:[{source:'root',target:'artistA',relation:'performed_by'},{source:'far',target:'artistB',relation:'performed_by'},{source:'root',target:'near',relation:'acoustic_neighbour'},{source:'root',target:'far',relation:'acoustic_neighbour'},{source:'root',target:'group',relation:'measured_in'},{source:'group',target:'descriptor',relation:'has_measurement'}]};

test('threshold removes weak neighbours and their orphan artist nodes',()=>{
  const visible=ctx.graphVisibleData(data,new Set(),40,true);
  assert.deepEqual(Array.from(visible.nodes,n=>n.id),['root','near','artistA','group']);
  const ids=new Set(visible.nodes.map(n=>n.id));assert.ok(visible.edges.every(e=>ids.has(e.source)&&ids.has(e.target)));
});
test('expanding a feature group reveals its measured descriptors and links',()=>{
  const visible=ctx.graphVisibleData(data,new Set(['timbre']),0,true);
  assert.ok(visible.nodes.some(n=>n.id==='descriptor'));
  assert.ok(visible.edges.some(e=>e.relation==='has_measurement'));
});
test('hiding artists preserves the song and feature evidence',()=>{
  const visible=ctx.graphVisibleData(data,new Set(['timbre']),0,false);
  assert.ok(!visible.nodes.some(n=>n.kind==='artist'));
  assert.equal(visible.edges.filter(e=>e.relation==='acoustic_neighbour').length,2);
  assert.ok(visible.nodes.some(n=>n.id==='descriptor'));
});
