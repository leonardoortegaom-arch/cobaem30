USE cobaem30;

ALTER TABLE grupos
    ADD COLUMN periodo_semestre ENUM('enero-junio', 'agosto-diciembre') NULL AFTER semestre;

UPDATE grupos
SET periodo_semestre = CASE
    WHEN ciclo_escolar LIKE 'agosto a diciembre %' THEN 'agosto-diciembre'
    ELSE 'enero-junio'
END;

ALTER TABLE grupos
    MODIFY COLUMN periodo_semestre ENUM('enero-junio', 'agosto-diciembre') NOT NULL;