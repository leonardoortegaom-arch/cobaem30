-- Migración forward-only: cada sentencia DDL puede producir autocommit en MySQL.
-- Requiere runner, precondiciones y postverificación. Un fallo parcial debe detenerse
-- para revisión y nunca reintentarse automáticamente sobre estructuras parciales.

-- Cohortes plurianuales independientes del calendario institucional.
CREATE TABLE generaciones (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    anio_inicio SMALLINT UNSIGNED NOT NULL,
    anio_fin SMALLINT UNSIGNED NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_generaciones_anios (anio_inicio, anio_fin),
    KEY idx_generaciones_activo_anios (activo, anio_inicio, anio_fin),
    CONSTRAINT chk_generaciones_anio_inicio
        CHECK (anio_inicio BETWEEN 1000 AND 9999),
    CONSTRAINT chk_generaciones_anio_fin
        CHECK (anio_fin BETWEEN 1000 AND 9999),
    CONSTRAINT chk_generaciones_orden_anios
        CHECK (anio_fin > anio_inicio),
    CONSTRAINT chk_generaciones_activo
        CHECK (activo IN (0, 1))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- Calendarios escolares institucionales; no representan generaciones.
CREATE TABLE ciclos_escolares (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    clave VARCHAR(30) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ciclos_escolares_clave (clave),
    KEY idx_ciclos_escolares_activo_fechas (activo, fecha_inicio, fecha_fin),
    CONSTRAINT chk_ciclos_escolares_fechas
        CHECK (fecha_inicio <= fecha_fin),
    CONSTRAINT chk_ciclos_escolares_activo
        CHECK (activo IN (0, 1))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- Periodos administrables contenidos conceptualmente en un ciclo escolar.
-- La contención de fechas respecto del ciclo se valida en la aplicación.
CREATE TABLE periodos_academicos (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    ciclo_escolar_id INT UNSIGNED NOT NULL,
    clave VARCHAR(30) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_periodos_academicos_ciclo_clave (
        ciclo_escolar_id,
        clave
    ),
    KEY idx_periodos_academicos_activo_fechas (
        activo,
        fecha_inicio,
        fecha_fin
    ),
    CONSTRAINT chk_periodos_academicos_fechas
        CHECK (fecha_inicio <= fecha_fin),
    CONSTRAINT chk_periodos_academicos_activo
        CHECK (activo IN (0, 1)),
    CONSTRAINT fk_periodos_academicos_ciclo
        FOREIGN KEY (ciclo_escolar_id) REFERENCES ciclos_escolares (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
