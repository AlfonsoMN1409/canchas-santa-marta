# Sistema web de reserva de canchas deportivas — Análisis y diseño
Caso ficticio: **Canchas Santa Marta**, red de 4 canchas (fútbol 5, pádel, baloncesto) en Rodadero, Centro y Taganga. Datos 100 % ficticios.

## 1. Problema, objetivos y alcance
**Problema.** Las reservas se hacen por WhatsApp, llamadas y un cuaderno por sede. Causas: no hay agenda central, cada encargado lleva su registro. Efectos: dobles reservas, jugadores sin confirmar, canchas vacías por cancelaciones tardías, sin cifras para decidir. Afectados: jugadores, encargados y administración.
**Objetivo general.** Centralizar la agenda de canchas en un MVP web seguro que permita reservar, consultar, cancelar y administrar reservas.
**Objetivos específicos (medibles).**
1. Reducir a 0 las dobles reservas mediante una restricción única en la BD.
2. Permitir reservar en máximo 5 pasos tras iniciar sesión.
3. Aplicar RLS en el 100 % de las tablas con pruebas de acceso negativo.
4. Mostrar indicadores de reservas por estado, deporte y mes.
**Alcance.** Registro/login, catálogo, franjas por hora, búsqueda, reserva, cancelación, panel de encargado, panel admin, indicadores. **Fuera del MVP:** pagos en línea, notificaciones, torneos, múltiples franjas por reserva. **Restricciones:** HTML/CSS/JS, GitHub Pages, Supabase. **Supuestos:** franjas de 1 h; zona horaria America/Bogota. **Éxito:** los 15 casos de prueba pasan.

## 2. Actores
| Actor | Necesidad | Permiso | Dato usado |
|---|---|---|---|
| Jugador | Reservar sin llamar | Crear/ver/cancelar sus reservas; ver disponibilidad | Nombre, teléfono |
| Encargado | Ver su agenda y marcar asistencia | Ver y cambiar estado de reservas de sus canchas | Reservas de su cancha |
| Administrador | Gestionar catálogos y medir | CRUD de catálogos y franjas; indicadores | Todo agregado |

## 3. Proceso
**AS IS:** jugador escribe por WhatsApp → encargado revisa cuaderno → responde manualmente → anota → sin confirmación ni cancelación registrada (cruces frecuentes).
**TO BE:** jugador inicia sesión → filtra deporte y fecha → ve solo franjas libres → confirma → la BD crea una reserva única → encargado confirma y luego marca jugada/no asistió → admin consulta indicadores. *(Dibujar ambos como diagrama de actividades.)*

## 4. Requisitos funcionales (prioridad A/M)
| ID | Requisito | Actor | Pri. | Criterio de aceptación |
|---|---|---|---|---|
| RF-01 | Registro con correo y contraseña | Jugador | A | Cuenta creada con perfil rol jugador |
| RF-02 | Inicio y cierre de sesión | Todos | A | Sesión válida; sin sesión no ve datos |
| RF-03 | Editar perfil propio | Jugador | M | Solo modifica su fila |
| RF-04 | Ver catálogo de deportes y canchas | Todos | A | Lista solo activos |
| RF-05 | Buscar disponibilidad por deporte y fecha | Jugador | A | Solo franjas libres y futuras |
| RF-06 | Reservar una franja libre | Jugador | A | Se crea una sola reserva y la franja deja de aparecer |
| RF-07 | Ver "Mis reservas" | Jugador | A | Muestra fecha, hora, cancha, deporte, estado |
| RF-08 | Cancelar con ≥2 h de anticipación | Jugador | A | Antes de 2 h se rechaza; libera la franja |
| RF-09 | Ver agenda de mis canchas | Encargado | A | No retorna reservas de otras canchas |
| RF-10 | Cambiar estado con transiciones válidas | Encargado | A | Transición inválida rechazada |
| RF-11 | Crear/editar/desactivar deportes | Admin | M | Cambios reflejados en el catálogo |
| RF-12 | Crear/editar/desactivar canchas y asignar encargado | Admin | M | Encargado ve la cancha asignada |
| RF-13 | Publicar franjas horarias | Admin/Encargado | A | No permite franjas superpuestas |
| RF-14 | Indicadores por estado, deporte y mes | Admin | M | Totales coinciden con la BD |
| RF-15 | Historial de cambios de estado | Admin | M | Cada cambio guarda quién y cuándo |

## 5. Requisitos no funcionales
| ID | Categoría | Verificable |
|---|---|---|
| RNF-01 | Seguridad | RLS habilitado en las 6 tablas, con políticas por rol |
| RNF-02 | Seguridad | Ninguna service_role key en el repo; solo anon |
| RNF-03 | Rendimiento | Búsqueda de un día responde en ≤3 s con 500 franjas |
| RNF-04 | Usabilidad | Reservar en ≤5 pasos tras iniciar sesión |
| RNF-05 | Compatibilidad | Últimas 2 versiones de Chrome y Firefox |
| RNF-06 | Accesibilidad | Etiquetas asociadas a controles, navegación por teclado, contraste ≥4.5:1 |
| RNF-07 | Mantenibilidad | JS separado de HTML; sin nombres genéricos |
| RNF-08 | Disponibilidad | Mensajes claros ante error de red; sin pantallas en blanco |
| RNF-09 | Responsive | Sin scroll horizontal en 360 px |

## 6. Casos de uso (a detallar con precondición, flujo, alternativas, excepciones y postcondición)
CU-01 Registrarse · CU-02 Iniciar sesión · CU-03 Buscar disponibilidad · CU-04 Reservar cancha · CU-05 Cancelar reserva · CU-06 Gestionar agenda del encargado · CU-07 Administrar catálogo y franjas · CU-08 Consultar indicadores.
*Ejemplo CU-04:* Pre: jugador autenticado y franjas publicadas. Flujo: busca → elige franja → confirma → se crea reserva. Excepción: otra persona reservó antes → el sistema informa el conflicto (error 23505) y recarga la lista. Post: reserva vinculada al jugador y franja no disponible.

## 7. Arquitectura
Navegador (HTML/CSS/JS en GitHub Pages) → API de Supabase (PostgREST + Auth, con la clave anon) → PostgreSQL (restricciones, triggers y RLS). El frontend **no** es una barrera de seguridad: toda regla crítica vive en la BD. *(Dibujar el diagrama.)*
**Navegación:** Jugador: Buscar · Mis reservas. Encargado: Agenda. Admin: Indicadores · Reservas. **Estados de UI** implementados: cargando, vacío, error, éxito.

## 8. Modelo de datos (ver `sql/esquema.sql`)
profiles(1)—(N)bookings; sports(1)—(N)courts; courts(1)—(N)slots; slots(1)—(0..1 viva)bookings; bookings(1)—(N)status_history.
**Decisiones:** (a) cancelar **cambia el estado** y conserva la fila; el índice único parcial `uq_booking_slot_viva` libera la franja. (b) Roles y estados con CHECK. (c) Borrado: RESTRICT en franjas y jugadores con reservas; CASCADE solo en historial; desactivación lógica con `activo`. (d) `auth.users` separado de `profiles` por UUID.
**Si el administrador cambia una franja con reserva:** se desactiva (`activo=false`) y la reserva se gestiona manualmente; no se borra.

## 9. Seguridad: matriz rol × recurso
| Recurso | Jugador | Encargado | Admin |
|---|---|---|---|
| profiles | S/U propio | S/U propio | S/U todos |
| sports, courts | S | S | S/I/U/D |
| slots | S | S/I/U/D de sus canchas | S/I/U/D |
| bookings | S/I propias; U solo a "cancelada" propia | S/U de sus canchas | S/I/U |
| status_history | S propias | — | S |
| v_indicadores | — | — | S |

## 10. Riesgos
| Riesgo | Prob. | Impacto | Prevención / respuesta |
|---|---|---|---|
| Doble reserva concurrente | Media | Alto | Índice único parcial; el cliente maneja el conflicto |
| Escalada de rol | Baja | Alto | Trigger `guard_profile`; el signup siempre crea "jugador" |
| Fuga de service_role key | Baja | Alto | Solo anon; `.gitignore`; revisar historial de commits |
| Inasistencia sin registro | Alta | Medio | Estado `no_asistio` y reporte |

## 11. Plan de pruebas (15 casos; ejecutar y anotar resultado obtenido)
| ID | Escenario | Esperado | Req. |
|---|---|---|---|
| CP-01 | Jugador reserva franja libre | Una reserva; franja desaparece | RF-06 |
| CP-02 | Dos sesiones reservan la misma franja | Una se confirma; la otra recibe conflicto controlado | RF-06 |
| CP-03 | Jugador cambia el ID para ver reserva ajena | RLS no devuelve datos | RNF-01 |
| CP-04 | Encargado actualiza reserva de otra cancha | Rechazado | RF-09 |
| CP-05 | Pantalla 360 px | Sin scroll horizontal | RNF-09 |
| CP-06 | Reservar franja pasada (vía API) | Error "franja pasada" | RF-06 |
| CP-07 | Cancelar con <2 h | Rechazado | RF-08 |
| CP-08 | Cancelar con >2 h | Estado cancelada; franja vuelve a aparecer | RF-08 |
| CP-09 | Jugador intenta pasar su rol a admin | Rechazado | RNF-01 |
| CP-10 | Transición cancelada → confirmada | Rechazada | RF-10 |
| CP-11 | Jugador intenta marcar "jugada" | Rechazado | RF-10 |
| CP-12 | Franja superpuesta | Error por exclusión | RF-13 |
| CP-13 | Jugador consulta v_indicadores | Sin datos/denegado | RF-14 |
| CP-14 | Lista vacía y error de red | Mensaje claro | RNF-08 |
| CP-15 | Navegación por teclado y etiquetas | Formularios operables | RNF-06 |

## 12. Trazabilidad (muestra; completar para todos los RF de prioridad A)
| Necesidad | Req. | Diseño | Implementación | Prueba |
|---|---|---|---|---|
| Evitar cruces | RF-06 | CU-04 | `uq_booking_slot_viva`, `guard_booking` | CP-01, CP-02, CP-06 |
| Privacidad | RF-07 | CU-05 | policy `b_sel` | CP-03 |
| Reducir no shows | RF-08 | CU-05 | `guard_booking` (2 h) | CP-07, CP-08 |

## 13. Pendientes que debe completar el equipo
Comparar **dos plataformas reales** de reserva (con enlace y fecha de consulta; no las inventé), dibujar los diagramas (AS IS/TO BE, casos de uso, arquitectura, ER, wireframes), ejecutar las pruebas con capturas, desplegar en GitHub Pages y registrar la bitácora de IA.

## 14. Bitácora de fuentes e IA
| Fecha | Herramienta | Propósito | Qué se usó | Cómo se verificó |
|---|---|---|---|---|
| (fecha) | Claude | Propuesta inicial de esquema, RLS y frontend | Esquema, políticas, app.js | Pruebas con 3 cuentas en Supabase |
Fuentes sugeridas: documentación oficial de Supabase (Auth, RLS, JS), GitHub Pages, MDN, OWASP, WCAG.

## 15. Cambios de la versión 2
| ID | Requisito nuevo | Actor | Criterio de aceptación |
|---|---|---|---|
| RF-16 | Aceptar términos y tratamiento de datos al registrarse | Jugador | Sin casilla marcada no se crea la cuenta (validado en la interfaz y en la BD); se guarda la fecha de aceptación |
| RF-17 | Registrar cédula (6-10 dígitos, única) y celular (10 dígitos, inicia en 3) | Jugador | Valores inválidos o cédula repetida se rechazan |
| RF-18 | Crear/editar canchas con precio por hora, días y horario de atención | Dueño/Admin | Se generan franjas de 1 hora para 14 días |
| RF-19 | Aislamiento entre dueños | Dueño | Un dueño no ve ni modifica canchas ni reservas de otro |
| RF-20 | El admin asigna o retira el rol de dueño por correo | Admin | Solo el admin puede ejecutarlo |

Pruebas nuevas (ejecutar y anotar resultado obtenido): CP-16 registro sin términos; CP-17 cédula inválida y duplicada; CP-18 dueño crea cancha y aparece para jugadores; CP-19 reserva de un cliente en la cancha de Pepito no aparece en la agenda de Juan; CP-20 Juan no puede editar ni generar franjas en la cancha de Pepito; CP-21 un jugador no puede darse rol de dueño; CP-22 cambiar el horario conserva las reservas existentes.
Riesgo nuevo: datos personales (cédula, celular). Mitigación: el dueño solo ve nombre y celular, y solo de reservas de su cancha; la cédula nunca se expone a dueños.
