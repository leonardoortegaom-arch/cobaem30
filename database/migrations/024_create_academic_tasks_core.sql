CREATE TABLE estados_tarea_academica (
    id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    clave VARCHAR(30) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion VARCHAR(255) NULL,
    orden SMALLINT UNSIGNED NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_estados_tarea_clave (clave),
    UNIQUE KEY uq_estados_tarea_nombre (nombre),
    UNIQUE KEY uq_estados_tarea_orden (orden),
    KEY idx_estados_tarea_admin (activo, orden, id),
    CONSTRAINT chk_estados_tarea_clave CHECK (CHAR_LENGTH(TRIM(clave)) > 0),
    CONSTRAINT chk_estados_tarea_nombre CHECK (CHAR_LENGTH(TRIM(nombre)) > 0),
    CONSTRAINT chk_estados_tarea_activo CHECK (activo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO estados_tarea_academica (clave, nombre, descripcion, orden, activo) VALUES
    ('BORRADOR', 'Borrador', NULL, 1, 1),
    ('PUBLICADA', 'Publicada', NULL, 2, 1),
    ('CERRADA', 'Cerrada', NULL, 3, 1),
    ('CANCELADA', 'Cancelada', NULL, 4, 1);

CREATE TABLE estados_entrega_tarea (
    id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    clave VARCHAR(30) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion VARCHAR(255) NULL,
    orden SMALLINT UNSIGNED NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_estados_entrega_clave (clave),
    UNIQUE KEY uq_estados_entrega_nombre (nombre),
    UNIQUE KEY uq_estados_entrega_orden (orden),
    KEY idx_estados_entrega_admin (activo, orden, id),
    CONSTRAINT chk_estados_entrega_clave CHECK (CHAR_LENGTH(TRIM(clave)) > 0),
    CONSTRAINT chk_estados_entrega_nombre CHECK (CHAR_LENGTH(TRIM(nombre)) > 0),
    CONSTRAINT chk_estados_entrega_activo CHECK (activo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO estados_entrega_tarea (clave, nombre, descripcion, orden, activo) VALUES
    ('ENVIADA', 'Enviada', NULL, 1, 1),
    ('APROBADA', 'Aprobada', NULL, 2, 1),
    ('RECHAZADA', 'Rechazada', NULL, 3, 1);

CREATE TABLE tareas_academicas (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    docente_usuario_id BIGINT UNSIGNED NOT NULL,
    grupo_id INT UNSIGNED NOT NULL,
    periodo_academico_id INT UNSIGNED NOT NULL,
    materia_id INT UNSIGNED NOT NULL,
    estado_tarea_id TINYINT UNSIGNED NOT NULL,
    titulo VARCHAR(150) NOT NULL,
    instrucciones TEXT NOT NULL,
    puntaje_maximo DECIMAL(8,2) NOT NULL,
    fecha_publicacion TIMESTAMP NULL,
    fecha_limite TIMESTAMP NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_tareas_docente_periodo_estado (docente_usuario_id, periodo_academico_id, estado_tarea_id, fecha_limite, id),
    KEY idx_tareas_grupo_periodo_estado (grupo_id, periodo_academico_id, estado_tarea_id, fecha_limite, id),
    KEY idx_tareas_periodo_estado (periodo_academico_id, estado_tarea_id, fecha_limite, id),
    KEY idx_tareas_materia_periodo (materia_id, periodo_academico_id, id),
    KEY idx_tareas_estado_fecha (estado_tarea_id, fecha_limite, id),
    KEY idx_tareas_fecha_limite (fecha_limite, id),
    CONSTRAINT fk_tareas_docente FOREIGN KEY (docente_usuario_id) REFERENCES usuarios (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_tareas_grupo FOREIGN KEY (grupo_id) REFERENCES grupos (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_tareas_periodo FOREIGN KEY (periodo_academico_id) REFERENCES periodos_academicos (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_tareas_materia FOREIGN KEY (materia_id) REFERENCES materias (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_tareas_estado FOREIGN KEY (estado_tarea_id) REFERENCES estados_tarea_academica (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT chk_tareas_titulo CHECK (CHAR_LENGTH(TRIM(titulo)) > 0),
    CONSTRAINT chk_tareas_instrucciones CHECK (CHAR_LENGTH(TRIM(instrucciones)) > 0),
    CONSTRAINT chk_tareas_puntaje CHECK (puntaje_maximo > 0),
    CONSTRAINT chk_tareas_publicacion_limite CHECK (fecha_publicacion IS NULL OR fecha_limite > fecha_publicacion),
    CONSTRAINT chk_tareas_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
