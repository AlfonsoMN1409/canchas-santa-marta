-- 1) Permite promover roles desde el SQL Editor (sin usuario de la app); la protección sigue activa en la app
create or replace function guard_profile() returns trigger language plpgsql as
$$ begin
  if auth.uid() is not null and new.rol<>old.rol and coalesce(my_role(),'')<>'admin'
  then raise exception 'No autorizado a cambiar el rol'; end if;
  return new;
end $$;
-- 2) Roles de demostración (después de crear los usuarios en Authentication)
update profiles set rol='admin' where id=(select id from auth.users where email='admin@prueba.com');
update profiles set rol='encargado' where id=(select id from auth.users where email='encargado@prueba.com');
update courts set encargado_id=(select id from auth.users where email='encargado@prueba.com') where id in (1,2);
