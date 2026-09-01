# Contrato técnico de migración desde v008

## 1. Alcance y estado de partida

Este documento define el contrato futuro para evolucionar COBAEM 30 desde el esquema real aplicado hasta 008. Es documental: no contiene migraciones ejecutables, no modifica el esquema y no autoriza escrituras.

Punto de partida confirmado por la auditoría y el diseño N2:

- 001–008 representan el baseline funcional.
- 009, 011, 012, 013 y 014 existen como propuestas rastreadas, pero nunca fueron aplicadas en la base auditada.
- 010 permanece reservado y ausente.
- 009 y 011–014 se clasifican como `SUPERSEDED_NOT_APPLIED` y nunca forman parte de una lista de ejecución.
- 010 se clasifica como `RESERVED_MISSING`.
- Las nuevas migraciones funcionales comienzan en 015.
- `ciclo_escolar` heredado se conserva literalmente; no se interpreta ni transforma automáticamente.

Compatibilidad obligatoria con tipos existentes:

| Destino existente | Tipo confirmado | Uso futuro |
| --- | --- | --- |
| `usuarios.id` | `BIGINT UNSIGNED` | orientadores, tutores, docentes y administradores |
| `grupos.id` | `INT UNSIGNED` | asignaciones, versiones e importaciones |
| `turnos.id` | `TINYINT UNSIGNED` | relación vigente de grupos |
| `alumnos.usuario_id` | `BIGINT UNSIGNED` | identidad académica del alumno |
| `creado_en` | `TIMESTAMP`, fecha actual por defecto | auditoría de creación |
| `actualizado_en` | `TIMESTAMP`, fecha actual y actualización automática | auditoría de cambios cuando aplique |

Las FK futuras deben coincidir exactamente con el tipo del destino. En información académica histórica se utilizará `ON DELETE RESTRICT`; no se utilizará `ON DELETE CASCADE`.

## 2. Manifiesto explícito y runner

El runner futuro debe recibir un manifiesto explícito y ordenado. Nunca debe ejecutar archivos solo porque aparezcan en `database/migrations`.

Estados mínimos del manifiesto:

- `EXECUTABLE`: migración autorizada para una secuencia concreta.
- `SUPERSEDED_NOT_APPLIED`: propuesta conservada en Git que nunca debe ejecutarse.
- `RESERVED_MISSING`: número deliberadamente reservado sin archivo ejecutable.
- `BOOTSTRAP`: recurso de control gestionado únicamente por el runner.

Clasificación inicial:

| Número | Estado | Tratamiento |
| --- | --- | --- |
| 000 | `BOOTSTRAP` | Crear únicamente el control de migraciones |
| 001–008 | `EXECUTABLE` o baseline | Ejecutar solo en base vacía; registrar como baseline en una base v008 validada |
| 009 | `SUPERSEDED_NOT_APPLIED` | Conservar, nunca ejecutar |
| 010 | `RESERVED_MISSING` | Sin archivo y sin ejecución |
| 011–014 | `SUPERSEDED_NOT_APPLIED` | Conservar, nunca ejecutar |
| 015 en adelante | `EXECUTABLE` | Ejecutar exclusivamente según manifiesto aprobado |

El manifiesto futuro debe registrar número, archivo esperado, estado, checksum autorizado, dependencias y orden. Un archivo ausente, inesperado, duplicado o con checksum distinto detiene el proceso.

### 2.1 Bootstrap 000

El recurso futuro equivalente a `000_create_schema_migrations.sql` se ejecuta antes de la secuencia numerada y solamente por el runner. Crea la tabla de control; no toca tablas funcionales. Debido a que el DDL de MySQL puede producir commits implícitos, el runner debe verificar antes y después la estructura exacta y detenerse ante un resultado parcial o inesperado.

### 2.2 Modo `baseline-v008`

El modo controlado para una base existente debe:

1. Exigir confirmación verificable de respaldo.
2. Obtener y comparar una huella estructural esperada, no solo nombres de tablas.
3. Verificar las tablas, columnas, índices y FK de 001–008.
4. Confirmar la ausencia de columnas introducidas por 009, 011 y 012.
5. Confirmar la ausencia de `grupo_horarios` y `docente_horarios`.
6. Confirmar que la tabla de control no contiene ejecuciones incompatibles.
7. Calcular SHA-256 de los archivos 001–008 y compararlos con el manifiesto aprobado.
8. Registrar 001–008 con `tipo_registro = BASELINE`.
9. No ejecutar nuevamente 001–008.
10. Detenerse ante cualquier diferencia, sin inferir estado por coincidencias parciales.

El baseline debe ser una operación explícita y auditable. No puede ejecutarse como efecto secundario del arranque de la aplicación.

### 2.3 Base vacía futura

Para una base vacía, el runner debe crear primero la tabla de control mediante 000, ejecutar 001–008 en orden, omitir 009, 010 y 011–014 conforme al manifiesto y continuar desde 015. Cada archivo se valida por checksum antes de ejecutarse.

### 2.4 Concurrencia, éxito y fallos

- El runner debe obtener un bloqueo exclusivo de migraciones para el esquema antes de cualquier cambio. Se recomienda un bloqueo asesor de MySQL con nombre estable y liberación garantizada, acompañado por verificación de conexión y timeout.
- Dos runners no pueden avanzar simultáneamente.
- Una migración se registra como aplicada solo después de que todas sus operaciones y verificaciones posteriores finalicen correctamente.
- Una migración fallida no se registra como ejecutada ni como baseline.
- Si cambia el checksum de una migración aplicada, el runner se detiene; no actualiza el checksum almacenado.
- Cada migración usa una sola conexión controlada.
- Las operaciones DML se agrupan transaccionalmente cuando MySQL lo permita.
- El DDL de MySQL no siempre es reversible mediante rollback por sus commits implícitos. Por ello cada migración estructural necesita preflight, respaldo, ensayo sobre copia, verificación posterior y un plan compensatorio separado.

## 3. Contrato futuro de `schema_migrations`

La tabla de control no contiene información funcional ni datos de conexión.

| Columna | Tipo propuesto | Nullable | Regla |
| --- | --- | --- | --- |
| `version` | `VARCHAR(20)` ASCII | No | PK o clave única; admite `000`, `015` y extensiones controladas |
| `archivo` | `VARCHAR(255)` | No | Único; nombre lógico, nunca ruta absoluta |
| `checksum_sha256` | `CHAR(64)` ASCII binario | No | Exactamente 64 caracteres hexadecimales |
| `aplicada_en` | `TIMESTAMP` | No | Fecha de registro exitoso |
| `duracion_ms` | `BIGINT UNSIGNED` | No | Duración no negativa |
| `lote_ejecucion` | `CHAR(36)` ASCII | Sí | UUID o identificador lógico del lote |
| `tipo_registro` | `VARCHAR(20)` | No | Clave controlada `EJECUTADA` o `BASELINE`; no `ENUM` |

Restricciones:

- `version` y `archivo` son únicos.
- El checksum se valida como SHA-256 hexadecimal.
- `tipo_registro` se valida mediante contrato del runner y restricción simple compatible, sin IDs fijos.
- No se guardan host, usuario, contraseña, secretos ni identidad de conexión.
- Los estados `SUPERSEDED_NOT_APPLIED` y `RESERVED_MISSING` pertenecen al manifiesto, no a esta tabla porque no representan aplicaciones.
- No existe una fila de “fallo aplicado”; los fallos se registran fuera del conjunto de migraciones aplicadas mediante salida operativa segura.

## 4. Secuencia propuesta

| Número | Objetivo | Dependencias | Tablas afectadas | Transforma datos | Reversible | Riesgo |
| --- | --- | --- | --- | --- | --- | --- |
| 000 | Control de migraciones | Ninguna | `schema_migrations` | No | Solo antes de registrar historia | Medio por DDL bootstrap |
| 015 | Catálogos de calendario | 008 | `generaciones`, `ciclos_escolares`, `periodos_academicos` | No | Sí antes de cargar o referenciar datos | Bajo |
| 016 | Referencias normalizadas nullable | 015 | `grupos` | No | Sí mientras referencias estén vacías | Medio |
| 017 | Historial de orientador y tutor | 016 | tablas de asignaciones | No | Sí antes de asignaciones reales | Medio |
| 018 | Catálogos de materias y aulas | 015 | `materias`, `aulas` | No | Sí antes de referencias | Bajo |
| 019 | Importaciones y versiones | 016, 018 | `importaciones_horario`, `versiones_horario` | No | Sí antes de versiones reales | Medio |
| 020 | Fuente única de clases | 019 | `clases_programadas` | No | Sí antes de clases reales | Alto por integridad temporal |
| 021 | Actividades no lectivas | 015, 018 | `actividades_docente_no_lectivas` | No | Sí antes de bloques reales | Medio |

Las cargas institucionales y el mapeo del grupo heredado no se mezclan con estas migraciones estructurales. Son operaciones asistidas posteriores, con validación, respaldo y auditoría propios.

## 5. Contrato académico

### 5.1 `generaciones`

Responsabilidad: representar una cohorte plurianual. ID propuesto `INT UNSIGNED`.

| Columna | Tipo propuesto | Nullable | Default | Clave o índice | Significado |
| --- | --- | --- | --- | --- | --- |
| `id` | `INT UNSIGNED` | No | autogenerado | PK | Identidad |
| `anio_inicio` | `SMALLINT UNSIGNED` | No | — | Único compuesto | Año inicial de cuatro dígitos |
| `anio_fin` | `SMALLINT UNSIGNED` | No | — | Único compuesto | Año final de cuatro dígitos |
| `activo` | `BOOLEAN` | No | verdadero | Índice de estado si el volumen lo justifica | Disponibilidad administrativa |
| `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `actualizado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría de cambio |

Reglas: ambos años deben tener cuatro dígitos, `anio_fin > anio_inicio` y la combinación es única. La etiqueta `AAAA-AAAA` se deriva para presentación. No se copia `grupos.ciclo_escolar` automáticamente.

### 5.2 `ciclos_escolares`

Responsabilidad: representar el calendario institucional. ID propuesto `INT UNSIGNED`.

| Columna | Tipo propuesto | Nullable | Default | Clave o índice | Significado |
| --- | --- | --- | --- | --- | --- |
| `id` | `INT UNSIGNED` | No | autogenerado | PK | Identidad |
| `clave` | `VARCHAR(30)` | No | — | Única | Clave semántica |
| `nombre` | `VARCHAR(100)` | No | — | — | Nombre institucional |
| `fecha_inicio` | `DATE` | No | — | Índice temporal opcional | Inicio real |
| `fecha_fin` | `DATE` | No | — | — | Fin real |
| `activo` | `BOOLEAN` | No | verdadero | Índice si es selectivo | Estado administrativo |
| `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `actualizado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría de cambio |

Reglas: clave única, fecha inicial no posterior a la final, sin `ENUM` y sin equivalencia implícita con una generación.

### 5.3 `periodos_academicos`

Responsabilidad: representar intervalos administrables dentro de un ciclo. ID propuesto `INT UNSIGNED`.

| Columna | Tipo propuesto | Nullable | Default | Clave o índice | Significado |
| --- | --- | --- | --- | --- | --- |
| `id` | `INT UNSIGNED` | No | autogenerado | PK | Identidad |
| `ciclo_escolar_id` | `INT UNSIGNED` | No | — | FK e índice | Ciclo padre |
| `clave` | `VARCHAR(30)` | No | — | Única con ciclo | Clave semántica |
| `nombre` | `VARCHAR(100)` | No | — | — | Nombre administrativo |
| `fecha_inicio` | `DATE` | No | — | Índice temporal opcional | Inicio real |
| `fecha_fin` | `DATE` | No | — | — | Fin real |
| `activo` | `BOOLEAN` | No | verdadero | Índice si es selectivo | Estado |
| `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `actualizado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría de cambio |

La FK al ciclo usa `RESTRICT`. La clave es única dentro del ciclo. Las fechas deben estar contenidas en las fechas del ciclo; esa validación entre filas corresponde a aplicación y transacción. No se limita el catálogo a dos periodos ni se usa `ENUM`.

### 5.4 Transición de `grupos`

015 no modifica grupos. En 016 se agregan inicialmente:

| Columna | Tipo propuesto | Nullable | Default | Clave o índice | Significado |
| --- | --- | --- | --- | --- | --- |
| `generacion_id` | `INT UNSIGNED` | Sí | nulo | FK e índice | Generación normalizada |
| `periodo_academico_id` | `INT UNSIGNED` | Sí | nulo | FK e índice | Periodo normalizado |

Se conservan sin cambios `ciclo_escolar`, `semestre`, `turno_id`, `clave` y `activo`. No se agrega `ciclo_escolar_id`, porque el ciclo normalizado se obtiene mediante grupo → periodo académico → ciclo escolar. No se ejecuta un `UPDATE` automático ni se hacen obligatorias las nuevas referencias en 016.

El único grupo heredado se mapeará posteriormente mediante una operación asistida. Las FK usan `RESTRICT`. `ciclo_escolar` solo podría retirarse en una fase futura cuando todos los grupos estén mapeados, la lectura dual haya concluido, los consumidores usen el modelo normalizado y existan respaldo y plan de reversión; no se propone retirarlo ahora.

## 6. Contrato de asignaciones

### 6.1 `asignaciones_orientador_grupo`

ID propuesto `BIGINT UNSIGNED`; `grupo_id` conserva `INT UNSIGNED`; los usuarios conservan `BIGINT UNSIGNED`.

| Columna | Tipo propuesto | Nullable | Default | Clave o índice | Significado |
| --- | --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | No | autogenerado | PK | Identidad histórica |
| `grupo_id` | `INT UNSIGNED` | No | — | FK, índice temporal y unicidad vigente | Grupo atendido |
| `orientador_usuario_id` | `BIGINT UNSIGNED` | No | — | FK e índice temporal | Orientador |
| `fecha_inicio` | `DATE` | No | — | Índice con grupo | Inicio de vigencia |
| `fecha_fin` | `DATE` | Sí | nulo | Índice con grupo | Fin inclusivo; nulo significa vigente |
| `creado_por_usuario_id` | `BIGINT UNSIGNED` | No | — | FK | Administrador autor |
| `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `actualizado_en` | `TIMESTAMP` | No | fecha actual | — | Cierre administrativo |

### 6.2 `asignaciones_tutor_grupo`

Repite el contrato anterior sustituyendo `orientador_usuario_id` por `tutor_usuario_id BIGINT UNSIGNED`. La tutoría es opcional, independiente de las clases y conserva historia. Un docente puede tutorar varios grupos.

### 6.3 Única asignación vigente y reemplazo

Se recomienda combinar:

1. Validación transaccional con bloqueo de la fila de grupo y consulta de asignaciones relevantes mediante `SELECT ... FOR UPDATE`.
2. Una columna generada nullable que exponga `grupo_id` solo cuando `fecha_fin` sea nula, con índice único sobre ese valor.

El índice generado impide dos filas vigentes incluso ante una carrera; el bloqueo serializa el cierre y alta y permite validar todos los intervalos. Un `CHECK` solo valida fechas de una fila y no puede impedir solapamientos con otras filas.

Reemplazo transaccional:

- bloquear el grupo y su asignación vigente;
- validar rol y cuenta activa mediante claves de catálogo;
- comprobar que la nueva fecha no solapa ningún intervalo histórico;
- cerrar la asignación anterior con fecha final coherente;
- crear la nueva asignación;
- confirmar ambas operaciones juntas.

Las FK a grupos y usuarios usan `RESTRICT`. No hay eliminación física ni IDs fijos de roles.

## 7. Catálogos de horarios

### 7.1 `materias`

ID propuesto `INT UNSIGNED`. Columnas: `id`, `clave VARCHAR(30)`, `nombre VARCHAR(150)`, `activo BOOLEAN`, `creado_en` y `actualizado_en`. La clave es única; el nombre se normaliza para presentación y búsqueda. Una materia referenciada se desactiva, no se elimina.

### 7.2 `aulas`

ID propuesto `INT UNSIGNED`. Columnas: `id`, `clave VARCHAR(30)`, `nombre VARCHAR(100)`, `activo BOOLEAN`, `creado_en` y `actualizado_en`. La clave es única. La FK desde clases es nullable: una clase puede quedar sin aula. Desactivar no rompe históricos. Espacios virtuales, externos o especiales quedan previstos como extensión, no como campos de texto libre en esta fase.

## 8. Versionado de horarios

### 8.1 Alcance exacto

Cada reemplazo y cada versión abarcan exactamente **un grupo dentro de un periodo académico e incluyen todas las clases programadas de ese grupo y periodo**.

Consecuencias:

- un archivo no reemplaza todo el plantel;
- no existe importación docente paralela;
- el horario docente deriva de clases activas de todos sus grupos;
- reemplazar un grupo puede introducir conflictos para varios docentes o aulas;
- antes de activar se compara contra clases activas de otros grupos;
- una reversión conserva el mismo alcance grupo-periodo, crea una operación auditable y no elimina versiones.

### 8.2 `importaciones_horario`

ID propuesto `BIGINT UNSIGNED`.

| Columna | Tipo propuesto | Nullable | Default | Clave o índice | Significado |
| --- | --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | No | autogenerado | PK | Operación auditable |
| `grupo_id` | `INT UNSIGNED` | No | — | FK e índice de alcance | Grupo objetivo |
| `periodo_academico_id` | `INT UNSIGNED` | No | — | FK e índice de alcance | Periodo objetivo |
| `usuario_administrador_id` | `BIGINT UNSIGNED` | No | — | FK | Autor de confirmación |
| `nombre_archivo_original` | `VARCHAR(255)` | No | — | — | Nombre saneado solo para presentación |
| `checksum_sha256` | `CHAR(64)` ASCII binario | No | — | Índice opcional no único | Integridad del archivo |
| `tamano_bytes` | `BIGINT UNSIGNED` | No | — | — | Tamaño validado |
| `clave_resultado` | `VARCHAR(30)` | No | — | Índice si es selectivo | Resultado controlado, sin `ENUM` |
| `filas_totales` | `INT UNSIGNED` | No | 0 | — | Conteo de entrada |
| `filas_validas` | `INT UNSIGNED` | No | 0 | — | Conteo válido |
| `filas_con_error` | `INT UNSIGNED` | No | 0 | — | Conteo inválido |
| `advertencias` | `TEXT` | Sí | nulo | — | Resumen seguro, sin datos internos |
| `creado_en` | `TIMESTAMP` | No | fecha actual | Índice temporal | Inicio confirmado |
| `confirmado_en` | `TIMESTAMP` | Sí | nulo | — | Confirmación administrativa |
| `finalizado_en` | `TIMESTAMP` | Sí | nulo | — | Fin de operación |

No almacena binarios, rutas absolutas, credenciales ni detalles internos destinados al navegador. Una vista previa nunca confirmada no crea esta fila ni modifica tablas activas; vive únicamente en almacenamiento temporal aislado y expirable. La conservación del archivo temporal sigue pendiente y debe limpiarse aun cuando no se confirme.

### 8.3 `versiones_horario`

ID propuesto `BIGINT UNSIGNED`.

| Columna | Tipo propuesto | Nullable | Default | Clave o índice | Significado |
| --- | --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | No | autogenerado | PK | Versión inmutable |
| `grupo_id` | `INT UNSIGNED` | No | — | FK, alcance y unicidad activa | Grupo |
| `periodo_academico_id` | `INT UNSIGNED` | No | — | FK, alcance y unicidad activa | Periodo |
| `numero_version` | `INT UNSIGNED` | No | — | Único por grupo-periodo | Secuencia monotónica |
| `importacion_id` | `BIGINT UNSIGNED` | Sí | nulo | FK única si aplica | Operación de origen |
| `version_origen_id` | `BIGINT UNSIGNED` | Sí | nulo | FK autorreferente | Base de una reversión |
| `es_activa` | `BOOLEAN` | No | falso | Índice generado de vigencia | Estado vigente |
| `activada_en` | `TIMESTAMP` | Sí | nulo | — | Activación |
| `reemplazada_en` | `TIMESTAMP` | Sí | nulo | — | Sustitución |
| `creada_por_usuario_id` | `BIGINT UNSIGNED` | No | — | FK | Autor administrativo |
| `creado_en` | `TIMESTAMP` | No | fecha actual | Índice temporal | Auditoría |

La combinación grupo-periodo-número es única. Para garantizar una sola versión activa sin triggers, se recomienda una columna generada nullable que exponga una clave compuesta de grupo y periodo únicamente cuando `es_activa` sea verdadera, con índice único, más bloqueo transaccional del alcance. Las versiones inactivas producen nulo y pueden coexistir.

Las versiones históricas son inmutables y no se eliminan. Revertir no reactiva una fila antigua: crea una nueva versión, copia de forma controlada el conjunto histórico y registra `version_origen_id`.

## 9. `clases_programadas`: fuente única

ID propuesto `BIGINT UNSIGNED`.

| Columna | Tipo propuesto | Nullable | Default | Clave o índice | Significado |
| --- | --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | No | autogenerado | PK | Clase versionada |
| `version_horario_id` | `BIGINT UNSIGNED` | No | — | FK e índices de horario | Versión y alcance |
| `docente_usuario_id` | `BIGINT UNSIGNED` | No | — | FK e índice temporal | Docente |
| `materia_id` | `INT UNSIGNED` | No | — | FK e índice | Materia |
| `aula_id` | `INT UNSIGNED` | Sí | nulo | FK e índice temporal | Aula opcional |
| `dia_semana` | `TINYINT UNSIGNED` | No | — | Índices temporales | Día normalizado 1–7 según contrato futuro |
| `hora_inicio` | `TIME` | No | — | Índices temporales | Inicio |
| `hora_fin` | `TIME` | No | — | Índices temporales | Fin |
| `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |

Grupo y periodo se obtienen desde `versiones_horario`; no se duplican en cada clase. No se crean tablas de horario docente o grupal.

Reglas:

- `hora_inicio < hora_fin` mediante validación de fila y aplicación.
- Día permitido como número normalizado; no `ENUM`.
- Docente y materia obligatorios; aula nullable.
- Versión y clases históricas inmutables.
- Duplicado exacto impedido dentro de una versión mediante unicidad de versión, docente, materia, aula normalizada, día e intervalo, complementada por validación porque los valores nulos requieren tratamiento explícito.
- Solapamientos parciales validados por aplicación dentro de la transacción.
- Antes de activar: conflictos internos del grupo; docente contra clases activas de otros grupos; aula contra otros grupos cuando exista; docente y aula contra actividades no lectivas.

## 10. `actividades_docente_no_lectivas`

ID propuesto `BIGINT UNSIGNED`.

| Columna | Tipo propuesto | Nullable | Default | Clave o índice | Significado |
| --- | --- | --- | --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | No | autogenerado | PK | Bloque no lectivo |
| `docente_usuario_id` | `BIGINT UNSIGNED` | No | — | FK e índice temporal | Docente |
| `periodo_academico_id` | `INT UNSIGNED` | No | — | FK e índice temporal | Periodo |
| `concepto` | `VARCHAR(100)` | No | — | — | Tipo o concepto controlado |
| `dia_semana` | `TINYINT UNSIGNED` | No | — | Índice temporal | Día normalizado |
| `hora_inicio` | `TIME` | No | — | Índice temporal | Inicio |
| `hora_fin` | `TIME` | No | — | Índice temporal | Fin |
| `aula_id` | `INT UNSIGNED` | Sí | nulo | FK e índice temporal | Aula opcional |
| `activo` | `BOOLEAN` | No | verdadero | Índice si es selectivo | Vigencia funcional |
| `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `actualizado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría de cambio |

Es independiente de clases, no crea grupos ficticios, participa en conflictos de docente y aula y no se importa silenciosamente desde plantillas de clases. Un catálogo de tipos puede incorporarse después cuando exista definición institucional.

## 11. Alcance transaccional de una importación

1. La vista previa no modifica tablas activas.
2. El administrador selecciona grupo y periodo.
3. El XLSX declara el horario completo de ese único alcance.
4. La confirmación inicia una transacción.
5. Se bloquea el alcance grupo-periodo mediante la fila de grupo y el conjunto de versiones correspondiente.
6. Se revalidan catálogos, roles, estado del grupo, periodo y todos los conflictos.
7. Se crea `importaciones_horario`.
8. Se obtiene y crea el siguiente número de versión bajo bloqueo.
9. Se insertan todas las clases de la versión nueva.
10. Se valida que el conjunto sea completo y coincida con la vista previa confirmada.
11. Se marca como reemplazada la versión anterior.
12. Se activa la nueva versión.
13. Se confirma la transacción.
14. Cualquier fallo provoca rollback completo.
15. El archivo temporal se elimina conforme a la política futura, tanto en éxito como en fallo.

Dos administradores sobre el mismo grupo-periodo quedan serializados por el mismo bloqueo de alcance. El segundo revalida número de versión, horario vigente y conflictos después de adquirirlo; nunca reutiliza la vista previa como autoridad de escritura. Importaciones de grupos distintos pueden avanzar en paralelo, pero deben validar conflictos compartidos de docentes y aulas bajo un orden de bloqueo estable para evitar carreras y deadlocks.

## 12. Matriz de índices

| Índice propuesto | Columnas | Consulta que soporta | Posible redundancia |
| --- | --- | --- | --- |
| `uq_generaciones_anios` | generación: inicio, fin | Evitar cohortes duplicadas | No |
| `uq_ciclos_clave` | ciclo: clave | Resolución semántica | No |
| `uq_periodos_ciclo_clave` | periodo: ciclo, clave | Resolver periodo | Cubre prefijo `ciclo_escolar_id` |
| `idx_grupos_generacion` | grupos: generación | Filtros académicos | No |
| `idx_grupos_periodo` | grupos: periodo | Filtros y alcance | No |
| `uq_orientador_grupo_vigente` | columna generada de grupo vigente | Una asignación activa | No |
| `idx_orientador_vigencia` | orientador, inicio, fin, grupo | Alcance actual e histórico | No |
| `idx_asignacion_orientador_grupo_intervalo` | grupo, inicio, fin | Detectar solapamientos | Puede cubrir parte del índice vigente, pero no su unicidad |
| `uq_tutor_grupo_vigente` | columna generada de grupo vigente | Un tutor activo | No |
| `idx_tutor_vigencia` | tutor, inicio, fin, grupo | Tutorías actuales e históricas | No |
| `uq_materias_clave` | materia: clave | Resolución de catálogo | No |
| `uq_aulas_clave` | aula: clave | Resolución de catálogo | No |
| `idx_importacion_alcance_fecha` | grupo, periodo, creado_en, id | Auditoría por alcance | No |
| `uq_version_numero` | grupo, periodo, número | Secuencia de versiones | Cubre búsquedas por alcance |
| `uq_version_activa` | clave generada grupo-periodo activa | Una versión activa | No |
| `idx_clase_version_dia_hora` | versión, día, inicio, fin | Horario activo del grupo tras resolver versión | No |
| `idx_clase_docente_dia_hora` | docente, día, inicio, fin, versión | Horario docente y conflictos | No |
| `idx_clase_aula_dia_hora` | aula, día, inicio, fin, versión | Ocupación de aula | No; omite filas sin aula de forma lógica |
| `idx_clase_materia` | materia, versión | Búsqueda por materia | Revisar selectividad antes de crear |
| `idx_actividad_docente_periodo_hora` | docente, periodo, día, inicio, fin | Conflictos no lectivos | No |
| `idx_actividad_aula_periodo_hora` | aula, periodo, día, inicio, fin | Conflictos de aula | Revisar selectividad si muchas aulas son nulas |

Antes de materializar índices se revisarán consultas reales con `EXPLAIN`. No se añadirá un índice independiente de FK si ya es prefijo efectivo de uno compuesto.

## 13. Matriz de integridad

| Regla | MySQL | Aplicación | Transacción | HTTP esperado |
| --- | --- | --- | --- | --- |
| FK con tipo compatible | FK `RESTRICT` | Resolver entidades | Revalidar antes de escribir | 422 o 404 según recurso |
| Año y fechas de una fila válidos | `CHECK` simple | Validación de calendario | — | 422 |
| Periodo dentro del ciclo | FK no basta | Comparar fechas padre-hijo | Revalidar ciclo bloqueado | 422/409 |
| Rol y cuenta activa | FK a usuario | Resolver clave de rol y estado | Revalidar al guardar | 422/409 |
| Una asignación vigente | Índice único generado | Validación previa | Bloqueo y reemplazo conjunto | 409 |
| Intervalos sin solapar | No resoluble solo con `CHECK` | Detectar intersecciones | Bloquear grupo y asignaciones | 409 |
| Una versión activa por alcance | Índice único generado | Validación previa | Bloqueo grupo-periodo | 409 |
| Número de versión monotónico | Único por alcance | Calcular siguiente | Calcular bajo bloqueo | 409/reintento seguro |
| Hora inicial menor a final | `CHECK` de fila | Validación de entrada | — | 422 |
| Duplicado exacto | Único dentro de versión | Normalizar nulos y comparar | Insertar lote atómico | 409/422 |
| Solapamiento de grupo | — | Comparación intervalos | Validar versión completa | 409 |
| Solapamiento docente | — | Comparar otros grupos activos | Bloqueos en orden estable | 409 |
| Solapamiento aula | — | Comparar cuando hay aula | Bloqueos en orden estable | 409 |
| Archivo no XLSX real | — | Firma y estructura | Antes de transacción | 415 |
| Archivo o lote excedido | — | Límites | Antes de transacción | 413 |
| Catálogo inexistente | FK como última defensa | Resolver toda fila | Revalidar antes de insertar | 422 |
| MySQL no disponible | — | Error genérico | Rollback si inició | 503 |

## 14. Coexistencia y despliegue gradual

1. Crear catálogos vacíos con 015.
2. Agregar referencias nullable con 016.
3. Crear asignaciones e historial con 017.
4. Crear catálogos de materias y aulas con 018.
5. Crear versionado con 019 y clases con 020.
6. Cargar catálogos institucionales mediante operación separada y auditada.
7. Mapear manualmente grupos heredados, sin reinterpretación automática.
8. Activar lectura dual temporal si los consumidores la requieren.
9. Habilitar administración nueva mediante feature flag o fase controlada.
10. Importar el primer horario completo de un grupo-periodo.
11. Verificar que las proyecciones de grupo y docente coincidan.
12. Activar la autorización del orientador después de asignar todos los grupos necesarios.
13. Retirar el código huérfano asociado a 013/014 solo después de validar el reemplazo.
14. Conservar `ciclo_escolar`; no retirarlo en esta secuencia.

### Rollback por migración

| Migración | Antes de exponer funciones | Con datos reales | Desactivación funcional segura |
| --- | --- | --- | --- |
| 015 | Retirar catálogos si están vacíos | Conservar tablas y desactivar administración | Feature flag de catálogos |
| 016 | Retirar columnas nullable si vacías | Mantener referencias y volver a lectura legado | Desactivar escritura normalizada |
| 017 | Retirar tablas si vacías | Conservar historial; no borrar asignaciones | Desactivar restricción de alcance y edición |
| 018 | Retirar catálogos si vacíos | Conservar materias/aulas inactivas e históricas | Desactivar mantenimiento |
| 019 | Retirar tablas si vacías | Conservar importaciones/versiones | Desactivar importación y mantener lectura |
| 020 | Retirar tabla si vacía | Conservar clases y volver temporalmente a módulos desconectados solo si fueran compatibles | Desactivar proyecciones nuevas |
| 021 | Retirar tabla si vacía | Conservar bloques históricos | Desactivar gestión no lectiva |

Una vez creados datos reales, rollback significa desactivar funcionalidad y aplicar una migración compensatoria ensayada; no implica destruir históricos ni editar migraciones ya aplicadas.

## 15. Matriz de transición

| Estado v008 | Estado coexistente | Estado normalizado | Condición para avanzar |
| --- | --- | --- | --- |
| `ciclo_escolar` literal | Literal preservado más FK nullable | Grupo con generación y periodo explícitos | Mapeo institucional aprobado y verificado |
| Sin generación catalogada | Catálogo cargado, grupos aún nullable | Todos los grupos relacionados | Cero grupos pendientes |
| Sin periodo normalizado | Ciclos/periodos cargados | Periodo válido por grupo | Fechas oficiales y correspondencia aprobadas |
| Sin asignaciones | Historial disponible sin restricción activa | Un orientador vigente por grupo requerido | Cobertura completa antes de limitar acceso |
| Sin materias/aulas | Catálogos cargados | Referencias válidas en clases | Catálogos institucionales aprobados |
| Sin horarios activos nuevos | Versionado vacío o en piloto | Una versión activa por grupo-periodo importado | Primera importación validada |
| Horarios 013/014 desconectados | Código antiguo preservado y nueva lectura bajo flag | Solo clases programadas como fuente | Proyecciones equivalentes verificadas |
| Orientador con alcance global legado | Asignaciones cargadas, restricción aún apagada | Acceso por asignación vigente | Política histórica y cobertura listas |

## 16. Pendientes institucionales

- Política de acceso histórico del orientador al finalizar su asignación.
- Catálogo real de materias.
- Catálogo real y nomenclatura de aulas.
- Calendario académico oficial.
- Plantilla XLSX definitiva y su versión inicial.
- Conservación del archivo temporal y original de importación.
- Roles autorizados para revertir versiones.
- Límites institucionales mínimo y máximo de duración.

Estos pendientes no impiden crear estructuras nullable, catálogos vacíos y mecanismos de versionado. Sí impiden activar restricciones finales, cargar valores supuestos o importar datos reales.

## 17. Criterios contractuales de aceptación

- El runner usa manifiesto explícito y bloqueo exclusivo.
- `baseline-v008` verifica huella estructural y checksums antes de registrar 001–008.
- 009 y 011–014 permanecen `SUPERSEDED_NOT_APPLIED`; 010 permanece `RESERVED_MISSING`.
- Una migración aplicada con checksum cambiado detiene el proceso.
- Ninguna migración nueva transforma automáticamente datos heredados.
- Las FK coinciden con los tipos vigentes y usan `RESTRICT` para datos históricos.
- No se usan `ENUM`, triggers ni `ON DELETE CASCADE` en el modelo propuesto.
- Cada versión abarca exactamente un grupo-periodo y contiene todas sus clases.
- Una sola versión está activa por alcance y las anteriores son inmutables.
- Horarios de grupo y docente derivan de `clases_programadas`.
- Vista previa, confirmación y activación están separadas.
- Cualquier fallo transaccional conserva la versión activa anterior.
- Una reversión crea una nueva operación y versión auditable.
- El despliegue puede desactivarse funcionalmente sin destruir históricos.

## 18. Diccionario de datos unificado

Esta matriz consolida el contrato propuesto. “Fecha actual” representa el patrón `TIMESTAMP` ya utilizado por el proyecto; “actualización automática” se reserva para columnas `actualizado_en`.

| Tabla | Columna | Tipo propuesto | Nullable | Default | Clave o índice | Significado |
| --- | --- | --- | --- | --- | --- | --- |
| `schema_migrations` | `version` | `VARCHAR(20)` ASCII | No | — | Única/PK | Versión lógica |
| `schema_migrations` | `archivo` | `VARCHAR(255)` | No | — | Única | Nombre lógico |
| `schema_migrations` | `checksum_sha256` | `CHAR(64)` ASCII binario | No | — | Validación SHA-256 | Huella inmutable |
| `schema_migrations` | `aplicada_en` | `TIMESTAMP` | No | fecha actual | — | Aplicación exitosa |
| `schema_migrations` | `duracion_ms` | `BIGINT UNSIGNED` | No | — | — | Duración |
| `schema_migrations` | `lote_ejecucion` | `CHAR(36)` ASCII | Sí | nulo | Índice opcional | Lote lógico |
| `schema_migrations` | `tipo_registro` | `VARCHAR(20)` | No | — | Validación de clave | Ejecutada o baseline |
| `generaciones` | `id` | `INT UNSIGNED` | No | autogenerado | PK | Identidad |
| `generaciones` | `anio_inicio` | `SMALLINT UNSIGNED` | No | — | Único compuesto | Inicio de cohorte |
| `generaciones` | `anio_fin` | `SMALLINT UNSIGNED` | No | — | Único compuesto | Fin de cohorte |
| `generaciones` | `activo` | `BOOLEAN` | No | verdadero | Índice sujeto a selectividad | Estado |
| `generaciones` | `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `generaciones` | `actualizado_en` | `TIMESTAMP` | No | fecha actual y actualización automática | — | Auditoría |
| `ciclos_escolares` | `id` | `INT UNSIGNED` | No | autogenerado | PK | Identidad |
| `ciclos_escolares` | `clave` | `VARCHAR(30)` | No | — | Única | Clave semántica |
| `ciclos_escolares` | `nombre` | `VARCHAR(100)` | No | — | — | Nombre institucional |
| `ciclos_escolares` | `fecha_inicio` | `DATE` | No | — | Temporal opcional | Inicio |
| `ciclos_escolares` | `fecha_fin` | `DATE` | No | — | — | Fin |
| `ciclos_escolares` | `activo` | `BOOLEAN` | No | verdadero | Índice sujeto a selectividad | Estado |
| `ciclos_escolares` | `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `ciclos_escolares` | `actualizado_en` | `TIMESTAMP` | No | fecha actual y actualización automática | — | Auditoría |
| `periodos_academicos` | `id` | `INT UNSIGNED` | No | autogenerado | PK | Identidad |
| `periodos_academicos` | `ciclo_escolar_id` | `INT UNSIGNED` | No | — | FK e índice | Ciclo padre |
| `periodos_academicos` | `clave` | `VARCHAR(30)` | No | — | Única con ciclo | Clave semántica |
| `periodos_academicos` | `nombre` | `VARCHAR(100)` | No | — | — | Nombre |
| `periodos_academicos` | `fecha_inicio` | `DATE` | No | — | Temporal opcional | Inicio |
| `periodos_academicos` | `fecha_fin` | `DATE` | No | — | — | Fin |
| `periodos_academicos` | `activo` | `BOOLEAN` | No | verdadero | Índice sujeto a selectividad | Estado |
| `periodos_academicos` | `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `periodos_academicos` | `actualizado_en` | `TIMESTAMP` | No | fecha actual y actualización automática | — | Auditoría |
| `grupos` | `generacion_id` | `INT UNSIGNED` | Sí | nulo | FK e índice | Generación normalizada futura |
| `grupos` | `periodo_academico_id` | `INT UNSIGNED` | Sí | nulo | FK e índice | Periodo normalizado futuro |
| `asignaciones_orientador_grupo` | `id` | `BIGINT UNSIGNED` | No | autogenerado | PK | Identidad histórica |
| `asignaciones_orientador_grupo` | `grupo_id` | `INT UNSIGNED` | No | — | FK e índices | Grupo |
| `asignaciones_orientador_grupo` | `orientador_usuario_id` | `BIGINT UNSIGNED` | No | — | FK e índice | Orientador |
| `asignaciones_orientador_grupo` | `fecha_inicio` | `DATE` | No | — | Índice de intervalo | Inicio |
| `asignaciones_orientador_grupo` | `fecha_fin` | `DATE` | Sí | nulo | Índice de intervalo | Fin inclusivo |
| `asignaciones_orientador_grupo` | `creado_por_usuario_id` | `BIGINT UNSIGNED` | No | — | FK | Administrador autor |
| `asignaciones_orientador_grupo` | `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `asignaciones_orientador_grupo` | `actualizado_en` | `TIMESTAMP` | No | fecha actual y actualización automática | — | Auditoría |
| `asignaciones_tutor_grupo` | `id` | `BIGINT UNSIGNED` | No | autogenerado | PK | Identidad histórica |
| `asignaciones_tutor_grupo` | `grupo_id` | `INT UNSIGNED` | No | — | FK e índices | Grupo |
| `asignaciones_tutor_grupo` | `tutor_usuario_id` | `BIGINT UNSIGNED` | No | — | FK e índice | Docente tutor |
| `asignaciones_tutor_grupo` | `fecha_inicio` | `DATE` | No | — | Índice de intervalo | Inicio |
| `asignaciones_tutor_grupo` | `fecha_fin` | `DATE` | Sí | nulo | Índice de intervalo | Fin inclusivo |
| `asignaciones_tutor_grupo` | `creado_por_usuario_id` | `BIGINT UNSIGNED` | No | — | FK | Administrador autor |
| `asignaciones_tutor_grupo` | `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `asignaciones_tutor_grupo` | `actualizado_en` | `TIMESTAMP` | No | fecha actual y actualización automática | — | Auditoría |
| `materias` | `id` | `INT UNSIGNED` | No | autogenerado | PK | Identidad |
| `materias` | `clave` | `VARCHAR(30)` | No | — | Única | Clave institucional |
| `materias` | `nombre` | `VARCHAR(150)` | No | — | — | Nombre normalizado |
| `materias` | `activo` | `BOOLEAN` | No | verdadero | Índice sujeto a selectividad | Estado |
| `materias` | `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `materias` | `actualizado_en` | `TIMESTAMP` | No | fecha actual y actualización automática | — | Auditoría |
| `aulas` | `id` | `INT UNSIGNED` | No | autogenerado | PK | Identidad |
| `aulas` | `clave` | `VARCHAR(30)` | No | — | Única | Clave del espacio |
| `aulas` | `nombre` | `VARCHAR(100)` | No | — | — | Nombre normalizado |
| `aulas` | `activo` | `BOOLEAN` | No | verdadero | Índice sujeto a selectividad | Estado |
| `aulas` | `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `aulas` | `actualizado_en` | `TIMESTAMP` | No | fecha actual y actualización automática | — | Auditoría |
| `importaciones_horario` | `id` | `BIGINT UNSIGNED` | No | autogenerado | PK | Operación |
| `importaciones_horario` | `grupo_id` | `INT UNSIGNED` | No | — | FK e índice de alcance | Grupo |
| `importaciones_horario` | `periodo_academico_id` | `INT UNSIGNED` | No | — | FK e índice de alcance | Periodo |
| `importaciones_horario` | `usuario_administrador_id` | `BIGINT UNSIGNED` | No | — | FK | Autor |
| `importaciones_horario` | `nombre_archivo_original` | `VARCHAR(255)` | No | — | — | Nombre saneado |
| `importaciones_horario` | `checksum_sha256` | `CHAR(64)` ASCII binario | No | — | Índice opcional | Integridad |
| `importaciones_horario` | `tamano_bytes` | `BIGINT UNSIGNED` | No | — | — | Tamaño |
| `importaciones_horario` | `clave_resultado` | `VARCHAR(30)` | No | — | Índice sujeto a selectividad | Resultado controlado |
| `importaciones_horario` | `filas_totales` | `INT UNSIGNED` | No | 0 | — | Total |
| `importaciones_horario` | `filas_validas` | `INT UNSIGNED` | No | 0 | — | Válidas |
| `importaciones_horario` | `filas_con_error` | `INT UNSIGNED` | No | 0 | — | Inválidas |
| `importaciones_horario` | `advertencias` | `TEXT` | Sí | nulo | — | Resumen seguro |
| `importaciones_horario` | `creado_en` | `TIMESTAMP` | No | fecha actual | Índice temporal | Inicio |
| `importaciones_horario` | `confirmado_en` | `TIMESTAMP` | Sí | nulo | — | Confirmación |
| `importaciones_horario` | `finalizado_en` | `TIMESTAMP` | Sí | nulo | — | Finalización |
| `versiones_horario` | `id` | `BIGINT UNSIGNED` | No | autogenerado | PK | Versión |
| `versiones_horario` | `grupo_id` | `INT UNSIGNED` | No | — | FK y alcance | Grupo |
| `versiones_horario` | `periodo_academico_id` | `INT UNSIGNED` | No | — | FK y alcance | Periodo |
| `versiones_horario` | `numero_version` | `INT UNSIGNED` | No | — | Único por alcance | Secuencia |
| `versiones_horario` | `importacion_id` | `BIGINT UNSIGNED` | Sí | nulo | FK única si aplica | Origen |
| `versiones_horario` | `version_origen_id` | `BIGINT UNSIGNED` | Sí | nulo | FK autorreferente | Reversión |
| `versiones_horario` | `es_activa` | `BOOLEAN` | No | falso | Unicidad generada | Vigencia |
| `versiones_horario` | `activada_en` | `TIMESTAMP` | Sí | nulo | — | Activación |
| `versiones_horario` | `reemplazada_en` | `TIMESTAMP` | Sí | nulo | — | Sustitución |
| `versiones_horario` | `creada_por_usuario_id` | `BIGINT UNSIGNED` | No | — | FK | Autor |
| `versiones_horario` | `creado_en` | `TIMESTAMP` | No | fecha actual | Índice temporal | Auditoría |
| `clases_programadas` | `id` | `BIGINT UNSIGNED` | No | autogenerado | PK | Clase |
| `clases_programadas` | `version_horario_id` | `BIGINT UNSIGNED` | No | — | FK e índices | Versión |
| `clases_programadas` | `docente_usuario_id` | `BIGINT UNSIGNED` | No | — | FK e índice temporal | Docente |
| `clases_programadas` | `materia_id` | `INT UNSIGNED` | No | — | FK e índice | Materia |
| `clases_programadas` | `aula_id` | `INT UNSIGNED` | Sí | nulo | FK e índice temporal | Aula opcional |
| `clases_programadas` | `dia_semana` | `TINYINT UNSIGNED` | No | — | Índices temporales | Día normalizado |
| `clases_programadas` | `hora_inicio` | `TIME` | No | — | Índices temporales | Inicio |
| `clases_programadas` | `hora_fin` | `TIME` | No | — | Índices temporales | Fin |
| `clases_programadas` | `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `actividades_docente_no_lectivas` | `id` | `BIGINT UNSIGNED` | No | autogenerado | PK | Actividad |
| `actividades_docente_no_lectivas` | `docente_usuario_id` | `BIGINT UNSIGNED` | No | — | FK e índice temporal | Docente |
| `actividades_docente_no_lectivas` | `periodo_academico_id` | `INT UNSIGNED` | No | — | FK e índice temporal | Periodo |
| `actividades_docente_no_lectivas` | `concepto` | `VARCHAR(100)` | No | — | — | Concepto controlado |
| `actividades_docente_no_lectivas` | `dia_semana` | `TINYINT UNSIGNED` | No | — | Índice temporal | Día |
| `actividades_docente_no_lectivas` | `hora_inicio` | `TIME` | No | — | Índice temporal | Inicio |
| `actividades_docente_no_lectivas` | `hora_fin` | `TIME` | No | — | Índice temporal | Fin |
| `actividades_docente_no_lectivas` | `aula_id` | `INT UNSIGNED` | Sí | nulo | FK e índice temporal | Aula opcional |
| `actividades_docente_no_lectivas` | `activo` | `BOOLEAN` | No | verdadero | Índice sujeto a selectividad | Estado |
| `actividades_docente_no_lectivas` | `creado_en` | `TIMESTAMP` | No | fecha actual | — | Auditoría |
| `actividades_docente_no_lectivas` | `actualizado_en` | `TIMESTAMP` | No | fecha actual y actualización automática | — | Auditoría |
