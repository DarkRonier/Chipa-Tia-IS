-- G06: foto opcional en los reportes de limpieza (clave del archivo en R2 o en `archivos`,
-- como `lecturas.foto_clave`; las fotos no se borran automáticamente por antigüedad).
ALTER TABLE limpiezas ADD COLUMN foto_clave TEXT;

-- G08: cada cuántos días como máximo hay que limpiar un área (1 = todos los días, 7 = una vez por semana).
-- NULL = sin exigencia.
ALTER TABLE areas_limpieza ADD COLUMN frecuencia_dias INTEGER;

-- Índices históricos para consultas por fecha entre los registros que tienen foto.
CREATE INDEX lecturas_con_foto ON lecturas(fecha) WHERE foto_clave IS NOT NULL;
CREATE INDEX limpiezas_con_foto ON limpiezas(fecha) WHERE foto_clave IS NOT NULL;
