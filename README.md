# MenteActiva 

App funcional para la tesis. Incluye inicio de sesion, vista paciente, vista psicologo, progreso diario, rendimiento, creacion de pacientes, configuracion de preguntas por IA y envio de link demo.

## Como correrlo

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
La integracion opcional con Ollama usa la URL local fija `http://localhost:11434/api/generate`.

## Accesos demo

Paciente (Elena):
- Email: `elena.rios@demo.com`
- Clave: `menteactiva`

Paciente (Lucía):
- Email: `lucia.herrera@demo.com`
- Clave: `jardin`

Paciente (Héctor):
- Email: `hector.ramos@demo.com`
- Clave: `jardin`

Psicologo:
- Email: `psicologa@demo.com`
- Clave: `jardin2`

## Actividades incluidas

- Lista del supermercado (memoria de trabajo)
- Pagar el boleto (atencion y calculo)
- Ordenar una receta (funciones ejecutivas)
- Agenda de turnos (orientacion temporal)
- Caras y nombres (memoria asociativa)
- Como me siento hoy (metacognicion)
- Tomar la medicacion (memoria prospectiva)
- Objetos de la casa (atencion visual)
- Mensajes y llamadas (comprension funcional)
- Camino al barrio (orientacion y decision)
