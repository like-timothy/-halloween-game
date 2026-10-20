const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const QRCode=require('qrcode');
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.static('public'));
app.get('/health',(_q,r)=>r.send('ok'));
app.get('/qr',async(req,res)=>{const code=String(req.query.code||'');if(!/^\d{6}$/.test(code))return res.sendStatus(400);const url=`${req.protocol}://${req.get('host')}/?code=${code}`;res.type('png');res.send(await QRCode.toBuffer(url,{width:320,margin:2}));});
const cases=[
 {title:'잠긴 달력',story:'벽에 걸린 낡은 달력. 두 숫자가 적힌 쪽지만 빛납니다. 두 숫자를 조합해 특별한 날짜를 찾아보세요.',prompt:'달력에서 비밀의 날짜를 터치하세요.',objects:[['🗓️','10월 15일'],['🕯️','10월 30일'],['🎃','10월 31일'],['🍂','11월 1일']],answer:2,clue:'10월 31일',explain:'이 날은 가을 축제의 전야로 알려져 있지만, 역사 속 또 다른 중요한 사건과도 연결됩니다.'},
 {title:'수상한 축제의 방',story:'가면과 사탕, 오래된 책이 놓여 있습니다. 이 축제의 이름에 숨겨진 뜻을 찾아보세요.',prompt:'‘모든 성인의 날 전야’를 뜻하는 오래된 이름을 찾으세요.',objects:[['🍬','Sweet Night'],['📜',"All Hallows’ Eve"],['🎭','Mask Festival'],['🌙','Moon Eve']],answer:1,clue:'All Hallows’ Eve',explain:'오늘날 널리 알려진 축제 이름은 All Hallows’ Eve(모든 성인의 날 전야)라는 표현에서 유래했습니다.'},
 {title:'흩어진 단어 조각',story:'서랍에서 네 장의 낡은 카드가 나왔습니다. 축제의 풍경과 어울리는 물건이 무엇인지 찾아보세요.',prompt:'전통적인 ‘잭오랜턴’을 만드는 데 쓰는 것을 터치하세요.',objects:[['🧅','양파'],['🥔','감자'],['🍎','사과'],['🎃','호박']],answer:3,clue:'Jack-o’-lantern',explain:'잭오랜턴은 오늘날 호박을 파서 만든 등불로 유명합니다. 과거 일부 지역에서는 순무도 사용했습니다.'},
 {title:'사라진 문서의 비밀',story:'시간의 문이 열리고 1517년 유럽의 오래된 교회 앞에 도착했습니다. 마지막 문서를 찾아야 탈출할 수 있습니다.',prompt:'1517년 10월 31일과 연결된 역사적 문서를 선택하세요.',objects:[['📕','수도원 규칙집'],['📜','95개조 반박문'],['🎼','찬송가 악보'],['🗺️','항해 지도']],answer:1,clue:'종교개혁',explain:'1517년 10월 31일, 마르틴 루터는 면죄부 판매와 관련한 문제를 제기하는 95개조 반박문을 발표했습니다. 전통적으로 교회 문에 게시했다고 전해집니다.'}
];
const rooms=new Map();function newCode(){let c;do{c=String(Math.floor(100000+Math.random()*900000))}while(rooms.has(c));return c;}
function roster(r){return [...r.players.values()].map(p=>({name:p.name,score:p.score})).sort((a,b)=>b.score-a.score)}
function state(r){io.to(r.code).emit('state',{phase:r.phase,code:r.code,index:r.index,count:r.players.size,players:roster(r),answered:r.answers.size,total:cases.length})}
function sendCase(r){r.phase='playing';r.answers.clear();io.to(r.code).emit('case',{index:r.index,total:cases.length,...Object.fromEntries(Object.entries(cases[r.index]).filter(([k])=>k!=='answer'&&k!=='explain'&&k!=='clue'))});state(r)}
function ack(cb,data){if(typeof cb==='function')cb(data)}
io.on('connection',s=>{
 s.on('create',(_,cb)=>{const c=newCode(),r={code:c,host:s.id,players:new Map(),phase:'lobby',index:0,answers:new Map()};rooms.set(c,r);s.join(c);s.data.code=c;s.data.host=true;ack(cb,{ok:true,code:c});state(r)});
 s.on('join',(data,cb)=>{const c=String(data?.code||'').trim(),name=String(data?.name||'').trim().slice(0,18),r=rooms.get(c);if(!r)return ack(cb,{ok:false,error:'참여 코드를 확인해 주세요.'});if(r.phase!=='lobby')return ack(cb,{ok:false,error:'이미 시작된 게임입니다.'});if(!name)return ack(cb,{ok:false,error:'닉네임을 입력하세요.'});if(r.players.size>=120)return ack(cb,{ok:false,error:'참여 인원이 가득 찼습니다.'});if([...r.players.values()].some(p=>p.name===name))return ack(cb,{ok:false,error:'이미 사용 중인 닉네임이에요.'});r.players.set(s.id,{name,score:0});s.join(c);s.data.code=c;s.data.host=false;ack(cb,{ok:true,name});state(r)});
 s.on('start',(_,cb)=>{const r=rooms.get(s.data.code);if(!r||r.host!==s.id||r.phase!=='lobby')return ack(cb,{ok:false});if(!r.players.size)return ack(cb,{ok:false,error:'학생 입장을 기다려 주세요.'});r.index=0;sendCase(r);ack(cb,{ok:true})});
 s.on('answer',(d,cb)=>{const r=rooms.get(s.data.code);if(!r||r.phase!=='playing'||!r.players.has(s.id)||r.answers.has(s.id))return ack(cb,{ok:false});const v=Number(d?.choice);if(!Number.isInteger(v)||v<0||v>=4)return ack(cb,{ok:false});r.answers.set(s.id,v);if(v===cases[r.index].answer)r.players.get(s.id).score+=100;ack(cb,{ok:true});state(r)});
 s.on('reveal',(_,cb)=>{const r=rooms.get(s.data.code);if(!r||r.host!==s.id||r.phase!=='playing')return ack(cb,{ok:false});r.phase='reveal';const q=cases[r.index];io.to(r.code).emit('reveal',{answer:q.answer,clue:q.clue,explain:q.explain,counts:q.objects.map((_,i)=>[...r.answers.values()].filter(v=>v===i).length)});state(r);ack(cb,{ok:true})});
 s.on('next',(_,cb)=>{const r=rooms.get(s.data.code);if(!r||r.host!==s.id||r.phase!=='reveal')return ack(cb,{ok:false});r.index++;if(r.index>=cases.length){r.phase='finished';io.to(r.code).emit('finished',{players:roster(r)});state(r)}else sendCase(r);ack(cb,{ok:true})});
 s.on('disconnect',()=>{const r=rooms.get(s.data.code);if(!r)return;if(r.host===s.id){io.to(r.code).emit('closed');rooms.delete(r.code)}else{r.players.delete(s.id);r.answers.delete(s.id);state(r)}});
});
server.listen(process.env.PORT||3000,()=>console.log('Mystery game listening'));
