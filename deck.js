// Elige qué mazo usar según la fecha. Se consulta cada vez que empieza una partida.
const MAZO_PRINCIPAL = require('./cards');        // las 86 cartas originales
const MAZO_PRUEBA = require('./cards-prueba');    // las 150 cartas para adultos

// La prueba dura hasta el 3 de noviembre de 2026 inclusive (hora de Uruguay, UTC-3).
// Desde el 4 de noviembre a las 00:00 vuelve solo el mazo principal.
// Para extender la prueba, cambiá esta fecha. Para cortarla ya, poné una fecha pasada.
const FIN_PRUEBA = new Date('2026-11-04T00:00:00-03:00');

function mazoActual(ahora = new Date()) {
  return ahora < FIN_PRUEBA ? MAZO_PRUEBA : MAZO_PRINCIPAL;
}

module.exports = { mazoActual, FIN_PRUEBA };
