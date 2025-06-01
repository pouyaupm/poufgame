let playerId, roomCode;
let eventSource;
let tokens = 5;

function el(id){return document.getElementById(id);}
el("create").onclick = async () => {
  const nickname = el("nickname").value.trim();
  if(!nickname) return alert("Enter nickname");
  const resp = await fetch("/create-room",{method:"POST",body:JSON.stringify({nickname})});
  const data = await resp.json();
  if(data.error) return alert(data.error);
  playerId=data.playerId;
  roomCode=data.code;
  startGame(true);
};

el("join").onclick = async () => {
  const nickname = el("nickname").value.trim();
  roomCode = el("room").value.trim();
  if(!nickname || !roomCode) return alert("Enter nickname and room");
  const resp = await fetch("/join-room",{method:"POST",body:JSON.stringify({code:roomCode,nickname})});
  const data = await resp.json();
  if(data.error) return alert(data.error);
  playerId=data.playerId;
  startGame(false);
};


async function startGame(isHost=false){
  el('login').style.display='none';
  el('game').style.display='block';
  el('roomTitle').innerText='Room '+roomCode;
  el('roomCode').innerText='Code: '+roomCode;
  if(isHost) el('startBtn').style.display='inline';
  el('tokens').textContent='Tokens: '+tokens;
  connectEvents();
  updatePlayers();
}

function connectEvents(){
  eventSource = new EventSource('/events?code='+roomCode+'&playerId='+playerId);
  eventSource.onmessage = e => {
    console.log('msg', e.data);
  };
  eventSource.addEventListener('player-joined', e => {
    const data = JSON.parse(e.data);
    addPlayer(data.id, data.nickname);
  });
  eventSource.addEventListener('chat-message', e => addChat(JSON.parse(e.data)));
  eventSource.addEventListener('private-message', e => handlePrivate(JSON.parse(e.data)));
  eventSource.addEventListener('trade-request', e => handleTradeRequest(JSON.parse(e.data)));
  eventSource.addEventListener('trade-result', e => addChat({from:'system', text:`Trade between ${e.data.from} and ${e.data.to} ${e.data.accept?'accepted':'declined'}` }));
  eventSource.addEventListener('game-start', e => handleGameStart(JSON.parse(e.data)));
  eventSource.addEventListener('token-update', e => handleToken(JSON.parse(e.data)));
}

function addChat(msg){
  const div=document.createElement('div');
  div.textContent=`${msg.from}: ${msg.text}`;
  el('chat').appendChild(div);
}

function handlePrivate(msg){
  if(msg.to===playerId || msg.from===playerId || msg.intercept){
    addChat(msg);
  }
  if(isSpy || msg.intercept){
    const div=document.createElement('div');
    div.textContent=`[SPY] ${msg.from}->${msg.to}: ${msg.text}`;
    el('spyLog').appendChild(div);
  }
}

function handleToken(data){
  if(data.id===playerId){
    tokens=data.tokens;
    el('tokens').textContent='Tokens: '+tokens;
  }
}

el('send').onclick = async () => {
  const text=el('msg').value;
  const target=el('target').value||null;
  await fetch('/send-message',{method:'POST',body:JSON.stringify({code:roomCode,playerId,target,text})});
  el('msg').value='';
};

el('startBtn').onclick = async () => {
  await fetch('/start-game',{method:'POST',body:JSON.stringify({code:roomCode,playerId})});
};

el('spyBtn').onclick = async () => {
  const target=el('spyTarget').value;
  if(!target) return;
  await fetch('/spy',{method:'POST',body:JSON.stringify({code:roomCode,playerId,target})});
};

el('tradeBtn').onclick = async () => {
  const target=el('tradeTarget').value;
  const amount=parseInt(el('tradeAmount').value)||1;
  await fetch('/trade',{method:'POST',body:JSON.stringify({code:roomCode,playerId,target,amount})});
};

function handleTradeRequest(data){
  if(data.to!==playerId) return;
  if(confirm(`Accept ${data.amount} token from ${data.from}?`)){
    fetch('/trade-response',{method:'POST',body:JSON.stringify({code:roomCode,playerId,from:data.from,accept:true})});
  } else {
    fetch('/trade-response',{method:'POST',body:JSON.stringify({code:roomCode,playerId,from:data.from,accept:false})});
  }
}

let isSpy=false;
function handleGameStart(data){
  if(data.spy===playerId){
    isSpy=true;
    el('spy').style.display='block';
  }
}

function addPlayer(id,nick){
  const option=document.createElement('option');
  option.value=id; option.textContent=nick; el('target').appendChild(option);
  const option2=option.cloneNode(true); el('tradeTarget').appendChild(option2);
  const option3=option.cloneNode(true); el('spyTarget').appendChild(option3);
}

function updatePlayers(){
  fetch('/players?code='+roomCode)
    .then(r=>r.json())
    .then(data=>{
      data.players.forEach(p=>addPlayer(p.id,p.nickname));
    });
}
