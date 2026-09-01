const grupoModel = require('../models/grupoModel');
const turnoModel = require('../models/turnoModel');
const crearMenuAdmin = require('../config/adminMenu');

const datosVacios = {
    clave: '',
    semestre: '',
    turno_id: '',
    ciclo_escolar: ''
};

const normalizarTexto = (valor) => typeof valor === 'string' ? valor.trim() : '';

const obtenerDatosFormulario = (body = {}) => ({
    clave: normalizarTexto(body.clave),
    semestre: normalizarTexto(body.semestre),
    turno_id: normalizarTexto(body.turno_id),
    ciclo_escolar: normalizarTexto(body.ciclo_escolar)
});

const convertirEnteroPositivo = (valor) => {
    if (!/^\d+$/.test(valor)) return null;

    const numero = Number(valor);
    return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
};

const obtenerIdPositivo = (valor) => {
    const id = Number(valor);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const cicloEscolarValido = (valor) => {
    const coincidencia = /^(\d{4})-(\d{4})$/.exec(valor);
    return Boolean(coincidencia) && Number(coincidencia[2]) > Number(coincidencia[1]);
};

const renderizarFormulario = async (
    res,
    { status = 200, error = null, datos = datosVacios } = {}
) => {
    const turnos = await turnoModel.listarTodos();

    return res.status(status).render('admin/grupos/nuevo', {
        title: 'Crear grupo | COBAEM 30',
        menuItems: crearMenuAdmin('grupos'),
        turnos,
        error,
        datos
    });
};

const renderizarFormularioEditar = async (
    res,
    { status = 200, error = null, datos }
) => {
    const turnos = await turnoModel.listarTodos();

    return res.status(status).render('admin/grupos/editar', {
        title: 'Editar grupo | COBAEM 30',
        menuItems: crearMenuAdmin('grupos'),
        turnos,
        error,
        datos
    });
};

const listarGrupos = async (req, res) => {
    try {
        const [turnos, ciclos] = await Promise.all([
            turnoModel.listarTodos(),
            grupoModel.listarCiclosDisponibles()
        ]);
        const busqueda = normalizarTexto(req.query.q).slice(0, 10);
        const semestreSolicitado = convertirEnteroPositivo(normalizarTexto(req.query.semestre));
        const semestre = semestreSolicitado !== null && semestreSolicitado <= 6
            ? semestreSolicitado
            : undefined;
        const turnoSolicitado = convertirEnteroPositivo(normalizarTexto(req.query.turno));
        const turnoId = turnoSolicitado !== null
            && turnos.some((turno) => Number(turno.id) === turnoSolicitado)
            ? turnoSolicitado
            : undefined;
        const cicloSolicitado = normalizarTexto(req.query.ciclo);
        const cicloEscolar = ciclos.includes(cicloSolicitado) ? cicloSolicitado : '';
        const estadoSolicitado = normalizarTexto(req.query.estado);
        const activo = estadoSolicitado === 'activo'
            ? true
            : estadoSolicitado === 'inactivo'
                ? false
                : undefined;
        const paginaSolicitada = typeof req.query.pagina === 'string'
            && /^\d+$/.test(req.query.pagina)
            && Number(req.query.pagina) > 0
            ? Number(req.query.pagina)
            : 1;
        const limite = 10;
        const filtrosModelo = {
            busqueda,
            semestre,
            turnoId,
            cicloEscolar,
            activo
        };
        const totalRegistros = await grupoModel.contarFiltrados(filtrosModelo);
        const totalPaginas = Math.max(1, Math.ceil(totalRegistros / limite));
        const paginaActual = Math.min(paginaSolicitada, totalPaginas);
        const grupos = await grupoModel.listarPaginado({
            ...filtrosModelo,
            limite,
            offset: (paginaActual - 1) * limite
        });
        const filtros = {
            q: busqueda,
            semestre: semestre ? String(semestre) : '',
            turno: turnoId ? String(turnoId) : '',
            ciclo: cicloEscolar,
            estado: typeof activo === 'boolean' ? estadoSolicitado : ''
        };
        const construirUrlPagina = (pagina) => {
            const parametros = new URLSearchParams();
            if (filtros.q) parametros.set('q', filtros.q);
            if (filtros.semestre) parametros.set('semestre', filtros.semestre);
            if (filtros.turno) parametros.set('turno', filtros.turno);
            if (filtros.ciclo) parametros.set('ciclo', filtros.ciclo);
            if (filtros.estado) parametros.set('estado', filtros.estado);
            parametros.set('pagina', String(pagina));
            return `/admin/grupos?${parametros.toString()}`;
        };
        const enlaces = Array.from({ length: totalPaginas }, (_, indice) => {
            const numero = indice + 1;
            return {
                numero,
                url: construirUrlPagina(numero),
                actual: numero === paginaActual
            };
        });

        res.render('admin/grupos/index', {
            title: 'Administración de grupos | COBAEM 30',
            menuItems: crearMenuAdmin('grupos'),
            grupos,
            turnos,
            ciclos,
            filtros,
            paginacion: {
                paginaActual,
                totalPaginas,
                totalRegistros,
                tieneAnterior: paginaActual > 1,
                tieneSiguiente: paginaActual < totalPaginas,
                urlAnterior: paginaActual > 1 ? construirUrlPagina(paginaActual - 1) : null,
                urlSiguiente: paginaActual < totalPaginas ? construirUrlPagina(paginaActual + 1) : null,
                enlaces
            },
            mensaje: req.query.estado === 'activado'
                ? 'Grupo activado correctamente.'
                : req.query.estado === 'desactivado'
                    ? 'Grupo desactivado correctamente.'
                    : req.query.actualizado === '1'
                        ? 'Grupo actualizado correctamente.'
                        : req.query.creado === '1'
                            ? 'Grupo creado correctamente.'
                            : null
        });
    } catch {
        res.status(503).send('No fue posible cargar la lista de grupos.');
    }
};

const mostrarFormularioCrear = async (req, res) => {
    try {
        await renderizarFormulario(res);
    } catch {
        res.status(503).send('No fue posible cargar el formulario de grupo.');
    }
};

const crearGrupo = async (req, res) => {
    const datos = obtenerDatosFormulario(req.body);
    const responderValidacion = async (mensaje) => renderizarFormulario(res, {
        status: 422,
        error: mensaje,
        datos
    });

    try {
        if (!datos.clave) {
            await responderValidacion('La clave es obligatoria.');
            return;
        }

        if (!/^\d{1,10}$/.test(datos.clave)) {
            await responderValidacion('La clave debe contener exclusivamente entre 1 y 10 dígitos.');
            return;
        }

        const semestre = convertirEnteroPositivo(datos.semestre);
        if (semestre === null || semestre < 1 || semestre > 6) {
            await responderValidacion('Selecciona un semestre válido.');
            return;
        }

        const turnoId = convertirEnteroPositivo(datos.turno_id);
        if (turnoId === null) {
            await responderValidacion('Selecciona un turno válido.');
            return;
        }

        const turno = await turnoModel.buscarPorId(turnoId);
        if (!turno) {
            await responderValidacion('Selecciona un turno válido.');
            return;
        }

        if (!cicloEscolarValido(datos.ciclo_escolar)) {
            await responderValidacion('El ciclo escolar debe tener el formato AAAA-AAAA y el segundo año debe ser posterior al primero.');
            return;
        }

        const grupoExistente = await grupoModel.buscarDuplicado(
            datos.clave,
            datos.ciclo_escolar,
            turno.id
        );
        if (grupoExistente) {
            await responderValidacion('Ya existe un grupo con esa clave, ciclo escolar y turno.');
            return;
        }

        await grupoModel.crear({
            turno_id: turno.id,
            clave: datos.clave,
            semestre,
            ciclo_escolar: datos.ciclo_escolar,
            activo: true
        });

        res.redirect('/admin/grupos?creado=1');
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            try {
                await responderValidacion('Ya existe un grupo con esa clave, ciclo escolar y turno.');
            } catch {
                res.status(503).send('No fue posible crear el grupo.');
            }
            return;
        }

        res.status(503).send('No fue posible crear el grupo.');
    }
};

const mostrarFormularioEditar = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Grupo no encontrado.');
        return;
    }

    try {
        const grupo = await grupoModel.buscarPorIdConTurno(id);
        if (!grupo) {
            res.status(404).send('Grupo no encontrado.');
            return;
        }

        await renderizarFormularioEditar(res, {
            datos: {
                id: grupo.id,
                clave: grupo.clave,
                semestre: String(grupo.semestre),
                turno_id: String(grupo.turno_id),
                ciclo_escolar: grupo.ciclo_escolar
            }
        });
    } catch {
        res.status(503).send('No fue posible cargar el grupo.');
    }
};

const actualizarGrupo = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Grupo no encontrado.');
        return;
    }

    const datos = {
        id,
        ...obtenerDatosFormulario(req.body)
    };

    const responderValidacion = async (mensaje) => renderizarFormularioEditar(res, {
        status: 422,
        error: mensaje,
        datos
    });

    try {
        const grupoActual = await grupoModel.buscarPorIdConTurno(id);
        if (!grupoActual) {
            res.status(404).send('Grupo no encontrado.');
            return;
        }

        if (!datos.clave) {
            await responderValidacion('La clave es obligatoria.');
            return;
        }

        if (!/^\d{1,10}$/.test(datos.clave)) {
            await responderValidacion('La clave debe contener exclusivamente entre 1 y 10 dígitos.');
            return;
        }

        const semestre = convertirEnteroPositivo(datos.semestre);
        if (semestre === null || semestre < 1 || semestre > 6) {
            await responderValidacion('Selecciona un semestre válido.');
            return;
        }

        const turnoId = convertirEnteroPositivo(datos.turno_id);
        if (turnoId === null) {
            await responderValidacion('Selecciona un turno válido.');
            return;
        }

        const turno = await turnoModel.buscarPorId(turnoId);
        if (!turno) {
            await responderValidacion('Selecciona un turno válido.');
            return;
        }

        if (!cicloEscolarValido(datos.ciclo_escolar)) {
            await responderValidacion('El ciclo escolar debe tener el formato AAAA-AAAA y el segundo año debe ser posterior al primero.');
            return;
        }

        const grupoDuplicado = await grupoModel.buscarDuplicado(
            datos.clave,
            datos.ciclo_escolar,
            turno.id
        );
        if (grupoDuplicado && Number(grupoDuplicado.id) !== id) {
            await responderValidacion('Ya existe un grupo con esa clave, ciclo escolar y turno.');
            return;
        }

        await grupoModel.actualizar(id, {
            turno_id: turno.id,
            clave: datos.clave,
            semestre,
            ciclo_escolar: datos.ciclo_escolar
        });

        res.redirect('/admin/grupos?actualizado=1');
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            try {
                await responderValidacion('Ya existe un grupo con esa clave, ciclo escolar y turno.');
            } catch {
                res.status(503).send('No fue posible actualizar el grupo.');
            }
            return;
        }

        res.status(503).send('No fue posible actualizar el grupo.');
    }
};

const mostrarConfirmacionEstado = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Grupo no encontrado.');
        return;
    }

    try {
        const grupo = await grupoModel.buscarPorIdConTurno(id);
        if (!grupo) {
            res.status(404).send('Grupo no encontrado.');
            return;
        }

        res.render('admin/grupos/estado', {
            title: 'Estado de grupo | COBAEM 30',
            menuItems: crearMenuAdmin('grupos'),
            grupo,
            accion: grupo.activo ? 'desactivar' : 'activar',
            error: null
        });
    } catch {
        res.status(503).send('No fue posible cargar el grupo.');
    }
};

const cambiarEstado = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Grupo no encontrado.');
        return;
    }

    try {
        const grupo = await grupoModel.buscarPorIdConTurno(id);
        if (!grupo) {
            res.status(404).send('Grupo no encontrado.');
            return;
        }

        const accion = typeof req.body.accion === 'string' ? req.body.accion : '';
        if (!['activar', 'desactivar'].includes(accion)) {
            res.status(422).send('La acción solicitada no es válida.');
            return;
        }

        const activar = accion === 'activar';
        if (Boolean(grupo.activo) === activar) {
            res.redirect(`/admin/grupos?estado=${activar ? 'activado' : 'desactivado'}`);
            return;
        }

        await grupoModel.actualizarEstado(id, activar);
        res.redirect(`/admin/grupos?estado=${activar ? 'activado' : 'desactivado'}`);
    } catch {
        res.status(503).send('No fue posible cambiar el estado del grupo.');
    }
};

const mostrarConfirmacionEliminar = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Grupo no encontrado.');
        return;
    }

    try {
        const grupo = await grupoModel.buscarPorIdConTurno(id);
        if (!grupo) {
            res.status(404).send('Grupo no encontrado.');
            return;
        }

        const totalAlumnos = await grupoModel.contarAlumnosPorGrupo(id);
        res.render('admin/grupos/estado', {
            title: 'Eliminar grupo | COBAEM 30',
            menuItems: crearMenuAdmin('grupos'),
            grupo,
            accion: 'eliminar',
            totalAlumnos,
            error: null
        });
    } catch {
        res.status(503).send('No fue posible cargar el grupo.');
    }
};

const eliminarGrupo = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Grupo no encontrado.');
        return;
    }

    try {
        const grupo = await grupoModel.buscarPorIdConTurno(id);
        if (!grupo) {
            res.status(404).send('Grupo no encontrado.');
            return;
        }

        const totalAlumnos = await grupoModel.contarAlumnosPorGrupo(id);
        if (totalAlumnos > 0) {
            res.status(409).send('No se puede eliminar un grupo que tiene alumnos registrados.');
            return;
        }

        await grupoModel.eliminar(id);
        res.redirect('/admin/grupos?eliminado=1');
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
            res.status(409).send('No se puede eliminar este grupo porque tiene información relacionada.');
            return;
        }
        res.status(503).send('No fue posible eliminar el grupo.');
    }
};

module.exports = {
    listarGrupos,
    mostrarFormularioCrear,
    crearGrupo,
    mostrarFormularioEditar,
    actualizarGrupo,
    mostrarConfirmacionEstado,
    cambiarEstado,
    mostrarConfirmacionEliminar,
    eliminarGrupo
};
