-- Depósitos por tipo (Mati, 2026-11-21, tercera vuelta). Arriba de la pantalla van los TIPOS de depósito y, en cada
-- uno, la lista de sus depósitos:
--   - Venta directa (tipo 'venta'): Venta frente y Venta comedor. Las ventas de cada caja descuentan de ahí. Qué
--     productos entran en cada uno lo dicen las categorías de producto (tabla deposito_categorias).
--   - Depósito frío (tipo 'almacen' en la base): varios, cada uno con su stock. Puede tener una máquina vinculada
--     (heladera, freezer) para ver su última temperatura. «Frío» no obliga a que sea una cámara ni a tener máquina.
--     «Materia prima» deja de ser un tipo aparte: es un depósito frío más, fijo (las compras de materia prima entran
--     ahí y la producción la consume de ahí), al que se le puede cambiar el nombre.
--   - Sucursal: no tiene stock; solo se registra lo que se le envió (tabla sucursales, sin cambios).
-- El super-administrador crea y borra depósitos fríos y sucursales.
-- Nada de stock se mueve: los ids de los depósitos siguen iguales.

-- Máquina vinculada (opcional) a un depósito frío.
ALTER TABLE depositos ADD COLUMN maquina_id TEXT REFERENCES maquinas(id);

-- Categorías que admite cada depósito de venta directa.
CREATE TABLE deposito_categorias (
  deposito_id TEXT NOT NULL REFERENCES depositos(id),
  categoria_id TEXT NOT NULL REFERENCES categorias(id),
  PRIMARY KEY (deposito_id, categoria_id)
);

-- Venta frente: lo del mostrador y las bebidas (todo menos el buffet y la materia prima).
INSERT INTO deposito_categorias (deposito_id, categoria_id)
SELECT 'venta', id FROM categorias
 WHERE lower(nombre) IN (lower('Chipas y bocaditos'), lower('Chipa Sticks'), lower('Panificados'), lower('Bebidas'), lower('Amandau'), lower('Otros'))
   AND EXISTS (SELECT 1 FROM depositos WHERE id = 'venta');
-- Venta comedor: buffet por kilo, postres y bebidas.
INSERT INTO deposito_categorias (deposito_id, categoria_id)
SELECT 'comedor', id FROM categorias
 WHERE lower(nombre) IN (lower('Buffet'), lower('Bebidas'))
   AND EXISTS (SELECT 1 FROM depositos WHERE id = 'comedor');

-- «Frío» era el nombre del tipo: el depósito pasa a llamarse «Cámara 1» (si nadie le cambió el nombre).
UPDATE depositos SET nombre = 'Cámara 1', descripcion = '' WHERE id = 'frio' AND nombre = 'Frío' AND borrado_en IS NULL
   AND NOT EXISTS (SELECT 1 FROM depositos WHERE lower(nombre) = lower('Cámara 1'));
UPDATE depositos SET descripcion = '' WHERE id = 'frio' AND descripcion = 'Almacén en frío.';
UPDATE depositos SET descripcion = 'Lo comprado para producir (queso, harina…). Las compras de materia prima entran acá y la producción la usa de acá.'
 WHERE id = 'materia_prima';
