const adminMenuItems = [
    {
        clave: 'dashboard',
        texto: 'Inicio',
        icono: 'fa-solid fa-house',
        url: '/dashboard/admin'
    },
    {
        clave: 'usuarios',
        texto: 'Usuarios',
        icono: 'fa-solid fa-users',
        url: '/admin/usuarios'
    },
    {
        clave: 'grupos',
        texto: 'Grupos',
        icono: 'fa-solid fa-layer-group',
        url: '/admin/grupos'
    },
    {
        clave: 'materias',
        texto: 'Materias',
        icono: 'fa-solid fa-book',
        url: '#'
    },
    {
        clave: 'reportes',
        texto: 'Reportes',
        icono: 'fa-solid fa-chart-line',
        url: '#'
    },
    {
        clave: 'configuracion',
        texto: 'Configuración',
        icono: 'fa-solid fa-gear',
        url: '#'
    }
];

const crearMenuAdmin = (opcionActiva) => adminMenuItems.map((item) => ({
    texto: item.texto,
    icono: item.icono,
    url: item.url,
    activo: item.clave === opcionActiva
}));

module.exports = crearMenuAdmin;
