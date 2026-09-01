USE cobaem30;

ALTER TABLE grupos
    ADD COLUMN generacion VARCHAR(9) NULL AFTER clave;

UPDATE grupos
SET generacion = ciclo_escolar,
    ciclo_escolar = CONCAT('enero a junio ', LEFT(ciclo_escolar, 4))
WHERE ciclo_escolar REGEXP '^[0-9]{4}-[0-9]{4}$';

ALTER TABLE grupos
    MODIFY COLUMN generacion VARCHAR(9) NOT NULL,
    MODIFY COLUMN ciclo_escolar VARCHAR(30) NOT NULL;