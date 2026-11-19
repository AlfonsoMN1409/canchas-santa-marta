const sb=supabase.createClient(APP_CONFIG.SUPABASE_URL,APP_CONFIG.SUPABASE_ANON_KEY);
const app=document.getElementById('app'),msg=document.getElementById('msg'),who=document.getElementById('who');
let me=null,tab='';
const TABS={jugador:[['buscar','Buscar y reservar'],['mias','Mis reservas']],
  encargado:[['canchas','Mis canchas'],['agenda','Reservas recibidas'],['resumen','Resumen']],
  admin:[['canchas','Todas las canchas'],['agenda','Todas las reservas'],['admin','Administración'],['resumen','Indicadores']]};
const ROL={jugador:'Jugador',encargado:'Dueño de cancha',admin:'Administrador'};
const DIAS=[['Lun',1],['Mar',2],['Mié',3],['Jue',4],['Vie',5],['Sáb',6],['Dom',0]];
const TERMINOS=`TÉRMINOS Y TRATAMIENTO DE DATOS PERSONALES (plantilla de ejemplo)
Responsable: Canchas Santa Marta (proyecto académico). Contacto: (correo del equipo).
Datos que recolectamos: nombres, cédula, celular y correo.
Finalidad: crear su cuenta, gestionar y confirmar reservas, y permitir que el dueño de la cancha reservada lo contacte por su reserva.
Quién ve sus datos: usted; el dueño de la cancha donde reserva (solo nombre y celular); y el administrador.
No vendemos ni compartimos sus datos con terceros.
Sus derechos (Ley 1581 de 2012): conocer, actualizar, rectificar y solicitar la supresión de sus datos, y revocar esta autorización.
Al marcar la casilla autoriza este tratamiento y acepta las reglas de reserva (cancelación con 2 horas de anticipación).`;
// ---------- utilidades (los datos de la BD se pintan siempre con textContent)
const money=n=>'$'+Number(n||0).toLocaleString('es-CO'),hh=h=>String(h).padStart(2,'0')+':00';
const hora=t=>t.slice(0,5),fmt=s=>`${s.fecha} ${hora(s.hora_inicio)}–${hora(s.hora_fin)}`;
function el(t,props={},...kids){const e=document.createElement(t);Object.assign(e,props);kids.flat().forEach(k=>e.append(k));return e}
const btn=(t,fn,cls='')=>el('button',{className:('b '+cls).trim(),type:'button',textContent:t,onclick:fn});
const note=(t,ok=false)=>{msg.className=ok?'ok':'err';msg.textContent=t};
const field=(label,id,type='text',attrs={})=>[el('label',{htmlFor:id,textContent:label}),el('input',{id,name:id,type,required:true,...attrs})];
const authErr=m=>/Database error/i.test(m)?'No se pudo crear la cuenta. Revisa que la cédula no esté ya registrada.':/already registered/i.test(m)?'Ese correo ya está registrado.':/Invalid login/i.test(m)?'Correo o contraseña incorrectos.':m==='Email not confirmed'?'Debes confirmar tu correo antes de entrar.':m;
const dbErr=e=>e.code==='23505'?'Esa franja acaba de ser reservada por otra persona. Actualizamos la lista.':e.message;

async function init(){
  const{data:{session}}=await sb.auth.getSession();
  if(!session){me=null;return authView()}
  const{data,error}=await sb.from('profiles').select('*').eq('id',session.user.id).single();
  if(error||!data?.activo){await sb.auth.signOut();note('Perfil inactivo o no disponible');return authView()}
  me=data;who.replaceChildren(el('span',{className:'bienvenida',textContent:`Bienvenido, ${me.nombres}`,title:ROL[me.rol]}),btn('Salir',async()=>{await sb.auth.signOut();init()}));
  tab=TABS[me.rol][0][0];render();
}
function authView(modo='login'){
  who.replaceChildren();const reg=modo==='registro';
  const f=el('form',{onsubmit:async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));
    if(reg){
      if(!/^\d{6,10}$/.test(d.documento))return note('La cédula debe tener entre 6 y 10 dígitos, sin puntos ni espacios.');
      if(!/^3\d{9}$/.test(d.telefono))return note('El celular debe tener 10 dígitos y empezar por 3.');
      if(!d.terminos)return note('Debes aceptar los términos y el tratamiento de datos personales.');
    }
    const r=reg?await sb.auth.signUp({email:d.email,password:d.password,options:{data:{nombres:d.nombres.trim(),documento:d.documento,telefono:d.telefono,acepta_terminos:'true'}}})
               :await sb.auth.signInWithPassword({email:d.email,password:d.password});
    if(r.error)return note(authErr(r.error.message));
    if(reg&&!r.data.session)return note('Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.',true);
    note(reg?'Cuenta creada. ¡Bienvenido!':'Bienvenido',true);init()}},
    ...(reg?[...field('Nombres y apellidos','nombres','text',{minLength:2,autocomplete:'name'}),
             ...field('Cédula (solo números)','documento','text',{inputMode:'numeric',pattern:'[0-9]{6,10}',maxLength:10}),
             ...field('Celular (10 dígitos)','telefono','tel',{inputMode:'numeric',pattern:'3[0-9]{9}',maxLength:10})]:[]),
    ...field('Correo','email','email',{autocomplete:'email'}),
    ...field('Contraseña (mín. 8)','password','password',{minLength:8,autocomplete:reg?'new-password':'current-password'}),
    ...(reg?[el('label',{className:'terms',htmlFor:'terminos'},el('input',{type:'checkbox',id:'terminos',name:'terminos',required:true}),'Acepto los términos y condiciones y autorizo el tratamiento de mis datos personales.'),
             el('details',{},el('summary',{textContent:'Leer términos y tratamiento de datos'}),el('p',{textContent:TERMINOS}))]:[]),
    el('p'),el('button',{className:'b',type:'submit',textContent:reg?'Crear cuenta':'Iniciar sesión'}));
  app.replaceChildren(el('nav',{},el('button',{className:reg?'off':'',textContent:'Iniciar sesión',onclick:()=>authView('login')}),
    el('button',{className:reg?'':'off',textContent:'Crear cuenta',onclick:()=>authView('registro')})),f);
}
function render(){
  const nav=el('nav',{},TABS[me.rol].map(([k,l])=>el('button',{className:k===tab?'':'off',textContent:l,onclick:()=>{tab=k;render()}})));
  const box=el('div',{},el('p',{textContent:'Cargando…'}));app.replaceChildren(nav,box);
  ({buscar,mias,canchas,agenda,admin:adminView,resumen})[tab](box);
}
// ---------- JUGADOR
async function buscar(box){
  const{data:sp}=await sb.from('sports').select('*').eq('activo',true).order('nombre');
  const s=el('select',{id:'dep'},(sp||[]).map(x=>el('option',{value:x.id,textContent:x.nombre})));
  const hoy=new Date().toLocaleDateString('en-CA');
  const d=el('input',{id:'fec',type:'date',value:hoy,min:hoy}),out=el('div');
  const load=async()=>{out.replaceChildren(el('p',{textContent:'Buscando…'}));
    const{data,error}=await sb.from('v_disponibilidad').select('*').eq('sport_id',s.value).eq('fecha',d.value).order('hora_inicio');
    if(error)return out.replaceChildren(el('p',{textContent:dbErr(error)}));
    if(!data.length)return out.replaceChildren(el('p',{textContent:'No hay franjas libres para esa búsqueda.'}));
    out.replaceChildren(...data.map(f=>el('div',{className:'card row'},el('span',{textContent:`${f.cancha} · ${fmt(f)} · ${money(f.precio_hora)}`}),
      btn('Reservar',async()=>{if(!confirm('¿Confirmar reserva?'))return;
        const{error}=await sb.from('bookings').insert({slot_id:f.slot_id,player_id:me.id});
        error?note(dbErr(error)):note('Reserva creada ✔',true);load()})))) };
  s.onchange=d.onchange=load;
  box.replaceChildren(el('label',{htmlFor:'dep',textContent:'Deporte'}),s,el('label',{htmlFor:'fec',textContent:'Fecha'}),d,out);load();
}
async function cambiar(id,estado,refresh){const{error}=await sb.from('bookings').update({estado}).eq('id',id);error?note(error.message):note('Estado actualizado',true);refresh()}
async function mias(box){
  const{data,error}=await sb.from('bookings').select('id,estado,precio_cop,slots(fecha,hora_inicio,hora_fin,courts(nombre,sports(nombre)))').eq('player_id',me.id);
  if(error)return note(error.message);
  if(!data.length)return box.replaceChildren(el('p',{textContent:'Aún no tienes reservas.'}));
  data.sort((a,b)=>(a.slots.fecha+a.slots.hora_inicio).localeCompare(b.slots.fecha+b.slots.hora_inicio));
  box.replaceChildren(...data.map(b=>el('div',{className:'card row'},
    el('span',{textContent:`${fmt(b.slots)} · ${b.slots.courts.nombre} (${b.slots.courts.sports.nombre}) · ${money(b.precio_cop)} · ${b.estado}`}),
    ['reservada','confirmada'].includes(b.estado)?btn('Cancelar',()=>confirm('¿Cancelar?')&&cambiar(b.id,'cancelada',()=>mias(box)),'d'):'')));
}
// ---------- DUEÑO / ADMIN: canchas, horario y precio
function courtForm(c,sp,done){
  const sel=(name,from,to,val)=>el('select',{name,id:name+(c?c.id:'n')},Array.from({length:to-from+1},(_,i)=>from+i).map(h=>el('option',{value:h,textContent:hh(h),selected:h===val})));
  const days=c?.dias_semana||[0,1,2,3,4,5,6];
  const lab=(t,id,ctl)=>[el('label',{htmlFor:id,textContent:t}),ctl];
  const nom=el('input',{id:'nom'+(c?c.id:'n'),name:'nombre',required:true,minLength:2,value:c?.nombre||'',placeholder:'Ej.: Cancha La Bahía'});
  const dep=el('select',{name:'sport_id',id:'dep'+(c?c.id:'n')},sp.map(x=>el('option',{value:x.id,textContent:x.nombre,selected:c?.sport_id===x.id})));
  const pre=el('input',{id:'pre'+(c?c.id:'n'),name:'precio_hora',type:'number',min:0,max:2000000,step:1000,required:true,value:c?.precio_hora??''});
  const f=el('form',{className:c?'':'card',onsubmit:async e=>{e.preventDefault();const d=new FormData(f);
    const body={nombre:d.get('nombre').trim(),sport_id:+d.get('sport_id'),precio_hora:+d.get('precio_hora'),hora_apertura:+d.get('hora_apertura'),hora_cierre:+d.get('hora_cierre'),dias_semana:d.getAll('dias').map(Number)};
    if(body.nombre.length<2)return note('Escribe el nombre de la cancha.');
    if(!(body.precio_hora>=0))return note('Escribe el precio por hora.');
    if(body.hora_apertura>=body.hora_cierre)return note('La hora de cierre debe ser posterior a la apertura.');
    if(!body.dias_semana.length)return note('Elige al menos un día de atención.');
    let id=c?.id,r;
    if(c)r=await sb.from('courts').update(body).eq('id',c.id);
    else{r=await sb.from('courts').insert({...body,encargado_id:me.id}).select('id').single();id=r.data?.id}
    if(r.error)return note(r.error.message);
    const g=await sb.rpc('generar_franjas',{p_court:id,p_dias:14});
    g.error?note(g.error.message):note(`Cancha guardada. Franjas nuevas generadas: ${g.data}`,true);done()}},
    el('h3',{textContent:c?'Editar cancha':'Crear nueva cancha'}),
    ...lab('Nombre de la cancha',nom.id,nom),...lab('Deporte',dep.id,dep),...lab('Precio por hora (COP)',pre.id,pre),
    ...lab('Abre a las',(c?'hora_apertura'+c.id:'hora_aperturan'),sel('hora_apertura',0,22,c?.hora_apertura??8)),
    ...lab('Cierra a las',(c?'hora_cierre'+c.id:'hora_cierren'),sel('hora_cierre',1,23,c?.hora_cierre??22)),
    el('label',{textContent:'Días de atención'}),
    el('div',{},DIAS.map(([t,v])=>el('label',{className:'chk'},el('input',{type:'checkbox',name:'dias',value:v,checked:days.includes(v)}),t))),
    el('p',{className:'hint',textContent:'Se crean franjas de 1 hora para los próximos 14 días. Al editar, se rehacen las franjas futuras que no tienen reservas.'}),
    el('button',{className:'b',type:'submit',textContent:c?'Guardar cambios':'Crear cancha'}));
  return f;
}
function courtCard(c,sp,done){
  const card=el('div',{className:'card'});
  const view=()=>card.replaceChildren(
    el('div',{className:'row'},el('b',{textContent:`${c.nombre} · ${c.sports.nombre}`}),el('span',{textContent:c.activo?'Activa':'Inactiva'})),
    el('p',{textContent:`${money(c.precio_hora)} por hora · ${hh(c.hora_apertura)}–${hh(c.hora_cierre)} · ${DIAS.filter(([,v])=>c.dias_semana.includes(v)).map(([t])=>t).join(', ')}`+(me.rol==='admin'&&c.profiles?` · Dueño: ${c.profiles.nombres}`:'')}),
    el('div',{},btn('Editar',()=>card.replaceChildren(courtForm(c,sp,done),btn('Cancelar',view,'off'))),
      btn(c.activo?'Desactivar':'Activar',async()=>{const{error}=await sb.from('courts').update({activo:!c.activo}).eq('id',c.id);error?note(error.message):note('Cancha actualizada',true);done()},c.activo?'d':''),
      btn('Generar próximos 14 días',async()=>{const g=await sb.rpc('generar_franjas',{p_court:c.id,p_dias:14});g.error?note(g.error.message):note(`Franjas nuevas: ${g.data}`,true)})));
  view();return card;
}
async function canchas(box){
  let q=sb.from('courts').select('*,sports(nombre),profiles(nombres)').order('id');
  if(me.rol!=='admin')q=q.eq('encargado_id',me.id);
  const[{data:sp},{data,error}]=await Promise.all([sb.from('sports').select('*').eq('activo',true).order('nombre'),q]);
  if(error)return note(error.message);
  const done=()=>canchas(box);
  box.replaceChildren(el('h2',{textContent:me.rol==='admin'?'Todas las canchas':'Mis canchas'}),courtForm(null,sp||[],done),
    ...(data.length?data.map(c=>courtCard(c,sp||[],done)):[el('p',{textContent:'Aún no hay canchas. Crea la primera con el formulario.'})]));
}
// ---------- Reservas recibidas e indicadores (la BD ya filtra por dueño)
async function agenda(box){
  const{data,error}=await sb.from('v_agenda').select('*').order('fecha').order('hora_inicio');
  if(error)return note(error.message);
  const sig={reservada:['confirmada'],confirmada:['jugada','no_asistio']};
  box.replaceChildren(el('h2',{textContent:me.rol==='admin'?'Todas las reservas':'Reservas de mis canchas'}),
    ...(data.length?data.map(b=>el('div',{className:'card'},
      el('div',{className:'row'},el('b',{textContent:`${fmt(b)} · ${b.cancha}`}),el('span',{textContent:b.estado})),
      el('p',{textContent:`${b.cliente} · Cel. ${b.telefono||'—'} · ${money(b.precio_cop)}`}),
      el('div',{},(sig[b.estado]||[]).map(n=>btn(n,()=>cambiar(b.id,n,()=>agenda(box)))),
        ['reservada','confirmada'].includes(b.estado)?btn('cancelada',()=>confirm('¿Cancelar esta reserva?')&&cambiar(b.id,'cancelada',()=>agenda(box)),'d'):'')))
      :[el('p',{textContent:'Todavía no hay reservas.'})]));
}
async function resumen(box){
  const{data,error}=await sb.from('v_indicadores').select('*').order('mes',{ascending:false});
  if(error)return note(error.message);
  const t=data.reduce((a,r)=>({n:a.n+r.total,i:a.i+Number(r.ingresos)}),{n:0,i:0});
  box.replaceChildren(el('h2',{textContent:'Resumen'}),el('div',{className:'card',textContent:`Reservas: ${t.n} · Ingresos (confirmadas y jugadas): ${money(t.i)}`}),
    ...data.map(r=>el('div',{className:'card',textContent:`${r.cancha} (${r.deporte}) · ${r.mes} · ${r.estado}: ${r.total}`+(Number(r.ingresos)?` · ${money(r.ingresos)}`:'')})));
  if(!data.length)box.append(el('p',{textContent:'Aún no hay datos.'}));
}
// ---------- ADMIN
function adminView(box){
  const email=el('input',{id:'em',type:'email',placeholder:'correo de un usuario ya registrado'}),dep=el('input',{id:'nd',placeholder:'Ej.: Voleibol'});
  const call=async on=>{const{error}=await sb.rpc('promover_dueno',{p_email:email.value,p_activar:on});
    error?note(error.message):note(on?'Listo: ahora es dueño de cancha.':'Listo: ya no es dueño de cancha.',true)};
  box.replaceChildren(el('h2',{textContent:'Dueños de cancha'}),el('p',{className:'hint',textContent:'La persona debe crear su cuenta primero. Como dueño solo verá y gestionará sus propias canchas y reservas.'}),
    el('label',{htmlFor:'em',textContent:'Correo del usuario'}),email,el('p'),btn('Dar rol de dueño',()=>call(true)),btn('Quitar rol',()=>call(false),'d'),
    el('h2',{textContent:'Deportes disponibles'}),el('label',{htmlFor:'nd',textContent:'Nuevo deporte'}),dep,el('p'),
    btn('Agregar deporte',async()=>{const n=dep.value.trim();if(n.length<2)return note('Escribe el nombre del deporte.');
      const{error}=await sb.from('sports').insert({nombre:n});error?note(error.code==='23505'?'Ese deporte ya existe.':error.message):(note('Deporte agregado',true),dep.value='')}));
}
init();
