-- MEJORAS v2 · ejecutar UNA sola vez sobre una base que ya tiene esquema.sql + politicas_rls.sql
-- Incluye: cédula/teléfono/términos, canchas con horario y precio, dueños con permisos limitados.

-- 0) Eliminar la simulación de canchas de prueba (conserva deportes y usuarios)
delete from bookings; delete from slots; delete from courts;

-- 0b) Permite promover roles desde el SQL Editor; la protección sigue activa para cualquier usuario de la app
create or replace function guard_profile() returns trigger language plpgsql as
$$ begin
  if auth.uid() is not null and new.rol<>old.rol and coalesce(my_role(),'')<>'admin'
  then raise exception 'No autorizado a cambiar el rol'; end if;
  return new;
end $$;

-- 1) Perfil: cédula, celular y constancia de aceptación de términos
alter table profiles add column if not exists acepta_terminos_at timestamptz;
alter table profiles add constraint profiles_documento_fmt check (documento is null or documento ~ '^[0-9]{6,10}$');
alter table profiles add constraint profiles_telefono_fmt  check (telefono  is null or telefono  ~ '^3[0-9]{9}$');

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare m jsonb := coalesce(new.raw_user_meta_data,'{}'::jsonb);
begin
  if coalesce(m->>'acepta_terminos','')<>'true' then raise exception 'Debe aceptar los terminos y el tratamiento de datos'; end if;
  insert into profiles(id,nombres,documento,telefono,acepta_terminos_at)
  values(new.id, coalesce(nullif(trim(m->>'nombres'),''),'Usuario'), nullif(m->>'documento',''), nullif(m->>'telefono',''), now());
  return new;
end $$;

-- 2) Canchas: horario semanal y precio por hora; la reserva guarda el precio vigente
alter table courts
  add column if not exists hora_apertura smallint not null default 8  check (hora_apertura between 0 and 22),
  add column if not exists hora_cierre   smallint not null default 22 check (hora_cierre between 1 and 23),
  add column if not exists dias_semana   smallint[] not null default '{0,1,2,3,4,5,6}';
alter table courts add constraint courts_horario_ok check (hora_apertura<hora_cierre);
alter table bookings add column if not exists precio_cop numeric(10,0);

-- 3) Políticas de canchas: cada dueño solo gestiona las suyas; el admin gestiona todas
drop policy if exists c_all on courts;
create policy c_ins on courts for insert with check (my_role()='admin' or (my_role()='encargado' and encargado_id=auth.uid()));
create policy c_upd on courts for update using (my_role()='admin' or encargado_id=auth.uid())
                                         with check (my_role()='admin' or encargado_id=auth.uid());
create policy c_del on courts for delete using (my_role()='admin' or encargado_id=auth.uid());

-- 4) Reservas: ahora guarda precio y exige cancha activa
create or replace function guard_booking() returns trigger language plpgsql security definer set search_path=public as $$
declare s slots; r text:=my_role(); inicio timestamp; ahora timestamp:=now() at time zone 'America/Bogota';
begin
  if tg_op='INSERT' then
    select * into s from slots where id=new.slot_id and activo;
    if not found then raise exception 'Franja no disponible'; end if;
    select precio_hora into new.precio_cop from courts where id=s.court_id and activo;
    if not found then raise exception 'Cancha inactiva'; end if;
    if s.fecha+s.hora_inicio <= ahora then raise exception 'No se puede reservar una franja pasada'; end if;
    new.estado:='reservada';
    if r='jugador' then new.player_id:=auth.uid(); end if;
    return new;
  end if;
  if new.estado=old.estado then return new; end if;
  if not ((old.estado='reservada' and new.estado in ('confirmada','cancelada'))
       or (old.estado='confirmada' and new.estado in ('jugada','cancelada','no_asistio')))
  then raise exception 'Transición % -> % no permitida',old.estado,new.estado; end if;
  if r='jugador' and new.estado<>'cancelada' then raise exception 'El jugador solo puede cancelar'; end if;
  if new.estado='cancelada' then
    select fecha+hora_inicio into inicio from slots where id=old.slot_id;
    if r='jugador' and inicio < ahora + interval '2 hours' then raise exception 'Solo se cancela con 2 horas de anticipación'; end if;
    new.cancelled_at:=now();
  end if;
  insert into status_history(booking_id,estado_anterior,estado_nuevo,changed_by) values(old.id,old.estado,new.estado,auth.uid());
  return new;
end $$;

-- 5) Generador de franjas de 1 hora según el horario de la cancha (solo el dueño de esa cancha o el admin)
create or replace function generar_franjas(p_court int, p_dias int default 14) returns int
language plpgsql security definer set search_path=public as $$
declare c courts; ahora timestamp:=now() at time zone 'America/Bogota'; n int;
begin
  select * into c from courts where id=p_court;
  if not found then raise exception 'La cancha no existe'; end if;
  if not (my_role()='admin' or c.encargado_id=auth.uid()) then raise exception 'No autorizado'; end if;
  if p_dias<1 or p_dias>60 then raise exception 'Elija entre 1 y 60 días'; end if;
  -- franjas futuras sin ninguna reserva: se rehacen según el horario nuevo
  delete from slots s where s.court_id=c.id and s.fecha+s.hora_inicio>ahora
    and not exists(select 1 from bookings b where b.slot_id=s.id);
  -- las que conservan historial se activan/desactivan según el horario nuevo
  update slots s set activo=(extract(dow from s.fecha)::int = any(c.dias_semana)
      and extract(hour from s.hora_inicio)>=c.hora_apertura and extract(hour from s.hora_inicio)<c.hora_cierre)
    where s.court_id=c.id and s.fecha+s.hora_inicio>ahora;
  insert into slots(court_id,fecha,hora_inicio,hora_fin)
  select c.id,d::date,make_time(h,0,0),make_time(h,0,0)+interval '1 hour'
  from generate_series(ahora::date::timestamp, (ahora::date+p_dias-1)::timestamp, interval '1 day') d,
       generate_series(c.hora_apertura::int, c.hora_cierre::int-1) h
  where extract(dow from d)::int = any(c.dias_semana) and d::date+make_time(h,0,0) > ahora
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- 6) El administrador convierte a un usuario ya registrado en dueño de cancha (o le quita el rol)
create or replace function promover_dueno(p_email text, p_activar boolean default true) returns text
language plpgsql security definer set search_path=public as $$
declare uid uuid;
begin
  if coalesce(my_role(),'')<>'admin' then raise exception 'Solo el administrador puede hacerlo'; end if;
  select id into uid from auth.users where lower(email)=lower(trim(p_email));
  if uid is null then raise exception 'No existe un usuario con ese correo (debe registrarse primero)'; end if;
  if exists(select 1 from profiles where id=uid and rol='admin') then raise exception 'Ese usuario es administrador'; end if;
  update profiles set rol=case when p_activar then 'encargado' else 'jugador' end where id=uid;
  return 'ok';
end $$;
revoke execute on function generar_franjas(int,int), promover_dueno(text,boolean) from public, anon;
grant  execute on function generar_franjas(int,int), promover_dueno(text,boolean) to authenticated;

-- 7) Vistas: cada dueño ve SOLO lo de sus canchas; el admin ve todo. Datos de contacto mínimos (sin cédula).
drop view if exists v_indicadores;
create view v_indicadores as
select sp.nombre deporte,c.nombre cancha,b.estado,date_trunc('month',s.fecha)::date mes,count(*) total,
       coalesce(sum(b.precio_cop) filter (where b.estado in ('confirmada','jugada')),0) ingresos
from bookings b join slots s on s.id=b.slot_id join courts c on c.id=s.court_id join sports sp on sp.id=c.sport_id
where my_role()='admin' or c.encargado_id=auth.uid()
group by 1,2,3,4;

create view v_agenda as
select b.id,b.estado,b.precio_cop,s.fecha,s.hora_inicio,s.hora_fin,c.id court_id,c.nombre cancha,sp.nombre deporte,
       p.nombres cliente,p.telefono
from bookings b join slots s on s.id=b.slot_id join courts c on c.id=s.court_id
     join sports sp on sp.id=c.sport_id join profiles p on p.id=b.player_id
where my_role()='admin' or c.encargado_id=auth.uid();
grant select on v_indicadores, v_agenda to authenticated;
