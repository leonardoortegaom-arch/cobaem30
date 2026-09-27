// Fixture exclusivamente visual. El importador futuro escribirá importaciones,
// versiones y clases; al activar una versión, el modelo usará automáticamente
// MATERIA_CLAVE, DOCENTE_CORREO y AULA_CLAVE ya resueltos en sus catálogos.
module.exports = Object.freeze([
    { materiaClave: 'MAT-DEMO', materiaNombre: 'Matemáticas de demostración', materiaDescripcion: 'Contenido ficticio para visualizar el futuro horario.', docenteNombre: 'Docente demostrativo A', diaSemana: 1, horaInicio: '08:00', horaFin: '09:30', aulaNombre: 'Aula demo' },
    { materiaClave: 'MAT-DEMO', materiaNombre: 'Matemáticas de demostración', materiaDescripcion: 'Contenido ficticio para visualizar el futuro horario.', docenteNombre: 'Docente demostrativo A', diaSemana: 3, horaInicio: '08:00', horaFin: '09:30', aulaNombre: null },
    { materiaClave: 'COM-DEMO', materiaNombre: 'Comunicación de demostración', materiaDescripcion: null, docenteNombre: 'Docente demostrativo B', diaSemana: 2, horaInicio: '10:00', horaFin: '11:30', aulaNombre: 'Aula demo' },
    { materiaClave: 'CIE-DEMO', materiaNombre: 'Ciencias de demostración', materiaDescripcion: null, docenteNombre: 'Docente demostrativo A', diaSemana: 4, horaInicio: '12:00', horaFin: '13:30', aulaNombre: 'Aula demo' },
    { materiaClave: 'ING-DEMO', materiaNombre: 'Inglés de demostración', materiaDescripcion: null, docenteNombre: 'Docente demostrativo B', diaSemana: 5, horaInicio: '09:30', horaFin: '11:00', aulaNombre: null }
]);
