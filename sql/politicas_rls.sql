create or replace function my_role() returns text language sql stable security definer set search_path=public as
$$ select rol from profiles where id=auth.uid() and activo $$;

-- Perfil automático al registrarse: SIEMPRE rol jugador
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path=public as
$$ begin insert into profiles(id,nombres) values(new.id, coalesce(new.raw_user_meta_data->>'nombres','Usuario')); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create or replace function guard_profile() returns trigger language plpgsql as
$$ begin if new.rol<>old.rol and coalesce(my_role(),'')<>'admin' then raise exception 'No autorizado a cambiar el rol'; end if; return new; end $$;
create trigger t_guard_profile before update on profiles for each row execute function guard_profile();

-- Reglas de negocio en la BD: fecha futura, transiciones válidas, cancelación con 2 h de anticipación
create or replace function guard_booking() returns trigger language plpgsql security definer set search_path=public as $$
declare s slots; r text:=my_role(); inicio timestamp; ahora timestamp:=now() at time zone 'America/Bogota';
begin
  if tg_op='INSERT' then
    select * into s from slots where id=new.slot_id and activo;
    if not found then raise exception 'Franja no disponible'; end if;
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
create trigger t_guard_booking before insert or update on bookings for each row execute function guard_booking();

create or replace function freeze_booking() returns trigger language plpgsql as
$$ begin if new.player_id<>old.player_id or new.slot_id<>old.slot_id then raise exception 'Campos no modificables'; end if; return new; end $$;
create trigger t_freeze before update on bookings for each row execute function freeze_booking();

alter table profiles enable row level security; alter table sports enable row level security;
alter table courts enable row level security;   alter table slots enable row level security;
alter table bookings enable row level security; alter table status_history enable row level security;

create policy p_sel on profiles for select using (id=auth.uid() or my_role()='admin');
create policy p_upd on profiles for update using (id=auth.uid() or my_role()='admin') with check (id=auth.uid() or my_role()='admin');
create policy sp_sel on sports for select to authenticated using (true);
create policy sp_all on sports for all using (my_role()='admin') with check (my_role()='admin');
create policy c_sel on courts for select to authenticated using (true);
create policy c_all on courts for all using (my_role()='admin') with check (my_role()='admin');
create policy s_sel on slots for select to authenticated using (true);
create policy s_all on slots for all
  using (my_role()='admin' or exists(select 1 from courts c where c.id=court_id and c.encargado_id=auth.uid()))
  with check (my_role()='admin' or exists(select 1 from courts c where c.id=court_id and c.encargado_id=auth.uid()));
create policy b_sel on bookings for select using (
  player_id=auth.uid() or my_role()='admin'
  or exists(select 1 from slots s join courts c on c.id=s.court_id where s.id=slot_id and c.encargado_id=auth.uid()));
create policy b_ins on bookings for insert with check (my_role() in ('jugador','admin') and (player_id=auth.uid() or my_role()='admin'));
create policy b_upd on bookings for update using (
  player_id=auth.uid() or my_role()='admin'
  or exists(select 1 from slots s join courts c on c.id=s.court_id where s.id=slot_id and c.encargado_id=auth.uid()));
create policy h_sel on status_history for select using (my_role()='admin'
  or exists(select 1 from bookings b where b.id=booking_id and b.player_id=auth.uid()));

-- Vistas: disponibilidad sin datos personales e indicadores solo para admin
create view v_disponibilidad as
select s.id slot_id,s.fecha,s.hora_inicio,s.hora_fin,c.nombre cancha,c.precio_hora,sp.id sport_id,sp.nombre deporte
from slots s join courts c on c.id=s.court_id join sports sp on sp.id=c.sport_id
where s.activo and c.activo and s.fecha+s.hora_inicio > now() at time zone 'America/Bogota'
  and not exists(select 1 from bookings b where b.slot_id=s.id and b.estado<>'cancelada');
create view v_indicadores as
select sp.nombre deporte,b.estado,date_trunc('month',s.fecha)::date mes,count(*) total
from bookings b join slots s on s.id=b.slot_id join courts c on c.id=s.court_id join sports sp on sp.id=c.sport_id
where my_role()='admin' group by 1,2,3;
grant select on v_disponibilidad,v_indicadores to authenticated;
