const XLSX = require('xlsx');
const grupoModel = require('../models/grupoModel');
const grupoHorarioModel = require('../models/grupoHorarioModel');
const crearMenuAdmin = require('../config/adminMenu');

const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
const NOMBRES_DIAS = {
    LUNES: 'Lunes', MARTES: 'Martes', MIERCOLES: 'Miércoles',
    JUEVES: 'Jueves', VIERNES: 'Viernes', SABADO: 'Sábado'
};

const texto = (valor) => String(valor ?? '').trim();
const clave = (valor) => texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

const obtenerId = (valor) => {
    const id = Number(valor);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const convertirHora = (valor) => {
    const match = /^(\d{1,2}):00(?::00)?$/.exec(texto(valor));
    if (!match) return null;
    const hour = Number(match[1]);
    return hour >= 7 && hour <= 14 ? `${String(hour).padStart(2, '0')}:00:00` : null;
};

const localizarEncabezado = (rows) => rows.findIndex((row) => {
    const columnas = row.map(clave);
    return columnas.includes('HORA') && DIAS.filter((dia) => columnas.includes(dia)).length >= 3;
});

const leerPlantilla = (sheet) => {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
    const headerRow = localizarEncabezado(rows);
    if (headerRow < 0) throw new Error('ENCABEZADOS');

    const headers = rows[headerRow].map(clave);
    const columnasDias = new Map();
    headers.forEach((header, index) => {
        if (DIAS.includes(header)) columnasDias.set(header, index);
    });

    const filas = [];
    rows.slice(headerRow + 1).forEach((row) => {
        const match = /^(\d{1,2}:\d{2})\s*\/\s*(\d{1,2}:\d{2})$/.exec(texto(row[0]));
        const horaInicio = convertirHora(match?.[1]);
        const horaFin = convertirHora(match?.[2]);
        if (!horaInicio || !horaFin || horaInicio >= horaFin) return;
        columnasDias.forEach((columnIndex, dia) => {
            const contenido = texto(row[columnIndex]);
            if (!contenido) return;
            const aulaMatch = /\[([^\]]+)\]\s*$/.exec(contenido);
            const materia = texto(aulaMatch ? contenido.slice(0, aulaMatch.index) : contenido);
            if (materia) filas.push({
                dia,
                horaInicio,
                horaFin,
                materia,
                aula: aulaMatch ? texto(aulaMatch[1]) : ''
            });
        });
    });
    return filas;
};

const renderizar = async (res, { status = 200, grupo, clases = [], error = null, exito = false, eliminado = false } = {}) => res.status(status).render('admin/grupos/horario', {
    title: 'Horario del grupo | COBAEM 30',
    menuItems: crearMenuAdmin('grupos'),
    grupo,
    clases,
    dias: DIAS,
    nombresDias: NOMBRES_DIAS,
    error,
    exito,
    eliminado
});

const mostrar = async (req, res) => {
    const grupoId = obtenerId(req.params.id);
    if (!grupoId) return res.status(404).send('Grupo no encontrado.');
    try {
        const grupo = await grupoModel.buscarPorIdConTurno(grupoId);
        if (!grupo) return res.status(404).send('Grupo no encontrado.');
        const clases = await grupoHorarioModel.listarPorGrupo(grupoId);
        return renderizar(res, { grupo, clases, exito: req.query.guardado === '1' || req.query.eliminado === '1', eliminado: req.query.eliminado === '1' });
    } catch {
        return res.status(500).send('No fue posible cargar el horario del grupo.');
    }
};

const importar = async (req, res) => {
    const grupoId = obtenerId(req.params.id);
    if (!grupoId) return res.status(404).send('Grupo no encontrado.');
    try {
        const grupo = await grupoModel.buscarPorIdConTurno(grupoId);
        if (!grupo) return res.status(404).send('Grupo no encontrado.');
        if (!req.file) return renderizar(res.status(422), { grupo, error: 'Selecciona un archivo Excel.' });
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
        const filas = leerPlantilla(workbook.Sheets[workbook.SheetNames[0]]);
        if (!filas.length) return renderizar(res.status(422), { grupo, error: 'El Excel no contiene clases en los bloques de 07:00 a 14:00.' });
        if (filas.length > 100) return renderizar(res.status(422), { grupo, error: 'El Excel contiene demasiadas clases.' });
        await grupoHorarioModel.reemplazarPorGrupo(grupoId, filas);
        return res.redirect(`/admin/grupos/${grupoId}/horario?guardado=1`);
    } catch (error) {
        const grupo = await grupoModel.buscarPorIdConTurno(grupoId);
        const mensaje = error.message === 'ENCABEZADOS'
            ? 'No se encontraron las columnas HORA y LUNES-SÁBADO en el Excel.'
            : 'No fue posible importar el horario.';
        return renderizar(res.status(422), { grupo, error: mensaje });
    }
};

const eliminar = async (req, res) => {
    const grupoId = obtenerId(req.params.id);
    if (!grupoId) return res.status(404).send('Grupo no encontrado.');
    try {
        const grupo = await grupoModel.buscarPorIdConTurno(grupoId);
        if (!grupo) return res.status(404).send('Grupo no encontrado.');
        await grupoHorarioModel.eliminarPorGrupo(grupoId);
        return res.redirect(`/admin/grupos/${grupoId}/horario?eliminado=1`);
    } catch {
        return res.status(500).send('No fue posible eliminar el horario.');
    }
};

module.exports = { mostrar, importar, eliminar };