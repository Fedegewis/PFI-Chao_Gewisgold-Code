# MenteActiva

App funcional para la tesis. Incluye inicio de sesión, vista paciente, vista psicólogo, jardín que crece por desafíos, rendimiento, creación de pacientes, configuración de preguntas por IA y envío de link demo.

## Cómo correrlo

```bash
npm install
npm run dev
```

Abrir: http://127.0.0.1:5179/

## Validaciones

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Variables de entorno

No requiere variables de entorno para correr la demo local.
La integración opcional con Ollama usa la URL local fija `http://localhost:11434/api/generate`.

## Accesos demo

### Pacientes

| Nombre | Email | Clave |
|---|---|---|
| Elena Ríos | `elena.rios@demo.com` | `menteactiva` |
| Lucía Herrera | `lucia.herrera@demo.com` | `jardin` |
| Héctor Ramos | `hector.ramos@demo.com` | `jardin` |

Cada paciente entra directo a su propia ficha. Podés variar entre los tres para ver perfiles distintos (Elena con buena precisión, Lucía recién arrancando, Héctor requiere apoyo).

### Psicólogo

- Email: `psicologa@demo.com`
- Clave: `jardin2`

Desde la vista del psicólogo se ven los 8 pacientes de demo con sus métricas, síntesis clínica y línea de tiempo de sesiones.

## Juegos incluidos

- Lista del supermercado
- Pagar el boleto
- Ordenar una receta
- Agenda de turnos
- Caras y nombres
- Cómo me siento hoy
- Tomar la medicación
- Objetos de la casa
- Mensajes y llamadas
- Camino al barrio
