# Rediseño académico y de horarios

## 1. Estado de partida

COBAEM 30 parte de una base estable compatible con el esquema aplicado hasta la migración 008. Las migraciones 009 y 011–014 están rastreadas, pero nunca fueron ejecutadas; no existe una migración 010. Las funciones de horarios permanecen preservadas en el código, aunque desconectadas de rutas y navegación activas.

El contrato vigente conserva `ciclo_escolar` con formato `AAAA-AAAA`. La base contiene actualmente un grupo y un alumno. Existen respaldos verificados anteriores y posteriores a la recuperación, y el historial Git local nuevo comienza en el commit `f237a97`, etiquetado como estado estable compatible con 008.

Este documento no cambia ese contrato ni autoriza la ejecución de las migraciones posteriores.

## 2. Problemas del diseño anterior

- `ciclo_escolar` mezclaba el año académico, la generación y el periodo dentro de un mismo valor o mediante reinterpretaciones posteriores.
- La migración 011 transformaba datos existentes e inventaba el periodo enero-junio sin evidencia suficiente del significado original.
- La migración 012 clasificaba cualquier valor no reconocido mediante una rama `ELSE`, con riesgo de asignar un periodo incorrecto.
- Los horarios de grupo y docente se almacenaban en tablas independientes, por lo que una misma clase podía divergir o duplicarse.
- Los dos formatos XLSX de horarios podían cargarse en módulos incorrectos porque el contrato no distinguía de forma sólida el tipo de plantilla.
- La identidad escrita dentro del libro no determinaba ni validaba de forma suficiente el destino seleccionado en la aplicación.
- No existían controles integrales para solapamientos de grupo, docente o aula.
- La presencia conceptual de `orientador_id` no restringía por sí misma las consultas del orientador.
- El uso de `ON DELETE CASCADE` podía borrar horarios como efecto indirecto de eliminar un grupo o usuario.
- La importación podía reemplazar el horario existente sin una advertencia y confirmación suficientemente explícitas.
- La validación del archivo dependía principalmente de la extensión y no acreditaba de forma robusta el tipo real del libro.

## 3. Conceptos académicos separados

### Generación

Ejemplo: `2026-2029`.

Representa la cohorte que inicia y concluye su trayectoria académica. Debe poseer identidad propia, año de inicio, año de finalización, clave semántica única y estado activo o inactivo.

### Ciclo escolar

Ejemplo: `2026-2027`.

Representa el año académico institucional. Debe poseer identidad propia, año inicial, año final, clave semántica única, fechas opcionales y estado.

### Periodo académico

Ejemplos: `AGOSTO_DICIEMBRE` y `ENERO_JUNIO`.

Debe pertenecer a un ciclo escolar y contener clave semántica, nombre, fecha de inicio, fecha de finalización, orden y estado.

Estos conceptos no deben relacionarse mediante texto libre. Tampoco debe derivarse automáticamente el periodo académico a partir de registros heredados cuya semántica no esté confirmada.

## 4. Relación con grupos

Cada grupo académico deberá relacionarse conceptualmente con:

- generación;
- periodo académico;
- turno;
- semestre;
- clave;
- estado.

El ciclo escolar se obtiene mediante la relación del periodo académico con su ciclo. Una posible identidad lógica del grupo es la combinación `clave + generación + periodo + turno`, pero deberá comprobarse si la clave institucional ya incorpora alguno de esos componentes y si un grupo puede repetirse dentro del mismo periodo. Esta decisión no define todavía una restricción SQL final.

El valor legado `ciclo_escolar` en formato `AAAA-AAAA` debe conservarse durante la transición. No deberá sobrescribirse hasta contar con un mapeo explícito, revisado y validado para cada registro.

## 5. Personal asignado

El modelo debe distinguir tres responsabilidades:

- orientador responsable del grupo;
- docente tutor o responsable del grupo;
- docentes responsables de cada materia programada.

Un único `docente_id` no debe representar a todos los profesores del grupo. Los docentes de materia deben obtenerse de las clases programadas.

Se recomienda modelar las asignaciones de orientador y, si se aprueba, de docente tutor mediante una tabla de asignaciones con vigencia e historial. Esta alternativa conserva cambios de responsable, permite validar periodos efectivos y evita perder contexto histórico. Una FK directa sería más sencilla, pero solo conservaría la asignación vigente. La elección definitiva entre FK directa y tabla histórica debe aprobarse antes de diseñar SQL.

El docente tutor debe ser opcional hasta confirmar que esta figura existe formalmente en el proceso académico.

## 6. Fuente unificada de horarios

Se propone una única entidad conceptual, `clase_programada`, con:

- grupo;
- docente;
- materia;
- aula o ubicación;
- día;
- hora de inicio;
- hora de fin;
- periodo académico;
- estado;
- marcas temporales.

El horario del grupo se consulta por grupo y el horario del docente por docente. Ambos representan los mismos registros; una clase no debe duplicarse en tablas diferentes.

Actividades no docentes como asesoría, reunión, atención a padres o planeación deben mantenerse separadas de las clases. “Disponible” o “Libre” no debe persistirse: la disponibilidad es la ausencia de un bloque ocupado.

Existen dos alternativas:

1. Una tabla separada para bloques de actividad docente, con docente, tipo, ubicación, periodo, día y horas.
2. Una tabla polimórfica de eventos que combine clases y actividades mediante referencias opcionales y reglas según el tipo.

Se recomienda la tabla separada para actividades docentes. Es más sencilla de validar, evita combinaciones nulas ambiguas y mantiene la integridad de las clases sin condicionales polimórficos complejos.

## 7. Catálogos necesarios

| Catálogo | Razón | Clave semántica y estado | Primera versión |
| --- | --- | --- | --- |
| Generaciones | Identificar cohortes sin texto libre | Clave única como `2026-2029`; activo/inactivo | Obligatorio |
| Ciclos escolares | Representar años académicos institucionales | Clave única como `2026-2027`; estado | Obligatorio |
| Periodos académicos | Delimitar intervalos dentro de un ciclo | Clave semántica, ciclo, fechas, orden y estado | Obligatorio |
| Materias | Evitar nombres variables y relacionar clases | Clave institucional estable; estado | Obligatorio para clases programadas |
| Aulas | Detectar ocupación y normalizar ubicaciones | Clave estable; estado | Pendiente de aprobar si será obligatorio desde la primera versión |
| Tipos de actividad docente | Clasificar bloques no lectivos | Clave semántica; estado | Obligatorio al implementar actividades no docentes |

No se recomienda `ENUM` para conceptos administrativos que puedan crecer o cambiar. Los catálogos permiten evolucionar sin alterar la estructura de las tablas consumidoras.

## 8. Integridad de horarios

Validaciones obligatorias:

- día dentro del catálogo permitido;
- hora inicial anterior a la hora final;
- bloque dentro del turno correspondiente;
- duración dentro de límites aprobados;
- ausencia de duplicado exacto;
- ausencia de solapamiento para el grupo;
- ausencia de solapamiento para el docente;
- ausencia de solapamiento para el aula;
- docente activo y con rol `DOCENTE`;
- grupo activo;
- materia activa;
- aula activa cuando corresponda;
- periodo académico activo;
- clase perteneciente al mismo periodo académico del grupo.

Responsabilidades recomendadas:

- **MySQL:** tipos, nulabilidad, claves foráneas, unicidad estructural, rangos simples y consistencia referencial.
- **Transacción del modelo:** bloquear o coordinar el ámbito afectado, volver a comprobar conflictos y guardar el lote de forma atómica.
- **Aplicación:** validar roles, estados, pertenencia, contratos semánticos, duración y solapamientos antes de solicitar la escritura.
- **Interfaz:** prevenir errores comunes, explicar conflictos y presentar un resumen previo, sin sustituir la validación del servidor.

Los `CHECK` de MySQL son útiles para condiciones de una fila, pero no resuelven fácilmente todos los solapamientos entre varias filas. Esa comprobación debe coordinarse en la transacción y en la aplicación.

## 9. Autorización del orientador

Política aprobada: un orientador solamente puede consultar alumnos pertenecientes a grupos que tenga asignados.

La restricción debe aplicarse en el servidor a:

- listado y detalle de alumnos;
- seguimientos;
- actividades de orientación;
- evidencias;
- reportes redactados;
- información de apoyo;
- PDF;
- historial individual y global cuando incluya alumnos.

No basta con ocultar alumnos en el listado. Toda ruta que reciba `alumnoId` debe verificar nuevamente la asignación entre el orientador autenticado y el grupo actual del alumno antes de consultar o exponer información relacionada.

Un alumno inexistente debe responder 404. Para un alumno existente fuera del alcance se recomienda también 404, de manera uniforme, para reducir la enumeración de alumnos y evitar confirmar la existencia de recursos ajenos. La política 404 frente a 403 deberá aprobarse formalmente antes de implementarse.

La transición debe asignar primero el grupo existente a un orientador válido. La restricción solo debe activarse después de verificar que no existan grupos o alumnos sin cobertura, evitando bloquear completamente al orientador actual.

## 10. Importación XLSX rediseñada

Se recomienda una plantilla normalizada por filas, no una cuadrícula semanal ambigua. Para clases, el contrato propuesto incluye:

- `VERSION_PLANTILLA`;
- `DIA`;
- `HORA_INICIO`;
- `HORA_FIN`;
- `CLAVE_GRUPO`;
- `CLAVE_MATERIA`;
- `CORREO_DOCENTE` o un identificador institucional estable;
- `CLAVE_AULA`.

La importación deberá exigir:

- tipo y versión de plantilla obligatorios;
- hoja con nombre fijo;
- encabezados exactos y documentados;
- máximo definido de filas;
- límites por celda;
- archivo XLSX real validado por contenido, no solo por extensión;
- rechazo de macros;
- rechazo de enlaces externos;
- rechazo de fórmulas en campos de datos;
- validación completa del lote antes de modificar MySQL;
- resumen previo de altas, cambios, omisiones y conflictos;
- confirmación explícita del administrador;
- transacción atómica;
- estrategia explícita de agregar o reemplazar;
- control de concurrencia;
- reporte de resultado por fila sin revelar detalles internos;
- validación de que la identidad del grupo del archivo coincide con el destino autorizado.

El horario docente de clases debe derivarse de esas mismas filas y no importarse por segunda vez. Las actividades no docentes requieren una plantilla distinta, identificada por su propio tipo y versión, con campos adecuados para el docente y el tipo de actividad.

## 11. Estrategia de migración desde 008

La transición debe dividirse en etapas controladas:

A. Crear catálogos y nuevas relaciones inicialmente anulables.

B. Registrar generaciones, ciclos y periodos académicos válidos a partir de decisiones explícitas.

C. Mapear de forma explícita y verificable el grupo existente.

D. Asignar un orientador responsable al grupo.

E. Validar integridad, cobertura y correspondencia con los valores heredados.

F. Activar restricciones obligatorias únicamente cuando no existan registros pendientes.

G. Crear materias, aulas y la fuente única de clases programadas.

H. Activar la autorización limitada del orientador después de completar las asignaciones.

No debe utilizarse un `UPDATE` que clasifique valores desconocidos mediante `ELSE`. Tampoco deben reunirse todas las transformaciones en una sola migración irreversible.

Se recomienda introducir una tabla de control de migraciones o adoptar un runner confiable que registre orden, identidad, checksum, fecha y resultado de cada migración aplicada.

## 12. Tratamiento de 009 y 011–014

Las migraciones 009 y 011–014 están rastreadas en Git, pero nunca fueron ejecutadas. En una fase posterior se deberá:

- retirarlas del directorio activo o archivarlas claramente como propuestas descartadas;
- evitar reutilizar sus números o contenido silenciosamente;
- crear una secuencia nueva, limpia y documentada;
- resolver expresamente la ausencia del número 010;
- conservar el contenido histórico mediante Git y los respaldos verificados.

N1 no mueve ni modifica estas migraciones.

## 13. Fases futuras

- **N2:** aprobar el modelo conceptual, decisiones pendientes y contratos de datos.
- **N3:** retirar del flujo activo las propuestas no ejecutadas y crear una migración base segura.
- **N4:** implementar catálogos académicos y mapear explícitamente el grupo existente.
- **N5:** implementar asignación de orientadores y autorización por alcance.
- **N6:** implementar materias, aulas y clases programadas como fuente única.
- **N7:** construir los horarios derivados de grupo y docente.
- **N8:** implementar importación XLSX segura con prevalidación y confirmación.
- **N9:** ejecutar pruebas integrales y una migración controlada primero sobre una copia verificable.

Cada fase debe compilar, validarse de forma proporcional al riesgo y finalizar en un commit independiente antes de comenzar la siguiente.

## 14. Criterios de aceptación

- `main` permanece como baseline estable.
- Ninguna migración nueva se ejecuta sin probarse antes sobre una copia verificada.
- Los datos heredados no se reinterpretan automáticamente.
- Cada clase existe una sola vez.
- El grupo y el docente muestran exactamente la misma clase desde la fuente unificada.
- Los conflictos se detectan antes del guardado definitivo.
- Un orientador no accede a alumnos de grupos ajenos.
- Un XLSX incorrecto no modifica datos.
- Un rollback preserva completamente la información anterior.
- Cada fase queda documentada en Git mediante un commit independiente.

## 15. Decisiones pendientes

- Confirmar si un grupo puede tener uno o varios orientadores simultáneos.
- Aprobar si se requiere historial y vigencia de asignaciones de orientadores.
- Confirmar la existencia institucional y obligatoriedad del docente tutor.
- Decidir si el catálogo de aulas será obligatorio desde la primera versión.
- Definir la duración mínima y máxima permitida para cada bloque.
- Elegir si la importación agrega registros, reemplaza el ámbito seleccionado o permite ambas estrategias explícitas.
- Formalizar si un recurso fuera del alcance del orientador responde 404 o 403, recomendándose 404 para reducir enumeración.
