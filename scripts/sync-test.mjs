// Multi-client regression test for the server-authoritative sync layer (Phase 0).
// Start the API server (PORT=3001 npm run start:server) then run:
//   node scripts/sync-test.mjs
// Exercises sequencing, sender echo, authoritative turn passing, disconnect-skip,
// gap-recovery replay, reconnect resync, and clean-leave board cleanup.
import pkg from '../node_modules/socket.io-client/dist/socket.io.js';
const { io } = pkg;

const URL = process.env.SYNC_TEST_URL || 'http://localhost:3001';
const ROOM = 'S' + Math.floor(Math.random() * 90000 + 10000);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// A test client: tracks the sequenced action stream and latest meta like the real app.
function mkClient(name) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { s, name, userId: `uid-${name}`, id: null, actions: [], meta: null, lastSeq: 0, gaps: 0 };
  s.on('game_action', (m) => {
    c.actions.push(m);
    if (typeof m.seq === 'number') {
      if (m.seq > c.lastSeq + 1) c.gaps++;
      c.lastSeq = Math.max(c.lastSeq, m.seq);
    }
  });
  s.on('game_meta', (m) => { c.meta = m; });
  s.on('sync_replay', ({ actions }) => { for (const a of actions) { c.actions.push(a); c.lastSeq = Math.max(c.lastSeq, a.seq); } });
  s.on('join_success', (d) => { c.id = s.id; });
  return c;
}
const join = (c) => new Promise((res) => {
  c.s.emit('join_room', { room: ROOM, name: c.name, color: '#22c55e', userId: c.userId });
  c.s.once('join_success', (d) => { c.id = c.s.id; res(d); });
});
const lastOf = (c, action) => [...c.actions].reverse().find(a => a.action === action);

setTimeout(() => { console.log('\n!! TIMEOUT — hung. pass=' + pass + ' fail=' + fail); process.exit(3); }, 15000);
async function main() {
  const A = mkClient('A'), B = mkClient('B'), C = mkClient('C');
  // Host auto-approves mid-game join requests (real UI shows a prompt).
  A.s.on('host_approval_request', ({ applicantId }) => A.s.emit('resolve_join_request', { room: ROOM, applicantId, approved: true }));
  await join(A); await wait(80);
  await join(B); await wait(80);
  await join(C); await wait(150);

  console.log('\n[1] START_GAME seeds authoritative meta + seq=1 to all');
  A.s.emit('game_action', { room: ROOM, action: 'START_GAME', data: { playerOrder: [A.id, B.id, C.id], firstPlayerId: A.id, mulligansAllowed: true } });
  await wait(200);
  ok(A.lastSeq === 1 && B.lastSeq === 1 && C.lastSeq === 1, `all clients at seq 1 (A=${A.lastSeq} B=${B.lastSeq} C=${C.lastSeq})`);
  ok(A.meta?.currentTurnPlayerId === A.id, `meta turn = A (${A.meta?.currentTurnPlayerId === A.id})`);
  ok(B.meta?.turnNumber === 1, 'turnNumber = 1');
  ok(JSON.stringify(B.meta?.turnOrder) === JSON.stringify(['uid-A','uid-B','uid-C']), 'turnOrder = [A,B,C] by userId');

  console.log('\n[2] Peer action is sequenced + echoed to sender too');
  A.s.emit('game_action', { room: ROOM, action: 'ADD_OBJECT', data: { id: 'card1', controllerId: A.id } });
  await wait(150);
  ok(A.lastSeq === 2 && B.lastSeq === 2 && C.lastSeq === 2, `all at seq 2 (A=${A.lastSeq} B=${B.lastSeq} C=${C.lastSeq})`);
  const addA = lastOf(A, 'ADD_OBJECT');
  ok(addA && addA.seq === 2 && addA.playerId === A.id, 'sender A received its own echo with playerId=A');

  console.log('\n[3] PASS_TURN is server-authoritative (A -> B)');
  A.s.emit('game_action', { room: ROOM, action: 'PASS_TURN', data: { prevDuration: '0:30' } });
  await wait(150);
  const pt = lastOf(C, 'PASS_TURN');
  ok(pt && pt.playerId === null, 'PASS_TURN is a server action (playerId=null)');
  ok(pt && pt.data.nextPlayerSocketId === B.id, `next player = B (${pt?.data.nextPlayerSocketId === B.id})`);
  ok(pt && pt.data.turnNumber === 2, `turnNumber = 2 (${pt?.data.turnNumber})`);
  ok(C.meta?.currentTurnPlayerId === B.id, 'meta pointer moved to B for all');

  console.log('\n[4] Non-current player cannot pass the turn');
  const seqBefore = A.lastSeq;
  C.s.emit('game_action', { room: ROOM, action: 'PASS_TURN', data: {} }); // C is not current (B is)
  await wait(150);
  ok(A.lastSeq === seqBefore, `illegal PASS_TURN from C ignored (seq stayed ${seqBefore})`);

  console.log('\n[5] Disconnect-skip: B (current) passes, but C is disconnected -> lands on A');
  C.s.close(); // C leaves the socket (temporary disconnect)
  await wait(200);
  B.s.emit('game_action', { room: ROOM, action: 'PASS_TURN', data: {} });
  await wait(200);
  const pt2 = lastOf(B, 'PASS_TURN');
  ok(pt2 && pt2.data.nextPlayerSocketId === A.id, `turn skipped disconnected C, landed on A (${pt2?.data.nextPlayerSocketId === A.id})`);

  console.log('\n[6] Gap recovery: request_sync replays missed actions');
  const D = mkClient('D-observer');
  await new Promise(res => { D.s.emit('join_room', { room: ROOM, name: 'D', color: '#3b82f6', userId: 'uid-D' }); D.s.once('join_success', res); });
  await wait(150);
  // D asks for everything since seq 0 -> should replay the full ordered history.
  D.actions = []; D.lastSeq = 0;
  D.s.emit('request_sync', { room: ROOM, sinceSeq: 0 });
  await wait(200);
  const replayed = D.actions.filter(a => typeof a.seq === 'number').map(a => a.seq);
  const contiguous = replayed.every((v, i) => i === 0 || v === replayed[i-1] + 1);
  ok(replayed.length >= 3 && replayed[0] === 1 && contiguous, `D replayed contiguous history from seq 1 (${replayed.join(',')})`);
  const startInReplay = D.actions.find(a => a.action === 'START_GAME');
  ok(!!startInReplay, 'replay includes START_GAME (D can rebuild from scratch)');

  console.log('\n[7] Reconnect: C rejoins with same userId and pulls what it missed');
  const C2 = mkClient('C'); C2.userId = 'uid-C';
  await join(C2); await wait(150);
  const cSeqBefore = C2.lastSeq;
  C2.s.emit('request_sync', { room: ROOM, sinceSeq: 2 }); // pretend C had applied up to seq 2 before dropping
  await wait(200);
  const cReplay = C2.actions.filter(a => typeof a.seq === 'number' && a.seq > 2);
  ok(cReplay.length >= 1, `reconnected C received missed actions after seq 2 (${cReplay.map(a=>a.seq).join(',')})`);
  ok(C2.meta?.currentTurnPlayerId === A.id, 'reconnected C sees correct current turn (A)');

  console.log('\n[8] Clean leave: departing player triggers board cleanup + reflow');
  A.actions = [];
  B.s.emit('leave_room', { room: ROOM });
  await wait(200);
  const removal = lastOf(A, 'REMOVE_PLAYER_OBJECTS');
  ok(removal && removal.data.userId === 'uid-B', `REMOVE_PLAYER_OBJECTS broadcast for B (${removal?.data.userId})`);
  ok(A.meta && !A.meta.turnOrder.includes('uid-B'), 'B removed from authoritative turn order');

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  A.s.close(); B.s.close(); C2.s.close(); D.s.close();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
