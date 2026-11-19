-- MIGRACIÓN v3 · ejecutar UNA vez, después de esquema + politicas_rls + migracion_v2
-- Añade: encargados (staff), bloqueo de franjas, franjas automáticas, perfil/eliminación de cuenta,
-- ficha de cancha, política de cancelación por dueño, bloqueo por inasistencias, calificaciones,
-- lista de espera, avisos internos, vistas para gráficos y gestión de usuarios.
create extension if not exists pg_cron;   -- si falla: Dashboard > Database > Extensions > pg_cron

-- 1) Roles y columnas nuevas
alter table profiles drop constraint if exists profiles_rol_check;
alter table profiles add constraint profiles_rol_check check (rol in ('jugador','encargado','staff','admin'));
alter table profiles add column if not exists bloqueado_hasta timestamptz;
alter table courts
  add column if not exists direccion text check (length(direccion)<=160),
  add column if not exists zona text check (length(zona)<=60),
  add column if not exists descripcion text check (length(descripcion)<=500),
  add column if not exists foto_url text check (foto_url is null or foto_url ~ '^https://'),
  add column if not exists mapa_url text check (mapa_url is null or mapa_url ~ '^https://'),
  add column if not exists horas_cancelacion smallint not null default 2 check (horas_cancelacion between 0 and 72);
alter table slots add column if not exists bloqueada boolean not null default false,
                  add column if not exists motivo_bloqueo text;

-- 2) Tablas nuevas
create table court_staff(court_id int not null references courts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade, primary key(court_id,user_id));
create table ratings(booking_id bigint primary key references bookings(id) on delete cascade,
  estrellas smallint not null check (estrellas between 1 and 5), comentario text check (length(comentario)<=200),
  created_at timestamptz not null default now());
create table waitlist(slot_id bigint not null references slots(id) on delete cascade,
  player_id uuid not null references profiles(id) on delete cascade, created_at timestamptz not null default now(),
  primary key(slot_id,player_id));
create table notificaciones(id bigserial primary key, user_id uuid not null references profiles(id) on delete cascade,
  texto text not null, leida boolean not null default false, created_at timestamptz not null default now());
create index on notificaciones(user_id,leida);
alter table court_staff enable row level security;   -- sin políticas: solo se toca vía funciones
alter table ratings enable row level security; alter table waitlist enable row level security;
alter table notificaciones enable row level security;
create policy r_sel on ratings for select to authenticated using (true);
create policy r_ins on ratings for insert with check (exists(select 1 from bookings b where b.id=booking_id and b.player_id=auth.uid() and b.estado='jugada'));
create policy w_sel on waitlist for select using (player_id=auth.uid());
create policy w_ins on waitlist for insert with check (player_id=auth.uid() and my_role()='jugador');
create policy w_del on waitlist for delete using (player_id=auth.uid());
create policy n_sel on notificaciones for select using (user_id=auth.uid());
create policy n_del on notificaciones for delete using (user_id=auth.uid());
create policy n_upd on notificaciones for update using (user_id=auth.uid()) with check (user_id=auth.uid());
revoke update on notificaciones from authenticated; grant update(leida) on notificaciones to authenticated;

-- 3) ¿Puede el usuario actual gestionar esta cancha? (admin, dueño o encargado asignado)
create or replace function can_manage(p_court int) returns boolean language sql stable security definer set search_path=public as $$
  select my_role() is not null and (my_role()='admin'
    or exists(select 1 from courts where id=p_court and encargado_id=auth.uid())
    or exists(select 1 from court_staff where court_id=p_court and user_id=auth.uid())) $$;

-- 4) Un usuario común ya NO puede cambiarse rol, estado, bloqueo, consentimiento ni cédula
create or replace function guard_profile() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.bypass',true),'')<>'1' and coalesce(my_role(),'')<>'admin'
     and (new.rol<>old.rol or new.activo<>old.activo or new.bloqueado_hasta is distinct from old.bloqueado_hasta
          or new.acepta_terminos_at is distinct from old.acepta_terminos_at or new.documento is distinct from old.documento)
  then raise exception 'No autorizado a cambiar ese campo'; end if;
  return new;
end $$;

-- 5) Reglas de reserva: cancha bloqueada, cancelación por dueño, jugador sancionado
create or replace function guard_booking() returns trigger language plpgsql security definer set search_path=public as $$
declare s slots; c courts; r text:=my_role(); inicio timestamp; h int; bh timestamptz;
  ahora timestamp:=now() at time zone 'America/Bogota'; bp boolean:=coalesce(current_setting('app.bypass',true),'')='1';
begin
  if tg_op='INSERT' then
    select * into s from slots where id=new.slot_id and activo and not bloqueada;
    if not found then raise exception 'Franja no disponible'; end if;
    select * into c from courts where id=s.court_id and activo;
    if not found then raise exception 'Cancha inactiva'; end if;
    if s.fecha+s.hora_inicio <= ahora then raise exception 'No se puede reservar una franja pasada'; end if;
    new.precio_cop:=c.precio_hora; new.estado:='reservada';
    if r='jugador' then new.player_id:=auth.uid(); end if;
    select bloqueado_hasta into bh from profiles where id=new.player_id;
    if bh is not null and bh>now() then raise exception 'No puedes reservar hasta %, por inasistencias', to_char(bh at time zone 'America/Bogota','YYYY-MM-DD'); end if;
    return new;
  end if;
  if new.estado=old.estado then return new; end if;
  if not ((old.estado='reservada' and new.estado in ('confirmada','cancelada'))
       or (old.estado='confirmada' and new.estado in ('jugada','cancelada','no_asistio')))
  then raise exception 'Transición % -> % no permitida',old.estado,new.estado; end if;
  if r='jugador' and new.estado<>'cancelada' and not bp then raise exception 'El jugador solo puede cancelar'; end if;
  if new.estado='cancelada' then
    select s2.fecha+s2.hora_inicio, co.horas_cancelacion into inicio,h from slots s2 join courts co on co.id=s2.court_id where s2.id=old.slot_id;
    if r='jugador' and not bp and inicio < ahora + make_interval(hours=>h) then
      raise exception 'Esta cancha exige cancelar con % horas de anticipación',h; end if;
    new.cancelled_at:=now();
  end if;
  insert into status_history(booking_id,estado_anterior,estado_nuevo,changed_by) values(old.id,old.estado,new.estado,auth.uid());
  return new;
end $$;

-- 6) Avisos internos, lista de espera y bloqueo tras 3 inasistencias en 60 días (7 días de suspensión)
create or replace function after_booking() returns trigger language plpgsql security definer set search_path=public as $$
declare cn text; own uuid; f text; n int;
begin
  select c.nombre,c.encargado_id,s.fecha||' '||left(s.hora_inicio::text,5) into cn,own,f
    from slots s join courts c on c.id=s.court_id where s.id=new.slot_id;
  if tg_op='INSERT' then
    if own is not null then insert into notificaciones(user_id,texto) values(own,'Nueva reserva en '||cn||' ('||f||')'); end if;
    return new;
  end if;
  if new.estado=old.estado then return new; end if;
  if new.estado='confirmada' then insert into notificaciones(user_id,texto) values(new.player_id,'Tu reserva en '||cn||' ('||f||') fue confirmada'); end if;
  if new.estado='cancelada' then
    if own is not null and auth.uid()=new.player_id then insert into notificaciones(user_id,texto) values(own,'Se canceló una reserva en '||cn||' ('||f||')'); end if;
    insert into notificaciones(user_id,texto) select player_id,'Se liberó una franja en '||cn||' ('||f||'). ¡Resérvala ya!' from waitlist where slot_id=new.slot_id;
    delete from waitlist where slot_id=new.slot_id;
  end if;
  if new.estado='no_asistio' then
    select count(*) into n from bookings where player_id=new.player_id and estado='no_asistio' and created_at>now()-interval '60 days';
    if n>=3 then
      perform set_config('app.bypass','1',true);
      update profiles set bloqueado_hasta=now()+interval '7 days' where id=new.player_id;
      perform set_config('app.bypass','',true);
      insert into notificaciones(user_id,texto) values(new.player_id,'Acumulaste 3 inasistencias: no podrás reservar durante 7 días');
    end if;
  end if;
  return new;
end $$;
create trigger t_after_booking after insert or update on bookings for each row execute function after_booking();

-- 7) Políticas: dueño y encargados ven/gestionan las reservas de sus canchas
drop policy if exists b_sel on bookings; drop policy if exists b_upd on bookings;
create policy b_sel on bookings for select using (player_id=auth.uid() or exists(select 1 from slots s where s.id=slot_id and can_manage(s.court_id)));
create policy b_upd on bookings for update using (player_id=auth.uid() or exists(select 1 from slots s where s.id=slot_id and can_manage(s.court_id)));

-- 8) Franjas: generador interno, versión con permisos y tarea diaria automática
create or replace function _gen(p_court int,p_dias int,p_rehacer boolean) returns int language plpgsql security definer set search_path=public as $$
declare c courts; ahora timestamp:=now() at time zone 'America/Bogota'; n int;
begin
  select * into c from courts where id=p_court and activo; if not found then return 0; end if;
  if p_rehacer then
    delete from slots s where s.court_id=c.id and s.fecha+s.hora_inicio>ahora and not s.bloqueada
      and not exists(select 1 from bookings b where b.slot_id=s.id);
    update slots s set activo=(extract(dow from s.fecha)::int = any(c.dias_semana)
        and extract(hour from s.hora_inicio)>=c.hora_apertura and extract(hour from s.hora_inicio)<c.hora_cierre)
      where s.court_id=c.id and s.fecha+s.hora_inicio>ahora;
  end if;
  insert into slots(court_id,fecha,hora_inicio,hora_fin)
  select c.id,d::date,make_time(h,0,0),make_time(h,0,0)+interval '1 hour'
  from generate_series(ahora::date::timestamp,(ahora::date+p_dias-1)::timestamp,interval '1 day') d,
       generate_series(c.hora_apertura::int,c.hora_cierre::int-1) h
  where extract(dow from d)::int = any(c.dias_semana) and d::date+make_time(h,0,0)>ahora
  on conflict do nothing;
  get diagnostics n=row_count; return n;
end $$;
create or replace function generar_franjas(p_court int,p_dias int default 14) returns int language plpgsql security definer set search_path=public as $$
declare c courts;
begin
  select * into c from courts where id=p_court; if not found then raise exception 'La cancha no existe'; end if;
  if not (my_role()='admin' or c.encargado_id=auth.uid()) then raise exception 'No autorizado'; end if;
  if p_dias<1 or p_dias>60 then raise exception 'Elija entre 1 y 60 días'; end if;
  return _gen(p_court,p_dias,true);
end $$;
create or replace function extender_franjas_todas() returns void language plpgsql security definer set search_path=public as $$
declare r record; begin for r in select id from courts where activo loop perform _gen(r.id,14,false); end loop; end $$;
revoke execute on function _gen(int,int,boolean), extender_franjas_todas() from public, anon, authenticated;
select cron.schedule('extender-franjas','0 8 * * *',$$select extender_franjas_todas()$$);  -- 08:00 UTC = 03:00 Bogotá

-- 9) Bloquear / desbloquear horas (dueño, encargado o admin). Las franjas con reserva viva no se bloquean.
create or replace function bloquear_franjas(p_court int,p_desde_fecha date,p_hasta_fecha date,p_desde int,p_hasta int,p_motivo text,p_bloquear boolean)
returns int language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if not can_manage(p_court) then raise exception 'No autorizado'; end if;
  if p_hasta_fecha<p_desde_fecha or p_hasta<=p_desde then raise exception 'Rango inválido'; end if;
  update slots s set bloqueada=p_bloquear, motivo_bloqueo=case when p_bloquear then left(p_motivo,100) end
   where s.court_id=p_court and s.fecha between p_desde_fecha and p_hasta_fecha
     and extract(hour from s.hora_inicio)>=p_desde and extract(hour from s.hora_inicio)<p_hasta
     and (not p_bloquear or not exists(select 1 from bookings b where b.slot_id=s.id and b.estado<>'cancelada'));
  get diagnostics n=row_count; return n;
end $$;

-- 10) Reservas semanales repetidas (la misma hora, misma cancha, N semanas)
create or replace function reservar_serie(p_slot bigint,p_semanas int) returns int language plpgsql security definer set search_path=public as $$
declare s slots; i int; n int:=0; sid bigint;
begin
  if coalesce(my_role(),'')<>'jugador' then raise exception 'Solo los jugadores reservan'; end if;
  if p_semanas<1 or p_semanas>8 then raise exception 'Elige entre 1 y 8 semanas'; end if;
  select * into s from slots where id=p_slot; if not found then raise exception 'Franja no disponible'; end if;
  for i in 0..p_semanas-1 loop
    sid:=null; select id into sid from slots where court_id=s.court_id and hora_inicio=s.hora_inicio and fecha=s.fecha+7*i;
    if sid is null then continue; end if;
    begin insert into bookings(slot_id,player_id) values(sid,auth.uid()); n:=n+1;
    exception when others then if i=0 then raise; end if; end;
  end loop;
  return n;
end $$;

-- 11) Encargados de cancha: los asigna el dueño de esa cancha (o el admin)
create or replace function asignar_staff(p_court int,p_email text,p_activar boolean default true) returns text
language plpgsql security definer set search_path=public as $$
declare c courts; uid uuid; pr text;
begin
  select * into c from courts where id=p_court; if not found then raise exception 'La cancha no existe'; end if;
  if not (my_role()='admin' or c.encargado_id=auth.uid()) then raise exception 'No autorizado'; end if;
  select id into uid from auth.users where lower(email)=lower(trim(p_email));
  if uid is null then raise exception 'No existe un usuario con ese correo (debe registrarse primero)'; end if;
  select rol into pr from profiles where id=uid;
  perform set_config('app.bypass','1',true);
  if p_activar then
    if pr in ('admin','encargado') then raise exception 'Ese usuario ya es administrador o dueño'; end if;
    insert into court_staff values(p_court,uid) on conflict do nothing;
    update profiles set rol='staff' where id=uid;
  else
    delete from court_staff where court_id=p_court and user_id=uid;
    if pr='staff' and not exists(select 1 from court_staff where user_id=uid) then update profiles set rol='jugador' where id=uid; end if;
  end if;
  perform set_config('app.bypass','',true);
  return 'ok';
end $$;

-- 12) Árbol dueño → cancha → encargados (admin ve todo; dueño solo lo suyo)
create or replace function equipo() returns table(dueno_id uuid,dueno text,dueno_email text,court_id int,cancha text,staff_id uuid,staff text,staff_email text)
language sql stable security definer set search_path=public as $$
  select p.id,p.nombres,u.email::text,c.id,c.nombre,sp.id,sp.nombres,su.email::text
  from courts c join profiles p on p.id=c.encargado_id join auth.users u on u.id=p.id
  left join court_staff cs on cs.court_id=c.id left join profiles sp on sp.id=cs.user_id left join auth.users su on su.id=cs.user_id
  where my_role()='admin' or c.encargado_id=auth.uid() order by 2,5 $$;

-- 13) Gestión de usuarios (solo admin)
create or replace function listar_usuarios() returns table(id uuid,nombres text,email text,rol text,activo boolean,created_at timestamptz,bloqueado_hasta timestamptz,n_canchas bigint)
language sql stable security definer set search_path=public as $$
  select p.id,p.nombres,u.email::text,p.rol,p.activo,p.created_at,p.bloqueado_hasta,(select count(*) from courts c where c.encargado_id=p.id)
  from profiles p join auth.users u on u.id=p.id where my_role()='admin' order by p.created_at desc $$;
create or replace function set_usuario_activo(p_id uuid,p_activo boolean) returns text language plpgsql security definer set search_path=public as $$
begin
  if coalesce(my_role(),'')<>'admin' then raise exception 'Solo el administrador'; end if;
  if p_id=auth.uid() then raise exception 'No puedes desactivarte a ti mismo'; end if;
  update profiles set activo=p_activo where id=p_id; return 'ok';
end $$;

-- 14) Derecho de supresión: anonimiza el perfil, cancela reservas futuras e inhabilita el acceso (se conserva el historial de reservas sin datos personales)
create or replace function eliminar_mi_cuenta() returns text language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'Sin sesión'; end if;
  if my_role()='admin' then raise exception 'El administrador no puede eliminarse desde la app'; end if;
  if exists(select 1 from courts where encargado_id=uid and activo) then raise exception 'Primero desactiva tus canchas'; end if;
  perform set_config('app.bypass','1',true);
  update bookings set estado='cancelada' where player_id=uid and estado in ('reservada','confirmada');
  delete from court_staff where user_id=uid; delete from waitlist where player_id=uid; delete from notificaciones where user_id=uid;
  update profiles set nombres='Usuario eliminado',documento=null,telefono=null,activo=false where id=uid;
  perform set_config('app.bypass','',true);
  update auth.users set email='eliminado-'||uid||'@invalid.local',encrypted_password='',raw_user_meta_data='{}'::jsonb,banned_until='infinity' where id=uid;
  return 'ok';
end $$;

-- 15) Vistas
drop view if exists v_disponibilidad, v_indicadores, v_agenda;
create view v_disponibilidad as
select s.id slot_id,s.fecha,s.hora_inicio,s.hora_fin,c.id court_id,c.nombre cancha,c.precio_hora,c.zona,c.direccion,c.descripcion,
       c.foto_url,c.mapa_url,c.horas_cancelacion,sp.id sport_id,sp.nombre deporte,
       (select round(avg(r.estrellas),1) from ratings r join bookings b on b.id=r.booking_id join slots s2 on s2.id=b.slot_id where s2.court_id=c.id) promedio
from slots s join courts c on c.id=s.court_id join sports sp on sp.id=c.sport_id
where s.activo and not s.bloqueada and c.activo and s.fecha+s.hora_inicio > now() at time zone 'America/Bogota'
  and not exists(select 1 from bookings b where b.slot_id=s.id and b.estado<>'cancelada');
create view v_ocupadas as
select s.id slot_id,s.fecha,s.hora_inicio,s.hora_fin,c.id court_id,c.nombre cancha,c.zona,c.precio_hora,sp.id sport_id
from slots s join courts c on c.id=s.court_id join sports sp on sp.id=c.sport_id
where s.activo and c.activo and s.fecha+s.hora_inicio > now() at time zone 'America/Bogota'
  and exists(select 1 from bookings b where b.slot_id=s.id and b.estado<>'cancelada');
create view v_agenda as
select b.id,b.estado,b.precio_cop,s.fecha,s.hora_inicio,s.hora_fin,c.id court_id,c.nombre cancha,sp.nombre deporte,p.nombres cliente,p.telefono
from bookings b join slots s on s.id=b.slot_id join courts c on c.id=s.court_id join sports sp on sp.id=c.sport_id join profiles p on p.id=b.player_id
where can_manage(c.id);
create view v_indicadores as
select sp.nombre deporte,c.nombre cancha,b.estado,date_trunc('month',s.fecha)::date mes,count(*) total,
       coalesce(sum(b.precio_cop) filter (where b.estado in ('confirmada','jugada')),0) ingresos
from bookings b join slots s on s.id=b.slot_id join courts c on c.id=s.court_id join sports sp on sp.id=c.sport_id
where can_manage(c.id) group by 1,2,3,4;
create view v_stats as   -- una fila por reserva, para los gráficos
select c.id court_id,c.nombre cancha,s.fecha,extract(hour from s.hora_inicio)::int hora,b.estado,coalesce(b.precio_cop,0) precio
from bookings b join slots s on s.id=b.slot_id join courts c on c.id=s.court_id where can_manage(c.id);
create view v_capacidad as   -- ocupación: franjas activas de los últimos 30 días en adelante vs. reservadas
select c.id court_id,c.nombre cancha,count(s.id) franjas,count(b.id) reservadas
from courts c join slots s on s.court_id=c.id and s.activo and not s.bloqueada and s.fecha>=current_date-30
left join bookings b on b.slot_id=s.id and b.estado<>'cancelada'
where can_manage(c.id) group by 1,2;
grant select on v_disponibilidad,v_ocupadas,v_agenda,v_indicadores,v_stats,v_capacidad to authenticated;

-- 16) Permisos de funciones
revoke execute on function bloquear_franjas(int,date,date,int,int,text,boolean), reservar_serie(bigint,int), asignar_staff(int,text,boolean),
  equipo(), listar_usuarios(), set_usuario_activo(uuid,boolean), eliminar_mi_cuenta() from public, anon;
grant execute on function bloquear_franjas(int,date,date,int,int,text,boolean), reservar_serie(bigint,int), asignar_staff(int,text,boolean),
  equipo(), listar_usuarios(), set_usuario_activo(uuid,boolean), eliminar_mi_cuenta() to authenticated;
