# Pruebas

- La suite completa (`npm test`) tarda ~4 s. El CI la corre en cada PR y antes de publicar en main.
- Mientras trabajás, corré solo los archivos de prueba de lo que tocás: `npx vitest run tests/stock.test.ts`.
  Corré la suite completa una vez antes de abrir o actualizar el PR, no después de cada cambio.
- Las pruebas comparten proceso (`isolate: false`): si una prueba simula el reloj, `fetch` o espía algo,
  `tests/preparar.ts` lo deshace al terminar cada archivo. No dejes estado global propio entre archivos.
- `nuevaPrueba()` (tests/ayuda.ts) da a cada prueba una copia propia de una base ya armada; no hace falta
  compartir bases entre pruebas para ganar tiempo.
- Dentro de un archivo las pruebas pueden depender del orden (ej. tests/anexo.test.ts): no mezclarlas.
