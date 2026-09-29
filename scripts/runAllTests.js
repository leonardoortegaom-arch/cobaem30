'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(PROJECT_ROOT, 'tests');

function listarPruebas(directorio = TESTS_DIR) {
    const archivos = fs.readdirSync(directorio, { withFileTypes: true })
        .filter((entrada) => entrada.isFile() && entrada.name.endsWith('.test.js'))
        .map((entrada) => path.join(directorio, entrada.name));

    archivos.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return archivos;
}

function main(opciones = {}) {
    const escribirError = opciones.escribirError || ((mensaje) => process.stderr.write(`${mensaje}\n`));
    let archivos;

    try {
        archivos = listarPruebas(opciones.testsDir || TESTS_DIR);
    } catch {
        escribirError('No fue posible localizar la suite de pruebas.');
        return 1;
    }

    if (archivos.length === 0) {
        escribirError('No se encontraron archivos de prueba.');
        return 1;
    }

    const ejecutar = opciones.spawnSync || spawnSync;
    const resultado = ejecutar(process.execPath, ['--test', ...archivos], {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        shell: false
    });

    if (resultado.error || !Number.isInteger(resultado.status)) {
        escribirError('No fue posible iniciar la suite de pruebas.');
        return 1;
    }

    return resultado.status;
}

if (require.main === module) {
    process.exitCode = main();
}

module.exports = { PROJECT_ROOT, TESTS_DIR, listarPruebas, main };
