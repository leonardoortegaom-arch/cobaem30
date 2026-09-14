-- Migración forward-only: cada sentencia DDL puede producir autocommit en MySQL.
-- Requiere runner, precondiciones y postverificación. Una creación parcial debe
-- detenerse para revisión y no debe repararse ni reintentarse automáticamente.

CREATE TABLE materias (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    clave VARCHAR(30) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    descripcion VARCHAR(500) NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_materias_clave (clave),
    KEY idx_materias_activo_nombre_id (activo, nombre, id),
    CONSTRAINT chk_materias_clave_no_vacia
        CHECK (CHAR_LENGTH(TRIM(clave)) > 0),
    CONSTRAINT chk_materias_nombre_no_vacio
        CHECK (CHAR_LENGTH(TRIM(nombre)) > 0),
    CONSTRAINT chk_materias_activo
        CHECK (activo IN (0, 1))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE aulas (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    clave VARCHAR(30) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    descripcion VARCHAR(500) NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_aulas_clave (clave),
    KEY idx_aulas_activo_nombre_id (activo, nombre, id),
    CONSTRAINT chk_aulas_clave_no_vacia
        CHECK (CHAR_LENGTH(TRIM(clave)) > 0),
    CONSTRAINT chk_aulas_nombre_no_vacio
        CHECK (CHAR_LENGTH(TRIM(nombre)) > 0),
    CONSTRAINT chk_aulas_activo
        CHECK (activo IN (0, 1))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
