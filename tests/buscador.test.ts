// Buscador dinámico de productos y proveedores: coincide por nombre o código, sin tildes ni mayúsculas.
import { describe, expect, it } from 'vitest'
import { filtrarOpciones } from '../src/components/Buscador'

const opciones = [
  { id: '1', nombre: 'Chipa quesú', codigo: 'CH-03' },
  { id: '2', nombre: 'Queso Paraguay', codigo: 'INS-10' },
  { id: '3', nombre: 'Huevo (maple)', codigo: '' },
  { id: '4', nombre: 'Chipa so\'o', codigo: 'CH-02' },
]

describe('buscador', () => {
  it('busca por nombre sin tildes ni mayúsculas y por código', () => {
    expect(filtrarOpciones(opciones, 'QUESU').map((o) => o.id)).toEqual(['1'])
    expect(filtrarOpciones(opciones, 'ques').map((o) => o.id)).toEqual(['2', '1'])
    expect(filtrarOpciones(opciones, 'ch-02').map((o) => o.id)).toEqual(['4'])
    expect(filtrarOpciones(opciones, 'chipa ch-0').map((o) => o.id)).toEqual(['1', '4'])
    expect(filtrarOpciones(opciones, 'nada')).toEqual([])
    expect(filtrarOpciones(opciones, '', 2)).toHaveLength(2)
  })
})
