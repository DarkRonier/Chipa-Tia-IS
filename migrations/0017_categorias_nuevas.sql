-- Categorías de productos nuevas (Mati, 2026-11-21). Reemplazan a Chipería, Chipitas y Heladería:
--   1. Chipas y bocaditos: todo lo que se consume en el frente (chipas, empanadas, sándwiches, croquetes…).
--   2. Chipa Sticks: los chipa sticks y sus variantes (producto empaquetado con código). Era «Chipitas».
--   3. Buffet: el buffet del comedor y los postres.
--   4. Panificados: los panes.
--   5. Materia prima: lo que se usa para elaborar (aceite, harina, carne, almidón, leche, queso…).
--   6. Bebidas: agua, gaseosas, vino, yogur… (ya existía).
--   7. Amandau: los productos de la franquicia Amandau (helados, cucuruchos…). Era «Heladería».
--   8. Otros: lo que no entra en ninguna (ya existía; no se desactiva).

-- 1) Las que faltan (si ya hay una con ese nombre, se usa esa).
INSERT INTO categorias (id, nombre, activo, orden)
SELECT x.id, x.nombre, 1, 0 FROM (
  SELECT 'cat-bocaditos' AS id, 'Chipas y bocaditos' AS nombre UNION ALL
  SELECT 'cat-sticks', 'Chipa Sticks' UNION ALL
  SELECT 'cat-buffet', 'Buffet' UNION ALL
  SELECT 'cat-panificados', 'Panificados' UNION ALL
  SELECT 'cat-materia-prima', 'Materia prima' UNION ALL
  SELECT 'cat-bebidas', 'Bebidas' UNION ALL
  SELECT 'cat-amandau', 'Amandau'
) x WHERE NOT EXISTS (SELECT 1 FROM categorias c WHERE lower(c.nombre) = lower(x.nombre));

UPDATE categorias SET activo = 1, orden = CASE lower(nombre)
  WHEN 'chipas y bocaditos' THEN 1 WHEN 'chipa sticks' THEN 2 WHEN 'buffet' THEN 3 WHEN 'panificados' THEN 4
  WHEN 'materia prima' THEN 5 WHEN 'bebidas' THEN 6 WHEN 'amandau' THEN 7 END
 WHERE lower(nombre) IN ('chipas y bocaditos', 'chipa sticks', 'buffet', 'panificados', 'materia prima', 'bebidas', 'amandau');

-- 2) Qué sectores compran cada una: lo que tenía la vieja pasa a la nueva. La materia prima estaba en «Otros», así que
--    quien compraba «Otros» ahora también compra «Materia prima» (y sigue con «Otros»).
INSERT OR IGNORE INTO categorias_sectores (categoria_id, sector)
SELECT n.id, x.sector
  FROM categorias_sectores x
  JOIN categorias v ON v.id = x.categoria_id
  JOIN categorias n ON lower(n.nombre) = CASE lower(v.nombre)
    WHEN 'chipería' THEN 'chipas y bocaditos' WHEN 'chipitas' THEN 'chipa sticks'
    WHEN 'heladería' THEN 'amandau' WHEN 'otros' THEN 'materia prima' END;

-- 3) Cada producto a su categoría. Solo se tocan los que estaban en las categorías de antes (Chipería, Chipitas,
--    Bebidas, Heladería, Otros) o sin categoría: si alguien armó una categoría propia, sus productos se quedan ahí.
UPDATE productos SET categoria_id = (
  SELECT id FROM categorias WHERE lower(nombre) = (
    SELECT CASE
      WHEN productos.tipo = 'materia_prima' THEN 'materia prima'
      WHEN vieja = 'heladería' OR productos.nombre LIKE '%helado%' OR productos.nombre LIKE '%cucurucho%'
        OR productos.nombre LIKE '%amandau%' THEN 'amandau'
      WHEN vieja = 'chipitas' OR (productos.sector = 'chipitas' AND productos.tipo = 'elaborado')
        OR productos.nombre LIKE '%stick%' THEN 'chipa sticks'
      WHEN productos.sin_stock = 1 OR productos.nombre LIKE '%buffet%' OR productos.nombre LIKE '%postre%' THEN 'buffet'
      WHEN vieja = 'bebidas' OR productos.nombre LIKE '%gaseosa%' OR productos.nombre LIKE '%agua %'
        OR productos.nombre LIKE 'agua' OR productos.nombre LIKE '%cerveza%' OR productos.nombre LIKE '%vino%'
        OR productos.nombre LIKE '%yogur%' OR productos.nombre LIKE '%jugo%' OR productos.nombre LIKE '%cocido%'
        OR productos.nombre LIKE '%refresco%' OR productos.nombre LIKE '%gatorade%' THEN 'bebidas'
      WHEN productos.sector = 'panaderia' AND productos.tipo = 'elaborado' THEN 'panificados'
      WHEN productos.nombre LIKE 'pan %' OR productos.nombre LIKE 'pan' THEN 'panificados'
      WHEN productos.tipo = 'elaborado' AND productos.sector IN ('chiperia', 'cocina') THEN 'chipas y bocaditos'
      WHEN vieja = 'chipería' THEN 'chipas y bocaditos'
      ELSE 'otros'
    END
    FROM (SELECT lower(nombre) AS vieja FROM categorias WHERE id = productos.categoria_id UNION ALL SELECT NULL LIMIT 1)
  )
  LIMIT 1
)
WHERE categoria_id IS NULL
   OR categoria_id IN (SELECT id FROM categorias WHERE lower(nombre) IN ('chipería', 'chipitas', 'bebidas', 'heladería', 'otros'));

-- 4) Chipería, Chipitas y Heladería ya no existen (no les queda ningún producto).
DELETE FROM categorias_sectores
 WHERE categoria_id IN (SELECT id FROM categorias WHERE lower(nombre) IN ('chipería', 'chipitas', 'heladería'));
DELETE FROM categorias
 WHERE lower(nombre) IN ('chipería', 'chipitas', 'heladería')
   AND NOT EXISTS (SELECT 1 FROM productos p WHERE p.categoria_id = categorias.id);
