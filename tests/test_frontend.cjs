const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {webcrypto,createHash}=require('node:crypto');

function storage(){const items=new Map();return {getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,String(v)),removeItem:k=>items.delete(k)};}
function harness(){
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[],replaceChildren(){},showModal(){},append(){}});return elements.get(id);};
  const context={document:{getElementById:element},sessionStorage:storage(),localStorage:storage(),crypto:webcrypto,TextEncoder,URL,URLSearchParams,Date,Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64'),setTimeout:()=>1,clearTimeout(){},location:{search:'',hostname:'127.0.0.1'},history:{replaceState(){}},window:{location:{assign(url){context.destination=url;}}},fetch:async()=>{throw new Error('No external requests in unit test');}};
  vm.createContext(context);vm.runInContext(fs.readFileSync('static/app.js','utf8'),context);
  return {context,element};
}

test('PKCE login binds a random state, the verifier and registered redirect',async()=>{
  const {context:c,element}=harness();element('client-id').value='a'.repeat(32);
  await c.connectSpotify({preventDefault(){}});
  const pending=JSON.parse(c.sessionStorage.getItem('resonance-oauth'));
  const url=new URL(c.destination);
  assert.equal(url.origin,'https://accounts.spotify.com');
  assert.equal(url.searchParams.get('redirect_uri'),'http://127.0.0.1:8000/callback');
  assert.equal(url.searchParams.get('state'),pending.state);
  assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(pending.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.ok(pending.verifier.length>=43&&pending.verifier.length<=128);
  const firstState=pending.state;await c.connectSpotify({preventDefault(){}});
  assert.notEqual(JSON.parse(c.sessionStorage.getItem('resonance-oauth')).state,firstState);
});

test('a mismatched OAuth state cannot exchange a code',async()=>{
  const {context:c,element}=harness();
  c.sessionStorage.setItem('resonance-oauth',JSON.stringify({state:'expected',created:Date.now(),clientId:'a'.repeat(32),verifier:'v'}));
  c.location.search='?code=secret-code&state=attacker';let requests=0;c.fetch=async()=>{requests++;throw new Error('Unexpected exchange');};
  await c.restoreSpotify();
  assert.equal(requests,0);assert.equal(c.sessionStorage.getItem('resonance-oauth'),null);
  assert.match(element('toast').textContent,/could not be verified/);
});

test('a valid OAuth callback stores tokens only in the tab and uses top-track scope',async()=>{
  const {context:c}=harness();
  c.sessionStorage.setItem('resonance-oauth',JSON.stringify({state:'expected',created:Date.now(),clientId:'a'.repeat(32),verifier:'verifier'}));
  c.location.search='?code=test-code&state=expected';const requests=[];
  c.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,status:200,json:async()=>url.includes('/api/token')?{access_token:'access',refresh_token:'refresh',expires_in:3600}:{items:[]}};};
  await c.restoreSpotify();
  const stored=JSON.parse(c.sessionStorage.getItem('resonance-spotify'));
  assert.equal(stored.access_token,'access');assert.equal(stored.refresh_token,'refresh');
  assert.equal(c.localStorage.getItem('resonance-spotify'),null);
  assert.equal(requests[0].options.body.get('code_verifier'),'verifier');
  assert.equal(requests[1].options.headers.Authorization,'Bearer access');
  assert.equal(c.sessionStorage.getItem('resonance-oauth'),null);
  c.disconnectSpotify();assert.equal(c.sessionStorage.getItem('resonance-spotify'),null);
});

test('Spotify URLs are converted to valid track URIs without accepting arbitrary URLs',()=>{
  const {context:c}=harness(),id='1'.repeat(22);
  assert.equal(c.uriFromInput(`https://open.spotify.com/track/${id}?si=example`),`spotify:track:${id}`);
  assert.equal(c.uriFromInput(`https://open.spotify.com/intl-de/track/${id}`),`spotify:track:${id}`);
  assert.equal(c.uriFromInput('   '),'');
  assert.equal(c.uriFromInput('https://another-site.example/track/'+id),'https://another-site.example/track/'+id);
});
