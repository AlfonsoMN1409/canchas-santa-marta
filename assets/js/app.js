const sb=supabase.createClient(APP_CONFIG.SUPABASE_URL,APP_CONFIG.SUPABASE_ANON_KEY);
const app=document.getElementById('app'),msg=document.getElementById('msg'),who=document.getElementById('who');
let me=null,tab='buscar';
// --- UI segura: siempre textContent, nunca innerHTML con datos de la BD
function el(t,props={},...kids){const e=document.createElement(t);Object.assign(e,props);kids.flat().forEach(k=>e.append(k));return e}
function note(t,ok=false){msg.className=ok?'ok':'err';msg.textContent=t}
function field(label,id,type='text',attrs={}){return[el('label',{htmlFor:id,textContent:label}),el('input',{id,type,required:true,...attrs})]}
const fmt=s=>[s.fecha,s.hora_inicio.slice(0,5)+'–'+s.hora_fin.slice(0,5)].join(' ');
const dbErr=e=>e.code==='23505'?'Esa franja acaba de ser reservada por otra persona. Actualizamos la lista.':e.message;

async function init(){
  const{data:{session}}=await sb.auth.getSession();
  if(!session){me=null;return authView()}
  const{data,error}=await sb.from('profiles').select('*').eq('id',session.user.id).single();
  if(error||!data?.activo){await sb.auth.signOut();note('Perfil inactivo o no disponible');return authView()}
  me=data;who.replaceChildren(el('span',{textContent:`${me.nombres} (${me.rol}) `}),el('button',{className:'b',textContent:'Salir',onclick:async()=>{await sb.auth.signOut();init()}}));
  tab=me.rol==='jugador'?'buscar':me.rol==='encargado'?'agenda':'resumen';render();
}
function authView(){
  who.replaceChildren();
  const f=el('form',{onsubmit:async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));
    const r=d.modo==='registro'?await sb.auth.signUp({email:d.email,password:d.password,options:{data:{nombres:d.nombres||'Usuario'}}}):await sb.auth.signInWithPassword({email:d.email,password:d.password});
    if(r.error)return note(r.error.message);note(d.modo==='registro'?'Cuenta creada. Si pide confirmar correo, revise su bandeja.':'Bienvenido',true);init()}},
    el('label',{htmlFor:'modo',textContent:'Acción'}),el('select',{id:'modo',name:'modo'},el('option',{value:'login',textContent:'Iniciar sesión'}),el('option',{value:'registro',textContent:'Registrarme'})),
    ...field('Nombres (solo registro)','nombres','text',{name:'nombres',required:false}),...field('Correo','email','email',{name:'email'}),
    ...field('Contraseña (mín. 8)','password','password',{name:'password',minLength:8}),el('p'),el('button',{className:'b',type:'submit',textContent:'Continuar'}));
  app.replaceChildren(el('div',{className:'card'},f));
}
function render(){
  const tabs={jugador:[['buscar','Buscar y reservar'],['mias','Mis reservas']],encargado:[['agenda','Agenda de mis canchas']],admin:[['resumen','Indicadores'],['agenda','Todas las reservas']]}[me.rol];
  const nav=el('nav',{},tabs.map(([k,l])=>el('button',{className:k===tab?'':'off',textContent:l,onclick:()=>{tab=k;render()}})));
  const box=el('div',{},el('p',{textContent:'Cargando…'}));app.replaceChildren(nav,box);
  ({buscar,mias,agenda:()=>agenda(box),resumen})[tab](box);
}
async function buscar(box){
  const{data:sp}=await sb.from('sports').select('*').eq('activo',true);
  const s=el('select',{id:'dep'},sp?.map(x=>el('option',{value:x.id,textContent:x.nombre}))||[]);
  const d=el('input',{id:'fec',type:'date',value:new Date().toLocaleDateString('en-CA'),min:new Date().toLocaleDateString('en-CA')});
  const out=el('div');
  const load=async()=>{out.replaceChildren(el('p',{textContent:'Buscando…'}));
    const{data,error}=await sb.from('v_disponibilidad').select('*').eq('sport_id',s.value).eq('fecha',d.value).order('hora_inicio');
    if(error)return out.replaceChildren(el('p',{textContent:dbErr(error)}));
    if(!data.length)return out.replaceChildren(el('p',{textContent:'No hay franjas libres para esa búsqueda.'}));
    out.replaceChildren(...data.map(f=>el('div',{className:'card row'},el('span',{textContent:`${f.cancha} · ${fmt(f)} · $${f.precio_hora}`}),
      el('button',{className:'b',textContent:'Reservar',onclick:async()=>{if(!confirm('¿Confirmar reserva?'))return;
        const{error}=await sb.from('bookings').insert({slot_id:f.slot_id,player_id:me.id});
        error?note(dbErr(error)):note('Reserva creada ✔',true);load()}})))) };
  s.onchange=d.onchange=load;
  box.replaceChildren(el('label',{htmlFor:'dep',textContent:'Deporte'}),s,el('label',{htmlFor:'fec',textContent:'Fecha'}),d,out);load();
}
const BASE='id,estado,slots(fecha,hora_inicio,hora_fin,courts(nombre,sports(nombre)))';
function lista(box,data,acciones){
  if(!data.length)return box.replaceChildren(el('p',{textContent:'No hay reservas.'}));
  data.sort((a,b)=>(a.slots.fecha+a.slots.hora_inicio).localeCompare(b.slots.fecha+b.slots.hora_inicio));
  box.replaceChildren(...data.map(b=>el('div',{className:'card row'},el('span',{textContent:`${fmt(b.slots)} · ${b.slots.courts.nombre} (${b.slots.courts.sports.nombre}) · ${b.estado}`}),
    el('span',{},acciones(b)))));
}
async function cambiar(id,estado,refresh){const{error}=await sb.from('bookings').update({estado}).eq('id',id);error?note(error.message):note('Estado actualizado',true);refresh()}
async function mias(box){
  const{data,error}=await sb.from('bookings').select(BASE).eq('player_id',me.id);
  if(error)return note(error.message);
  lista(box,data,b=>['reservada','confirmada'].includes(b.estado)?[el('button',{className:'b d',textContent:'Cancelar',onclick:()=>confirm('¿Cancelar?')&&cambiar(b.id,'cancelada',()=>mias(box))})]:[]);
}
async function agenda(box){
  const{data,error}=await sb.from('bookings').select(BASE);
  if(error)return note(error.message);
  const sig={reservada:['confirmada'],confirmada:['jugada','no_asistio']};
  lista(box,data,b=>(sig[b.estado]||[]).concat(['reservada','confirmada'].includes(b.estado)?['cancelada']:[]).map(n=>el('button',{className:n==='cancelada'?'b d':'b',textContent:n,onclick:()=>cambiar(b.id,n,()=>agenda(box))})));
}
async function resumen(box){
  const{data,error}=await sb.from('v_indicadores').select('*');
  if(error)return note(error.message);
  const t={};data.forEach(r=>{t[r.estado]=(t[r.estado]||0)+r.total});
  box.replaceChildren(el('h2',{textContent:'Reservas por estado'}),...Object.entries(t).map(([k,v])=>el('div',{className:'card',textContent:`${k}: ${v}`})),
    el('h2',{textContent:'Por deporte y mes'}),...data.map(r=>el('div',{className:'card',textContent:`${r.deporte} · ${r.mes} · ${r.estado}: ${r.total}`})));
  if(!data.length)box.append(el('p',{textContent:'Aún no hay datos.'}));
}
init();
