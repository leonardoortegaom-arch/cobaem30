const XLSX = require('xlsx');
const usuarioModel = require('../models/usuarioModel');
const docenteHorarioModel = require('../models/docenteHorarioModel');
const crearMenuAdmin = require('../config/adminMenu');

const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
const NOMBRES_DIAS = { LUNES: 'Lunes', MARTES: 'Martes', MIERCOLES: 'Miércoles', JUEVES: 'Jueves', VIERNES: 'Viernes', SABADO: 'Sábado' };
const texto = (valor) => String(valor ?? '').trim();
const clave = (valor) => texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
const obtenerId = (valor) => Number.isSafeInteger(Number(valor)) && Number(valor) > 0 ? Number(valor) : null;
const convertirHora = (valor) => {
    const match = /^(\d{1,2}):00(?::00)?$/.exec(texto(valor));
    if (!match || Number(match[1]) < 7 || Number(match[1]) > 14) return null;
    return `${String(Number(match[1])).padStart(2, '0')}:00:00`;
};

const localizarEncabezado = (rows) => rows.findIndex((row) => {
    const headers = row.map(clave);
    return headers.some((header) => header === 'HORA' || header === 'HORARIO')
        && DIAS.filter((dia) => headers.includes(dia)).length >= 3;
});

const leerPlantilla = (sheet) => {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
    const headerIndex = localizarEncabezado(rows);
    if (headerIndex < 0) throw new Error('ENCABEZADOS');
    const headers = rows[headerIndex].map(clave);
    const horaColumn = headers.findIndex((header) => header === 'HORA' || header === 'HORARIO');
    const columnas = new Map();
    headers.forEach((header, index) => { if (DIAS.includes(header)) columnas.set(header, index); });
    const filas = [];
    rows.slice(headerIndex + 1).forEach((row) => {
        const match = /^(\d{1,2}:\d{2})\s*\/\s*(\d{1,2}:\d{2})$/.exec(texto(row[horaColumn]));
        const horaInicio = convertirHora(match?.[1]);
        const horaFin = convertirHora(match?.[2]);
        if (!horaInicio || !horaFin || horaInicio >= horaFin) return;
        columnas.forEach((index, dia) => {
            const contenido = texto(row[index]);
            if (!contenido) return;
            const detalleMatch = /\[([^\]]+)\]\s*$/i.exec(contenido);
            const detalle = detalleMatch ? texto(detalleMatch[1]) : '';
            const esGrupo = /^(?:gpo|grupo)\b/i.test(detalle);
            filas.push({ dia, horaInicio, horaFin, materia: texto(detalleMatch ? contenido.slice(0, detalleMatch.index) : contenido), grupo: esGrupo ? detalle : '', aula: esGrupo ? '' : detalle });
        });
    });
    return filas.filter((fila) => fila.materia);
};

const renderizar = (res, { docente, clases = [], error = null, exito = false, eliminado = false } = {}) => res.render('admin/usuarios/horario', { title: 'Horario docente | COBAEM 30', menuItems: crearMenuAdmin('usuarios'), docente, clases, dias: DIAS, nombresDias: NOMBRES_DIAS, error, exito, eliminado });

const mostrar = async (req, res) => {
    const docenteId = obtenerId(req.params.id);
    if (!docenteId) return res.status(404).send('Docente no encontrado.');
    try {
        const docente = await usuarioModel.buscarPorIdConRol(docenteId);
        if (!docente || docente.rol_clave !== 'DOCENTE') return res.status(404).send('Docente no encontrado.');
        const clases = await docenteHorarioModel.listarPorDocente(docenteId);
        return renderizar(res, { docente, clases, exito: req.query.guardado === '1' || req.query.eliminado === '1', eliminado: req.query.eliminado === '1' });
    } catch { return res.status(500).send('No fue posible cargar el horario docente.'); }
};

const importar = async (req, res) => {
    const docenteId = obtenerId(req.params.id);
    if (!docenteId) return res.status(404).send('Docente no encontrado.');
    try {
        const docente = await usuarioModel.buscarPorIdConRol(docenteId);
        if (!docente || docente.rol_clave !== 'DOCENTE') return res.status(404).send('Docente no encontrado.');
        if (!req.file) return renderizar(res.status(422), { docente, error: 'Selecciona un archivo Excel.' });
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.SheetNames.map((name) => workbook.Sheets[name]).find((candidate) => {
            const rows = XLSX.utils.sheet_to_json(candidate, { header: 1, defval: '', blankrows: false });
            return localizarEncabezado(rows) >= 0;
        });
        if (!sheet) throw new Error('ENCABEZADOS');
        const filas = leerPlantilla(sheet);
        if (!filas.length) return renderizar(res.status(422), { docente, error: 'El Excel no contiene clases entre 07:00 y 14:00.' });
        await docenteHorarioModel.reemplazarPorDocente(docenteId, filas);
        return res.redirect(`/admin/usuarios/${docenteId}/horario?guardado=1`);
    } catch (error) {
        console.error('Error al importar horario docente:', error);
        const docente = await usuarioModel.buscarPorIdConRol(docenteId);
        const mensaje = error.message === 'ENCABEZADOS'
            ? 'No se encontraron las columnas HORA y LUNES-SÁBADO.'
            : error.code === 'ER_DUP_ENTRY'
                ? 'Hay dos clases en el mismo bloque de día y hora.'
                : 'No fue posible importar el horario.';
        return renderizar(res.status(422), { docente, error: mensaje });
    }
};

const eliminar = async (req, res) => {
    const docenteId = obtenerId(req.params.id);
    if (!docenteId) return res.status(404).send('Docente no encontrado.');
    await docenteHorarioModel.eliminarPorDocente(docenteId);
    return res.redirect(`/admin/usuarios/${docenteId}/horario?eliminado=1`);
};

module.exports = { mostrar, importar, eliminar };