# Canchas Santa Marta — MVP de reserva de canchas deportivas



## Descripción
Sistema web que centraliza la agenda de canchas: los jugadores reservan y cancelan, los encargados gestionan la asistencia de sus canchas y el administrador consulta indicadores. Tecnologías: HTML5, CSS3, JavaScript, GitHub Pages y Supabase (Auth, PostgreSQL, RLS).

## Enlace publicado
(https://alfonsomn1409.github.io/canchas-santa-marta/)

## Roles
- **Jugador**: se registra solo (con cédula, celular y aceptación de términos), busca, reserva y cancela.
- **Dueño de cancha** (rol `encargado` en la BD): crea **sus** canchas con horario semanal y precio por hora, ve y gestiona solo las reservas de sus canchas. No ve nada de otros dueños.
- **Administrador**: ve y gestiona todo, da o quita el rol de dueño por correo y agrega deportes.

## Estructura
`index.html` · `assets/css` · `assets/img` · `assets/js` · `sql` · `docs`

## Decisiones técnicas
- Doble reserva: índice único parcial en `bookings(slot_id)` donde estado ≠ cancelada; cancelar cambia el estado y libera la franja.
- Reglas (transiciones válidas, fecha futura, cancelación con 2 h de anticipación) en triggers, no solo en la interfaz.
- RLS habilitado en todas las tablas; roles y estados con CHECK.
- Los datos de la BD se pintan con `textContent`.
- Aislamiento por dueño: políticas RLS por cancha y vistas `v_agenda` / `v_indicadores` filtradas por `auth.uid()`; el dueño ve solo nombre y celular del cliente (nunca la cédula).
- Franjas de 1 hora generadas por la función `generar_franjas` según el horario de la cancha; cada reserva guarda el precio vigente.
- Consentimiento: la BD rechaza registros sin aceptar términos y guarda la fecha de aceptación; cédula y celular se validan con CHECK.
- La clave publishable es pública por diseño; no hay secretos en el repositorio.

## Funcionalidades pendientes 
- Las franjas se generan para 14 días; hay que pulsar *Generar próximos 14 días* para extender (no hay tarea automática).
- Sin edición de perfil, pagos ni notificaciones. El texto de términos es una plantilla que el equipo debe revisar.
- Un dueño no puede transferir su cancha a otro dueño desde la interfaz.
