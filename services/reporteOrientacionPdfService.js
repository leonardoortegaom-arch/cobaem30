const PDFDocument = require('pdfkit');

const COLORS = {
    primary: '#1E3A8A',
    accent: '#2563EB',
    text: '#1F2937',
    muted: '#6B7280',
    border: '#D1D5DB',
    soft: '#F8FAFC'
};

const texto = (valor) => valor === null || valor === undefined ? '' : String(valor);

const formatearFecha = (valor) => {
    const coincidencia = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(valor));
    return coincidencia ? `${coincidencia[3]}/${coincidencia[2]}/${coincidencia[1]}` : texto(valor);
};

const generarPdf = (reporte) => new Promise((resolve, reject) => {
    const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 58, bottom: 58, left: 54, right: 54 },
        bufferPages: true,
        info: {
            Title: 'Reporte de seguimiento y orientación',
            Author: 'COBAEM 30',
            Subject: 'Seguimiento y orientación escolar'
        }
    });
    const partes = [];
    doc.on('data', (parte) => partes.push(parte));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(partes)));

    const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const limiteInferior = () => doc.page.height - doc.page.margins.bottom - 20;
    const asegurarEspacio = (alto = 80) => {
        if (doc.y + alto > limiteInferior()) doc.addPage();
    };
    const linea = () => {
        doc.moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .strokeColor(COLORS.border)
            .lineWidth(0.7)
            .stroke();
        doc.moveDown(0.6);
    };
    const tituloSeccion = (titulo) => {
        asegurarEspacio(55);
        doc.moveDown(0.5).font('Helvetica-Bold').fontSize(15).fillColor(COLORS.primary).text(titulo);
        doc.moveDown(0.25);
        linea();
    };
    const campo = (etiqueta, valor) => {
        asegurarEspacio(28);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.muted).text(`${etiqueta}:`, { continued: true });
        doc.font('Helvetica').fillColor(COLORS.text).text(` ${texto(valor)}`);
    };
    const bloque = (titulo, metadatos, contenido) => {
        asegurarEspacio(105);
        const inicio = doc.y;
        doc.rect(doc.page.margins.left, inicio, ancho, 1).fillColor(COLORS.accent).fill();
        doc.y = inicio + 9;
        doc.font('Helvetica-Bold').fontSize(11.5).fillColor(COLORS.text).text(texto(titulo));
        metadatos.forEach(([etiqueta, valor]) => campo(etiqueta, valor));
        doc.moveDown(0.35).font('Helvetica').fontSize(10).fillColor(COLORS.text).text(texto(contenido), {
            width: ancho,
            align: 'left',
            lineGap: 2
        });
        doc.moveDown(0.8);
    };

    doc.font('Helvetica-Bold').fontSize(19).fillColor(COLORS.primary).text('COBAEM 30');
    doc.fontSize(16).fillColor(COLORS.text).text('Reporte de seguimiento y orientación');
    doc.moveDown(0.6);
    campo('Fecha de generación', formatearFecha(reporte.fechaGeneracion));
    campo('Periodo consultado', `${formatearFecha(reporte.periodo.desde)} a ${formatearFecha(reporte.periodo.hasta)}`);
    campo('Orientador', `${texto(reporte.orientador.nombre)} · ${texto(reporte.orientador.rol)}`);

    tituloSeccion('Datos del alumno');
    campo('Nombre completo', reporte.alumno.nombre);
    campo('Correo', reporte.alumno.correo);
    campo('Matrícula', reporte.alumno.matricula);
    campo('Grupo', reporte.alumno.grupo);
    campo('Semestre', reporte.alumno.semestre);
    campo('Turno', reporte.alumno.turno);
    campo('Ciclo escolar', reporte.alumno.ciclo);
    campo('Estado de la cuenta', reporte.alumno.activo ? 'Activo' : 'Inactivo');
    campo('Estado del grupo', reporte.alumno.grupoActivo ? 'Activo' : 'Inactivo');

    tituloSeccion('Resumen');
    campo('Total de seguimientos', reporte.resumen.totalSeguimientos);
    reporte.resumen.seguimientosPorTipo.forEach((item) => campo(`Tipo ${item.nombre}`, item.total));
    campo('Total de actividades', reporte.resumen.totalActividades);
    reporte.resumen.actividadesPorEstado.forEach((item) => campo(`Estado ${item.nombre}`, item.total));

    tituloSeccion('Observaciones de seguimiento');
    if (reporte.seguimientos.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted)
            .text('No existen observaciones de seguimiento en el periodo seleccionado.');
    } else {
        reporte.seguimientos.forEach((item) => bloque(item.titulo, [
            ['Fecha', formatearFecha(item.fecha)],
            ['Tipo', item.tipo_nombre],
            ['Orientador responsable', item.orientador_nombre]
        ], item.descripcion));
    }

    tituloSeccion('Actividades de orientación');
    if (reporte.actividades.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted)
            .text('No existen actividades de orientación en el periodo seleccionado.');
    } else {
        reporte.actividades.forEach((item) => {
            const datos = [
                ['Fecha de asignación', formatearFecha(item.fecha_asignacion)]
            ];
            if (item.fecha_realizacion) datos.push(['Fecha de realización', formatearFecha(item.fecha_realizacion)]);
            datos.push(['Estado', item.estado_nombre]);
            datos.push(['Orientador responsable', item.orientador_nombre]);
            bloque(item.titulo, datos, item.instrucciones);
        });
    }

    asegurarEspacio(90);
    doc.moveDown(1).rect(doc.page.margins.left, doc.y, ancho, 58).fillColor(COLORS.soft).fill();
    doc.fillColor(COLORS.text).font('Helvetica-Oblique').fontSize(9)
        .text(
            'Este reporte refleja los registros de seguimiento y actividades existentes en el sistema durante el periodo seleccionado. No representa calificaciones oficiales.',
            doc.page.margins.left + 12,
            doc.y + 12,
            { width: ancho - 24, lineGap: 2 }
        );

    const rango = doc.bufferedPageRange();
    for (let indice = 0; indice < rango.count; indice += 1) {
        doc.switchToPage(rango.start + indice);
        if (indice > 0) {
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.primary)
                .text('COBAEM 30 · Reporte de seguimiento y orientación', doc.page.margins.left, 28, {
                    width: ancho,
                    align: 'left',
                    lineBreak: false
                });
        }
        doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
            .text(`Página ${indice + 1} de ${rango.count}`, doc.page.margins.left, doc.page.height - 35, {
                width: ancho,
                align: 'center',
                lineBreak: false
            });
    }

    doc.end();
});

module.exports = {
    generarPdf
};
