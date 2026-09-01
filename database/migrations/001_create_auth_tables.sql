USE cobaem30;

CREATE TABLE IF NOT EXISTS roles (
    id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    clave VARCHAR(30) NOT NULL,
    nombre VARCHAR(50) NOT NULL,
    descripcion VARCHAR(255) NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_roles_clave (clave),
    UNIQUE KEY uq_roles_nombre (nombre)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

INSERT IGNORE INTO roles (clave, nombre, descripcion) VALUES
    ('ADMINISTRADOR', 'Administrador', 'Administra usuarios y la configuración general del sistema.'),
    ('DOCENTE', 'Docente', 'Gestiona actividades académicas, asistencia y grupos asignados.'),
    ('ALUMNO', 'Alumno', 'Consulta materias, actividades y seguimiento académico.'),
    ('ORIENTADOR', 'Orientador', 'Da seguimiento académico y formativo a los alumnos.');

CREATE TABLE IF NOT EXISTS usuarios (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    rol_id TINYINT UNSIGNED NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    apellido_paterno VARCHAR(80) NOT NULL,
    apellido_materno VARCHAR(80) NULL,
    correo VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_acceso DATETIME NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_usuarios_correo (correo),
    KEY idx_usuarios_rol_id (rol_id),
    KEY idx_usuarios_activo (activo),
    CONSTRAINT fk_usuarios_roles
        FOREIGN KEY (rol_id) REFERENCES roles (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
