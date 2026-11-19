const sb=supabase.createClient(APP_CONFIG.SUPABASE_URL,APP_CONFIG.SUPABASE_ANON_KEY);
const app=document.getElementById('app'),msg=document.getElementById('msg'),who=document.getElementById('who'),temaBtn=document.getElementById('tema');
let me=null,tab='',REC=/type=recovery/.test(location.hash);
const AV=['avisos','Avisos'],PF=['perfil','Mi perfil'];
const TABS={jugador:[['buscar','Buscar y reservar'],['mias','Mis reservas'],AV,PF],
  encargado:[['canchas','Mis canchas'],['agenda','Reservas recibidas'],['equipo','Mi equipo'],['resumen','Indicadores'],AV,PF],
  staff:[['agenda','Reservas'],AV,PF],
  admin:[['canchas','Todas las canchas'],['agenda','Todas las reservas'],['admin','Administración'],['resumen','Indicadores'],AV,PF]};
const ROL={jugador:'Jugador',encargado:'Dueño de cancha',staff:'Encargado de cancha',admin:'Administrador'};
const DIAS=[['Lun',1],['Mar',2],['Mié',3],['Jue',4],['Vie',5],['Sáb',6],['Dom',0]];
const TERMINOS=`TÉRMINOS Y TRATAMIENTO DE DATOS PERSONALES (plantilla de ejemplo)
Responsable: Canchas Santa Marta (proyecto académico). Contacto: (correo del equipo).
Datos que recolectamos: nombres, cédula, celular y correo.
Finalidad: crear su cuenta, gestionar y confirmar reservas, y permitir que el dueño o encargado de la cancha reservada lo contacte por su reserva.
Quién ve sus datos: usted; el dueño y los encargados de la cancha donde reserva (solo nombre y celular); y el administrador.
No vendemos ni compartimos sus datos con terceros.
Sus derechos (Ley 1581 de 2012): conocer, actualizar, rectificar y solicitar la supresión de sus datos, y revocar esta autorización. Puede ejercerlos en "Mi perfil".
Al marcar la casilla autoriza este tratamiento y acepta las reglas de reserva (cada cancha define su plazo de cancelación; 3 inasistencias en 60 días suspenden las reservas 7 días).`;
// ---------- tema claro/oscuro
const setTema=t=>{document.documentElement.dataset.tema=t;try{localStorage.setItem('tema',t)}catch(e){}
  temaBtn.textContent=t==='oscuro'?'☀️':'🌙';temaBtn.title=t==='oscuro'?'Cambiar a modo claro':'Cambiar a modo oscuro'};
temaBtn.onclick=()=>setTema(document.documentElement.dataset.tema==='oscuro'?'claro':'oscuro');
setTema(document.documentElement.dataset.tema||'claro');
// ---------- utilidades (los datos de la BD se pintan siempre con textContent)
const money=n=>'$'+Number(n||0).toLocaleString('es-CO'),hh=h=>String(h).padStart(2,'0')+':00';
const hora=t=>t.slice(0,5),fmt=s=>`${s.fecha} ${hora(s.hora_inicio)}–${hora(s.hora_fin)}`;
const https=u=>/^https:\/\//.test(u||'')?u:'';
function el(t,props={},...kids){const e=document.createElement(t);Object.assign(e,props);kids.flat().forEach(k=>e.append(k));return e}
const btn=(t,fn,cls='')=>el('button',{className:('b '+cls).trim(),type:'button',textContent:t,onclick:fn});
const note=(t,ok=false)=>{msg.className=ok?'ok':'err';msg.textContent=t;if(!ok)scrollTo(0,0)};
const field=(label,id,type='text',attrs={})=>[el('label',{htmlFor:id,textContent:label}),el('input',{id,name:id,type,required:true,...attrs})];
const authErr=m=>/rate limit/i.test(m)?'Se enviaron demasiados correos en poco tiempo. Espera unos minutos e inténtalo de nuevo.':/captcha/i.test(m)?'No se pudo verificar el captcha. Inténtalo otra vez.':/Database error/i.test(m)?'No se pudo crear la cuenta. Revisa que la cédula no esté ya registrada.':/already registered/i.test(m)?'Ese correo ya está registrado.':/Invalid login/i.test(m)?'Correo o contraseña incorrectos.':m==='Email not confirmed'?'Debes confirmar tu correo antes de entrar.':m;
const dbErr=e=>e.code==='23505'?'Esa franja acaba de ser reservada por otra persona. Actualizamos la lista.':e.message;
const stars=n=>n?`★ ${n}`:'Sin calificaciones';
function lock(b,s){b.disabled=true;let n=s;const t=setInterval(()=>{n--;b.textContent=`Espera ${n}s`;if(n<=0){clearInterval(t);b.disabled=false;b.textContent=b.dataset.t}},1000)}
function drawCap(d){const k=APP_CONFIG.TURNSTILE_SITEKEY;if(!k)return;const t=()=>window.turnstile?turnstile.render(d,{sitekey:k}):setTimeout(t,300);t()}
const signOut=async()=>{await sb.auth.signOut();init()};

async function init(){
  if(REC)return recoveryView();
  const{data:{session}}=await sb.auth.getSession();
  if(!session){me=null;return authView()}
  const{data,error}=await sb.from('profiles').select('*').eq('id',session.user.id).single();
  if(error||!data?.activo){await sb.auth.signOut();note('Cuenta inactiva o no disponible');return authView()}
  me=data;who.replaceChildren(el('span',{className:'bienvenida',textContent:`Bienvenido, ${me.nombres}`,title:ROL[me.rol]}),btn('Salir',signOut));
  tab=TABS[me.rol][0][0];render();
}
// ---------- acceso: ingresar, crear cuenta, olvidé mi contraseña
function authView(modo='login'){
  who.replaceChildren();const reg=modo==='registro',olv=modo==='olvido',label=reg?'Crear cuenta':olv?'Enviar enlace':'Iniciar sesión';
  const cap=el('div'),sub=el('button',{className:'b',type:'submit',textContent:label});sub.dataset.t=label;
  const f=el('form',{onsubmit:async e=>{e.preventDefault();if(sub.disabled)return;const d=Object.fromEntries(new FormData(f));
    if(reg){
      if(!/^\d{6,10}$/.test(d.documento))return note('La cédula debe tener entre 6 y 10 dígitos, sin puntos ni espacios.');
      if(!/^3\d{9}$/.test(d.telefono))return note('El celular debe tener 10 dígitos y empezar por 3.');
      if(!d.terminos)return note('Debes aceptar los términos y el tratamiento de datos personales.');
    }
    const cp=APP_CONFIG.TURNSTILE_SITEKEY?{captchaToken:d['cf-turnstile-response']}:{};
    sub.disabled=true;let r;
    if(olv)r=await sb.auth.resetPasswordForEmail(d.email,{redirectTo:location.origin+location.pathname,...cp});
    else if(reg)r=await sb.auth.signUp({email:d.email,password:d.password,options:{...cp,data:{nombres:d.nombres.trim(),documento:d.documento,telefono:d.telefono,acepta_terminos:'true'}}});
    else r=await sb.auth.signInWithPassword({email:d.email,password:d.password,options:cp});
    sub.disabled=false;
    if(r.error){window.turnstile&&APP_CONFIG.TURNSTILE_SITEKEY&&turnstile.reset();if(/rate limit/i.test(r.error.message))lock(sub,60);return note(authErr(r.error.message))}
    if(olv){lock(sub,60);return note('Si el correo está registrado, recibirás un enlace para crear una nueva contraseña.',true)}
    if(reg&&!r.data.session)return note('Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.',true);
    note(reg?'Cuenta creada. ¡Bienvenido!':'Bienvenido',true);init()}},
    ...(reg?[...field('Nombres y apellidos','nombres','text',{minLength:2,autocomplete:'name'}),
             ...field('Cédula (solo números)','documento','text',{inputMode:'numeric',pattern:'[0-9]{6,10}',maxLength:10}),
             ...field('Celular (10 dígitos)','telefono','tel',{inputMode:'numeric',pattern:'3[0-9]{9}',maxLength:10})]:[]),
    ...field('Correo','email','email',{autocomplete:'email'}),
    ...(olv?[]:field('Contraseña (mín. 8)','password','password',{minLength:8,autocomplete:reg?'new-password':'current-password'})),
    ...(reg?[el('label',{className:'terms',htmlFor:'terminos'},el('input',{type:'checkbox',id:'terminos',name:'terminos',required:true}),'Acepto los términos y condiciones y autorizo el tratamiento de mis datos personales.'),
             el('details',{},el('summary',{textContent:'Leer términos y tratamiento de datos'}),el('p',{textContent:TERMINOS}))]:[]),
    cap,el('p'),sub);
  drawCap(cap);
  const nb=(m,t)=>el('button',{className:m===modo?'':'off',textContent:t,onclick:()=>authView(m)});
  app.replaceChildren(el('nav',{},nb('login','Iniciar sesión'),nb('registro','Crear cuenta')),f,
    modo==='login'?el('p',{},el('a',{href:'#',textContent:'Olvidé mi contraseña',onclick:e=>{e.preventDefault();authView('olvido')}})):'');
}
function recoveryView(){
  who.replaceChildren();const sub=el('button',{className:'b',type:'submit',textContent:'Guardar contraseña'});
  const f=el('form',{onsubmit:async e=>{e.preventDefault();const{error}=await sb.auth.updateUser({password:f.np.value});
    if(error)return note(error.message);REC=false;history.replaceState(null,'',location.pathname);note('Contraseña actualizada',true);init()}},
    el('h2',{textContent:'Crea tu nueva contraseña'}),...field('Nueva contraseña (mín. 8)','np','password',{minLength:8,autocomplete:'new-password'}),el('p'),sub);
  app.replaceChildren(f);
}
async function render(){
  const{count}=await sb.from('notificaciones').select('id',{count:'exact',head:true}).eq('leida',false);
  const nav=el('nav',{},TABS[me.rol].map(([k,l])=>el('button',{className:k===tab?'':'off',textContent:k==='avisos'&&count?`${l} (${count})`:l,onclick:()=>{tab=k;render()}})));
  const box=el('div',{},el('p',{textContent:'Cargando…'}));app.replaceChildren(nav,box);
  ({buscar,mias,canchas,agenda,admin:adminView,resumen,equipo:equipoView,avisos,perfil})[tab](box);
}
// ---------- JUGADOR: buscar (filtros, fotos, varias horas, semanas repetidas, lista de espera)
async function buscar(box){
  const{data:sp}=await sb.from('sports').select('*').eq('activo',true).order('nombre');
  const s=el('select',{id:'dep'},(sp||[]).map(x=>el('option',{value:x.id,textContent:x.nombre})));
  const hoy=new Date().toLocaleDateString('en-CA');
  const d=el('input',{id:'fec',type:'date',value:hoy,min:hoy}),zon=el('select',{id:'zon'}),max=el('input',{id:'max',type:'number',min:0,step:1000,placeholder:'Sin límite'});
  const sem=el('select',{id:'sem'},Array.from({length:8},(_,i)=>el('option',{value:i+1,textContent:i?`Repetir ${i+1} semanas`:'Solo esa fecha'})));
  const out=el('div');let L=[],O=[];
  const pinta=()=>{
    const ok=f=>(!zon.value||f.zona===zon.value)&&(!max.value||f.precio_hora<=+max.value);
    const G=new Map();L.filter(ok).forEach(f=>{if(!G.has(f.court_id))G.set(f.court_id,{f,libres:[],ocup:[]});G.get(f.court_id).libres.push(f)});
    O.filter(ok).forEach(f=>{if(G.has(f.court_id))G.get(f.court_id).ocup.push(f)});
    if(!G.size)return out.replaceChildren(el('p',{textContent:'No hay franjas libres para esa búsqueda.'}));
    out.replaceChildren(...[...G.values()].map(({f,libres,ocup})=>{
      const cbs=libres.map(x=>({x,cb:el('input',{type:'checkbox',value:x.slot_id})}));
      const mapa=https(f.mapa_url);
      return el('div',{className:'card'},https(f.foto_url)?el('img',{className:'foto',src:f.foto_url,alt:`Foto de ${f.cancha}`,loading:'lazy'}):'',
        el('div',{className:'row'},el('b',{textContent:f.cancha}),el('span',{textContent:`${stars(f.promedio)} · ${money(f.precio_hora)}/h`})),
        el('p',{className:'hint',textContent:[f.zona,f.direccion,`Cancelación gratis hasta ${f.horas_cancelacion} h antes`].filter(Boolean).join(' · ')}),
        f.descripcion?el('p',{textContent:f.descripcion}):'',
        mapa?el('p',{},el('a',{href:mapa,target:'_blank',rel:'noopener noreferrer',textContent:'Ver en el mapa'})):'',
        el('div',{},cbs.map(({x,cb})=>el('label',{className:'chk'},cb,hora(x.hora_inicio)))),
        btn('Reservar horas marcadas',async()=>{
          const ch=cbs.filter(c=>c.cb.checked).map(c=>c.x).sort((a,b)=>a.hora_inicio.localeCompare(b.hora_inicio));
          if(!ch.length)return note('Marca al menos una hora.');
          if(ch.some((x,i)=>i&&x.hora_inicio!==ch[i-1].hora_fin))return note('Las horas deben ser seguidas.');
          const w=+sem.value;if(!confirm(`¿Reservar ${ch.length} hora(s)${w>1?` durante ${w} semanas`:''} en ${f.cancha}?`))return;
          if(w===1){const{error}=await sb.from('bookings').insert(ch.map(x=>({slot_id:x.slot_id,player_id:me.id})));error?note(dbErr(error)):note('Reserva creada ✔',true)}
          else{let n=0;for(const x of ch){const{data,error}=await sb.rpc('reservar_serie',{p_slot:x.slot_id,p_semanas:w});if(error){note(dbErr(error));break}n+=data;}
            if(n)note(`Reservas creadas: ${n} (las semanas sin franja o ya ocupadas se omiten)`,true)}
          load()}),
        ocup.length?el('details',{},el('summary',{textContent:'Horas ocupadas · avisarme si se libera'}),
          el('div',{},ocup.map(o=>btn(hora(o.hora_inicio),async()=>{const{error}=await sb.from('waitlist').insert({slot_id:o.slot_id,player_id:me.id});
            error?note(error.code==='23505'?'Ya estás en la lista de espera.':error.message):note('Te avisaremos en "Avisos" si se libera.',true)},'off')))):'')}));
  };
  const load=async()=>{out.replaceChildren(el('p',{textContent:'Buscando…'}));
    const[a,b]=await Promise.all([sb.from('v_disponibilidad').select('*').eq('sport_id',s.value).eq('fecha',d.value).order('hora_inicio'),
                                   sb.from('v_ocupadas').select('*').eq('sport_id',s.value).eq('fecha',d.value).order('hora_inicio')]);
    if(a.error)return out.replaceChildren(el('p',{textContent:dbErr(a.error)}));
    L=a.data;O=b.data||[];const zs=[...new Set([...L,...O].map(x=>x.zona).filter(Boolean))].sort(),prev=zon.value;
    zon.replaceChildren(el('option',{value:'',textContent:'Todas las zonas'}),...zs.map(z=>el('option',{value:z,textContent:z,selected:z===prev})));pinta()};
  s.onchange=d.onchange=load;zon.onchange=max.oninput=pinta;
  box.replaceChildren(el('label',{htmlFor:'dep',textContent:'Deporte'}),s,el('label',{htmlFor:'fec',textContent:'Fecha'}),d,
    el('label',{htmlFor:'zon',textContent:'Zona'}),zon,el('label',{htmlFor:'max',textContent:'Precio máximo por hora (COP)'}),max,
    el('label',{htmlFor:'sem',textContent:'Repetición semanal (ej.: el partido de todos los jueves)'}),sem,out);load();
}
async function cambiar(id,estado,refresh){const{error}=await sb.from('bookings').update({estado}).eq('id',id);error?note(error.message):note('Estado actualizado',true);refresh()}
async function mias(box){
  const[{data,error},{data:cal},{data:esp}]=await Promise.all([
    sb.from('bookings').select('id,estado,precio_cop,slots(fecha,hora_inicio,hora_fin,courts(nombre,horas_cancelacion,sports(nombre)))').eq('player_id',me.id),
    sb.from('ratings').select('booking_id,estrellas'),
    sb.from('waitlist').select('slot_id,slots(fecha,hora_inicio,hora_fin,courts(nombre))')]);
  if(error)return note(error.message);
  const done=()=>mias(box),R=new Map((cal||[]).map(r=>[r.booking_id,r.estrellas]));
  data.sort((a,b)=>(a.slots.fecha+a.slots.hora_inicio).localeCompare(b.slots.fecha+b.slots.hora_inicio));
  const califica=b=>{const n=el('select',{id:'st'+b.id,'aria-label':'Estrellas'},[5,4,3,2,1].map(i=>el('option',{value:i,textContent:'★'.repeat(i)}))),c=el('input',{id:'cm'+b.id,placeholder:'Comentario (opcional)',maxLength:200});
    return el('div',{className:'row'},n,c,btn('Calificar',async()=>{const{error}=await sb.from('ratings').insert({booking_id:b.id,estrellas:+n.value,comentario:c.value.trim()||null});error?note(error.message):(note('¡Gracias por calificar!',true),done())}))};
  box.replaceChildren(el('h2',{textContent:'Mis reservas'}),
    ...(data.length?data.map(b=>el('div',{className:'card'},el('div',{className:'row'},
      el('span',{textContent:`${fmt(b.slots)} · ${b.slots.courts.nombre} (${b.slots.courts.sports.nombre}) · ${money(b.precio_cop)} · ${b.estado}`}),
      ['reservada','confirmada'].includes(b.estado)?btn('Cancelar',()=>confirm(`Esta cancha permite cancelar hasta ${b.slots.courts.horas_cancelacion} h antes. ¿Cancelar?`)&&cambiar(b.id,'cancelada',done),'d'):''),
      b.estado==='jugada'?(R.has(b.id)?el('p',{className:'hint',textContent:`Tu calificación: ${'★'.repeat(R.get(b.id))}`}):califica(b)):'')):[el('p',{textContent:'Aún no tienes reservas.'})]),
    ...(esp?.length?[el('h2',{textContent:'Lista de espera'}),...esp.map(w=>el('div',{className:'card row'},el('span',{textContent:`${fmt(w.slots)} · ${w.slots.courts.nombre}`}),
      btn('Quitar',async()=>{await sb.from('waitlist').delete().eq('slot_id',w.slot_id).eq('player_id',me.id);done()},'off')))]:[]));
}
// ---------- DUEÑO / ADMIN: canchas
const txt=(c,name,label,val,attrs={})=>{const id=name+(c?c.id:'n');return[el('label',{htmlFor:id,textContent:label}),el('input',{id,name,value:val||'',...attrs})]};
function courtForm(c,sp,done){
  const sel=(name,from,to,val)=>el('select',{name,id:name+(c?c.id:'n')},Array.from({length:to-from+1},(_,i)=>from+i).map(h=>el('option',{value:h,textContent:hh(h),selected:h===val})));
  const days=c?.dias_semana||[0,1,2,3,4,5,6],lab=(t,id,ctl)=>[el('label',{htmlFor:id,textContent:t}),ctl];
  const dep=el('select',{name:'sport_id',id:'dep'+(c?c.id:'n')},sp.map(x=>el('option',{value:x.id,textContent:x.nombre,selected:c?.sport_id===x.id})));
  const pre=el('input',{id:'pre'+(c?c.id:'n'),name:'precio_hora',type:'number',min:0,max:2000000,step:1000,required:true,value:c?.precio_hora??''});
  const can=el('input',{id:'can'+(c?c.id:'n'),name:'horas_cancelacion',type:'number',min:0,max:72,required:true,value:c?.horas_cancelacion??2});
  const desc=el('textarea',{id:'des'+(c?c.id:'n'),name:'descripcion',maxLength:500,rows:2,value:c?.descripcion||''});
  const f=el('form',{className:c?'':'card',onsubmit:async e=>{e.preventDefault();const d=new FormData(f),g=k=>(d.get(k)||'').trim()||null;
    const body={nombre:d.get('nombre').trim(),sport_id:+d.get('sport_id'),precio_hora:+d.get('precio_hora'),hora_apertura:+d.get('hora_apertura'),hora_cierre:+d.get('hora_cierre'),
      dias_semana:d.getAll('dias').map(Number),horas_cancelacion:+d.get('horas_cancelacion'),direccion:g('direccion'),zona:g('zona'),descripcion:g('descripcion'),foto_url:g('foto_url'),mapa_url:g('mapa_url')};
    if(body.nombre.length<2)return note('Escribe el nombre de la cancha.');
    if(!(body.precio_hora>=0))return note('Escribe el precio por hora.');
    if(body.hora_apertura>=body.hora_cierre)return note('La hora de cierre debe ser posterior a la apertura.');
    if(!body.dias_semana.length)return note('Elige al menos un día de atención.');
    if((body.foto_url&&!https(body.foto_url))||(body.mapa_url&&!https(body.mapa_url)))return note('Los enlaces de foto y mapa deben empezar por https://');
    let id=c?.id,r;
    if(c)r=await sb.from('courts').update(body).eq('id',c.id);
    else{r=await sb.from('courts').insert({...body,encargado_id:me.id}).select('id').single();id=r.data?.id}
    if(r.error)return note(r.error.message);
    const g2=await sb.rpc('generar_franjas',{p_court:id,p_dias:14});
    g2.error?note(g2.error.message):note(`Cancha guardada. Franjas nuevas generadas: ${g2.data}`,true);done()}},
    el('h3',{textContent:c?'Editar cancha':'Crear nueva cancha'}),
    ...txt(c,'nombre','Nombre de la cancha',c?.nombre,{required:true,minLength:2,placeholder:'Ej.: Cancha La Bahía'}),
    ...lab('Deporte',dep.id,dep),...lab('Precio por hora (COP)',pre.id,pre),
    ...txt(c,'zona','Zona (ej.: Rodadero)',c?.zona,{maxLength:60}),...txt(c,'direccion','Dirección',c?.direccion,{maxLength:160}),
    ...lab('Descripción',desc.id,desc),
    ...txt(c,'foto_url','Enlace de una foto (https://…)',c?.foto_url,{type:'url'}),...txt(c,'mapa_url','Enlace de Google Maps (https://…)',c?.mapa_url,{type:'url'}),
    ...lab('Cancelación gratis hasta (horas antes)',can.id,can),
    ...lab('Abre a las','hora_apertura'+(c?c.id:'n'),sel('hora_apertura',0,22,c?.hora_apertura??8)),
    ...lab('Cierra a las','hora_cierre'+(c?c.id:'n'),sel('hora_cierre',1,23,c?.hora_cierre??22)),
    el('label',{textContent:'Días de atención'}),
    el('div',{},DIAS.map(([t,v])=>el('label',{className:'chk'},el('input',{type:'checkbox',name:'dias',value:v,checked:days.includes(v)}),t))),
    el('p',{className:'hint',textContent:'Las franjas de 1 hora se extienden solas cada día (14 días hacia adelante). Al editar, se rehacen las franjas futuras sin reservas.'}),
    el('button',{className:'b',type:'submit',textContent:c?'Guardar cambios':'Crear cancha'}));
  return f;
}
function blockForm(c){
  const hoy=new Date().toLocaleDateString('en-CA'),I=k=>k+c.id;
  const f1=el('input',{id:I('bf1'),type:'date',value:hoy,min:hoy}),f2=el('input',{id:I('bf2'),type:'date',value:hoy,min:hoy});
  const h=(id,from,to,v)=>el('select',{id},Array.from({length:to-from+1},(_,i)=>from+i).map(x=>el('option',{value:x,textContent:hh(x),selected:x===v})));
  const h1=h(I('bh1'),0,23,0),h2=h(I('bh2'),1,24,24),mo=el('input',{id:I('bmo'),maxLength:100,placeholder:'Mantenimiento, evento privado…'});
  const go=async on=>{const{data,error}=await sb.rpc('bloquear_franjas',{p_court:c.id,p_desde_fecha:f1.value,p_hasta_fecha:f2.value,p_desde:+h1.value,p_hasta:+h2.value,p_motivo:mo.value.trim(),p_bloquear:on});
    error?note(error.message):note(`${data} franja(s) ${on?'bloqueadas (las que ya tienen reserva no se bloquean: cancélalas primero)':'desbloqueadas'}`,true)};
  return el('details',{},el('summary',{textContent:'Bloquear horas (mantenimiento, evento privado)'}),
    el('label',{htmlFor:f1.id,textContent:'Desde el día'}),f1,el('label',{htmlFor:f2.id,textContent:'Hasta el día'}),f2,
    el('label',{htmlFor:h1.id,textContent:'Desde la hora'}),h1,el('label',{htmlFor:h2.id,textContent:'Hasta la hora (sin incluir)'}),h2,
    el('label',{htmlFor:mo.id,textContent:'Motivo'}),mo,el('p'),btn('Bloquear',()=>go(true),'d'),btn('Desbloquear',()=>go(false),'off'));
}
function courtCard(c,sp,done){
  const card=el('div',{className:'card'});
  const view=()=>card.replaceChildren(
    el('div',{className:'row'},el('b',{textContent:`${c.nombre} · ${c.sports.nombre}`}),el('span',{textContent:c.activo?'Activa':'Inactiva'})),
    el('p',{textContent:`${money(c.precio_hora)} por hora · ${hh(c.hora_apertura)}–${hh(c.hora_cierre)} · ${DIAS.filter(([,v])=>c.dias_semana.includes(v)).map(([t])=>t).join(', ')}`+(c.zona?` · ${c.zona}`:'')+(me.rol==='admin'&&c.profiles?` · Dueño: ${c.profiles.nombres}`:'')}),
    el('div',{},btn('Editar',()=>card.replaceChildren(courtForm(c,sp,done),btn('Cancelar',view,'off'))),
      btn(c.activo?'Desactivar':'Activar',async()=>{const{error}=await sb.from('courts').update({activo:!c.activo}).eq('id',c.id);error?note(error.message):note('Cancha actualizada',true);done()},c.activo?'d':''),
      btn('Generar franjas ahora',async()=>{const g=await sb.rpc('generar_franjas',{p_court:c.id,p_dias:14});g.error?note(g.error.message):note(`Franjas nuevas: ${g.data}`,true)},'off')),
    blockForm(c));
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
// ---------- Equipo: dueño → cancha → encargados (el dueño asigna; el admin ve todo)
async function equipoView(box){
  const{data,error}=await sb.rpc('equipo');if(error)return note(error.message);
  const done=()=>equipoView(box),D=new Map();
  data.forEach(r=>{if(!D.has(r.dueno_id))D.set(r.dueno_id,{r,C:new Map()});const C=D.get(r.dueno_id).C;if(!C.has(r.court_id))C.set(r.court_id,{r,S:[]});if(r.staff_id)C.get(r.court_id).S.push(r)});
  const cancha=({r,S})=>{const em=el('input',{id:'se'+r.court_id,type:'email',placeholder:'correo de una persona ya registrada'});
    return el('div',{className:'card'},el('b',{textContent:r.cancha}),
      ...(S.length?S.map(s=>el('div',{className:'row'},el('span',{textContent:`${s.staff} · ${s.staff_email}`}),
        btn('Quitar',async()=>{const{error}=await sb.rpc('asignar_staff',{p_court:r.court_id,p_email:s.staff_email,p_activar:false});error?note(error.message):note('Encargado retirado',true);done()},'d'))):[el('p',{className:'hint',textContent:'Sin encargados.'})]),
      el('label',{htmlFor:em.id,textContent:'Asignar encargado (correo)'}),em,el('p'),
      btn('Asignar',async()=>{const{error}=await sb.rpc('asignar_staff',{p_court:r.court_id,p_email:em.value,p_activar:true});error?note(error.message):note('Encargado asignado',true);done()}))};
  box.replaceChildren(el('h2',{textContent:me.rol==='admin'?'Dueños, canchas y encargados':'Mi equipo'}),
    el('p',{className:'hint',textContent:'Un encargado ve y gestiona las reservas de las canchas que le asignes (confirmar, marcar asistencia, contactar al cliente). No puede editar canchas ni ver cédulas.'}),
    ...(D.size?[...D.values()].map(({r,C})=>el('div',{},me.rol==='admin'?el('h3',{textContent:`${r.dueno} · ${r.dueno_email}`}):'',...[...C.values()].map(cancha))):[el('p',{textContent:'Aún no hay canchas.'})]));
}
// ---------- Reservas recibidas e indicadores con gráficos
async function agenda(box){
  const{data,error}=await sb.from('v_agenda').select('*').order('fecha').order('hora_inicio');
  if(error)return note(error.message);
  const sig={reservada:['confirmada'],confirmada:['jugada','no_asistio']};
  box.replaceChildren(el('h2',{textContent:me.rol==='admin'?'Todas las reservas':'Reservas de mis canchas'}),
    ...(data.length?data.map(b=>el('div',{className:'card'},
      el('div',{className:'row'},el('b',{textContent:`${fmt(b)} · ${b.cancha}`}),el('span',{textContent:b.estado})),
      el('p',{textContent:`${b.cliente} · Cel. ${b.telefono||'—'} · ${money(b.precio_cop)}`}),
      el('div',{},(sig[b.estado]||[]).map(n=>btn(n,()=>cambiar(b.id,n,()=>agenda(box)))),
        ['reservada','confirmada'].includes(b.estado)?btn('cancelada',()=>confirm('¿Cancelar esta reserva?')&&cambiar(b.id,'cancelada',()=>agenda(box)),'d'):'',
        /^3\d{9}$/.test(b.telefono||'')?el('a',{className:'b off',target:'_blank',rel:'noopener noreferrer',textContent:'WhatsApp',
          href:`https://wa.me/57${b.telefono}?text=${encodeURIComponent(`Hola ${b.cliente}, sobre tu reserva en ${b.cancha} el ${fmt(b)}.`)}`}):'')))
      :[el('p',{textContent:'Todavía no hay reservas.'})]));
}
function chart(title,rows,f=v=>v){
  const mx=Math.max(1,...rows.map(r=>r[1]));
  return el('div',{className:'card'},el('h3',{textContent:title}),...(rows.length?rows.map(([l,v])=>{const i=el('i');i.style.width=`${Math.round(100*v/mx)}%`;
    return el('div',{className:'bar'},el('span',{textContent:l}),el('div',{className:'track'},i),el('span',{textContent:f(v)}))}):[el('p',{className:'hint',textContent:'Aún no hay datos.'})]));
}
async function resumen(box){
  const[{data:st,error},{data:cap}]=await Promise.all([sb.from('v_stats').select('*'),sb.from('v_capacidad').select('*')]);
  if(error)return note(error.message);
  const sum=(a,k,v=()=>1)=>Object.entries(a.reduce((m,r)=>(m[k(r)]=(m[k(r)]||0)+v(r),m),{}));
  const ing=st.filter(r=>['confirmada','jugada'].includes(r.estado)),vivas=st.filter(r=>r.estado!=='cancelada');
  box.replaceChildren(el('h2',{textContent:'Indicadores'}),
    el('div',{className:'card',textContent:`Reservas: ${st.length} · Ingresos (confirmadas y jugadas): ${money(ing.reduce((a,r)=>a+Number(r.precio),0))}`}),
    chart('Ocupación por cancha (franjas desde hace 30 días)',(cap||[]).map(c=>[c.cancha,c.franjas?Math.round(100*c.reservadas/c.franjas):0]),v=>v+'%'),
    chart('Ingresos por mes',sum(ing,r=>r.fecha.slice(0,7),r=>Number(r.precio)).sort(),money),
    chart('Horas pico (reservas vigentes por hora)',sum(vivas,r=>hh(r.hora)).sort()),
    chart('Reservas por estado',sum(st,r=>r.estado)));
}
// ---------- Avisos, perfil y derechos sobre los datos
async function avisos(box){
  const{data,error}=await sb.from('notificaciones').select('*').order('created_at',{ascending:false}).limit(50);
  if(error)return note(error.message);
  box.replaceChildren(el('h2',{textContent:'Avisos'}),...(data.length?data.map(n=>el('div',{className:'card'},el('p',{textContent:n.texto}),
    el('span',{className:'hint',textContent:new Date(n.created_at).toLocaleString('es-CO')+(n.leida?'':' · nuevo')}))):[el('p',{textContent:'No tienes avisos.'})]));
  if(data.some(n=>!n.leida))await sb.from('notificaciones').update({leida:true}).eq('leida',false);
}
function perfil(box){
  const nom=el('input',{id:'pn',name:'n',required:true,minLength:2,value:me.nombres,autocomplete:'name'}),tel=el('input',{id:'pt',name:'t',type:'tel',required:true,inputMode:'numeric',maxLength:10,value:me.telefono||''});
  const pw=el('input',{id:'pp',type:'password',minLength:8,autocomplete:'new-password'}),cf=el('input',{id:'pc',placeholder:'Escribe ELIMINAR'});
  const f=el('form',{onsubmit:async e=>{e.preventDefault();if(nom.value.trim().length<2)return note('Escribe tu nombre.');if(!/^3\d{9}$/.test(tel.value))return note('El celular debe tener 10 dígitos y empezar por 3.');
    const{error}=await sb.from('profiles').update({nombres:nom.value.trim(),telefono:tel.value}).eq('id',me.id);
    if(error)return note(error.message);me.nombres=nom.value.trim();me.telefono=tel.value;note('Datos actualizados',true)}},
    el('h2',{textContent:'Mi perfil'}),el('p',{className:'hint',textContent:`Rol: ${ROL[me.rol]} · Cédula: ${me.documento?'•••••'+me.documento.slice(-3):'—'} (para corregir la cédula, escribe al administrador)`}),
    el('label',{htmlFor:'pn',textContent:'Nombres y apellidos'}),nom,el('label',{htmlFor:'pt',textContent:'Celular'}),tel,el('p'),el('button',{className:'b',type:'submit',textContent:'Guardar'}));
  const dl=btn('Descargar mis datos',async()=>{const{data}=await sb.from('bookings').select('estado,precio_cop,created_at,slots(fecha,hora_inicio,courts(nombre))').eq('player_id',me.id);
    const a=el('a',{href:URL.createObjectURL(new Blob([JSON.stringify({perfil:me,reservas:data},null,2)],{type:'application/json'})),download:'mis-datos.json'});a.click()},'off');
  const del=btn('Eliminar mi cuenta',async()=>{if(cf.value!=='ELIMINAR')return note('Escribe ELIMINAR para confirmar.');
    const{error}=await sb.rpc('eliminar_mi_cuenta');if(error)return note(error.message);note('Tu cuenta fue eliminada.',true);await sb.auth.signOut();init()},'d');
  box.replaceChildren(f,el('h3',{textContent:'Cambiar contraseña'}),el('label',{htmlFor:'pp',textContent:'Nueva contraseña (mín. 8)'}),pw,el('p'),
    btn('Cambiar contraseña',async()=>{if(pw.value.length<8)return note('Mínimo 8 caracteres.');const{error}=await sb.auth.updateUser({password:pw.value});error?note(error.message):(note('Contraseña cambiada',true),pw.value='')}),
    el('h3',{textContent:'Tus datos (Ley 1581)'}),el('p',{className:'hint',textContent:'Eliminar la cuenta borra tu nombre, cédula y celular, cancela tus reservas futuras y cierra el acceso. El historial queda sin datos personales.'}),
    dl,el('label',{htmlFor:'pc',textContent:'Para eliminar tu cuenta escribe ELIMINAR'}),cf,el('p'),del);
}
// ---------- ADMIN: dueños, usuarios, equipo y deportes
async function adminView(box){
  const email=el('input',{id:'em',type:'email',placeholder:'correo de un usuario ya registrado'}),dep=el('input',{id:'nd',placeholder:'Ej.: Voleibol'}),q=el('input',{id:'bq',placeholder:'Buscar por nombre o correo'});
  const call=async on=>{const{error}=await sb.rpc('promover_dueno',{p_email:email.value,p_activar:on});
    error?note(error.message):(note(on?'Listo: ahora es dueño de cancha.':'Listo: ya no es dueño de cancha.',true),adminView(box))};
  const lista=el('div'),eq=el('div'),{data:U,error}=await sb.rpc('listar_usuarios');if(error)return note(error.message);
  const pintaU=()=>{const t=q.value.toLowerCase();lista.replaceChildren(...U.filter(u=>!t||(u.nombres+u.email).toLowerCase().includes(t)).map(u=>el('div',{className:'card row'},
    el('span',{textContent:`${u.nombres} · ${u.email} · ${ROL[u.rol]}${u.n_canchas?` · ${u.n_canchas} cancha(s)`:''}${u.activo?'':' · DESACTIVADO'}${u.bloqueado_hasta&&new Date(u.bloqueado_hasta)>new Date()?' · suspendido por inasistencias':''}`}),
    u.id===me.id?'':btn(u.activo?'Desactivar':'Activar',async()=>{const{error}=await sb.rpc('set_usuario_activo',{p_id:u.id,p_activo:!u.activo});error?note(error.message):(note('Usuario actualizado',true),adminView(box))},u.activo?'d':''))) )};
  q.oninput=pintaU;
  box.replaceChildren(el('h2',{textContent:'Dueños de cancha'}),el('p',{className:'hint',textContent:'La persona debe crear su cuenta primero. Como dueño solo verá y gestionará sus propias canchas y reservas; él mismo asigna a sus encargados.'}),
    el('label',{htmlFor:'em',textContent:'Correo del usuario'}),email,el('p'),btn('Dar rol de dueño',()=>call(true)),btn('Quitar rol',()=>call(false),'d'),
    eq,el('h2',{textContent:'Usuarios'}),el('label',{htmlFor:'bq',textContent:'Buscar'}),q,lista,
    el('h2',{textContent:'Deportes disponibles'}),el('label',{htmlFor:'nd',textContent:'Nuevo deporte'}),dep,el('p'),
    btn('Agregar deporte',async()=>{const n=dep.value.trim();if(n.length<2)return note('Escribe el nombre del deporte.');
      const{error}=await sb.from('sports').insert({nombre:n});error?note(error.code==='23505'?'Ese deporte ya existe.':error.message):(note('Deporte agregado',true),dep.value='')}));
  pintaU();equipoView(eq);
}
sb.auth.onAuthStateChange(ev=>{if(ev==='PASSWORD_RECOVERY'){REC=true;recoveryView()}});
init();
