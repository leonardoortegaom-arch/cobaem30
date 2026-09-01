USE cobaem30;

CREATE TABLE IF NOT EXISTS tipos_seguimiento (
    id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    clave VARCHAR(30) NOT NULL,
    nombre VARCHAR(60) NOT NULL,
    descripcion VARCHAR(255) NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tipos_seguimiento_clave (clave),
    UNIQUE KEY uq_tipos_seguimiento_nombre (nombre)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

INSERT IGNORE INTO tipos_seguimiento (clave, nombre, descripcion)
VALUES
    ('ACADEMICO', 'Académico', 'Observaciones cualitativas sobre el desempeño académico.'),
    ('CONDUCTUAL', 'Conductual', 'Observaciones relacionadas con la conducta del alumno.'),
    ('DISCIPLINARIO', 'Disciplinario', 'Seguimiento de situaciones que requieren atención disciplinaria.'),
    ('INCUMPLIMIENTO', 'Incumplimiento', 'Registro de compromisos o responsabilidades no cumplidos.');

CREATE TABLE IF NOT EXISTS estados_actividad_orientacion (
    id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    clave VARCHAR(30) NOT NULL,
    nombre VARCHAR(60) NOT NULL,
    descripcion VARCHAR(255) NULL,
    orden TINYINT UNSIGNED NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_estados_actividad_clave (clave),
    UNIQUE KEY uq_estados_actividad_nombre (nombre),
    UNIQUE KEY uq_estados_actividad_orden (orden)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

INSERT IGNORE INTO estados_actividad_orientacion (clave, nombre, descripcion, orden)
VALUES
    ('PENDIENTE', 'Pendiente', 'Actividad asignada pendiente de atención.', 1),
    ('EN_PROCESO', 'En proceso', 'Actividad actualmente en desarrollo.', 2),
    ('REALIZADA', 'Realizada', 'Actividad completada.', 3),
    ('NO_REALIZADA', 'No realizada', 'Actividad que no fue completada.', 4),
    ('CANCELADA', 'Cancelada', 'Actividad cancelada.', 5);

CREATE TABLE IF NOT EXISTS seguimientos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    alumno_usuario_id BIGINT UNSIGNED NOT NULL,
    orientador_usuario_id BIGINT UNSIGNED NOT NULL,
    tipo_id TINYINT UNSIGNED NOT NULL,
    fecha_seguimiento DATE NOT NULL,
    titulo VARCHAR(150) NOT NULL,
    descripcion TEXT NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_seguimientos_alumno_fecha (alumno_usuario_id, fecha_seguimiento),
    KEY idx_seguimientos_orientador (orientador_usuario_id),
    KEY idx_seguimientos_tipo (tipo_id),
    CONSTRAINT fk_seguimientos_alumno
        FOREIGN KEY (alumno_usuario_id) REFERENCES alumnos (usuario_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_seguimientos_orientador
        FOREIGN KEY (orientador_usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_seguimientos_tipo
        FOREIGN KEY (tipo_id) REFERENCES tipos_seguimiento (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS actividades_orientacion (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    alumno_usuario_id BIGINT UNSIGNED NOT NULL,
    orientador_usuario_id BIGINT UNSIGNED NOT NULL,
    estado_id TINYINT UNSIGNED NOT NULL,
    titulo VARCHAR(150) NOT NULL,
    instrucciones TEXT NOT NULL,
    fecha_asignacion DATE NOT NULL,
    fecha_limite DATE NULL,
    fecha_realizacion DATE NULL,
    observacion_resultado TEXT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_actividades_alumno_fecha (alumno_usuario_id, fecha_asignacion),
    KEY idx_actividades_orientador (orientador_usuario_id),
    KEY idx_actividades_estado (estado_id),
    CONSTRAINT chk_actividades_fecha_limite
        CHECK (fecha_limite IS NULL OR fecha_limite >= fecha_asignacion),
    CONSTRAINT chk_actividades_fecha_realizacion
        CHECK (fecha_realizacion IS NULL OR fecha_realizacion >= fecha_asignacion),
    CONSTRAINT fk_actividades_alumno
        FOREIGN KEY (alumno_usuario_id) REFERENCES alumnos (usuario_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_actividades_orientador
        FOREIGN KEY (orientador_usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_actividades_estado
        FOREIGN KEY (estado_id) REFERENCES estados_actividad_orientacion (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
