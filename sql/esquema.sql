-- Reserva de canchas deportivas · esquema reproducible (Supabase / PostgreSQL)
create extension if not exists btree_gist;

create table profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  nombres text not null check (length(trim(nombres))>=2),
  documento text unique, telefono text,
  rol text not null default 'jugador' check (rol in ('jugador','encargado','admin')),
  activo boolean not null default true,
  created_at timestamptz not null default now());

create table sports(id serial primary key, nombre text not null unique, activo boolean not null default true);

create table courts(
  id serial primary key, nombre text not null,
  sport_id int not null references sports(id),
  encargado_id uuid references profiles(id) on delete set null,
  precio_hora numeric(10,0) not null check (precio_hora>=0),
  activo boolean not null default true);

create table slots(
  id bigserial primary key,
  court_id int not null references courts(id) on delete restrict,
  fecha date not null, hora_inicio time not null, hora_fin time not null,
  activo boolean not null default true,
  check (hora_fin>hora_inicio),
  unique (court_id,fecha,hora_inicio),
  -- impide franjas superpuestas en la misma cancha
  exclude using gist (court_id with =, tsrange(fecha+hora_inicio, fecha+hora_fin) with &&));

create table bookings(
  id bigserial primary key,
  player_id uuid not null references profiles(id) on delete restrict,
  slot_id bigint not null references slots(id) on delete restrict,
  estado text not null default 'reservada'
    check (estado in ('reservada','confirmada','jugada','cancelada','no_asistio')),
  nota text check (length(nota)<=200),
  created_at timestamptz not null default now(), cancelled_at timestamptz);
-- DOBLE RESERVA: una sola reserva viva por franja; cancelar libera la franja (la fila se conserva)
create unique index uq_booking_slot_viva on bookings(slot_id) where estado<>'cancelada';
create index on bookings(player_id); create index on slots(fecha,court_id);

create table status_history(
  id bigserial primary key, booking_id bigint not null references bookings(id) on delete cascade,
  estado_anterior text, estado_nuevo text not null,
  changed_by uuid references auth.users(id), changed_at timestamptz not null default now());
