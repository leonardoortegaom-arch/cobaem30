'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const manifestModule = require('../scripts/migrationManifest');

function cargarClonReal() {
    return JSON.parse(JSON.stringify(manifestModule.cargarManifiesto()));
}

function checksumDeTexto(texto) {
    return crypto.createHash('sha256')
        .update(manifestModule.normalizarContenidoParaChecksum(texto), 'utf8')
        .digest('hex');
}

function conDirectorioTemporal(callback) {
    const directorio = fs.mkdtempSync(path.join(os.tmpdir(), 'cobaem30-manifest-'));
    try {
        return callback(directorio);
    } finally {
        fs.rmSync(directorio, { recursive: true, force: true });
    }
}

function manifiestoMinimo(archivo, checksum) {
    return {
        versionFormato: 2,
        legacyBaselineThrough: 1,
        algoritmoChecksum: 'sha256-utf8-lf-v1',
        descripcion: 'Manifiesto temporal de prueba.',
        migraciones: [{
            version: 1,
            identificador: '001',
            estado: 'ACTIVE',
            archivo,
            checksumSha256: checksum,
            descripcion: 'Migración temporal.'
        }]
    };
}

test('1. el manifiesto real tiene estructura válida', () => {
    assert.equal(manifestModule.validarEstructuraManifiesto(manifestModule.cargarManifiesto()), true);
});

test('2. todos los SQL físicos están manifestados', () => {
    const manifiesto = manifestModule.cargarManifiesto();
    const fisicos = manifestModule.listarArchivosSql();
    const declarados = manifiesto.migraciones.filter((item) => item.archivo).map((item) => item.archivo).sort();
    const esperados = [
        '000_create_schema_migrations.sql',
        '001_create_auth_tables.sql',
        '002_create_sessions_table.sql',
        '003_add_credential_version.sql',
        '004_create_groups_tables.sql',
        '005_create_students_table.sql',
        '006_create_orientation_tracking_tables.sql',
        '007_create_orientation_activity_attachments.sql',
        '008_create_written_orientation_reports.sql',
        '009_add_group_staff_assignments.sql',
        '011_add_generation_to_groups.sql',
        '012_add_semester_period_to_groups.sql',
        '013_create_group_schedules_table.sql',
        '014_create_teacher_schedules_table.sql',
        '015_create_academic_calendar_catalogs.sql',
        '016_add_academic_calendar_references_to_groups.sql',
        '017_create_group_staff_assignments.sql'
    ].sort();
    assert.deepEqual(fisicos, declarados);
    assert.deepEqual(fisicos, esperados);
    assert.equal(fisicos.some((archivo) => archivo.startsWith('010_')), false);
    assert.equal(new Set(declarados).size, declarados.length);
});

test('3. los checksums reales coinciden', () => {
    const resultado = manifestModule.validarArchivosYChecksums(manifestModule.cargarManifiesto());
    assert.equal(resultado.totalArchivosSql, 17);
});

test('4. LF y CRLF producen el mismo checksum', () => {
    assert.equal(checksumDeTexto('uno\ndos\n'), checksumDeTexto('uno\r\ndos\r\n'));
});

test('5. un cambio real en SQL cambia el checksum', () => {
    assert.notEqual(checksumDeTexto('SELECT 1;\n'), checksumDeTexto('SELECT 2;\n'));
});

test('6. un BOM UTF-8 inicial no cambia el checksum', () => {
    const sinBom = Buffer.from('texto\n', 'utf8');
    const conBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), sinBom]);
    assert.equal(checksumDeTexto(sinBom), checksumDeTexto(conBom));
});

test('7. espacios significativos cambian el checksum', () => {
    assert.notEqual(checksumDeTexto('valor\n'), checksumDeTexto('valor \n'));
});

test('8. una versión duplicada es rechazada', () => {
    const manifiesto = cargarClonReal();
    manifiesto.migraciones.splice(2, 0, { ...manifiesto.migraciones[1] });
    assert.throws(() => manifestModule.validarEstructuraManifiesto(manifiesto));
});

test('9. un archivo duplicado es rechazado', () => {
    const manifiesto = cargarClonReal();
    manifiesto.migraciones[2].archivo = manifiesto.migraciones[1].archivo;
    assert.throws(() => manifestModule.validarEstructuraManifiesto(manifiesto), /Archivo duplicado/);
});

test('10. un estado desconocido es rechazado', () => {
    const manifiesto = cargarClonReal();
    manifiesto.migraciones[1].estado = 'INVENTADO';
    assert.throws(() => manifestModule.validarEstructuraManifiesto(manifiesto), /Estado desconocido/);
});

test('11. ACTIVE sin archivo es rechazazada', () => {
    const manifiesto = cargarClonReal();
    manifiesto.migraciones[1].archivo = null;
    manifiesto.migraciones[1].checksumSha256 = null;
    assert.throws(() => manifestModule.validarEstructuraManifiesto(manifiesto));
});

test('12. SUPERSEDED sin checksum es rechazazada', () => {
    const manifiesto = cargarClonReal();
    manifiesto.migraciones.find((item) => item.version === 9).checksumSha256 = null;
    assert.throws(() => manifestModule.validarEstructuraManifiesto(manifiesto), /Checksum inválido/);
});

test('13. RESERVED_MISSING con archivo es rechazazada', () => {
    const manifiesto = cargarClonReal();
    const entrada = manifiesto.migraciones.find((item) => item.version === 10);
    entrada.archivo = '010_invalida.sql';
    entrada.checksumSha256 = '0'.repeat(64);
    assert.throws(() => manifestModule.validarEstructuraManifiesto(manifiesto));
});

test('14. PLANNED con archivo es rechazazada', () => {
    const manifiesto = cargarClonReal();
    const entrada = manifiesto.migraciones.find((item) => item.version === 18);
    entrada.archivo = '018_invalida.sql';
    entrada.checksumSha256 = '0'.repeat(64);
    assert.throws(() => manifestModule.validarEstructuraManifiesto(manifiesto));
    const entradaReal = manifestModule.cargarManifiesto().migraciones.find((item) => item.version === 18);
    assert.deepEqual({ archivo: entradaReal.archivo, checksum: entradaReal.checksumSha256 }, { archivo: null, checksum: null });
});

test('15. una ruta con .. es rechazada', () => {
    const manifiesto = cargarClonReal();
    manifiesto.migraciones[1].archivo = '../001.sql';
    assert.throws(() => manifestModule.validarEstructuraManifiesto(manifiesto), /inseguro/);
});

test('16. una ruta absoluta es rechazada', () => {
    const manifiesto = cargarClonReal();
    manifiesto.migraciones[1].archivo = path.resolve('001.sql');
    assert.throws(() => manifestModule.validarEstructuraManifiesto(manifiesto), /inseguro/);
});

test('17. un SQL físico no manifestado es detectado', () => {
    conDirectorioTemporal((directorio) => {
        fs.writeFileSync(path.join(directorio, 'extra.sql'), 'SELECT 1;\n', 'utf8');
        assert.throws(
            () => manifestModule.validarArchivosYChecksums(cargarClonReal(), { directorioMigraciones: directorio }),
            /SQL físico no manifestado/
        );
    });
});

test('18. un archivo esperado ausente es detectado', () => {
    conDirectorioTemporal((directorio) => {
        const manifiesto = manifiestoMinimo('001_ausente.sql', '0'.repeat(64));
        assert.throws(
            () => manifestModule.validarArchivosYChecksums(manifiesto, { directorioMigraciones: directorio }),
            /Archivo esperado ausente/
        );
    });
});

test('19. un checksum modificado es detectado', () => {
    const manifiesto = cargarClonReal();
    manifiesto.migraciones[0].checksumSha256 = '0'.repeat(64);
    assert.throws(() => manifestModule.validarArchivosYChecksums(manifiesto), /Checksum distinto/);
});

test('20. 010 permanece reservado y sin archivo', () => {
    const entrada = manifestModule.cargarManifiesto().migraciones.find((item) => item.version === 10);
    assert.deepEqual(
        { estado: entrada.estado, archivo: entrada.archivo, checksum: entrada.checksumSha256 },
        { estado: 'RESERVED_MISSING', archivo: null, checksum: null }
    );
});

test('21. 009 y 011–014 permanecen superseded', () => {
    const migraciones = manifestModule.cargarManifiesto().migraciones;
    for (const version of [9, 11, 12, 13, 14]) {
        const entrada = migraciones.find((item) => item.version === version);
        assert.equal(entrada.estado, 'SUPERSEDED_NOT_APPLIED');
        assert.match(entrada.checksumSha256, /^[0-9a-f]{64}$/);
    }
});

test('22. 015 está active y 016–021 permanecen planned', () => {
    const migraciones = manifestModule.cargarManifiesto().migraciones;
    const activa = migraciones.find((item) => item.version === 15);
    assert.equal(activa.estado, 'ACTIVE');
    assert.equal(activa.archivo, '015_create_academic_calendar_catalogs.sql');
    assert.match(activa.checksumSha256, /^[0-9a-f]{64}$/);
    assert.equal(
        manifestModule.calcularChecksumCanonico(path.join(manifestModule.MIGRATIONS_DIR, activa.archivo)),
        activa.checksumSha256
    );
    const activa016 = migraciones.find((item) => item.version === 16);
    assert.equal(activa016.estado, 'ACTIVE');
    assert.equal(activa016.archivo, '016_add_academic_calendar_references_to_groups.sql');
    assert.match(activa016.checksumSha256, /^[0-9a-f]{64}$/);
    assert.equal(manifestModule.calcularChecksumCanonico(path.join(manifestModule.MIGRATIONS_DIR, activa016.archivo)), activa016.checksumSha256);
    const activa017 = migraciones.find((item) => item.version === 17);
    assert.equal(activa017.estado, 'ACTIVE');
    assert.equal(activa017.archivo, '017_create_group_staff_assignments.sql');
    assert.equal(manifestModule.calcularChecksumCanonico(path.join(manifestModule.MIGRATIONS_DIR, activa017.archivo)), activa017.checksumSha256);
    for (let version = 18; version <= 21; version += 1) {
        const entrada = migraciones.find((item) => item.version === version);
        assert.equal(entrada.estado, 'PLANNED');
        assert.equal(entrada.archivo, null);
        assert.equal(entrada.checksumSha256, null);
    }
});

test('23. el módulo no importa mysql2, dotenv ni database.js', () => {
    const fuente = fs.readFileSync(path.join(manifestModule.PROJECT_ROOT, 'scripts', 'migrationManifest.js'), 'utf8');
    assert.doesNotMatch(fuente, /mysql2|dotenv|config[\\/]database|child_process|\beval\s*\(/i);
});

test('24. los comandos de escritura son rechazados', () => {
    for (const comando of ['up', 'down', 'migrate', 'apply', 'baseline-v008', 'status', 'rollback']) {
        const errores = [];
        const codigo = manifestModule.ejecutarCli([comando], { log() {}, error: (mensaje) => errores.push(mensaje) });
        assert.notEqual(codigo, 0);
        assert.equal(errores.length, 1);
    }
});

test('25. plan es estático y no presenta migraciones como aplicadas', () => {
    const salida = [];
    const errores = [];
    const codigo = manifestModule.ejecutarCli(['plan'], {
        log: (mensaje) => salida.push(mensaje),
        error: (mensaje) => errores.push(mensaje)
    });
    const texto = salida.join('\n');
    assert.equal(codigo, 0);
    assert.deepEqual(errores, []);
    assert.match(texto, /Plan estático del manifiesto/);
    assert.match(texto, /no hubo acceso a base de datos/);
    assert.doesNotMatch(texto, /aplicada en MySQL|conectado a DB/i);
    assert.equal(salida.filter((linea) => /^\d{3} \|/.test(linea)).length, 22);
});

test('26. formato 2 declara el límite del baseline legado', () => {
    const manifiesto = manifestModule.cargarManifiesto();
    assert.equal(manifiesto.versionFormato, 2);
    assert.equal(manifiesto.legacyBaselineThrough, 8);
});

test('27. ACTIVE posterior al baseline exige metadatos de ejecución', () => {
    const manifiesto = cargarClonReal();
    delete manifiesto.migraciones.find((item) => item.version === 15).execution;
    assert.throws(() => manifestModule.validarEstructuraManifiesto(manifiesto), /ejecución/);
});

test('28. contrato 015 está manifestado y protegido por checksum', () => {
    const entrada = manifestModule.cargarManifiesto().migraciones.find((item) => item.version === 15);
    assert.equal(entrada.execution.statementCount, 3);
    assert.deepEqual(entrada.execution.statements.map((item) => item.target), ['generaciones', 'ciclos_escolares', 'periodos_academicos']);
    const ruta = path.join(manifestModule.PROJECT_ROOT, entrada.execution.postconditionContract);
    assert.equal(manifestModule.calcularChecksumCanonico(ruta), entrada.execution.postconditionChecksumSha256);
});

test('29. rutas inseguras de contrato son rechazadas', () => {
    const manifiesto = cargarClonReal();
    manifiesto.migraciones.find((item) => item.version === 15).execution.postconditionContract = '../contrato.json';
    assert.throws(() => manifestModule.validarEstructuraManifiesto(manifiesto), /Contrato/);
});

test('30. precondiciones deben corresponder con los targets', () => {
    const manifiesto = cargarClonReal();
    manifiesto.migraciones.find((item) => item.version === 15).execution.preconditions[0].target = 'otra_tabla';
    assert.throws(() => manifestModule.validarEstructuraManifiesto(manifiesto), /precondici/i);
});
