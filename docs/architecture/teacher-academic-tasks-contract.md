# Contrato arquitectónico de tareas académicas del docente

## 1. Alcance y autoridad

Este documento define el modelo institucional previo a cualquier migración o implementación funcional de tareas académicas. No autoriza crear tablas, rutas, controladores, datos iniciales ni archivos demostrativos.

El módulo pertenece al dominio académico del `DOCENTE`. Es independiente del módulo de orientación y no reutiliza `actividades_orientacion`, `estados_actividad_orientacion`, `adjuntos_actividad_orientacion` ni una eventual abstracción genérica `adjuntos_actividad`; tampoco reutiliza permisos, rutas, modelos o controladores de orientación. `ORIENTADOR` no obtiene acceso a tareas académicas y `ADMINISTRADOR` no figura como docente autor ni puede suplantarlo.

La relación funcional es:

`DOCENTE autenticado -> grupo y materia realmente impartidos -> tarea académica -> destinatarios congelados -> intentos históricos -> revisiones docentes históricas`.

“Mis materias” continúa siendo una vista académica derivada del horario. “Mis tareas” será una interfaz distinta, con autorización, estados e historial propios.

## 2. Fuente del alcance docente

La identidad docente se obtiene exclusivamente de `req.session.usuario.id`. Ningún formulario, parámetro o consulta puede aportar `docente_usuario_id` como autoridad.

Crear o publicar una tarea exige comprobar que existe por lo menos una fila de `clases_programadas` que, mediante su `version_horario_id`, pertenece a una `versiones_horario` activa y coincide simultáneamente con:

- el docente autenticado;
- el grupo de la versión;
- el periodo académico de la versión;
- la materia de la clase.

La tarea no referencia un bloque individual: una misma combinación docente-grupo-materia puede tener varios bloques semanales. La autorización se resuelve con una consulta `EXISTS` sobre la versión activa, usando placeholders y revalidándose dentro de la publicación transaccional.

La tarea conserva explícitamente `docente_usuario_id`, `grupo_id`, `periodo_academico_id` y `materia_id`. Es una instantánea de contexto académico: una sustitución futura del horario no reescribe tareas publicadas ni cambia su autor o alcance histórico.

## 3. Ciclo de vida de la tarea

El catálogo `estados_tarea_academica`, administrado por clave semántica y sin `ENUM`, define inicialmente:

| Clave | Semántica |
| --- | --- |
| `BORRADOR` | Solo el docente autor puede editar contenido, alcance y adjuntos. No es visible al alumnado. |
| `PUBLICADA` | Visible para los destinatarios congelados. El alcance, autor, grupo, periodo y materia quedan inmutables. |
| `CERRADA` | Conserva consultas, intentos y evaluaciones; no admite nuevos intentos. |
| `CANCELADA` | Conserva historial y no admite nuevas entregas. |

La transición normal es `BORRADOR -> PUBLICADA -> CERRADA`. La cancelación debe partir de un estado permitido por la política futura y quedar auditada. Una tarea publicada no se elimina físicamente. Para mantener una regla uniforme y evitar rutas destructivas, la primera implementación tampoco eliminará borradores: se cancelarán o permanecerán como borradores según la operación autorizada.

Al publicar se fija `publicada_en` con tiempo del servidor. La fecha y hora límite es un instante institucional que debe guardarse sin depender del navegador y presentarse en la zona horaria configurada por el sistema.

## 4. Destinatarios congelados

La tarea se dirige al grupo completo, pero su población se congela al publicarla:

1. Se bloquea la tarea en estado `BORRADOR`.
2. Se revalida la combinación docente-grupo-periodo-materia contra el horario activo.
3. Se obtienen los alumnos activos que pertenecen al grupo.
4. Se crea exactamente un destinatario por tarea y alumno.
5. Se cambia la tarea a `PUBLICADA` y se fija `publicada_en`.
6. Se verifica la cardinalidad y se confirma una sola transacción.

Un alumno incorporado después no recibe silenciosamente tareas históricas. Un alumno trasladado conserva las tareas donde quedó registrado como destinatario. Una futura incorporación tardía será una operación explícita, autorizada, idempotente y auditada; su rol ejecutor y condiciones institucionales permanecen pendientes.

Las entregas se autorizan exclusivamente contra `destinatarios_tarea_academica`, no contra la pertenencia actual al grupo ni contra IDs enviados por el cliente.

## 5. Entregas e intentos

El alumno selecciona uno o más archivos y pulsa explícitamente **Enviar tarea**. Seleccionar archivos no inicia una carga. El primer alcance funcional exige al menos un archivo; una eventual entrega exclusivamente textual queda fuera del contrato inicial.

Cada envío crea un intento nuevo e inmutable:

- el número de intento es secuencial dentro de tarea y destinatario;
- `enviado_en` procede de MySQL o del servidor;
- `es_tardia` se calcula en la misma transacción comparando `enviado_en` con `fecha_hora_limite`;
- una entrega tardía se acepta, conserva y muestra; no se bloquea ni sustituye el estado de revisión;
- cada intento conserva sus propios adjuntos;
- un reenvío nunca sobrescribe ni elimina intentos anteriores.

`SIN_ENTREGA` es una condición derivada por ausencia de intentos. No se inserta una entrega ficticia. `TARDÍA` es una propiedad del intento, no un estado de revisión.

## 6. Revisión y evaluación

El catálogo `estados_entrega_tarea`, sin `ENUM`, define inicialmente:

| Clave | Semántica |
| --- | --- |
| `ENVIADA` | Intento recibido y pendiente de resolución docente. |
| `APROBADA` | Intento aceptado; puede incluir calificación y comentario. |
| `RECHAZADA` | Requiere corrección; exige retroalimentación y habilita un intento posterior. |

El alumno no puede elegir ni modificar estado, calificación o comentario. Solo el docente autor de la tarea puede revisar, y debe conservar una relación académica autorizada conforme a la política de acceso histórico definida en la sección 15.

Cada decisión crea una fila nueva en `revisiones_entrega_tarea`. Las revisiones anteriores nunca se actualizan ni eliminan. El intento puede conservar `estado_entrega_actual_id` como proyección materializada para consultas, pero su cambio debe ejecutarse en la misma transacción que inserta la revisión; la bitácora de revisiones es la evidencia histórica.

Reglas:

- `RECHAZADA` requiere comentario no vacío.
- `APROBADA` admite calificación y comentario opcionales.
- La calificación es opcional, no negativa y, cuando la tarea tiene puntuación máxima, no puede superarla.
- La relación entre calificación y puntuación máxima se revalida en la transacción porque abarca filas distintas.
- Una revisión no modifica adjuntos ni datos del intento.
- Después de `RECHAZADA`, el alumno crea un intento con número superior.
- Reabrir un intento `APROBADA` permanece como decisión institucional pendiente.

## 7. Modelo lógico propuesto

Los tipos siguen las convenciones actuales: IDs de usuarios en `BIGINT UNSIGNED`, IDs de grupos, periodos y materias en `INT UNSIGNED`, PK históricas en `BIGINT UNSIGNED`, `InnoDB`, `utf8mb4` y `utf8mb4_0900_ai_ci`. Todas las columnas propuestas son `NOT NULL`, excepto aquellas marcadas expresamente como `NULL`. Todas las FK usan `ON UPDATE RESTRICT` y `ON DELETE RESTRICT`; no se usa `ON DELETE CASCADE`.

El diseño no usa `ENUM`, triggers, procedimientos, BLOB, base64, nombres o correos desnormalizados ni datos demostrativos. Los catálogos semánticos aprobados son datos contractuales futuros, no ejemplos ficticios.

### 7.1 `estados_tarea_academica`

- **Propósito:** catálogo del ciclo de vida de la tarea.
- **Columnas:** `id TINYINT UNSIGNED`, `clave VARCHAR(30)`, `nombre VARCHAR(100)`, `descripcion VARCHAR(255) NULL`, `orden SMALLINT UNSIGNED`, `activo BOOLEAN`, `creado_en TIMESTAMP`, `actualizado_en TIMESTAMP`.
- **PK y unicidad:** PK `id`; UNIQUE para `clave`, `nombre` y `orden`.
- **Índice:** `(activo, orden, id)`.
- **Reglas:** clave y nombre no vacíos después de `TRIM`; `activo` limitado a 0/1.
- **Historia:** desactivar un valor impide usos nuevos, pero no invalida tareas existentes.

### 7.2 `tareas_academicas`

- **Propósito:** tarea creada por un docente dentro de un alcance académico comprobado.
- **Columnas:** `id BIGINT UNSIGNED`; `docente_usuario_id BIGINT UNSIGNED`; `grupo_id INT UNSIGNED`; `periodo_academico_id INT UNSIGNED`; `materia_id INT UNSIGNED`; `estado_tarea_academica_id TINYINT UNSIGNED`; `titulo VARCHAR(150)`; `instrucciones TEXT`; `publicada_en TIMESTAMP NULL`; `fecha_hora_limite TIMESTAMP NOT NULL`; `puntuacion_maxima DECIMAL(8,2) NULL`; `creado_en TIMESTAMP`; `actualizado_en TIMESTAMP`.
- **FK:** docente a `usuarios(id)`; grupo a `grupos(id)`; periodo a `periodos_academicos(id)`; materia a `materias(id)`; estado al catálogo de tareas.
- **Índices:** `(docente_usuario_id, estado_tarea_academica_id, fecha_hora_limite, id)`; `(grupo_id, periodo_academico_id, estado_tarea_academica_id, fecha_hora_limite, id)`; `(materia_id, periodo_academico_id, id)`; índices adicionales solo si una FK no queda cubierta por prefijo izquierdo.
- **Reglas:** título e instrucciones no vacíos; puntuación máxima nula o mayor que cero; `publicada_en` nula en borrador y obligatoria al publicar; las transiciones complejas se validan en aplicación y transacción.
- **Unicidad:** no se impone UNIQUE por título ni por combinación académica; un docente puede publicar varias tareas para la misma materia y grupo.
- **Historia:** alcance y autor inmutables desde la publicación; no hay eliminación física publicada.

### 7.3 `destinatarios_tarea_academica`

- **Propósito:** instantánea de alumnos destinatarios al publicar.
- **Columnas:** `id BIGINT UNSIGNED`; `tarea_academica_id BIGINT UNSIGNED`; `alumno_usuario_id BIGINT UNSIGNED`; `asignado_en TIMESTAMP`.
- **FK:** tarea a `tareas_academicas(id)` y alumno a `alumnos(usuario_id)`.
- **PK y unicidad:** PK `id`; UNIQUE `(tarea_academica_id, alumno_usuario_id)`.
- **Índices:** `(alumno_usuario_id, asignado_en, tarea_academica_id)` para “Mis tareas”; la UNIQUE cubre consultas por tarea.
- **Historia:** un traslado no elimina ni cambia el destinatario. Una incorporación posterior agrega una fila mediante una operación controlada futura.

### 7.4 `adjuntos_tarea_academica`

- **Propósito:** material proporcionado por el docente como parte de la tarea, separado de las entregas.
- **Columnas:** `id BIGINT UNSIGNED`; `tarea_academica_id BIGINT UNSIGNED`; `subido_por_usuario_id BIGINT UNSIGNED`; `nombre_original VARCHAR(255)`; `clave_almacenamiento CHAR(36)` o identificador interno seguro equivalente; `extension VARCHAR(20)`; `mime_type VARCHAR(150)`; `tamano_bytes BIGINT UNSIGNED`; `hash_sha256 CHAR(64)` ASCII binario; `creado_en TIMESTAMP`.
- **FK:** tarea y usuario cargador, ambos con RESTRICT.
- **Unicidad e índices:** UNIQUE `clave_almacenamiento`; índice `(tarea_academica_id, creado_en, id)`; hash indexable solo si se adopta una política explícita de deduplicación, que no se presume.
- **Historia:** después de publicar no se sustituyen ni eliminan físicamente; una corrección sustantiva requiere política futura de versión o anexo.

### 7.5 `estados_entrega_tarea`

- **Propósito:** catálogo de resolución actual de cada intento.
- **Columnas y restricciones:** mismo patrón de catálogo que `estados_tarea_academica`, con claves `ENVIADA`, `APROBADA` y `RECHAZADA`.
- **Historia:** las claves son autoridad; no se usan IDs fijos ni `ENUM`.

### 7.6 `intentos_entrega_tarea`

- **Propósito:** cada envío histórico de un destinatario.
- **Columnas:** `id BIGINT UNSIGNED`; `destinatario_tarea_academica_id BIGINT UNSIGNED`; `numero_intento INT UNSIGNED`; `estado_entrega_actual_id TINYINT UNSIGNED`; `enviado_en TIMESTAMP`; `es_tardia BOOLEAN`; `creado_en TIMESTAMP`.
- **FK:** destinatario y estado actual con RESTRICT.
- **PK y unicidad:** PK `id`; UNIQUE `(destinatario_tarea_academica_id, numero_intento)`.
- **Índices:** `(destinatario_tarea_academica_id, enviado_en, id)`; `(estado_entrega_actual_id, enviado_en, id)` para revisión pendiente.
- **Reglas:** número de intento mayor o igual que 1; tardía limitada a 0/1; estado inicial resuelto por clave `ENVIADA`.
- **Historia:** el contenido del intento, instante y tardanza son inmutables. Solo la proyección de estado actual cambia junto con una revisión nueva.

### 7.7 `adjuntos_intento_entrega`

- **Propósito:** archivos pertenecientes exactamente a un intento.
- **Columnas:** mismo patrón de metadatos seguros de `adjuntos_tarea_academica`, sustituyendo la FK por `intento_entrega_tarea_id`.
- **FK:** intento y usuario alumno que subió el archivo, con RESTRICT.
- **Unicidad e índices:** UNIQUE `clave_almacenamiento`; índice `(intento_entrega_tarea_id, creado_en, id)`.
- **Historia:** ningún reenvío sobrescribe estos archivos y no se eliminan al revisar otro intento.

### 7.8 `revisiones_entrega_tarea`

- **Propósito:** bitácora inmutable de decisiones docentes sobre un intento.
- **Columnas:** `id BIGINT UNSIGNED`; `intento_entrega_tarea_id BIGINT UNSIGNED`; `numero_revision INT UNSIGNED`; `docente_revisor_usuario_id BIGINT UNSIGNED`; `estado_entrega_id TINYINT UNSIGNED`; `calificacion DECIMAL(8,2) NULL`; `comentario VARCHAR(2000) NULL`; `revisado_en TIMESTAMP`.
- **FK:** intento, docente revisor y estado de entrega, con RESTRICT.
- **PK y unicidad:** PK `id`; UNIQUE `(intento_entrega_tarea_id, numero_revision)`.
- **Índices:** `(docente_revisor_usuario_id, revisado_en, id)`; `(estado_entrega_id, revisado_en, id)`.
- **Reglas:** número de revisión mayor o igual que 1; calificación nula o no negativa; comentario no vacío cuando exista. La obligatoriedad del comentario para `RECHAZADA` y el máximo calificable se validan junto con la tarea dentro de la transacción.
- **Historia:** una revisión nunca se edita ni borra; una corrección crea otra revisión y actualiza la proyección actual del intento de forma atómica.

## 8. Archivos privados

Los archivos se almacenan bajo un espacio propio de `storage/private`, separado del directorio de evidencias de orientación. MySQL conserva solo metadatos, hash y una clave interna aleatoria; no almacena BLOB, base64 ni rutas físicas.

El servidor valida firma real, tamaño, MIME permitido, extensión derivada, nombre saneado y hash. No confía en valores del navegador. Cada descarga revalida sesión, rol, autoría o destinatario y pertenencia exacta al recurso; una denegación o inexistencia responde 404 sin revelar el recurso.

En una carga se inspeccionan temporales antes de iniciar la transacción. Dentro de la operación se mueven archivos, se insertan metadatos y se verifican filas afectadas. Un error anterior al commit revierte MySQL y elimina destinos creados; un error posterior al commit no elimina archivos confirmados. Los temporales se limpian siempre. La conciliación ante caída abrupta del proceso será una tarea operativa separada.

Los límites definitivos de cantidad, tamaño total, tamaño individual y MIME permanecen pendientes y no se heredan automáticamente del módulo de orientación.

## 9. Autorización y respuestas

### DOCENTE

Puede consultar sus tareas, crear y editar borradores, publicar dentro de su alcance real, consultar destinatarios, descargar entregas y revisar intentos. Puede cerrar o cancelar conforme a transiciones explícitas. No acepta docente, grupo, periodo, materia, alumno o estado como autoridad desde el cliente.

### ALUMNO

Puede consultar tareas donde figura como destinatario, descargar adjuntos de esas tareas, crear intentos propios, descargar sus propios archivos y consultar sus revisiones. No puede cambiar estados, calificaciones o comentarios, ver entregas ajenas ni ampliar alcance mediante parámetros.

### ORIENTADOR

No tiene acceso a rutas, modelos o archivos del módulo académico. Una asignación vigente de orientación no concede acceso a tareas o entregas.

### ADMINISTRADOR

Administra catálogos y horarios que habilitan el alcance, pero no aparece como docente autor, no publica en nombre del docente y no revisa intentos suplantándolo. Cualquier futura función de soporte deberá conservar identidad y auditoría propias y requerirá otra decisión institucional.

Los recursos inexistentes y los existentes fuera del alcance responden 404 de forma uniforme. Validación de formulario usa 422, conflictos concurrentes 409 y fallos de base 503 con mensajes seguros. POST exige autenticación, rol y CSRF.

## 10. Concurrencia y transacciones

### Publicación y destinatarios

- Bloquear la tarea `BORRADOR` por ID y autor.
- Revalidar estado, autor y alcance contra la versión activa.
- Bloquear el ámbito necesario del grupo para obtener una instantánea consistente.
- Insertar destinatarios mediante una operación idempotente controlada.
- Verificar cantidad, cambiar a `PUBLICADA`, fijar `publicada_en` y confirmar todo junto.
- Ante cualquier fallo, rollback total: una tarea no puede quedar publicada sin su instantánea.

### Numeración y envío

- Bloquear el destinatario y el último intento de esa tarea-alumno.
- Verificar que la tarea esté `PUBLICADA`, que el alumno sea destinatario y que no exista un envío concurrente equivalente.
- Calcular `numero_intento = último + 1` bajo el bloqueo; la UNIQUE es la última barrera.
- Insertar intento en `ENVIADA`, calcular tardanza, mover archivos e insertar todos sus metadatos en una sola unidad lógica.
- Un token idempotente de un solo uso o barrera equivalente debe impedir que un doble clic cree dos intentos; su forma exacta se definirá en la implementación.

### Revisión

- Bloquear la tarea, el intento esperado y su estado actual.
- Confirmar autor docente, estado revisable y número o versión esperados.
- Insertar una revisión con numeración secuencial y actualizar `estado_entrega_actual_id` en la misma transacción.
- Dos revisiones concurrentes no se sobrescriben: una confirma y la otra recibe 409.

### Cierre

- Bloquear la tarea y revalidar su estado.
- Coordinar con envíos en curso usando el mismo orden de bloqueo: tarea, destinatario, intento.
- Un envío que ya obtuvo el bloqueo concluye antes del cierre; después del cierre no empiezan intentos nuevos.
- Cerrar nunca borra intentos, archivos o revisiones.

## 11. Consultas funcionales previstas

### DOCENTE

- **Mis grupos y materias:** combinaciones distintas obtenidas de clases de versiones activas del docente.
- **Tareas:** filtro obligatorio por `docente_usuario_id` de sesión.
- **Detalle y destinatarios:** tarea del autor, instantánea de destinatarios y último intento por alumno.
- **Revisión:** intento perteneciente a una tarea del autor, con archivos y revisiones ordenados.

### ALUMNO

- **Mis tareas:** `alumnos.usuario_id -> destinatarios -> tarea`, sin depender del grupo actual.
- **Detalle:** tarea publicada/cerrada/cancelada donde es destinatario, adjuntos del profesor e intentos propios.
- **Entrega:** destinatario de sesión y tarea publicable; no recibe alumno ni destinatario desde el cliente.
- **Historial:** intentos y revisiones propios únicamente.

## 12. Interfaces previstas

DOCENTE:

- Mis grupos y materias.
- Listado de tareas.
- Nuevo borrador y edición.
- Confirmación de publicación.
- Detalle de tarea.
- Destinatarios y condición derivada de entrega.
- Revisión e historial de intentos.

ALUMNO:

- Mis tareas.
- Detalle y adjuntos del docente.
- Envío explícito.
- Historial de intentos.
- Estado, calificación y retroalimentación.

Las vistas usarán el lenguaje visual vigente, estados vacíos y diseño adaptable. No mezclarán enlaces o permisos de orientación.

## 13. Secuencia conceptual de migraciones futuras

Se reserva conceptualmente la numeración 024 en adelante, sin crear archivos ni modificar el manifiesto:

1. **024 — Catálogos y tareas:** `estados_tarea_academica`, `estados_entrega_tarea`, `tareas_academicas` y, tras aprobación explícita, filas contractuales de los catálogos.
2. **025 — Destinatarios y adjuntos docentes:** `destinatarios_tarea_academica` y `adjuntos_tarea_academica`.
3. **026 — Intentos y archivos de entrega:** `intentos_entrega_tarea` y `adjuntos_intento_entrega`.
4. **027 — Revisiones históricas:** `revisiones_entrega_tarea` y las barreras contractuales de estado actual.

Cada número es una propuesta de planeación, no una reserva en `migration-manifest.json`. Antes de implementarlo debe revisarse si conviene dividir migraciones DDL y datos de catálogo para conservar atomicidad y recuperación controlada.

## 14. Criterios de aceptación para la implementación futura

- El docente solo opera sobre combinaciones que realmente imparte en una versión activa.
- Publicar congela destinatarios y alcance en una sola transacción.
- Cambiar el horario no reescribe tareas publicadas.
- Un alumno trasladado conserva su historial; uno nuevo no recibe tareas anteriores automáticamente.
- Cada envío crea un intento histórico con uno o más archivos.
- Entregas tardías se aceptan y quedan marcadas.
- `SIN_ENTREGA` se deriva y `TARDÍA` no sustituye el estado de revisión.
- Las revisiones son append-only y las concurrentes no se sobrescriben.
- No hay eliminación física ni cascadas destructivas.
- Archivos privados no exponen rutas y todas las descargas revalidan alcance.
- DOCENTE, ALUMNO, ORIENTADOR y ADMINISTRADOR conservan fronteras explícitas.
- No se reutilizan tablas, estados o rutas de orientación.

## 15. Decisiones institucionales pendientes

Antes de crear la primera migración deben resolverse expresamente:

1. Escala institucional, precisión y forma de presentación de la calificación.
2. Cantidad máxima de archivos, tamaño individual, tamaño total y MIME permitidos por tarea e intento.
3. Rol autorizado y condiciones para incorporar alumnos que ingresen tarde al grupo.
4. Acceso del docente a tareas y entregas después de finalizar el periodo o dejar de impartir la combinación.
5. Posibilidad futura de entregas con texto y sin archivo.
6. Reapertura o nueva revisión después de `APROBADA`.
7. Política de corrección o anexos para archivos docentes después de publicar.
8. Notificaciones al publicar, entregar, rechazar, aprobar, cerrar o cancelar.
9. Importación masiva de tareas, si alguna vez se requiere.
10. Token o mecanismo idempotente definitivo para doble envío.
