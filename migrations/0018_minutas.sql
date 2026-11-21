-- «Minutas» (Mati, 2026-11-21): subcategoría dentro de «Chipas y bocaditos» para las comidas rápidas que se hacen al
-- momento (hamburguesa, sándwiches, pollo frito; milanesa o lomito si se agregan). Solo se tocan los productos del
-- catálogo que siguen en esa categoría y sin subcategoría: si el administrador ya les puso otra, se respeta.
UPDATE productos SET subcategoria = 'Minutas'
 WHERE subcategoria = ''
   AND categoria_id IN (SELECT id FROM categorias WHERE lower(nombre) = lower('Chipas y bocaditos'))
   AND nombre IN ('Hamburguesa', 'Sándwich de milanesa', 'Sándwich de pollo', 'Sándwich de JyQ', 'Sándwich de verdura',
                  'Pollo muslo (frito)');
