/*! SPDX-License-Identifier: GPL-3.0-only */
import { pairingRoutines, pairingTranscript } from '../rtc-pairing.js';
import { SRPClientSession } from '../vendor/tssrp6a/session-client.js';
import { bigIntToArrayBuffer } from '../vendor/tssrp6a/utils.js';

const utf8 = new TextEncoder(), DOMAIN = 'http-probe-v1';
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const unhex = value => new Uint8Array(value.match(/../g).map(x => parseInt(x, 16)));
const integer = (value, size) => {
  if (typeof value !== 'string' || !value.length || value.length > size || !/^[0-9a-f]+$/.test(value)) throw new Error('Invalid pairing number');
  return BigInt('0x' + value);
};

export async function authenticateHttpProbe({ fetchPhone, code, session, signal }) {
  const post = async (route, body) => {
    const response = await fetchPhone(route, { method: 'POST', body: JSON.stringify(body), signal });
    if (!response.ok) throw await httpError(response);
    return response.json();
  };
  const routines = pairingRoutines();
  const step = await new SRPClientSession(routines).step1('TiPlay browser', code);
  const challenge = await post('/http-probe/pair/start', { s: session });
  if (!/^[0-9a-f]{32}$/.test(challenge.id)) throw new Error('Invalid challenge');
  const proof = await step.step2(integer(challenge.salt,64), integer(challenge.B,512));
  const a = proof.A.toString(16);
  const answer = await post('/http-probe/pair/finish', { s:session, id:challenge.id, A:a, M1:proof.M1.toString(16) });
  await proof.step3(integer(answer.M2,64));
  if (answer.transport !== DOMAIN || !Number.isInteger(answer.epoch) || answer.epoch <= 0 || !/^[0-9a-f]{64}$/.test(answer.binding)) throw new Error('Invalid H2 response');
  const keyBytes = await routines.hashPadded(bigIntToArrayBuffer(proof.S));
  const root = await crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const transcript = pairingTranscript(['TiPlay-RTC-SRP6a-v1',challenge.id,session,a,challenge.B,challenge.salt,DOMAIN,'',answer.epoch]);
  if (!await crypto.subtle.verify('HMAC',root,unhex(answer.binding),transcript)) throw new Error('Phone authentication failed');
  const derive = label => crypto.subtle.sign('HMAC',root,utf8.encode(label));
  return {
    auth: await crypto.subtle.importKey('raw',await derive('TiPlay-HTTP-probe-auth-v1'),{name:'HMAC',hash:'SHA-256'},false,['sign']),
    encryption: await crypto.subtle.importKey('raw',await derive('TiPlay-HTTP-probe-encryption-v1'),'AES-GCM',false,['decrypt']),
  };
}

export function decryptHttpVideo(body,key,session,onBytes=()=>{}) {
  const reader=body.getReader();let chunk=new Uint8Array(0),offset=0,closed=false,pending=null;
  const additionalData=utf8.encode(session);
  const validLength=length=>length>=28&&length<=8*1024*1024+4096;
  // Settle errors as values so a prefetched authentication failure never creates
  // an unhandled rejection while downstream is busy with the preceding record.
  const decrypt=sealed=>crypto.subtle.decrypt({name:'AES-GCM',iv:sealed.subarray(0,12),additionalData},key,sealed.subarray(12))
    .then(plain=>({plain}),error=>({error}));
  function prefetchAvailable(){
    // Only overlap work already in the same fetched chunk. Never pull the network
    // ahead of downstream demand, and retain at most one extra sealed record.
    if(chunk.length-offset<4)return;
    const length=new DataView(chunk.buffer,chunk.byteOffset+offset,4).getUint32(0);
    if(!validLength(length)||chunk.length-offset<4+length)return;
    const start=offset+4;offset=start+length;
    pending=decrypt(chunk.subarray(start,offset));
  }
  async function exact(length,allowEnd=false){
    // Fetch chunks commonly contain a complete record. Borrow that immutable view
    // until decrypt resolves instead of copying every encrypted video payload.
    while(offset===chunk.length){
      const next=await reader.read();
      if(next.done){if(allowEnd)return null;throw new Error('Truncated encrypted HTTP record');}
      chunk=next.value;offset=0;onBytes(chunk.byteLength);
    }
    if(chunk.length-offset>=length){
      const view=chunk.subarray(offset,offset+length);offset+=length;return view;
    }
    const output=new Uint8Array(length);let used=0;
    while(used<length){
      if(offset===chunk.length){
        const next=await reader.read();
        if(next.done){if(allowEnd&&used===0)return null;throw new Error('Truncated encrypted HTTP record');}
        chunk=next.value;offset=0;onBytes(chunk.byteLength);
      }
      const size=Math.min(length-used,chunk.length-offset);output.set(chunk.subarray(offset,offset+size),used);offset+=size;used+=size;
    }
    return output;
  }
  return new ReadableStream({
    async pull(controller){
      try{
        let current=pending;pending=null;
        if(!current){
          const header=await exact(4,true);if(header===null){closed=true;controller.close();return;}
          const length=new DataView(header.buffer,header.byteOffset,header.byteLength).getUint32(0);
          if(!validLength(length))throw new Error('Invalid encrypted HTTP record length');
          current=decrypt(await exact(length));
        }
        if(closed)return;
        prefetchAvailable();
        const {plain,error}=await current;if(error)throw error;
        if(!closed)controller.enqueue(new Uint8Array(plain));
      }catch(error){pending=null;if(!closed){closed=true;controller.error(error);}await reader.cancel().catch(()=>{});}
    },
    async cancel(){closed=true;pending=null;await reader.cancel().catch(()=>{});},
  },{highWaterMark:0});
}

async function httpError(response) {
  const body = await response.json().catch(() => ({}));
  return Object.assign(new Error(body.error === 'bluetooth-required'
    ? '请先在 CarPlay 开启“由 iPhone 蓝牙播放音频”，再连接。'
    : `HTTP ${response.status}: ${body.error || '连接失败'}`), {
    status: body.error === 'bluetooth-required' ? undefined : response.status,
    reason: body.error || 'http-failed',
  });
}

/** Shared encrypted HTTP transport. It never constructs a peer, media element or audio context. */
export function createHttpVideoTransport({fetchPhone,code,session,signal}) {
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once:true});
  let keys=null,video=null,bytes=0,connected=false,requests=0,totalRequests=0,rekeys=0,queue=Promise.resolve(),sample=null;
  const serial = task => {
    const next=queue.then(task); queue=next.catch(()=>{}); return next;
  };
  // A stalled control request must not indefinitely block touch-up and reconnect.
  async function jsonOperation(task, detached=false) {
    const pending = new AbortController(), cancel=()=>pending.abort();
    if(!detached) { if(lifetime.signal.aborted) cancel(); else lifetime.signal.addEventListener('abort',cancel,{once:true}); }
    const timer=setTimeout(cancel,10000);
    try { return await task(pending.signal); }
    finally {clearTimeout(timer);lifetime.signal.removeEventListener('abort',cancel);}
  }
  const pair = requestSignal => authenticateHttpProbe({fetchPhone,code,session,signal:requestSignal});
  async function request(path,{method='POST',body='',requestSignal=lifetime.signal}={}){
    // The phone bounds replay memory to 4096 nonces. Rotate authenticated request keys
    // before that limit without replacing the session or the existing video decryptor.
    // All control/bye operations are serialized, so an old-key request cannot overtake rotation.
    if(requests>=3000){keys=await pair(requestSignal);requests=0;rekeys++;}
    const nonce=hex(crypto.getRandomValues(new Uint8Array(16)));
    const digest=hex(await crypto.subtle.digest('SHA-256',utf8.encode(body)));
    const signature=hex(await crypto.subtle.sign('HMAC',keys.auth,utf8.encode([method,path,session,nonce,digest].join('\n'))));
    requests++;totalRequests++;
    const response=await fetchPhone(path+'?s='+encodeURIComponent(session),{method,body:method==='GET'?undefined:body,signal:requestSignal,keepalive:path==='/http-probe/bye',headers:{Authorization:`H2 ${nonce}:${signature}`}});
    if(!response.ok)throw await httpError(response);
    return response;
  }
  return {
    async connect(){
      keys=await jsonOperation(pair);
      const started=performance.timeOrigin+performance.now();
      const hello=await jsonOperation(async requestSignal=>(await request('/http-probe/control',{
        body:JSON.stringify({q:0,s:session,e:[]}),requestSignal})).json());
      sample={serverMs:hello.clockMs,started,ended:performance.timeOrigin+performance.now()};
      const response=await request('/http-probe/video',{method:'GET'});
      video=decryptHttpVideo(response.body,keys.encryption,session,n=>{bytes+=n;});
      connected=true;
      return this;
    },
    get video(){return video;},
    isConnected:()=>connected&&!lifetime.signal.aborted,
    control(q,events){return serial(()=>jsonOperation(async requestSignal=>(await request('/http-probe/control',{
      body:JSON.stringify({q,s:session,e:events}),requestSignal})).json()));},
    bye(){const leaving=connected;return serial(async()=>{
      try{if(leaving)await jsonOperation(requestSignal=>request('/http-probe/bye',{body:'{}',requestSignal}),true);}
      finally{connected=false;}
    });},
    // The complete player uses the same transport contract; HTTP mode has no audio or resource token.
    hello:()=>({audio:false}), clockSample:()=>sample, resourceToken:()=>null,
    openAudio:()=>Promise.reject(new Error('HTTP video mode requires iPhone Bluetooth audio')),
    close(){connected=false;lifetime.abort();signal?.removeEventListener('abort',abort);},
    stats:()=>({transport:DOMAIN,bytesReceived:bytes,state:connected?'connected':'closed',generation:0,
      stage:connected?'http-video-connected':'http-video-connecting',controlRequests:totalRequests,rekeys}),
  };
}
