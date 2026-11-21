import assert from 'node:assert/strict';
import {forwardStoredEvents, RunTimeline} from './event-delivery.mjs';
const runId = 'offline-run';
const first = {id:'9007199254740993',type:'run.running',data:{}};
const second = {id:'9007199254741001',type:'run.completed',data:{text:'done'}};
const stored = [first];
const viewer = new RunTimeline(runId);
viewer.reconcileRun({id:runId,state:'running'});
let waits = 0;
const reads = [];
const controller = new AbortController();
const options = {
  runId, signal:controller.signal,
  readAfter: async (run, cursor) => {
    reads.push({run,cursor});
    return stored.filter(event => BigInt(event.id) > BigInt(cursor));
  },
  wait: async () => { waits++; stored.push(second); },
};
// Backend has committed first; transport disconnects before the viewer receives it.
const lost = forwardStoredEvents(options);
assert.equal((await lost.next()).value.event.id,first.id);
await lost.return();
assert.equal(viewer.cursor,'0');
viewer.connectionChanged('reconnecting');
assert.equal(viewer.run.state,'running');
// Same Run; replay begins at the viewer cursor, not the collector cursor.
const replay = forwardStoredEvents({...options,after:viewer.cursor});
const delivered = (await replay.next()).value;
assert.equal(viewer.apply(delivered),true);
assert.equal(viewer.apply(delivered),false);
const later = (await replay.next()).value;
assert.equal(waits,1); // Event committed after an empty read is still delivered.
assert.equal(viewer.apply(later),true);
assert.equal(viewer.rows.size,2);
assert.equal(viewer.cursor,second.id);
assert.equal(viewer.run.state,'running'); // Event projection is not the final query.
viewer.reconcileRun({id:runId,state:'completed',output:{text:'done'}});
viewer.connectionChanged('disconnected');
assert.equal(viewer.run.state,'completed');
assert.ok(reads.every(row=>row.run===runId));
assert.throws(()=>viewer.apply({run_id:'other',event:first}),/Unexpected Run/);
controller.abort();
assert.equal((await replay.next()).done,true);
console.log('Offline delivery checks passed: lost delivery, viewer replay, duplicate suppression, late commit, large IDs, same Run, separate connection state and abort. No HTTP, browser or Hexagon service used.');
