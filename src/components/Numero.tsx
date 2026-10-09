// Campo numérico grande para cargar cantidades desde el celular.
export default function Numero({ valor, onChange, etiqueta, min = 0 }: {
  valor: number; onChange: (n: number) => void; etiqueta: string; min?: number
}) {
  return (
    <label className="numero">
      <span>{etiqueta}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={valor === 0 ? '' : valor}
        placeholder="0"
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
      />
    </label>
  )
}
