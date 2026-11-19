-- Solo el catálogo de deportes. Las canchas y horarios los crean los dueños/administradores desde la aplicación.
insert into sports(nombre) values ('Fútbol 5'),('Pádel'),('Baloncesto') on conflict do nothing;
