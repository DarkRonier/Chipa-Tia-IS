-- Mati (2026-11-23): la máquina de un depósito frío tiene que ser una de las de los sectores; por ahora, ninguno lleva
-- máquina. Si la purga de la entrega (scripts/purga-entrega.sql) ya creó «Heladera» y «Freezer» solo para eso, se sacan.
UPDATE depositos SET maquina_id = NULL WHERE maquina_id IN ('maq-heladera', 'maq-freezer');
DELETE FROM maquinas WHERE id IN ('maq-heladera', 'maq-freezer')
   AND NOT EXISTS (SELECT 1 FROM lecturas WHERE maquina_id = maquinas.id)
   AND NOT EXISTS (SELECT 1 FROM incidencias WHERE maquina_id = maquinas.id);
