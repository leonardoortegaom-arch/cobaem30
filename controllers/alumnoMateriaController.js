const alumnoMateriaModel = require('../models/alumnoMateriaModel');
const demo = require('../config/studentSubjectsDemo');
const crearMenuPorRol = require('../config/roleMenus');

const DIAS = Object.freeze({ 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' });

const normalizarFila = (fila) => ({
    materiaClave: fila.materiaClave ?? fila.materia_clave,
    materiaNombre: fila.materiaNombre ?? fila.materia_nombre,
    materiaDescripcion: fila.materiaDescripcion ?? fila.materia_descripcion ?? null,
    docenteNombre: fila.docenteNombre ?? fila.docente_nombre,
    diaSemana: Number(fila.diaSemana ?? fila.dia_semana),
    horaInicio: fila.horaInicio ?? fila.hora_inicio,
    horaFin: fila.horaFin ?? fila.hora_fin,
    aulaNombre: fila.aulaNombre ?? fila.aula_nombre ?? null
});

const construirMaterias = (filas) => {
    const agrupadas = new Map();
    for (const entrada of filas.map(normalizarFila)) {
        const clave = entrada.materiaClave;
        if (!agrupadas.has(clave)) {
            agrupadas.set(clave, { clave, nombre: entrada.materiaNombre,
                descripcion: entrada.materiaDescripcion, docentes: [], bloques: [] });
        }
        const materia = agrupadas.get(clave);
        if (!materia.docentes.includes(entrada.docenteNombre)) materia.docentes.push(entrada.docenteNombre);
        materia.bloques.push({ diaNumero: entrada.diaSemana, dia: DIAS[entrada.diaSemana] || 'Día no disponible',
            horaInicio: entrada.horaInicio, horaFin: entrada.horaFin,
            aula: entrada.aulaNombre || 'Sin aula asignada' });
    }
    return [...agrupadas.values()].map((materia) => ({ ...materia,
        docentes: materia.docentes.sort((a, b) => a.localeCompare(b, 'es')),
        bloques: materia.bloques.sort((a, b) => a.diaNumero - b.diaNumero
            || a.horaInicio.localeCompare(b.horaInicio) || a.horaFin.localeCompare(b.horaFin)),
        cantidadBloques: materia.bloques.length
    })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.clave.localeCompare(b.clave, 'es'));
};

const crearMenuMaterias = () => crearMenuPorRol('ALUMNO', { dashboardActivo: false, opcionActiva: '/alumno/materias' });
const crearControlador = ({ modelo = alumnoMateriaModel, datosDemo = demo,
    entorno = () => process.env.NODE_ENV } = {}) => {
    const listar = async (req, res) => {
        const usuarioId = Number(req.session.usuario.id);
        try {
            const resultado = await modelo.obtenerEstadoAcademico(usuarioId);
            if (['NO_STUDENT_PROFILE', 'NO_GROUP'].includes(resultado.estado)) {
                return res.status(404).send('Perfil académico no encontrado.');
            }
            const demoPermitido = entorno() !== 'production'
                && ['GROUP_CALENDAR_PENDING', 'NO_ACTIVE_SCHEDULE'].includes(resultado.estado);
            const filas = demoPermitido ? datosDemo : resultado.filas;
            const materias = construirMaterias(filas);
            return res.render('alumno/materias/index', {
                title: 'Mis materias | COBAEM 30', menuItems: crearMenuMaterias(), materias,
                modoDemostracion: demoPermitido, estado: resultado.estado,
                resumen: { materias: materias.length,
                    bloques: materias.reduce((total, materia) => total + materia.cantidadBloques, 0),
                    docentes: new Set(materias.flatMap((materia) => materia.docentes)).size }
            });
        } catch {
            return res.status(503).send('No fue posible cargar tus materias. Inténtalo nuevamente.');
        }
    };
    return { listar };
};

module.exports = { ...crearControlador(), crearControlador, construirMaterias, normalizarFila };
