-- Qué categorías compra cada sector (Mati, 2026-11-21). El administrador y el supervisor compran todo; el cajero no compra.
--   Chipería:        Chipas y bocaditos, Materia prima, Bebidas, Otros
--   Chipitas:        Chipa Sticks, Materia prima, Otros
--   Panadería:       Panificados, Materia prima, Otros
--   Cocina y buffet: Buffet, Bebidas, Otros
-- Amandau no la compra ningún sector (será de un rol futuro). Solo se tocan estas categorías (por nombre): las que haya
-- creado el administrador quedan como están. Después se cambia en Catálogos → Categorías.
DELETE FROM categorias_sectores WHERE categoria_id IN (
  SELECT id FROM categorias WHERE lower(nombre) IN (
    'chipas y bocaditos', 'chipa sticks', 'buffet', 'panificados', 'materia prima', 'bebidas', 'amandau', 'otros'));

INSERT OR IGNORE INTO categorias_sectores (categoria_id, sector)
SELECT c.id, x.sector FROM categorias c JOIN (
  SELECT 'chiperia' AS sector, 'chipas y bocaditos' AS categoria UNION ALL
  SELECT 'chiperia', 'materia prima' UNION ALL
  SELECT 'chiperia', 'bebidas' UNION ALL
  SELECT 'chiperia', 'otros' UNION ALL
  SELECT 'chipitas', 'chipa sticks'
) x ON lower(c.nombre) = x.categoria;
INSERT OR IGNORE INTO categorias_sectores (categoria_id, sector)
SELECT c.id, x.sector FROM categorias c JOIN (
  SELECT 'chipitas' AS sector, 'materia prima' AS categoria UNION ALL
  SELECT 'chipitas', 'otros' UNION ALL
  SELECT 'panaderia', 'panificados' UNION ALL
  SELECT 'panaderia', 'materia prima' UNION ALL
  SELECT 'panaderia', 'otros'
) x ON lower(c.nombre) = x.categoria;
INSERT OR IGNORE INTO categorias_sectores (categoria_id, sector)
SELECT c.id, x.sector FROM categorias c JOIN (
  SELECT 'cocina' AS sector, 'buffet' AS categoria UNION ALL
  SELECT 'cocina', 'bebidas' UNION ALL
  SELECT 'cocina', 'otros'
) x ON lower(c.nombre) = x.categoria;
