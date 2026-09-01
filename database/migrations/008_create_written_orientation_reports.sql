USE cobaem30;

CREATE TABLE IF NOT EXISTS tipos_reporte_orientacion (
    id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    clave VARCHAR(30) NOT NULL,
    nombre VARCHAR(60) NOT NULL,
    descripcion VARCHAR(255) NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tipos_reporte_orientacion_clave (clave),
    UNIQUE KEY uq_tipos_reporte_orientacion_nombre (nombre)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

INSERT IGNORE INTO tipos_reporte_orientacion (clave, nombre, descripcion)
VALUES
    (
        'ACADEMICO',
        'Académico',
        'Reporte relacionado con rendimiento, cumplimiento, aprendizaje o situación académica del alumno.'
    ),
    (
        'CONDUCTUAL',
        'Conductual',
        'Reporte relacionado con conducta, convivencia, disciplina o comportamiento del alumno.'
    );

CREATE TABLE IF NOT EXISTS estados_reporte_orientacion (
    id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    clave VARCHAR(30) NOT NULL,
    nombre VARCHAR(60) NOT NULL,
    descripcion VARCHAR(255) NULL,
    es_terminal BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_estados_reporte_orientacion_clave (clave),
    UNIQUE KEY uq_estados_reporte_orientacion_nombre (nombre)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

INSERT IGNORE INTO estados_reporte_orientacion (
    clave,
    nombre,
    descripcion,
    es_terminal
)
VALUES
    (
        'BORRADOR',
        'Borrador',
        'Reporte en elaboración que puede continuar editándose por su autor.',
        FALSE
    ),
    (
        'FINALIZADO',
        'Finalizado',
        'Reporte cerrado que ya no puede editarse y queda disponible para generar el PDF definitivo.',
        TRUE
    );

CREATE TABLE IF NOT EXISTS reportes_orientacion (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    alumno_usuario_id BIGINT UNSIGNED NOT NULL,
    orientador_usuario_id BIGINT UNSIGNED NOT NULL,
    tipo_reporte_id TINYINT UNSIGNED NOT NULL,
    estado_id TINYINT UNSIGNED NOT NULL,
    fecha_reporte DATE NOT NULL,
    periodo_desde DATE NOT NULL,
    periodo_hasta DATE NOT NULL,
    motivo VARCHAR(250) NOT NULL,
    contenido MEDIUMTEXT NOT NULL,
    conclusiones TEXT NULL,
    recomendaciones TEXT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    finalizado_en TIMESTAMP NULL DEFAULT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_reportes_orientacion_alumno_fecha_id (
        alumno_usuario_id,
        fecha_reporte,
        id
    ),
    KEY idx_reportes_orientacion_orientador_estado_actualizado_id (
        orientador_usuario_id,
        estado_id,
        actualizado_en,
        id
    ),
    KEY idx_reportes_orientacion_tipo_fecha_id (
        tipo_reporte_id,
        fecha_reporte,
        id
    ),
    KEY idx_reportes_orientacion_estado_fecha_id (
        estado_id,
        fecha_reporte,
        id
    ),
    KEY idx_reportes_orientacion_periodo (
        periodo_desde,
        periodo_hasta
    ),
    CONSTRAINT chk_reportes_orientacion_periodo
        CHECK (
            periodo_desde <= periodo_hasta
            AND DATEDIFF(periodo_hasta, periodo_desde) <= 365
        ),
    CONSTRAINT chk_reportes_orientacion_version
        CHECK (version >= 1),
    CONSTRAINT fk_reportes_orientacion_alumno
        FOREIGN KEY (alumno_usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_reportes_orientacion_orientador
        FOREIGN KEY (orientador_usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_reportes_orientacion_tipo
        FOREIGN KEY (tipo_reporte_id) REFERENCES tipos_reporte_orientacion (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_reportes_orientacion_estado
        FOREIGN KEY (estado_id) REFERENCES estados_reporte_orientacion (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
