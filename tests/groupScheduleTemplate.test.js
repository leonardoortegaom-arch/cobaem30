const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const XLSX = require('xlsx');

const projectRoot = path.resolve(__dirname, '..');
const templatePath = path.join(projectRoot, 'public', 'templates', 'plantilla_importacion_horario_grupo.xlsx');
const scriptPath = path.join(projectRoot, 'scripts', 'generateGroupScheduleTemplate.js');
const packageLockPath = path.join(projectRoot, 'package-lock.json');
const expectedHeaders = ['DIA', 'HORA_INICIO', 'HORA_FIN', 'MATERIA_CLAVE', 'DOCENTE_CORREO', 'AULA_CLAVE'];
const generator = require(scriptPath);

function readWorkbook(filePath = templatePath) {
    return XLSX.readFile(filePath, { cellStyles: true, bookVBA: true, cellFormula: true });
}

function sheetRows(workbook, sheetName) {
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', blankrows: false });
}

function workbookStructure(filePath) {
    const workbook = readWorkbook(filePath);
    return {
        sheets: workbook.SheetNames,
        clases: sheetRows(workbook, 'Clases'),
        instrucciones: sheetRows(workbook, 'Instrucciones'),
        filter: workbook.Sheets.Clases['!autofilter'],
        widths: workbook.Sheets.Clases['!cols'].map((column) => column.wch)
    };
}

function workbookText(workbook) {
    return workbook.SheetNames
        .flatMap((name) => sheetRows(workbook, name).flat())
        .map((value) => String(value))
        .join('\n');
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function zipEntryText(filePath, suffix) {
    const container = XLSX.CFB.read(fs.readFileSync(filePath), { type: 'buffer' });
    const index = container.FullPaths.findIndex((name) => name.endsWith(`/${suffix}`));
    assert.notEqual(index, -1, `No se encontró ${suffix}`);
    return Buffer.from(container.FileIndex[index].content).toString('utf8');
}

test('01 la plantilla oficial existe', () => {
    assert.ok(fs.statSync(templatePath).isFile());
    assert.ok(fs.statSync(templatePath).size > 0);
});

test('02 el archivo es un XLSX válido con filtro, congelación, formato de hora y estilo institucional', () => {
    const workbook = readWorkbook();
    assert.equal(workbook.bookType, undefined);
    assert.deepEqual(workbook.Sheets.Clases['!autofilter'], { ref: 'A1:F1' });
    const sheetXml = zipEntryText(templatePath, 'xl/worksheets/sheet1.xml');
    assert.match(sheetXml, /<pane[^>]+ySplit="1"[^>]+state="frozen"/);
    assert.match(sheetXml, /<col min="2" max="2"[^>]+style="2"/);
    assert.match(sheetXml, /<col min="3" max="3"[^>]+style="2"/);
    assert.equal(workbook.Sheets.Clases.A1.s.fgColor.rgb, '6F1D3D');
});

test('03 no contiene macros', () => {
    const workbook = readWorkbook();
    assert.equal(workbook.vbaraw, undefined);
    const container = XLSX.CFB.read(fs.readFileSync(templatePath), { type: 'buffer' });
    assert.equal(container.FullPaths.some((name) => /vbaProject\.bin$/i.test(name)), false);
    assert.equal(container.FullPaths.some((name) => /xl\/(?:externalLinks|media|drawings)\//i.test(name)), false);
});

test('04 contiene exactamente dos hojas', () => {
    assert.deepEqual(readWorkbook().SheetNames, ['Clases', 'Instrucciones']);
});

test('05 Clases es la primera hoja', () => {
    assert.equal(readWorkbook().SheetNames[0], 'Clases');
});

test('06 los encabezados son exactos y conservan el orden contractual', () => {
    assert.deepEqual(sheetRows(readWorkbook(), 'Clases')[0], expectedHeaders);
});

test('07 Clases no contiene filas de ejemplo', () => {
    assert.deepEqual(sheetRows(readWorkbook(), 'Clases'), [expectedHeaders]);
});

test('08 ninguna hoja contiene fórmulas', () => {
    const workbook = readWorkbook();
    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        for (const cellName of Object.keys(sheet).filter((name) => !name.startsWith('!'))) {
            assert.equal(sheet[cellName].f, undefined);
        }
    }
});

test('09 no contiene datos personales', () => {
    const text = workbookText(readWorkbook());
    assert.doesNotMatch(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    assert.doesNotMatch(text, /matr[ií]cula|nombre completo|sesion|contrase[nñ]a real/i);
});

test('10 no solicita ni contiene IDs internos como columnas de datos', () => {
    assert.equal(expectedHeaders.some((header) => /(^|_)ID($|_)/.test(header)), false);
    assert.doesNotMatch(expectedHeaders.join(' '), /GRUPO_ID|PERIODO_ACADEMICO_ID|DOCENTE_ID|MATERIA_ID|AULA_ID/);
});

test('11 Instrucciones cubre el alcance, filas, referencias, horas, encabezados, seguridad y prevalidación', () => {
    const text = workbookText(readWorkbook()).toUpperCase();
    for (const expected of ['GRUPO', 'PERIODO ACADEMICO', 'CADA FILA', 'MATERIA_CLAVE', 'DOCENTE_CORREO', 'AULA_CLAVE', 'HH:MM', 'NO CAMBIES', 'FORMULAS', 'MACROS', 'ANTES DE CONFIRMAR', '500 FILAS']) {
        assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('12 DOMINGO no aparece como valor permitido', () => {
    const text = workbookText(readWorkbook()).toUpperCase();
    assert.match(text, /DOMINGO NO ESTA PERMITIDO/);
    const permittedSegment = text.match(/VALORES ADMITIDOS: ([^.]+)/)?.[1] ?? '';
    assert.doesNotMatch(permittedSegment, /DOMINGO/);
});

test('13 AULA_CLAVE se documenta como opcional', () => {
    const rows = sheetRows(readWorkbook(), 'Instrucciones');
    assert.ok(rows.some((row) => row[0] === 'AULA_CLAVE' && /^Opcional\./.test(row[1])));
});

test('14 DOCENTE_CORREO se documenta como obligatorio', () => {
    const rows = sheetRows(readWorkbook(), 'Instrucciones');
    assert.ok(rows.some((row) => row[0] === 'DOCENTE_CORREO' && /^Obligatorio\./.test(row[1])));
});

test('15 el generador funciona desde fuera del directorio del proyecto', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cobaem30-template-cwd-'));
    const output = path.join(temporaryDirectory, 'nested', 'template.xlsx');
    const previousCwd = process.cwd();
    try {
        process.chdir(temporaryDirectory);
        assert.equal(generator.generarPlantilla(output), output);
        assert.deepEqual(readWorkbook(output).SheetNames, ['Clases', 'Instrucciones']);
    } finally {
        process.chdir(previousCwd);
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});

test('16 una copia regenerada conserva la misma estructura', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cobaem30-template-structure-'));
    const output = path.join(temporaryDirectory, 'template.xlsx');
    try {
        generator.generarPlantilla(output);
        assert.deepEqual(workbookStructure(output), workbookStructure(templatePath));
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});

test('17 importar el módulo no modifica la plantilla oficial', () => {
    const before = sha256(templatePath);
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(scriptPath)})`], {
        cwd: os.tmpdir(),
        encoding: 'utf8'
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(sha256(templatePath), before);
});

test('18 los XLSX históricos no se incorporan como fuentes oficiales', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    assert.doesNotMatch(source, /adminGrupoHorarioController|adminDocenteHorarioController|grupo_horarios|docente_horarios/);
    assert.equal(generator.crearLibro.length, 0);
});

test('19 el generador no accede a MySQL ni carga configuración', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    assert.doesNotMatch(source, /mysql2|dotenv|config[\\/]database|MIGRATION_DB_|DB_PASSWORD|DB_USER/);
});

test('20 generar una copia temporal no modifica package-lock.json', () => {
    const before = sha256(packageLockPath);
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cobaem30-template-lock-'));
    try {
        generator.generarPlantilla(path.join(temporaryDirectory, 'template.xlsx'));
        assert.equal(sha256(packageLockPath), before);
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});
