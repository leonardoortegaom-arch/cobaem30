const crearMenuAdmin = require('./adminMenu');

const menusPorRol = {
    DOCENTE: [
        { texto: 'Inicio', icono: 'fa-solid fa-house', url: '/dashboard/docente', activo: true },
        { texto: 'Asistencia', icono: 'fa-solid fa-clipboard-check', url: '#' },
        { texto: 'Actividades', icono: 'fa-solid fa-book-open', url: '#' },
        { texto: 'Alumnos', icono: 'fa-solid fa-users', url: '#' },
        { texto: 'Reportes', icono: 'fa-solid fa-chart-line', url: '#' }
    ],
    ALUMNO: [
        { texto: 'Inicio', icono: 'fa-solid fa-house', url: '/dashboard/alumno', activo: true },
        { texto: 'Mis materias', icono: 'fa-solid fa-book', url: '/alumno/materias' },
        { texto: 'Actividades', icono: 'fa-solid fa-list-check', url: '/alumno/actividades' },
        { texto: 'Seguimiento', icono: 'fa-solid fa-chart-line', deshabilitado: true },
        { texto: 'Perfil', icono: 'fa-solid fa-user', url: '#' }
    ],
    ORIENTADOR: [
        { texto: 'Inicio', icono: 'fa-solid fa-house', url: '/dashboard/orientador', activo: true },
        { texto: 'Alumnos', icono: 'fa-solid fa-user-graduate', url: '/orientador/alumnos' },
        { texto: 'Seguimiento', icono: 'fa-solid fa-clipboard-list', url: '/orientador/seguimientos' },
        { texto: 'Reportes', icono: 'fa-solid fa-file-lines', url: '/orientador/reportes' },
        { texto: 'Historial', icono: 'fa-solid fa-chart-line', url: '/orientador/historial' }
    ]
};

const crearMenuPorRol = (rol, { dashboardActivo = true, opcionActiva = null } = {}) => {
    if (rol === 'ADMINISTRADOR') {
        return crearMenuAdmin(dashboardActivo ? 'dashboard' : null);
    }

    const menu = menusPorRol[rol] || [];
    return menu.map((item) => ({
        ...item,
        activo: opcionActiva ? item.url === opcionActiva : dashboardActivo && Boolean(item.activo)
    }));
};

module.exports = crearMenuPorRol;
