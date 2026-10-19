const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));
app.get('/health', (_req,res) => res.status(200).send('ok'));
app.get('/qr', async (req,res) => {
  const code = String(req.query.code || '');
  if (!/^\d{6}$/.test(code)) return res.status(400).send('Invalid code');
  const url = `${req.protocol}://${req.get('host')}/?code=${code}`;
  try {
    const png = await require('qrcode').toBuffer(url, {width:320, margin:2});
    res.type('png').send(png);
  } catch {res.status(500).send('QR unavailable');}
});
const rooms = new Map();
const QUESTIONS = [
  {q:'할로윈 하면 가장 먼저 떠오르는 것은?', choices:['🎃 호박','👻 귀신','🍬 사탕','🧙 코스튬'], correct:null, note:'정답 없는 투표! 우리 반의 생각을 확인해요.'},
  {q:'할로윈은 매년 언제일까요?', choices:['10월 1일','10월 25일','10월 31일','11월 1일'], correct:2, note:'10월 31일은 종교개혁을 기념하는 날이기도 해요.'},
  {q:'Halloween이라는 이름의 유래는?', choices:['귀신들의 축제','모든 성인의 날 전야','호박 축제','마녀들의 생일'], correct:1, note:'All Hallows’ Eve, 곧 모든 성인의 날 전야에서 유래했어요.'},
  {q:'1517년 10월 31일과 관련된 역사적 사건은?', choices:['콜럼버스의 항해','루터의 95개조 반박문 발표','프랑스 혁명','첫 크리스마스'], correct:1, note:'루터는 1517년 10월 31일 면벌부 관행을 비판하는 95개조 반박문을 발표했어요.'},
  {q:'마르틴 루터가 문제 삼았던 것은?', choices:['교회 건물 색깔','교회 음악의 박자','면벌부 판매와 잘못된 가르침','성직자의 헤어스타일'], correct:2, note:'하나님의 은혜를 돈으로 살 수 있다는 오해를 비판했어요.'},
  {q:'종교개혁의 핵심 가르침에 가까운 것은?', choices:['돈이 많으면 구원받는다','완벽해야 사랑받는다','하나님의 은혜를 믿음으로 받는다','인기가 많으면 의롭다'], correct:2, note:'“오직 의인은 믿음으로 말미암아 살리라”(로마서 1:17)'}
];
function code(){let x; do{x=String(Math.floor(100000+Math.random()*900000));}while(rooms.has(x));return x;}
function roster(r){return [...r.players.values()].map(p=>({name:p.name,score:p.score,id:p.id})).sort((a,b)=>b.score-a.score);}
function emitState(r){io.to(r.code).emit('room-state',{code:r.code,phase:r.phase,index:r.index,total:QUESTIONS.length,players:roster(r),answered:r.answers.size,deadline:r.deadline});}
function reveal(r){if(r.phase!=='question')return; clearTimeout(r.timer);r.phase='reveal';const q=QUESTIONS[r.index];const counts=q.choices.map((_,i)=>[...r.answers.values()].filter(a=>a.choice===i).length);io.to(r.code).emit('reveal',{correct:q.correct,counts,note:q.note,players:roster(r)});emitState(r);}
function next(r){clearTimeout(r.timer);r.index++;if(r.index>=QUESTIONS.length){r.phase='finished';io.to(r.code).emit('finished',{players:roster(r)});emitState(r);return;}r.phase='question';r.answers.clear();r.deadline=Date.now()+15000;const q=QUESTIONS[r.index];io.to(r.code).emit('question',{index:r.index,total:QUESTIONS.length,q:q.q,choices:q.choices,deadline:r.deadline,poll:q.correct===null});emitState(r);r.timer=setTimeout(()=>reveal(r),15000);}
io.on('connection',socket=>{
  socket.on('create-room',(_,cb)=>{const c=code();const r={code:c,host:socket.id,players:new Map(),phase:'lobby',index:-1,answers:new Map(),deadline:null,timer:null};rooms.set(c,r);socket.join(c);socket.data.room=c;socket.data.host=true;cb?.({ok:true,code:c});emitState(r);});
  socket.on('join-room',(data,cb)=>{const c=String(data?.code||'').trim();const name=String(data?.name||'').trim().slice(0,16);const r=rooms.get(c);if(!r)return cb?.({ok:false,error:'참여 코드를 확인해 주세요.'});if(r.phase!=='lobby')return cb?.({ok:false,error:'이미 시작된 게임입니다. 다음 게임에 참여해 주세요.'});if(!name)return cb?.({ok:false,error:'닉네임을 입력해 주세요.'});if(r.players.size>=100)return cb?.({ok:false,error:'참여 인원이 가득 찼습니다.'});if([...r.players.values()].some(p=>p.name===name))return cb?.({ok:false,error:'이미 사용 중인 닉네임입니다.'});r.players.set(socket.id,{id:socket.id,name,score:0});socket.join(c);socket.data.room=c;socket.data.host=false;cb?.({ok:true,code:c,name});emitState(r);});
  socket.on('start',(_,cb)=>{const r=rooms.get(socket.data.room);if(!r||r.host!==socket.id||r.phase!=='lobby')return cb?.({ok:false});if(r.players.size===0)return cb?.({ok:false,error:'학생이 한 명 이상 참여해야 합니다.'});next(r);cb?.({ok:true});});
  socket.on('answer',(data,cb)=>{const r=rooms.get(socket.data.room);if(!r||r.phase!=='question'||!r.players.has(socket.id)||r.answers.has(socket.id)||Date.now()>r.deadline)return cb?.({ok:false});const choice=Number(data?.choice);if(!Number.isInteger(choice)||choice<0||choice>3)return cb?.({ok:false});const q=QUESTIONS[r.index];r.answers.set(socket.id,{choice});if(q.correct===choice){const remaining=Math.max(0,r.deadline-Date.now());r.players.get(socket.id).score+=500+Math.round(500*remaining/15000);}cb?.({ok:true});emitState(r);if(r.answers.size===r.players.size)reveal(r);});
  socket.on('next',(_,cb)=>{const r=rooms.get(socket.data.room);if(!r||r.host!==socket.id||r.phase!=='reveal')return cb?.({ok:false});next(r);cb?.({ok:true});});
  socket.on('restart',(_,cb)=>{const r=rooms.get(socket.data.room);if(!r||r.host!==socket.id||r.phase!=='finished')return cb?.({ok:false});r.phase='lobby';r.index=-1;r.answers.clear();r.deadline=null;for(const p of r.players.values())p.score=0;io.to(r.code).emit('reset');emitState(r);cb?.({ok:true});});
  socket.on('disconnect',()=>{const r=rooms.get(socket.data.room);if(!r)return;if(r.host===socket.id){clearTimeout(r.timer);io.to(r.code).emit('closed');rooms.delete(r.code);return;}r.players.delete(socket.id);r.answers.delete(socket.id);if(r.phase==='question'&&r.answers.size===r.players.size)reveal(r);emitState(r);});
});
server.listen(process.env.PORT||3000,()=>console.log('Quiz ready on port '+(process.env.PORT||3000)));
