#!/usr/bin/env node
// Out-of-band witness captured from a real preceding deployment, not a provider
// oracle. Exercise retained history after the operator's actual corpus refresh.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resource,page,changeEvent} from './contract.mjs';
import {transport,parseJson} from './transport.mjs';
const [scope,file]=process.argv.slice(2);if(!scope||!file)throw Error('Usage: history-witness.mjs SCOPE WITNESS.json');
const witness=JSON.parse(fs.readFileSync(file,'utf8')),io=transport(scope);
const report={scope,witness:file,checks:[],exchanges:io.receipts};
async function read(path,options){const r=await io.request(path,options);assert.equal(r.status,200,`${path}: ${r.status}`);return parseJson(r.text);}
try{
 const current=await read(witness.subject);resource(current,{revisionModel:'versioned'});
 assert.notEqual(current.id.rev,witness.previous.id.rev);
 for(const [key,value] of Object.entries(witness.expectedBody))assert.deepEqual(current.body[key],value);
 const old=await read(witness.subject+'?revision='+encodeURIComponent(witness.previous.id.rev));
 assert.deepEqual(old,witness.previous);report.checks.push('pinned previous representation survives refresh');
 const one=await read(witness.subject+':revisions?limit=1');page(one);assert.equal(one.items.length,1);assert.ok(one.cursor);
 const two=await read(witness.subject+':revisions?limit=1&after='+encodeURIComponent(one.cursor));page(two);
 assert.notEqual(one.items[0].id.rev,two.items[0].id.rev);assert.equal(two.head,true);
 assert.deepEqual([one.items[0],two.items[0]],[old,current]);report.checks.push('revision pagination advances by revision');
 const revisions=await io.request(witness.subject+':revisions?format=jsonl',{headers:{Accept:'application/jsonl'}});
 assert.equal(revisions.status,200);assert.deepEqual(revisions.text.trim().split('\n').map(parseJson),[old,current]);report.checks.push('JSONL history agrees with JSON');
 const filter=encodeURIComponent(JSON.stringify([{kind:'compare',field:['id','id'],op:'eq',value:witness.subject}]));
 const exported=await io.request('bdp/export?revisions=true&format=jsonl&filter='+filter,{headers:{Accept:'application/jsonl'}});assert.equal(exported.status,200);
 const records=exported.text.trim().split('\n').map(parseJson);assert.equal(records[0].kind,'export-begin');assert.equal(records.at(-1).kind,'export-end');assert.equal(records.at(-1).count,2);assert.deepEqual(records.slice(1,-1),[old,current]);
 let exportAfter,exportFrames=[];
 do{const p=await read('bdp/export?revisions=true&limit=1&filter='+filter+(exportAfter?'&after='+encodeURIComponent(exportAfter):''));page(p);exportFrames.push(...p.items);exportAfter=p.cursor;if(p.head)break;}while(exportFrames.length<10);
 assert.deepEqual(exportFrames,records);report.checks.push('revision export preserves both versions across JSONL and JSON pages');
 let after=witness.cursor,events=[];
 do{const p=await read('sys/changes?limit=100&after='+encodeURIComponent(after));page(p);for(const e of p.items)changeEvent(e,'versioned');events.push(...p.items);after=p.cursor;if(p.head)break;assert.ok(p.items.length,'feed made no progress');}while(events.length<100000);
 assert.ok(events.length>0);assert.ok(events.every((e,i)=>!i||e.ordinal>events[i-1].ordinal));
 assert.equal(new Set(events.map(e=>e.transaction+'|'+e.subject.id)).size,events.length,'duplicate resource events within one commit');
 const changed=events.filter(e=>e.subject.id===witness.subject);assert.equal(changed.length,1);assert.equal(changed[0].kind,'updated');
 assert.deepEqual(changed[0].content,{kind:'full',representation:current});assert.equal(current.provenance.previousRevision,old.id.rev);assert.equal(current.provenance.committedAt,changed[0].at);
 const retired=events.find(e=>e.kind==='deleted');assert.ok(retired,'actual refresh must exercise a retirement');
 const gone=await io.request(retired.subject.id);assert.equal(gone.status,410,'retired unpinned identity must be Gone');report.checks.push('retired unpinned identity is Gone');
 const malformed=JSON.parse(Buffer.from(after,'base64url').toString());malformed.generation={foo:'bar'};
 const refused=await io.request('sys/changes?after='+Buffer.from(JSON.stringify(malformed)).toString('base64url'));assert.ok([400,410].includes(refused.status),'malformed cursor must be a client fault');report.checks.push('malformed cursor is refused without internal failure');
 const currentExport=await read('bdp/export?limit=1'),historyExport=await read('bdp/export?limit=1&revisions=true');
 for(const [cursor,mode] of [[currentExport.cursor,'true'],[historyExport.cursor,'false']]){assert.ok(cursor);const mismatch=await io.request('bdp/export?limit=1&revisions='+mode+'&after='+encodeURIComponent(cursor));assert.ok([400,410].includes(mismatch.status),'export cursor crossed revision mode');}report.checks.push('export cursors bind revision selection');
 const tail=await read('sys/changes?after='+encodeURIComponent(after));assert.deepEqual(tail.items,[]);assert.equal(tail.head,true);report.checks.push('feed resumes from the previous snapshot cut through actual changes');
 const bulk=await io.request('sys/changes?format=jsonl&after='+encodeURIComponent(witness.cursor),{headers:{Accept:'application/jsonl'}});assert.equal(bulk.status,200);assert.deepEqual(bulk.text.trim().split('\n').map(parseJson),events);report.checks.push('JSONL changefeed has the same ordered events');
 const live=await io.request('sys/changes?format=sse&after='+encodeURIComponent(witness.cursor),{headers:{Accept:'text/event-stream'},observeForMs:1000});assert.equal(live.status,200);
 const frames=live.text.split('\n\n').slice(0,-1).filter(s=>s.split('\n').some(l=>l.startsWith('data:'))).map(s=>parseJson(s.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')));
 assert.ok(frames.length>0,'live resume emitted no retained event');assert.deepEqual(frames,events.slice(0,frames.length));report.checks.push('SSE replays the same real changes');
 report.state='pass';report.events=events.length;
}catch(error){report.state='fail';report.error=error.message;process.exitCode=1;}
finally{io.close?.();console.log(JSON.stringify(report,null,2));}
