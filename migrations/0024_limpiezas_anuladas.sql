-- Una planilla de limpieza mal cargada no se borra: el supervisor o el administrador la anula con un motivo
-- (Mati, 2026-11-23). Queda en el historial como anulada y deja de contar para el visto bueno, los reportes y
-- las alertas de áreas sin limpiar.
ALTER TABLE limpiezas ADD COLUMN anulada_por TEXT REFERENCES usuarios(id);
ALTER TABLE limpiezas ADD COLUMN anulada_en TEXT;
ALTER TABLE limpiezas ADD COLUMN motivo_anulacion TEXT;
