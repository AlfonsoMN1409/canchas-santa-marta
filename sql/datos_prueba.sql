-- Datos ficticios. Cree los usuarios en Authentication > Users y luego promueva roles:
-- update profiles set rol='admin' where id='<uuid-admin>';
-- update profiles set rol='encargado' where id='<uuid-encargado>'; update courts set encargado_id='<uuid-encargado>' where id=1;
insert into sports(nombre) values ('Fútbol 5'),('Pádel'),('Baloncesto');
insert into courts(nombre,sport_id,precio_hora) values
 ('Cancha Rodadero 1',1,90000),('Cancha Rodadero 2',1,90000),('Pádel Centro A',2,60000),('Coliseo Taganga',3,70000);
insert into slots(court_id,fecha,hora_inicio,hora_fin)
select c.id,d::date,h::time,h::time+interval '1 hour'
from courts c, generate_series(current_date,current_date+6,'1 day') d, generate_series('2000-01-01 18:00'::timestamp,'2000-01-01 21:00','1 hour') h;
