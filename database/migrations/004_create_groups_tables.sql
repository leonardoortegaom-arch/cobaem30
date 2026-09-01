USE cobaem30;

CREATE TABLE IF NOT EXISTS turnos (
    id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    clave VARCHAR(20) NOT NULL,
    nombre VARCHAR(50) NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_turnos_clave (clave),
    UNIQUE KEY uq_turnos_nombre (nombre)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

INSERT IGNORE INTO turnos (clave, nombre)
VALUES
    ('MATUTINO', 'Matutino'),
    ('VESPERTINO', 'Vespertino');

CREATE TABLE IF NOT EXISTS grupos (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    turno_id TINYINT UNSIGNED NOT NULL,
    clave VARCHAR(10) NOT NULL,
    semestre TINYINT UNSIGNED NOT NULL,
    ciclo_escolar VARCHAR(20) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_grupos_clave_ciclo_turno (clave, ciclo_escolar, turno_id),
    KEY idx_grupos_turno_id (turno_id),
    KEY idx_grupos_semestre (semestre),
    KEY idx_grupos_ciclo_escolar (ciclo_escolar),
    KEY idx_grupos_activo (activo),
    CONSTRAINT chk_grupos_semestre CHECK (semestre BETWEEN 1 AND 6),
    CONSTRAINT fk_grupos_turno
        FOREIGN KEY (turno_id) REFERENCES turnos (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
