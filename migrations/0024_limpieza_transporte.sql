-- Planilla RE-09.10 «Registro de Limpieza: Transporte y Mantenimiento» (fotos de Mati, 2026-11-23), que faltaba.
-- Cada fila es un día del móvil; se marca con X lo hecho o con - si no se hizo nada. El N° es el del móvil
-- (chofer y ayudante van en el comentario). La pueden cargar todos los sectores, como el sanitario.
INSERT OR IGNORE INTO areas_limpieza (id, nombre, codigo, activo, orden) VALUES ('transporte', 'Transporte y mantenimiento', 'RE-09.10', 1, 10);
INSERT OR IGNORE INTO areas_sectores (area_id, sector) VALUES ('transporte', 'chiperia');
INSERT OR IGNORE INTO areas_sectores (area_id, sector) VALUES ('transporte', 'chipitas');
INSERT OR IGNORE INTO areas_sectores (area_id, sector) VALUES ('transporte', 'panaderia');
INSERT OR IGNORE INTO areas_sectores (area_id, sector) VALUES ('transporte', 'cocina');
INSERT OR IGNORE INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-transporte-01', 'transporte', 'Limpieza diaria / superficial', 1, 1, 0);
INSERT OR IGNORE INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-transporte-02', 'transporte', 'Limpieza profunda', 1, 1, 1);
INSERT OR IGNORE INTO tareas_limpieza (id, area_id, nombre, pide_numero, activo, orden) VALUES ('tarea-transporte-03', 'transporte', 'Mantenimiento', 1, 1, 2);
