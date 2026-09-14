const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_PATH = path.join(
    PROJECT_ROOT,
    'public',
    'templates',
    'plantilla_importacion_horario_grupo.xlsx'
);

const HEADERS = Object.freeze([
    'DIA',
    'HORA_INICIO',
    'HORA_FIN',
    'MATERIA_CLAVE',
    'DOCENTE_CORREO',
    'AULA_CLAVE'
]);

const INSTRUCTIONS = Object.freeze([
    ['Plantilla de importacion del horario completo de un grupo'],
    ['Alcance', 'Selecciona el grupo y el periodo academico en el sistema; no los agregues al archivo.'],
    ['Una fila', 'Cada fila representa una clase completa, incluso si el bloque dura varias horas.'],
    ['Referencias', 'MATERIA_CLAVE, DOCENTE_CORREO y, cuando se use, AULA_CLAVE deben existir previamente y estar activos.'],
    ['DIA obligatorio', 'Valores admitidos: LUNES, MARTES, MIERCOLES, JUEVES, VIERNES y SABADO. DOMINGO no esta permitido.'],
    ['Horas obligatorias', 'HORA_INICIO y HORA_FIN aceptan una hora real de Excel o texto HH:mm, sin fecha; el inicio debe ser anterior al fin.'],
    ['MATERIA_CLAVE', 'Obligatoria. Usa la clave de la materia, no su nombre ni un ID interno.'],
    ['DOCENTE_CORREO', 'Obligatorio. Usa el correo de una cuenta DOCENTE existente y activa; no incluyas nombres ni contrasenas.'],
    ['AULA_CLAVE', 'Opcional. Dejala vacia si la clase aun no tiene aula; si se indica, debe ser una clave activa.'],
    ['Encabezados', 'No cambies, dupliques ni agregues encabezados o columnas.'],
    ['Contenido', 'No uses formulas, macros, errores de celda ni filas parcialmente vacias. Celdas que comiencen con =, +, - o @ no son confiables y se rechazaran.'],
    ['Exclusiones', 'No agregues actividades administrativas, tutorias ni actividades no lectivas.'],
    ['Validacion', 'Los errores y conflictos se mostraran antes de confirmar; la vista previa no modifica la base de datos.'],
    ['Limite futuro', 'El importador admitira como maximo 500 filas de clases por archivo.']
]);

function crearLibro() {
    const workbook = XLSX.utils.book_new();
    workbook.Props = {
        Title: 'Plantilla de importacion del horario completo de un grupo',
        Subject: 'Contrato tabular de clases por grupo y periodo academico',
        Author: 'COBAEM 30',
        Company: 'COBAEM 30',
        CreatedDate: new Date('2000-01-01T00:00:00.000Z')
    };

    const clases = XLSX.utils.aoa_to_sheet([HEADERS]);
    clases['!autofilter'] = { ref: 'A1:F1' };
    clases['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
    clases['!cols'] = [
        { wch: 15 },
        { wch: 16, z: 'hh:mm' },
        { wch: 16, z: 'hh:mm' },
        { wch: 22 },
        { wch: 34 },
        { wch: 20 }
    ];
    clases['!rows'] = [{ hpt: 24 }];
    const instrucciones = XLSX.utils.aoa_to_sheet(INSTRUCTIONS);
    instrucciones['!cols'] = [{ wch: 24 }, { wch: 110 }];
    instrucciones['!rows'] = [{ hpt: 26 }];

    XLSX.utils.book_append_sheet(workbook, clases, 'Clases');
    XLSX.utils.book_append_sheet(workbook, instrucciones, 'Instrucciones');
    return workbook;
}

function obtenerEntrada(contenedor, sufijo) {
    const indice = contenedor.FullPaths.findIndex((nombre) => nombre.endsWith(`/${sufijo}`));
    if (indice < 0) throw new Error('ESTRUCTURA_XLSX_INESPERADA');
    return contenedor.FileIndex[indice];
}

function aplicarPresentacionXlsx(rutaDestino) {
    const contenedor = XLSX.CFB.read(fs.readFileSync(rutaDestino), { type: 'buffer' });
    const hojaClases = obtenerEntrada(contenedor, 'xl/worksheets/sheet1.xml');
    const hojaInstrucciones = obtenerEntrada(contenedor, 'xl/worksheets/sheet2.xml');
    const estilos = obtenerEntrada(contenedor, 'xl/styles.xml');

    let xmlClases = Buffer.from(hojaClases.content).toString('utf8');
    xmlClases = xmlClases
        .replace(
            '<sheetViews><sheetView workbookViewId="0"/></sheetViews>',
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
        )
        .replace(/<col min="([23])" max="\1"([^>]*)\/>/g, '<col min="$1" max="$1"$2 style="2"/>')
        .replace(/<c r="([A-F]1)"/g, '<c r="$1" s="1"');

    let xmlInstrucciones = Buffer.from(hojaInstrucciones.content).toString('utf8');
    xmlInstrucciones = xmlInstrucciones.replace('<c r="A1"', '<c r="A1" s="1"');

    let xmlEstilos = Buffer.from(estilos.content).toString('utf8');
    xmlEstilos = xmlEstilos
        .replace(
            '<fonts count="1">',
            '<fonts count="2">'
        )
        .replace(
            '</fonts>',
            '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>'
        )
        .replace(
            '<fills count="2">',
            '<fills count="3">'
        )
        .replace(
            '</fills>',
            '<fill><patternFill patternType="solid"><fgColor rgb="FF6F1D3D"/><bgColor indexed="64"/></patternFill></fill></fills>'
        )
        .replace(
            '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>',
            '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="20" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
        );

    hojaClases.content = Buffer.from(xmlClases, 'utf8');
    hojaClases.size = hojaClases.content.length;
    hojaInstrucciones.content = Buffer.from(xmlInstrucciones, 'utf8');
    hojaInstrucciones.size = hojaInstrucciones.content.length;
    estilos.content = Buffer.from(xmlEstilos, 'utf8');
    estilos.size = estilos.content.length;
    fs.writeFileSync(rutaDestino, XLSX.CFB.write(contenedor, { type: 'buffer', fileType: 'zip', compression: true }));
}

function generarPlantilla(rutaDestino = DEFAULT_OUTPUT_PATH) {
    const destino = path.resolve(rutaDestino);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    XLSX.writeFile(crearLibro(), destino, {
        bookType: 'xlsx',
        compression: true,
        cellStyles: true
    });
    aplicarPresentacionXlsx(destino);
    return destino;
}

function ejecutarCli(argumentos = process.argv.slice(2)) {
    if (argumentos.length > 0) {
        throw new Error('Este generador no acepta argumentos.');
    }
    const destino = generarPlantilla();
    process.stdout.write(`Plantilla generada: ${path.relative(PROJECT_ROOT, destino)}\n`);
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = ejecutarCli();
    } catch {
        process.stderr.write('No fue posible generar la plantilla.\n');
        process.exitCode = 1;
    }
}

module.exports = {
    PROJECT_ROOT,
    DEFAULT_OUTPUT_PATH,
    HEADERS,
    INSTRUCTIONS,
    crearLibro,
    aplicarPresentacionXlsx,
    generarPlantilla,
    ejecutarCli
};
