# Contrato de actividades docentes no lectivas

## 1. Alcance y autoridad

Este documento fija las decisiones institucionales que deberá implementar la migración 021. Su alcance es exclusivamente el modelo semanal recurrente de actividades docentes no lectivas. No define SQL ejecutable, interfaces, importadores ni eventos excepcionales.

Ante una descripción anterior incompatible sobre estas actividades, este contrato sustituye la propuesta de concepto libre, estado booleano, sábado, eventos de fecha única, edición directa por docentes, eliminación física, relación con grupos o inclusión en el XLSX de horarios de grupo.

## 2. Decisiones definitivas

- Una actividad es un bloque semanal recurrente dentro de un periodo académico obligatorio.
- `dia_semana` admite del 1 al 5: lunes, martes, miércoles, jueves y viernes. Sábado y domingo quedan excluidos.
- Las horas son flexibles y la hora inicial debe ser anterior a la final.
- 021 crea el catálogo vacío `tipos_actividad_docente`; no inventa valores institucionales y no usa `ENUM`.
- Cada actividad referencia obligatoriamente un tipo del catálogo. Un texto libre no sustituye esa clasificación.
- La vigencia usa `fecha_inicio` obligatoria y `fecha_fin` nullable. No se representa solo mediante un booleano.
- Los eventos de una fecha concreta no comparten esta tabla; una entidad futura los modelará.
- El aula es opcional y se referencia mediante `aula_id`; no existe una ubicación textual alternativa.
- Solo ADMINISTRADOR crea, reemplaza o cierra actividades. DOCENTE únicamente consulta las suyas.
- Las actividades no pertenecen a un grupo, una materia ni una versión de horario.
- No forman parte de la plantilla XLSX de horarios de grupo.

## 3. Modelo lógico propuesto para 021

### 3.1 `tipos_actividad_docente`

El catálogo tendrá un identificador numérico compatible con las referencias internas, una clave semántica única, un nombre institucional, estado administrativo y marcas temporales conforme a las convenciones de los catálogos vigentes. La clave y el nombre no podrán quedar vacíos después de `TRIM`.

El catálogo empieza vacío. Las claves se resolverán por su valor semántico y nunca mediante identificadores fijos. Desactivar un tipo impedirá usarlo en nuevas actividades, pero no invalidará el historial que ya lo referencia.

### 3.2 `actividades_docente_no_lectivas`

| Campo conceptual | Tipo propuesto | Nulabilidad | Regla |
| --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` autogenerado | No | Clave primaria |
| `docente_usuario_id` | `BIGINT UNSIGNED` | No | Referencia a `usuarios` |
| `periodo_academico_id` | `INT UNSIGNED` | No | Referencia a `periodos_academicos` |
| `tipo_actividad_docente_id` | Identificador compatible con el catálogo | No | Clasificación obligatoria |
| `aula_id` | `INT UNSIGNED` | Sí | Referencia opcional a `aulas` |
| `titulo` | `VARCHAR(150)` | No | Texto breve no vacío después de `TRIM` |
| `observaciones` | `VARCHAR(500)` | Sí | Texto plano; si existe, no queda vacío después de `TRIM` |
| `dia_semana` | `TINYINT UNSIGNED` | No | Valor de 1 a 5 |
| `hora_inicio` | `TIME` | No | Anterior a `hora_fin` |
| `hora_fin` | `TIME` | No | Posterior a `hora_inicio` |
| `fecha_inicio` | `DATE` | No | Inicio de vigencia inclusivo |
| `fecha_fin` | `DATE` | Sí | Fin inclusivo, igual o posterior al inicio |
| `creado_por_usuario_id` | `BIGINT UNSIGNED` | No | Administrador que crea la fila |
| `creado_en` | `TIMESTAMP` | No | Auditoría de creación según la convención vigente |

No se agregan `grupo_id`, `version_horario_id`, `materia_id`, `concepto`, `descripcion`, `ubicacion_texto` ni una copia del nombre o correo de usuarios. Tampoco se usa un campo `activo` como historial.

## 4. Claves, índices e integridad

- La actividad usa una clave primaria sobre `id`.
- El catálogo usa una clave primaria y unicidad sobre su clave semántica.
- Se requieren índices para consultar por docente, periodo, vigencia, día y horas.
- Cuando exista aula, se requiere un índice equivalente para periodo, aula, vigencia, día y horas.
- Se requieren índices compatibles con las claves foráneas de tipo y creador, evitando duplicados redundantes.
- Todas las claves foráneas usan `ON DELETE RESTRICT`; ninguna usa eliminación en cascada.
- La política exacta de `ON UPDATE` se decidirá conservadoramente en el contrato SQL de 021, atendiendo tipos, columnas derivadas e inmutabilidad histórica.
- Los `CHECK` de fila limitan el día de 1 a 5, exigen hora inicial anterior a la final y, cuando exista fecha final, exigen que no sea anterior a la inicial.
- La ausencia de solapamientos no se simula mediante un `CHECK` ni una unicidad incorrecta entre filas.

## 5. Semántica de vigencia e historial

Una fila está vigente en una fecha de consulta cuando la fecha pertenece al intervalo inclusivo iniciado por `fecha_inicio` y `fecha_fin` es nula o no es anterior a esa fecha. `fecha_fin IS NULL` identifica una vigencia abierta, pero la pertenencia al periodo académico continúa siendo obligatoria.

Un cambio sustantivo de docente, periodo, tipo, aula, título, observaciones, día u horario no sobrescribe el registro histórico: dentro de una transacción se cierra la vigencia anterior y se crea una fila nueva. Cerrar una actividad actualiza únicamente su fecha final. No se elimina físicamente, no se reactiva una fila cerrada y no se reutiliza `versiones_horario`.

## 6. Autorización

- ADMINISTRADOR es el único rol que puede crear, reemplazar o cerrar actividades y administrar el catálogo.
- `creado_por_usuario_id` se obtiene de la sesión administrativa, nunca del cliente.
- DOCENTE puede consultar sus propias actividades, pero no crear, editar, cerrar ni eliminar registros.
- La autorización se aplica en servidor y no depende de ocultar controles visuales.

## 7. Conflictos con clases y aulas

La validación definitiva se realiza en aplicación, dentro de una transacción y con bloqueos suficientes para impedir confirmaciones concurrentes incompatibles.

Para el mismo periodo se verifica el intervalo efectivo de vigencia y:

1. El docente no se solapa con `clases_programadas` pertenecientes a versiones de horario activas.
2. El docente no se solapa con otra actividad no lectiva vigente.
3. Cuando `aula_id` existe, el aula no se solapa con clases programadas activas.
4. Cuando `aula_id` existe, el aula no se solapa con otra actividad no lectiva vigente.

Las consultas de clases obtienen grupo y periodo mediante `versiones_horario`. Las actividades no duplican esas relaciones. La comparación temporal considera día, horas, periodo y vigencia por fechas; los `CHECK` solo validan la coherencia de una fila.

## 8. Horario derivado del docente

El horario del docente combina dos fuentes mediante consultas separadas o `UNION`:

- `clases_programadas`, con naturaleza `CLASE`;
- `actividades_docente_no_lectivas`, con naturaleza `ACTIVIDAD`.

La salida conserva esa naturaleza. Una actividad no se presenta como materia y una clase no se copia como actividad.

## 9. Exclusiones de 021

021 no implementa eventos de fecha única, actividades de sábado o domingo, relación con grupos, relación con materias, versiones completas, eliminación física, edición por docentes, controladores, rutas, formularios, importación XLSX ni datos iniciales del catálogo.

La plantilla `plantilla_importacion_horario_grupo.xlsx` permanece reservada exclusivamente para clases de un grupo dentro de un periodo. No se modifica ni acepta actividades no lectivas.

## 10. Criterios de aceptación para 021

- Crea exactamente el catálogo vacío y la tabla de actividades recurrentes.
- Declara tipos, nulabilidad, límites textuales y relaciones compatibles con las tablas vigentes.
- Exige periodo, docente, tipo, título, día, horas, fecha inicial y creador.
- Mantiene aula, observaciones y fecha final como opcionales.
- Limita el día a lunes–viernes y valida horas y fechas.
- Usa claves foráneas con eliminación restringida y no usa `ENUM`.
- No introduce grupo, materia, versión de horario, concepto libre, ubicación textual ni estado booleano histórico.
- Incluye índices útiles para consultas y prevalidación de conflictos sin redundancias evidentes.
- Comienza sin tipos inventados ni actividades iniciales.
- Su contrato de postcondición protege toda la estructura y su manifiesto conserva las migraciones anteriores sin cambios.

## 11. Pendientes posteriores

- Definir la entidad de eventos excepcionales con fecha concreta, sin convertirla en un modelo híbrido con actividades recurrentes.
- Definir una plantilla propia de actividades, con formato y versión independientes, si la institución autoriza importación masiva.
- Implementar la administración del catálogo y de vigencias para ADMINISTRADOR.
- Implementar la consulta de horario derivado para DOCENTE.
- Precisar en el contrato SQL de 021 las acciones `ON UPDATE`, nombres de restricciones e índices finales.
