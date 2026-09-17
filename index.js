require('dotenv').config();

const express = require('express');
const path = require('path');

const sessionMiddleware = require('./config/session');
const {
    attachCsrfToken,
    csrfProtection,
    csrfErrorHandler
} = require('./middlewares/csrfMiddleware');

const homeRoutes = require('./routes/homeRoutes');
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const adminUsuarioRoutes = require('./routes/adminUsuarioRoutes');
const adminGrupoRoutes = require('./routes/adminGrupoRoutes');
const adminMateriaRoutes = require('./routes/adminMateriaRoutes');
const adminAulaRoutes = require('./routes/adminAulaRoutes');
const adminGeneracionRoutes = require('./routes/adminGeneracionRoutes');
const adminCicloEscolarRoutes = require('./routes/adminCicloEscolarRoutes');
const adminPeriodoAcademicoRoutes = require('./routes/adminPeriodoAcademicoRoutes');
const accountRoutes = require('./routes/accountRoutes');
const orientadorAlumnoRoutes = require('./routes/orientadorAlumnoRoutes');
const orientadorSeguimientoRoutes = require('./routes/orientadorSeguimientoRoutes');
const orientadorHistorialRoutes = require('./routes/orientadorHistorialRoutes');
const orientadorReporteRoutes = require('./routes/orientadorReporteRoutes');
const alumnoActividadRoutes = require('./routes/alumnoActividadRoutes');


const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(sessionMiddleware);
app.use(attachCsrfToken);
app.use(csrfProtection);

app.use('/', homeRoutes);
app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/admin/usuarios', adminUsuarioRoutes);
app.use('/admin/grupos', adminGrupoRoutes);
app.use('/admin/materias', adminMateriaRoutes);
app.use('/admin/aulas', adminAulaRoutes);
app.use('/admin/generaciones', adminGeneracionRoutes);
app.use('/admin/ciclos-escolares', adminCicloEscolarRoutes);
app.use('/admin/periodos-academicos', adminPeriodoAcademicoRoutes);
app.use('/mi-cuenta', accountRoutes);
app.use('/orientador/alumnos', orientadorAlumnoRoutes);
app.use('/orientador/seguimientos', orientadorSeguimientoRoutes);
app.use('/orientador/historial', orientadorHistorialRoutes);
app.use('/orientador/reportes', orientadorReporteRoutes);
app.use('/alumno/actividades', alumnoActividadRoutes);

app.use(csrfErrorHandler);

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
