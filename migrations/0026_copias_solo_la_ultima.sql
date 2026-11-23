-- Mati (2026-11-23, antes de la entrega): borrar todas las copias de seguridad menos la última.
-- Saca de la lista (Datos → Copias) todas menos la más reciente. Los archivos en R2 (copias/…) quedan, pero ya no se
-- ven ni se pueden descargar desde el sistema.
DELETE FROM copias WHERE clave <> (SELECT clave FROM copias ORDER BY fecha DESC, clave DESC LIMIT 1);
