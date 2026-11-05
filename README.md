# Canchas Santa Marta — MVP de reserva de canchas deportivas
Proyecto integrador de Análisis y Diseño de Software.

## Integrantes
CBC · BCB

## Descripción
Sistema web que centraliza la agenda de canchas: los jugadores reservan y cancelan, los encargados gestionan la asistencia de sus canchas y el administrador consulta indicadores. Tecnologías: HTML5, CSS3, JavaScript, GitHub Pages y Supabase (Auth, PostgreSQL, RLS).

## Enlace publicado
(pegar aquí la URL de GitHub Pages)

## Credenciales de demostración (datos ficticios)
| Rol | Correo | Contraseña |
|---|---|---|
| Jugador | p1@prueba.com | 12345678 |
| Jugador | p2@prueba.com | 12345678 |
| Encargado (canchas 1 y 2) | encargado@prueba.com | 12345678 |
| Administrador | admin@prueba.com | 12345678 |

## Instalación (reproducir la base de datos)
1. Cree un proyecto en Supabase y, en el SQL Editor, ejecute en orden: `sql/esquema.sql`, `sql/politicas_rls.sql`, `sql/datos_prueba.sql`.
2. En Authentication > Users cree los 4 usuarios de la tabla (con *Auto Confirm*).
3. Ejecute la actualización de `guard_profile` (ver `sql/ajustes_post_instalacion.sql`) y luego los `update` de roles de ese mismo archivo.
4. Edite `assets/js/config.js` con su URL y su clave pública (anon/publishable). **Nunca** use la service_role.
5. Abra `index.html` o publique con GitHub Pages.

## Estructura
`index.html` · `assets/css` · `assets/js` · `sql` · `docs`

## Decisiones técnicas
- Doble reserva: índice único parcial en `bookings(slot_id)` donde estado ≠ cancelada; cancelar cambia el estado y libera la franja.
- Reglas (transiciones válidas, fecha futura, cancelación con 2 h de anticipación) en triggers, no solo en la interfaz.
- RLS habilitado en todas las tablas; roles y estados con CHECK.
- Los datos de la BD se pintan con `textContent`.
- La clave publishable es pública por diseño; no hay secretos en el repositorio.

## Funcionalidades pendientes (declaradas con honestidad)
- No hay pantallas para crear/editar deportes, canchas y franjas: se hace con SQL o Table Editor. (Actualizar esta línea si se implementan.)
- Sin edición de perfil en la interfaz, pagos ni notificaciones.
