# Contrato XLSX del horario completo de un grupo

## 1. Propósito y alcance

Este documento define la única plantilla oficial de entrada para importar clases programadas. Una importación abarca exactamente **un grupo dentro de un periodo académico** y reemplazará, de forma versionada y reversible, el horario completo de ese alcance cuando exista el importador futuro.

La versión contractual inicial es **1**. El importador futuro reconocerá el tipo y la versión por la plantilla oficial, las hojas y los encabezados exactos; ninguna celda suministrada por el usuario declarará o podrá alterar esa versión.

El grupo y el periodo se seleccionan en el dashboard administrativo. No se repiten dentro del XLSX. La plantilla matricial semanal será únicamente una vista o exportación futura y no una fuente de importación.

Esta fase define el contrato y la plantilla; no implementa lectura de archivos, vista previa, rutas ni escrituras en MySQL.

## 2. Libro y hoja de datos

El archivo debe ser un XLSX real sin macros. La hoja obligatoria se llama `Clases`, debe ser la primera y contiene seis columnas exactas, sin columnas adicionales:

| Orden | Encabezado | Obligatorio | Identidad o significado |
| ---: | --- | :---: | --- |
| 1 | `DIA` | Sí | Día semanal de la clase |
| 2 | `HORA_INICIO` | Sí | Inicio del bloque |
| 3 | `HORA_FIN` | Sí | Fin del bloque |
| 4 | `MATERIA_CLAVE` | Sí | Clave estable de una materia existente |
| 5 | `DOCENTE_CORREO` | Sí | Correo de una cuenta docente existente |
| 6 | `AULA_CLAVE` | No | Clave estable de un aula existente |

Una fila representa un bloque completo de clase. Por ejemplo, un bloque de 10:00 a 12:00 ocupa una sola fila; no se divide en una fila por hora.

## 3. Reglas por columna

### `DIA`

- Es obligatorio.
- Valores admitidos: `LUNES`, `MARTES`, `MIERCOLES`, `JUEVES`, `VIERNES` y `SABADO`.
- El importador podrá normalizar mayúsculas y retirar acentos antes de validar.
- `DOMINGO` no está permitido.

### `HORA_INICIO` y `HORA_FIN`

- Son obligatorias.
- Admiten valores reales de hora de Excel o texto `HH:mm`.
- No admiten una fecha asociada.
- `HORA_INICIO` debe ser anterior a `HORA_FIN`.
- Las duraciones son flexibles.

### `MATERIA_CLAVE`

- Es obligatoria y se normalizará con `trim` y mayúsculas.
- Debe resolver una materia existente y activa mediante `materias.clave`.
- Nunca se resuelve por nombre ni por un ID interno.
- La importación no crea materias automáticamente.

### `DOCENTE_CORREO`

- Es obligatorio y se normalizará con `trim` y minúsculas de forma segura.
- Debe resolver un usuario existente, activo y con rol `DOCENTE`.
- No admite nombre, ID, contraseña ni otra credencial.
- El correo solo resuelve la cuenta; no se copia a `clases_programadas`.
- La importación no crea usuarios automáticamente.

### `AULA_CLAVE`

- Es opcional; una celda vacía significa que la clase aún no tiene aula.
- Cuando se informa, se normalizará con `trim` y mayúsculas y debe resolver un aula existente y activa mediante `aulas.clave`.
- Nunca se resuelve por nombre ni por un ID interno.
- La importación no crea aulas automáticamente.

## 4. Filas y límites

- No se permiten filas parcialmente vacías: toda fila iniciada debe satisfacer sus columnas obligatorias.
- Solo se ignoran filas completamente vacías después del área de datos.
- El archivo debe contener al menos una clase.
- El límite contractual inicial para el importador futuro será de **500 filas de clases** por archivo.
- No se aceptan encabezados duplicados, omitidos, reordenados o desconocidos.
- No se permiten fórmulas, macros ni celdas con errores.
- Las celdas que comiencen con `=`, `+`, `-` o `@` se consideran entrada no confiable y deberán rechazarse, aunque el lector las presente como texto.
- Las actividades administrativas, tutorías y demás actividades no lectivas no pertenecen a esta plantilla.

## 5. Prevalidación futura

La vista previa futura no escribirá en MySQL y escapará todo valor al presentarlo. Antes de permitir una confirmación deberá detectar, como mínimo:

- bloques duplicados;
- solapamientos del grupo objetivo;
- solapamientos del docente;
- solapamientos del aula cuando exista;
- materia inexistente o inactiva;
- docente inexistente, inactivo o con rol distinto de `DOCENTE`;
- aula inexistente o inactiva;
- día u hora inválidos;
- grupo o periodo inválidos;
- archivo sin clases;
- fórmulas, errores de celda, macros, encabezados duplicados o columnas desconocidas.

El grupo y el periodo seleccionados son parte del alcance autorizado del dashboard, no datos confiados al archivo. La prevalidación completa deberá repetirse dentro de la confirmación transaccional futura.

## 6. Privacidad y seguridad

La plantilla no contiene nombres completos, matrículas, contraseñas ni IDs internos. `DOCENTE_CORREO` se usa únicamente para resolver la cuenta y no se conserva como duplicado en las clases programadas. Ningún valor del XLSX debe renderizarse como HTML ni interpretarse como fórmula o comando.

Los cuatro XLSX históricos mencionados durante el rediseño no estaban accesibles al definir este contrato y no se incorporan como fuente oficial. Los importadores matriciales preservados quedan fuera de esta especificación.

## 7. Plantilla versionada

La plantilla oficial se conserva en `public/templates/plantilla_importacion_horario_grupo.xlsx` y se genera explícitamente con `npm run templates:generate-group-schedule`. Contiene:

1. `Clases`, con únicamente los seis encabezados, fila superior congelada, filtros, anchos adecuados y formato de hora para las columnas correspondientes.
2. `Instrucciones`, con un resumen operativo de este contrato.

No contiene filas demostrativas, fórmulas, macros, imágenes externas ni datos personales.
