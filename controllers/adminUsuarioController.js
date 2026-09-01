const bcrypt = require('bcrypt');

const usuarioModel = require('../models/usuarioModel');
const rolModel = require('../models/rolModel');
const alumnoModel = require('../models/alumnoModel');
const grupoModel = require('../models/grupoModel');
const adminUsuarioService = require('../services/adminUsuarioService');
const crearMenuAdmin = require('../config/adminMenu');

const RONDAS_BCRYPT = 12;
const CORREO_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const datosVacios = {
    nombre: '',
    apellido_paterno: '',
    apellido_materno: '',
    correo: '',
    rol_id: '',
    matricula: '',
    grupo_id: ''
};

const normalizarCampo = (valor) => typeof valor === 'string' ? valor.trim() : '';

const obtenerDatosFormulario = (body = {}) => ({
    nombre: normalizarCampo(body.nombre),
    apellido_paterno: normalizarCampo(body.apellido_paterno),
    apellido_materno: normalizarCampo(body.apellido_materno),
    correo: normalizarCampo(body.correo).toLowerCase(),
    rol_id: normalizarCampo(body.rol_id),
    matricula: normalizarCampo(body.matricula),
    grupo_id: normalizarCampo(body.grupo_id)
});

const obtenerIdPositivo = (valor) => {
    const id = Number(valor);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const validarDatosGenerales = (datos) => {
    if (!datos.nombre) return 'El nombre es obligatorio.';
    if (datos.nombre.length > 100) return 'El nombre no puede superar 100 caracteres.';
    if (!datos.apellido_paterno) return 'El apellido paterno es obligatorio.';
    if (datos.apellido_paterno.length > 80) return 'El apellido paterno no puede superar 80 caracteres.';
    if (datos.apellido_materno.length > 80) return 'El apellido materno no puede superar 80 caracteres.';
    if (!datos.correo) return 'El correo es obligatorio.';
    if (datos.correo.length > 150 || !CORREO_REGEX.test(datos.correo)) {
        return 'El correo no tiene un formato válido.';
    }

    const rolId = Number(datos.rol_id);
    if (!Number.isInteger(rolId) || rolId <= 0) return 'Selecciona un rol válido.';

    return null;
};

const renderizarFormulario = async (res, { status = 200, error = null, datos = datosVacios } = {}) => {
    const [roles, grupos] = await Promise.all([
        rolModel.listarTodos(),
        grupoModel.listarActivosParaSeleccion()
    ]);

    return res.status(status).render('admin/usuarios/nuevo', {
        title: 'Crear usuario | COBAEM 30',
        menuItems: crearMenuAdmin('usuarios'),
        roles,
        grupos,
        error,
        datos
    });
};

const renderizarFormularioEditar = async (
    res,
    { status = 200, error = null, datos, esUsuarioActual, rolActualClave }
) => {
    const roles = await rolModel.listarTodos();

    return res.status(status).render('admin/usuarios/editar', {
        title: 'Editar usuario | COBAEM 30',
        menuItems: crearMenuAdmin('usuarios'),
        roles,
        error,
        datos,
        esUsuarioActual,
        rolActualClave
    });
};

const renderizarPerfilAlumno = async (
    res,
    { status = 200, error = null, usuario, perfil, datos }
) => {
    const gruposActivos = await grupoModel.listarActivosParaSeleccion();
    const grupos = gruposActivos.map((grupo) => ({ ...grupo, activo: true }));

    if (!grupos.some((grupo) => Number(grupo.id) === Number(perfil.grupo_id))) {
        grupos.push({
            id: perfil.grupo_id,
            clave: perfil.grupo_clave,
            semestre: perfil.semestre,
            ciclo_escolar: perfil.ciclo_escolar,
            turno_clave: perfil.turno_clave,
            turno_nombre: perfil.turno_nombre,
            activo: Boolean(perfil.grupo_activo)
        });
    }

    return res.status(status).render('admin/usuarios/alumno', {
        title: 'Perfil académico del alumno | COBAEM 30',
        menuItems: crearMenuAdmin('usuarios'),
        usuario,
        perfil,
        grupos,
        datos,
        error
    });
};

const listarUsuarios = async (req, res) => {
    try {
        const roles = await rolModel.listarTodos();
        const busqueda = normalizarCampo(req.query.q).slice(0, 100);
        const rolSolicitado = normalizarCampo(req.query.rol);
        const rolClave = roles.some((rol) => rol.clave === rolSolicitado)
            ? rolSolicitado
            : '';
        const estadoSolicitado = normalizarCampo(req.query.estado);
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
            rolClave,
            activo
        };
        const totalRegistros = await usuarioModel.contarFiltrados(filtrosModelo);
        const totalPaginas = Math.max(1, Math.ceil(totalRegistros / limite));
        const paginaActual = Math.min(paginaSolicitada, totalPaginas);
        const usuarios = await usuarioModel.listarPaginado({
            ...filtrosModelo,
            limite,
            offset: (paginaActual - 1) * limite
        });
        const filtros = {
            q: busqueda,
            rol: rolClave,
            estado: typeof activo === 'boolean' ? estadoSolicitado : ''
        };
        const construirUrlPagina = (pagina) => {
            const parametros = new URLSearchParams();
            if (filtros.q) parametros.set('q', filtros.q);
            if (filtros.rol) parametros.set('rol', filtros.rol);
            if (filtros.estado) parametros.set('estado', filtros.estado);
            parametros.set('pagina', String(pagina));
            return `/admin/usuarios?${parametros.toString()}`;
        };
        const enlaces = Array.from({ length: totalPaginas }, (_, indice) => {
            const numero = indice + 1;
            return {
                numero,
                url: construirUrlPagina(numero),
                actual: numero === paginaActual
            };
        });

        res.render('admin/usuarios/index', {
            title: 'Administración de usuarios | COBAEM 30',
            usuarios,
            roles,
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
            menuItems: crearMenuAdmin('usuarios'),
            usuarioActualId: Number(req.session.usuario.id),
            mensaje: req.query.academico === 'actualizado'
                ? 'Perfil académico actualizado correctamente.'
                : req.query.password === 'restablecida'
                ? 'Contraseña restablecida correctamente. Las sesiones anteriores fueron invalidadas.'
                : req.query.estado === 'activado'
                ? 'Usuario activado correctamente.'
                : req.query.estado === 'desactivado'
                    ? 'Usuario desactivado correctamente.'
                    : req.query.actualizado === '1'
                        ? 'Usuario actualizado correctamente.'
                        : req.query.creado === '1'
                            ? 'Usuario creado correctamente.'
                            : null
        });
    } catch {
        res.status(500).send('No fue posible cargar la lista de usuarios.');
    }
};

const mostrarFormularioCrear = async (req, res) => {
    try {
        await renderizarFormulario(res);
    } catch {
        res.status(500).send('No fue posible cargar el formulario de usuario.');
    }
};

const crearUsuario = async (req, res) => {
    const datos = obtenerDatosFormulario(req.body);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const passwordConfirmacion = typeof req.body.password_confirmacion === 'string'
        ? req.body.password_confirmacion
        : '';

    const responderValidacion = async (mensaje) => {
        await renderizarFormulario(res, {
            status: 422,
            error: mensaje,
            datos
        });
    };

    try {
        if (!datos.nombre) {
            await responderValidacion('El nombre es obligatorio.');
            return;
        }

        if (datos.nombre.length > 100) {
            await responderValidacion('El nombre no puede superar 100 caracteres.');
            return;
        }

        if (!datos.apellido_paterno) {
            await responderValidacion('El apellido paterno es obligatorio.');
            return;
        }

        if (datos.apellido_paterno.length > 80) {
            await responderValidacion('El apellido paterno no puede superar 80 caracteres.');
            return;
        }

        if (datos.apellido_materno.length > 80) {
            await responderValidacion('El apellido materno no puede superar 80 caracteres.');
            return;
        }

        if (!datos.correo) {
            await responderValidacion('El correo es obligatorio.');
            return;
        }

        if (datos.correo.length > 150 || !CORREO_REGEX.test(datos.correo)) {
            await responderValidacion('El correo no tiene un formato válido.');
            return;
        }

        const rolId = Number(datos.rol_id);
        if (!Number.isInteger(rolId) || rolId <= 0) {
            await responderValidacion('Selecciona un rol válido.');
            return;
        }

        const rol = await rolModel.buscarPorId(rolId);
        if (!rol) {
            await responderValidacion('Selecciona un rol válido.');
            return;
        }

        let alumno = null;
        if (rol.clave === 'ALUMNO') {
            if (!/^\d{9}$/.test(datos.matricula)) {
                await responderValidacion('La matrícula debe contener exactamente nueve dígitos.');
                return;
            }

            const matriculaExistente = await alumnoModel.buscarPorMatricula(datos.matricula);
            if (matriculaExistente) {
                await responderValidacion('La matrícula ya está registrada.');
                return;
            }

            const grupoId = Number(datos.grupo_id);
            if (!Number.isSafeInteger(grupoId) || grupoId <= 0) {
                await responderValidacion('Selecciona un grupo activo válido.');
                return;
            }

            const grupo = await grupoModel.buscarActivoPorId(grupoId);
            if (!grupo) {
                await responderValidacion('Selecciona un grupo activo válido.');
                return;
            }

            alumno = {
                matricula: datos.matricula,
                grupo_id: grupo.id
            };
        }

        if (!password) {
            await responderValidacion('La contraseña es obligatoria.');
            return;
        }

        if (password.length < 12) {
            await responderValidacion('La contraseña debe tener al menos 12 caracteres.');
            return;
        }

        if (Buffer.byteLength(password, 'utf8') > 72) {
            await responderValidacion('La contraseña no puede superar 72 bytes.');
            return;
        }

        if (password !== passwordConfirmacion) {
            await responderValidacion('La confirmación de contraseña no coincide.');
            return;
        }

        const usuarioExistente = await usuarioModel.buscarPorCorreo(datos.correo);
        if (usuarioExistente) {
            await responderValidacion('El correo ya está registrado.');
            return;
        }

        const passwordHash = await bcrypt.hash(password, RONDAS_BCRYPT);
        await adminUsuarioService.crearUsuarioConPerfil({
            usuario: {
                rol_id: rol.id,
                nombre: datos.nombre,
                apellido_paterno: datos.apellido_paterno,
                apellido_materno: datos.apellido_materno || null,
                correo: datos.correo,
                password_hash: passwordHash,
                activo: true
            },
            alumno
        });

        res.redirect('/admin/usuarios?creado=1');
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            try {
                await responderValidacion('No fue posible crear el usuario porque alguno de los datos ya está registrado.');
            } catch {
                res.status(500).send('No fue posible crear el usuario.');
            }
            return;
        }

        res.status(500).send('No fue posible crear el usuario.');
    }
};

const mostrarFormularioEditar = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Usuario no encontrado.');
        return;
    }

    try {
        const usuario = await usuarioModel.buscarPorIdConRol(id);
        if (!usuario) {
            res.status(404).send('Usuario no encontrado.');
            return;
        }

        await renderizarFormularioEditar(res, {
            datos: {
                id: usuario.id,
                nombre: usuario.nombre,
                apellido_paterno: usuario.apellido_paterno,
                apellido_materno: usuario.apellido_materno || '',
                correo: usuario.correo,
                rol_id: String(usuario.rol_id)
            },
            esUsuarioActual: Number(req.session.usuario.id) === id,
            rolActualClave: usuario.rol_clave
        });
    } catch {
        res.status(500).send('No fue posible cargar el usuario.');
    }
};

const actualizarUsuario = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Usuario no encontrado.');
        return;
    }

    const datos = {
        id,
        ...obtenerDatosFormulario(req.body)
    };

    try {
        const usuarioActual = await usuarioModel.buscarPorIdConRol(id);
        if (!usuarioActual) {
            res.status(404).send('Usuario no encontrado.');
            return;
        }

        const esUsuarioActual = Number(req.session.usuario.id) === id;
        const responderValidacion = async (mensaje) => {
            await renderizarFormularioEditar(res, {
                status: 422,
                error: mensaje,
                datos,
                esUsuarioActual,
                rolActualClave: usuarioActual.rol_clave
            });
        };

        const errorValidacion = validarDatosGenerales(datos);
        if (errorValidacion) {
            await responderValidacion(errorValidacion);
            return;
        }

        const rolId = Number(datos.rol_id);
        const rol = await rolModel.buscarPorId(rolId);
        if (!rol) {
            await responderValidacion('Selecciona un rol válido.');
            return;
        }

        const cambiaHaciaAlumno = usuarioActual.rol_clave !== 'ALUMNO' && rol.clave === 'ALUMNO';
        const cambiaDesdeAlumno = usuarioActual.rol_clave === 'ALUMNO' && rol.clave !== 'ALUMNO';
        if (cambiaHaciaAlumno || cambiaDesdeAlumno) {
            await responderValidacion(
                'El cambio hacia o desde el rol Alumno debe realizarse desde el módulo académico correspondiente.'
            );
            return;
        }

        if (esUsuarioActual && rolId !== Number(usuarioActual.rol_id)) {
            datos.rol_id = String(usuarioActual.rol_id);
            await responderValidacion('No puedes cambiar el rol de tu propia cuenta.');
            return;
        }

        const usuarioConCorreo = await usuarioModel.buscarPorCorreo(datos.correo);
        if (usuarioConCorreo && Number(usuarioConCorreo.id) !== id) {
            await responderValidacion('El correo ya está registrado.');
            return;
        }

        await usuarioModel.actualizarDatosYRol(id, {
            rol_id: rolId,
            nombre: datos.nombre,
            apellido_paterno: datos.apellido_paterno,
            apellido_materno: datos.apellido_materno || null,
            correo: datos.correo
        });

        res.redirect('/admin/usuarios?actualizado=1');
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            try {
                const usuarioActual = await usuarioModel.buscarPorIdConRol(id);
                await renderizarFormularioEditar(res, {
                    status: 422,
                    error: 'El correo ya está registrado.',
                    datos,
                    esUsuarioActual: Number(req.session.usuario.id) === id,
                    rolActualClave: usuarioActual.rol_clave
                });
            } catch {
                res.status(500).send('No fue posible actualizar el usuario.');
            }
            return;
        }

        res.status(500).send('No fue posible actualizar el usuario.');
    }
};

const mostrarPerfilAlumno = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Usuario no encontrado.');
        return;
    }

    try {
        const usuario = await usuarioModel.buscarPorIdConRol(id);
        if (!usuario) {
            res.status(404).send('Usuario no encontrado.');
            return;
        }

        if (usuario.rol_clave !== 'ALUMNO') {
            res.status(422).send('El usuario seleccionado no tiene un perfil académico de Alumno.');
            return;
        }

        const perfil = await alumnoModel.buscarPorUsuarioIdConGrupo(id);
        if (!perfil) {
            res.status(404).send('Perfil académico no encontrado.');
            return;
        }

        await renderizarPerfilAlumno(res, {
            usuario,
            perfil,
            datos: {
                matricula: perfil.matricula,
                grupo_id: String(perfil.grupo_id)
            }
        });
    } catch {
        res.status(500).send('No fue posible cargar el perfil académico.');
    }
};

const actualizarPerfilAlumno = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Usuario no encontrado.');
        return;
    }

    const datos = {
        matricula: normalizarCampo(req.body.matricula),
        grupo_id: normalizarCampo(req.body.grupo_id)
    };

    try {
        const usuario = await usuarioModel.buscarPorIdConRol(id);
        if (!usuario) {
            res.status(404).send('Usuario no encontrado.');
            return;
        }

        if (usuario.rol_clave !== 'ALUMNO') {
            res.status(422).send('El usuario seleccionado no tiene un perfil académico de Alumno.');
            return;
        }

        const perfil = await alumnoModel.buscarPorUsuarioIdConGrupo(id);
        if (!perfil) {
            res.status(404).send('Perfil académico no encontrado.');
            return;
        }

        const responderValidacion = async (mensaje) => renderizarPerfilAlumno(res, {
            status: 422,
            error: mensaje,
            usuario,
            perfil,
            datos
        });

        if (!/^\d{9}$/.test(datos.matricula)) {
            await responderValidacion('La matrícula debe contener exactamente nueve dígitos.');
            return;
        }

        const matriculaExistente = await alumnoModel.buscarPorMatricula(datos.matricula);
        if (matriculaExistente && Number(matriculaExistente.usuario_id) !== id) {
            await responderValidacion('La matrícula ya está registrada.');
            return;
        }

        const grupoId = Number(datos.grupo_id);
        if (!Number.isSafeInteger(grupoId) || grupoId <= 0) {
            await responderValidacion('Selecciona un grupo válido.');
            return;
        }

        const grupoSeleccionado = await grupoModel.buscarPorIdConTurno(grupoId);
        if (!grupoSeleccionado) {
            await responderValidacion('El grupo seleccionado no existe.');
            return;
        }

        const conservaGrupoActual = grupoId === Number(perfil.grupo_id);
        if (!conservaGrupoActual && !grupoSeleccionado.activo) {
            await responderValidacion('Solo puedes asignar un grupo activo.');
            return;
        }

        const conservaMatricula = datos.matricula === perfil.matricula;
        if (conservaMatricula && conservaGrupoActual) {
            res.redirect('/admin/usuarios?academico=actualizado');
            return;
        }

        await alumnoModel.actualizarPerfil(id, datos.matricula, grupoId);
        res.redirect('/admin/usuarios?academico=actualizado');
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            try {
                const usuario = await usuarioModel.buscarPorIdConRol(id);
                const perfil = await alumnoModel.buscarPorUsuarioIdConGrupo(id);
                await renderizarPerfilAlumno(res, {
                    status: 422,
                    error: 'La matrícula ya está registrada.',
                    usuario,
                    perfil,
                    datos
                });
            } catch {
                res.status(500).send('No fue posible actualizar el perfil académico.');
            }
            return;
        }

        res.status(500).send('No fue posible actualizar el perfil académico.');
    }
};

const mostrarConfirmacionEstado = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Usuario no encontrado.');
        return;
    }

    try {
        const usuarioObjetivo = await usuarioModel.buscarPorIdConRol(id);
        if (!usuarioObjetivo) {
            res.status(404).send('Usuario no encontrado.');
            return;
        }

        const esUsuarioActual = Number(req.session.usuario.id) === id;
        res.status(esUsuarioActual ? 403 : 200).render('admin/usuarios/estado', {
            title: 'Estado de usuario | COBAEM 30',
            menuItems: crearMenuAdmin('usuarios'),
            usuarioObjetivo,
            accion: usuarioObjetivo.activo ? 'desactivar' : 'activar',
            error: esUsuarioActual
                ? 'No puedes cambiar el estado de tu propia cuenta.'
                : null
        });
    } catch {
        res.status(500).send('No fue posible cargar el usuario.');
    }
};

const cambiarEstado = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Usuario no encontrado.');
        return;
    }

    try {
        const usuarioObjetivo = await usuarioModel.buscarPorIdConRol(id);
        if (!usuarioObjetivo) {
            res.status(404).send('Usuario no encontrado.');
            return;
        }

        if (Number(req.session.usuario.id) === id) {
            res.status(403).send('No puedes cambiar el estado de tu propia cuenta.');
            return;
        }

        const accion = typeof req.body.accion === 'string' ? req.body.accion : '';
        if (!['activar', 'desactivar'].includes(accion)) {
            res.status(422).send('La acción solicitada no es válida.');
            return;
        }

        const activar = accion === 'activar';
        if (Boolean(usuarioObjetivo.activo) === activar) {
            res.redirect(`/admin/usuarios?estado=${activar ? 'activado' : 'desactivado'}`);
            return;
        }

        await usuarioModel.actualizarEstado(id, activar);
        res.redirect(`/admin/usuarios?estado=${activar ? 'activado' : 'desactivado'}`);
    } catch {
        res.status(500).send('No fue posible cambiar el estado del usuario.');
    }
};

const renderizarFormularioPassword = (res, { status = 200, usuarioObjetivo, error = null }) => res
    .status(status)
    .render('admin/usuarios/password', {
        title: 'Restablecer contraseña | COBAEM 30',
        menuItems: crearMenuAdmin('usuarios'),
        usuarioObjetivo,
        error
    });

const mostrarFormularioPassword = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Usuario no encontrado.');
        return;
    }

    try {
        const usuarioObjetivo = await usuarioModel.buscarPorIdConRol(id);
        if (!usuarioObjetivo) {
            res.status(404).send('Usuario no encontrado.');
            return;
        }

        if (Number(req.session.usuario.id) === id) {
            res.status(403).send('No puedes restablecer tu propia contraseña desde esta función.');
            return;
        }

        renderizarFormularioPassword(res, { usuarioObjetivo });
    } catch {
        res.status(500).send('No fue posible cargar el usuario.');
    }
};

const restablecerPassword = async (req, res) => {
    const id = obtenerIdPositivo(req.params.id);
    if (!id) {
        res.status(404).send('Usuario no encontrado.');
        return;
    }

    try {
        const usuarioObjetivo = await usuarioModel.buscarPorIdConRol(id);
        if (!usuarioObjetivo) {
            res.status(404).send('Usuario no encontrado.');
            return;
        }

        if (Number(req.session.usuario.id) === id) {
            res.status(403).send('No puedes restablecer tu propia contraseña desde esta función.');
            return;
        }

        const password = typeof req.body.password === 'string' ? req.body.password : '';
        const passwordConfirmacion = typeof req.body.password_confirmacion === 'string'
            ? req.body.password_confirmacion
            : '';
        const responderValidacion = (mensaje) => renderizarFormularioPassword(res, {
            status: 422,
            usuarioObjetivo,
            error: mensaje
        });

        if (!password) {
            responderValidacion('La contraseña es obligatoria.');
            return;
        }

        if (password.length < 12) {
            responderValidacion('La contraseña debe tener al menos 12 caracteres.');
            return;
        }

        if (Buffer.byteLength(password, 'utf8') > 72) {
            responderValidacion('La contraseña no puede superar 72 bytes.');
            return;
        }

        if (password !== passwordConfirmacion) {
            responderValidacion('La confirmación de contraseña no coincide.');
            return;
        }

        const passwordHash = await bcrypt.hash(password, RONDAS_BCRYPT);
        const resultado = await usuarioModel.actualizarPasswordEInvalidarSesiones(id, passwordHash);
        if (resultado.affectedRows !== 1) {
            throw new Error('No se actualizó el usuario esperado.');
        }

        res.redirect('/admin/usuarios?password=restablecida');
    } catch {
        res.status(500).send('No fue posible restablecer la contraseña.');
    }
};

module.exports = {
    listarUsuarios,
    mostrarFormularioCrear,
    crearUsuario,
    mostrarFormularioEditar,
    actualizarUsuario,
    mostrarPerfilAlumno,
    actualizarPerfilAlumno,
    mostrarConfirmacionEstado,
    cambiarEstado,
    mostrarFormularioPassword,
    restablecerPassword
};
