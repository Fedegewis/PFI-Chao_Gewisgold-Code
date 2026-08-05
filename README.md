# MenteActiva Jardin - 

App funcional para la tesis. Incluye inicio de sesion, vista paciente, vista psicologo, jardin que crece por desafios, rendimiento, creacion de pacientes, configuracion de preguntas por IA y envio de link demo.

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

Paciente:
- Email: `elena.rios@demo.com`
- Clave: `menteactiva`

Psicologo:
- Email: `psicologa@demo.com`
- Clave: `jardin2`

## Juegos incluidos

- Lista del supermercado
- Pagar el boleto
- Ordenar una receta
- Agenda de turnos
- Caras y nombres
- Como me siento hoy
