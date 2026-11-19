-- Pruebas automáticas de las reglas de reserva. Ejecutar en el SQL Editor; al final hace ROLLBACK (no deja datos).
-- Resultado: mensajes "PASA"/"FALLA" en la pestaña Messages/Notices.
begin;
insert into auth.users(id,email,raw_user_meta_data,aud,role) values
 ('aaaaaaaa-0000-0000-0000-000000000001','t_j1@test.local','{"nombres":"Jugador Uno","acepta_terminos":"true"}','authenticated','authenticated'),
 ('aaaaaaaa-0000-0000-0000-000000000002','t_j2@test.local','{"nombres":"Jugador Dos","acepta_terminos":"true"}','authenticated','authenticated'),
 ('aaaaaaaa-0000-0000-0000-000000000003','t_dueno@test.local','{"nombres":"Dueno Test","acepta_terminos":"true"}','authenticated','authenticated');
update profiles set rol='encargado' where id='aaaaaaaa-0000-0000-0000-000000000003';
insert into sports(nombre) values('TestDeporte');
insert into courts(nombre,sport_id,encargado_id,precio_hora) select 'Cancha Test',id,'aaaaaaaa-0000-0000-0000-000000000003',10000 from sports where nombre='TestDeporte';
insert into slots(court_id,fecha,hora_inicio,hora_fin) select c.id,current_date+3,'10:00','11:00' from courts c where nombre='Cancha Test';
insert into slots(court_id,fecha,hora_inicio,hora_fin) select c.id,current_date-1,'10:00','11:00' from courts c where nombre='Cancha Test';
insert into slots(court_id,fecha,hora_inicio,hora_fin)   -- franja que empieza en ~1 hora (falla si cruza medianoche)
  select c.id,t::date,t::time,t::time+interval '1 hour' from courts c,
  (select date_trunc('hour',now() at time zone 'America/Bogota')+interval '1 hour' t) x where nombre='Cancha Test';

create function pg_temp.t(caso text,u uuid,q text,debe_fallar boolean) returns void language plpgsql as $f$
declare fallo boolean:=false; m text;
begin
  perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin execute q; exception when others then fallo:=true; m:=sqlerrm; end;
  execute 'reset role';
  raise notice '% | % %',case when fallo=debe_fallar then 'PASA ' else 'FALLA' end,caso,coalesce('('||m||')','');
end $f$;

select pg_temp.t('CP-01 jugador reserva franja libre','aaaaaaaa-0000-0000-0000-000000000001',
  $q$insert into bookings(slot_id,player_id) select id,'aaaaaaaa-0000-0000-0000-000000000001' from slots where fecha=current_date+3$q$,false);
select pg_temp.t('CP-02 segunda reserva de la misma franja','aaaaaaaa-0000-0000-0000-000000000002',
  $q$insert into bookings(slot_id,player_id) select id,'aaaaaaaa-0000-0000-0000-000000000002' from slots where fecha=current_date+3$q$,true);
select pg_temp.t('CP-06 franja pasada','aaaaaaaa-0000-0000-0000-000000000002',
  $q$insert into bookings(slot_id,player_id) select id,'aaaaaaaa-0000-0000-0000-000000000002' from slots where fecha=current_date-1$q$,true);
select pg_temp.t('CP-09 jugador se sube a admin','aaaaaaaa-0000-0000-0000-000000000001',
  $q$update profiles set rol='admin' where id='aaaaaaaa-0000-0000-0000-000000000001'$q$,true);
select pg_temp.t('CP-11 jugador marca jugada','aaaaaaaa-0000-0000-0000-000000000001',
  $q$update bookings set estado='jugada' where player_id='aaaaaaaa-0000-0000-0000-000000000001'$q$,true);
select pg_temp.t('CP-03 otro jugador no ve reservas ajenas','aaaaaaaa-0000-0000-0000-000000000002',
  $q$do $x$ begin if exists(select 1 from bookings) then raise exception 've reservas ajenas'; end if; end $x$$q$,false);
select pg_temp.t('Dueño confirma reserva de su cancha','aaaaaaaa-0000-0000-0000-000000000003',
  $q$do $x$ begin update bookings set estado='confirmada'; if not found then raise exception 'no la ve'; end if; end $x$$q$,false);
select pg_temp.t('CP-07 cancelar con menos de 2 h','aaaaaaaa-0000-0000-0000-000000000002',
  $q$do $x$ begin
     insert into bookings(slot_id,player_id) select id,'aaaaaaaa-0000-0000-0000-000000000002' from slots where fecha=(now() at time zone 'America/Bogota')::date and hora_inicio>(now() at time zone 'America/Bogota')::time;
     update bookings set estado='cancelada' where player_id='aaaaaaaa-0000-0000-0000-000000000002'; end $x$$q$,true);
rollback;
