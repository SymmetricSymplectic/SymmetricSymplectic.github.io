# GRAPPA en JavaScript: reconstrucción del núcleo y extensión interpersonal

Primera implementación independiente basada en Daniel **Veit**, *Matchmaking in Electronic Markets: An Agent-Based Approach towards Matchmaking in Electronic Negotiations*, LNAI 2882, Springer, 2003. Fuente: PDF aportado por el usuario. Las páginas citadas son las impresas, no el índice del visor PDF. No se recuperó ni se portó el código Java original; tampoco se verificó su disponibilidad actual en archivos web.

## Ejecutar

- Abrir `demo.html` directamente en un navegador. No requiere servidor, conexión ni dependencias.
- Ejecutar `node example.js` para ver el ejemplo en consola.
- Ejecutar `node test.js` para comprobar el motor.
- Importar en Node: `const {Matchmaker, reciprocal} = require('./grappa.js')`.
- En navegador: cargar `grappa.js`; la API queda en `globalThis.GRAPPA`.

Verificación realizada: las 10 pruebas de `test.js` y el ejemplo de consola se ejecutaron correctamente con Node 24.19.0. La sintaxis del script de la demo fue comprobada, pero su presentación e interacción no pudieron verificarse en un navegador: el entorno no tenía el ejecutable instalado. Se requiere un navegador moderno con `structuredClone`.

## Qué aporta realmente el libro

GRAPPA no es una fórmula universal de compatibilidad ni un algoritmo de aprendizaje. Su contribución es una arquitectura de comparación de objetos multidimensionales, con semántica configurable por dominio. El «centroid» es la solicitud o perfil objetivo; no tiene que ser un promedio estadístico.

| Componente del libro | Referencia | Reconstrucción |
|---|---|---|
| Tipos básicos y compuestos, ODS/RDS | §4.4.1, pp. 85–89 | Objetos JSON; árbol explícito de criterios. Validación de configuración y valores comparados, sin implementar toda la gramática ORDL |
| Base SGMB y sistema GMS | Defs. 4.4.11–12, pp. 88–89 | Configuración, catálogo de funciones y base de candidatos en memoria |
| MAP entre solicitud y oferta | Def. 4.4.17, pp. 96–97 | Rutas `request`/`candidate`; transformaciones complejas deben hacerse previamente |
| Normalización de métricas | Teorema 4.5.19, pp. 98–99 | `boundedNumber`: d/(1+d), con escala explícita |
| Distancia numérica | Def. 4.5.37, pp. 108–109 | Valor absoluto, normalizado |
| Agregación jerárquica y promedio ponderado | §4.5.4–5, pp. 111–117 | Árbol de promedios ponderados locales |
| Alta, baja, k vecinos y consulta por radio | Def. 4.4.12, p. 89 | `offer`, `withdraw`, `rank({k,r})` |
| Funciones intercambiables y resultados detallados | §5.3, pp. 123–130 | Funciones registrables y árbol explicativo por resultado |

El capítulo 5 dice explícitamente que presenta ideas de implementación, interfaces y extractos, no un listado completo (p. 119). Permite reconstruir un núcleo funcional, pero no prometer equivalencia exacta con el Java perdido.

No se implementaron todavía: XML/DTD y ORDL completos, MAP con combinaciones arbitrarias, TF–IDF del §4.5.2, distancia minimum-link, listas de longitud variable, fechas, EJB/RMI, persistencia, índices de búsqueda, interfaz de edición de perfiles ni asignación global de parejas. La comparación de conjuntos usa Jaccard o cobertura dirigida como extensiones explícitas, no como sustitutos supuestamente idénticos al minimum-link.

## Revisión crítica

1. **Las funciones deben auditarse, no copiarse mecánicamente.** En la Def. 4.5.39, p. 109, los casos escritos no cubren simétricamente algunos intervalos con extremos compartidos: para I=[0,2], J=[0,1], el tercer caso da d(I,J)=1, pero d(J,I) cae en «otherwise», que vale infinito. Se verificó esta fórmula visualmente en el PDF. Por tanto, la afirmación inmediatamente posterior de que es una función de distancia simétrica necesita una corrección. Esta implementación no utiliza esa fórmula.
2. **Casos vacíos.** La distancia de listas de la Def. 4.5.44, p. 113, divide por la longitud mínima: hace falta definir el caso de lista vacía. La regla de umbral de la Def. 4.5.49, pp. 116–117, también necesita una convención cuando ningún criterio pasa el umbral (m=0).
3. **Distancia frente a relevancia.** El §4.1 fija cero como buen ajuste en distancia y uno como buen ajuste en relevancia. La explicación de restricciones «strong» de §5.3.2, p. 125, habla de cero de una forma que no encaja claramente con esa convención. Aquí la convención es inequívoca: distancia pequeña = buen ajuste; una restricción falla cuando d supera su máximo permitido.
4. **Unidades y escalas.** d/(1+d) acota una distancia, pero no elimina por sí sola la dependencia de las unidades. Se usa primero |a-b|/s, donde s>0 tiene las unidades del atributo. Cambiar unidades exige cambiar s también.
5. **Pesos y estructura.** La agregación funciona matemáticamente, pero criterios redundantes pueden contar la misma preferencia varias veces. El libro discute independencia preferencial y pseudo-ortogonalización en §4.3, pp. 83–84; agrupar variables no demuestra independencia estadística ni valida una utilidad aditiva.
6. **Evaluación limitada al dominio.** El capítulo 7 evalúa selección de personal, no relaciones personales. En p. 163 se resume una tendencia a favorecer recall frente a precisión; no justifica concluir superioridad universal ni validez para dating. Nuestra extensión necesita su propia evaluación.

## Modelo matemático implementado

Una hoja i compara una preferencia q_i con el atributo m_i(x) extraído del candidato mediante MAP. Cada función entrega una disimilitud d_i en [0,1]. Un nodo v con hijos c agrega:

    D_v = Σ_c w_vc D_c / Σ_c w_vc,   w_vc > 0.

Con datos completos, la puntuación direccional es S(A→B)=1−D(preferencias_A, perfil_B).

Si todas las hojas son métricas sobre los dominios respectivos, todos los pesos son fijos y positivos y se compara el producto completo de esos dominios, el promedio ponderado es una métrica: positividad y simetría son inmediatas; la desigualdad triangular se suma con pesos positivos; la distancia cero obliga a que cada coordenada coincida. Por inducción esto vale para el árbol. Si MAP omite información, como mucho se obtiene una pseudométrica sobre los perfiles originales. Si las comparaciones expresan preferencias dirigidas, **no se afirma que D sea una métrica**.

Para una preferencia de intervalo [l,u] y un atributo x se añade:

    d([l,u],x) = min(1, max(l−x, 0, x−u)/s),   s > 0.

Toda posición dentro del intervalo tiene penalización cero. Esto describe tolerancia a una característica, no identidad de perfiles. Una restricción con `maxDistance: 0` exige satisfacerla exactamente. No debe utilizarse la cercanía a la propia personalidad como regla universal: cada persona declara su objetivo y tolerancia. La complementariedad también puede expresarse como un objetivo distinto del propio rasgo, sin asumir que los opuestos necesariamente funcionan mejor.

La extensión recíproca predeterminada es:

    C(A,B) = min(S(A→B), S(B→A)).

Es simétrica y no supera ninguna de las dos puntuaciones. También se ofrece la media geométrica sqrt(S(A→B) S(B→A)); es más compensatoria. Ninguna combinación es un teorema psicológico: son reglas de producto que deben contrastarse empíricamente.

## Datos faltantes y exclusiones

- `null` o ausencia de una propiedad significa desconocido. Una lista vacía significa una lista declarada vacía; no es ausencia.
- Una hoja desconocida se representa por el intervalo de distancias [0,1]. Los promedios ponderados propagan cotas inferior y superior. La puntuación queda en [1−D_superior,1−D_inferior]. Son cotas deterministas, no intervalos de confianza; pueden ser conservadoras si hay dependencias entre criterios.
- La cobertura suma el peso efectivo de las hojas observadas. El peso efectivo de una hoja es el producto de pesos normalizados a lo largo de su rama; no basta contar respuestas.
- Se ordena por el extremo inferior de la puntuación. Así, omitir datos no mejora esa puntuación conservadora.
- Si falta un dato requerido para una restricción obligatoria, el resultado queda `pending`. Si alguna restricción observada falla, queda `rejected`. Sólo `eligible` entra en `rank` por defecto.
- El radio `r` se aplica a la cota superior de la distancia: devuelve coincidencias garantizadas dentro del radio bajo las cotas del modelo. Con datos completos coincide con la consulta usual.
- La puntuación numérica se conserva para explicar exclusiones; **un resultado rejected o pending no debe recomendarse como coincidencia válida**, aunque tenga una puntuación alta.

## API mínima

```js
const {Matchmaker} = require('./grappa.js');
const m = new Matchmaker({
  id: 'ritmo',
  request: 'horasDeseadas',
  candidate: 'horasSociales',
  distance: 'intervalPreference',
  params: {scale: 10},
  maxDistance: 0
});
m.offer('p1', {horasSociales: 4});
m.offer('p2', {horasSociales: 12});
console.log(m.rank({horasDeseadas: [2,6]}, {k: 5}));
```

Cada hoja usa rutas relativas a la solicitud y al candidato. La API de reciprocidad pasa `A.preferences` y `B.profile` al motor de A, y viceversa. Cada persona puede tener su propio motor/pesos. `evaluate` devuelve el estado, las cotas, la cobertura y el árbol; `rank` añade identificadores. Se pueden registrar distancias propias con `new Matchmaker(schema, {nombre: funcion})`, siempre con resultados finitos en [0,1]. Configuraciones y valores inválidos generan errores, no puntuaciones silenciosas.

La demo utiliza personas ficticias, tres ejes ilustrativos y contextos declarados. **No implementa un instrumento Big Five validado, ni diagnostica rasgos, ni estima probabilidades de éxito interpersonal.** El peso ajustable cambia sólo las preferencias de la persona seleccionada; los demás mantienen sus pesos. El contexto se modela por igualdad exacta únicamente para simplificar el ejemplo.

## Continuación propuesta

1. Definir dominios separados: amistad, colaboración, actividades y dating. Cada uno necesita su propio esquema de objetivos, preferencias y restricciones.
2. Elegir cómo obtener rasgos y preferencias: autorreporte explícito, tolerancias y pesos; mantener separados rasgos observados y preferencias. Si se utilizan cuestionarios psicométricos, justificar instrumento, versión, permisos y validez para la población de interés.
3. Construir perfiles editables, registro de versiones del esquema y pruebas de sensibilidad del ranking. Comparar reglas de semejanza, preferencias individuales y reciprocidad con baselines simples.
4. Evaluar con resultados consentidos: interés mutuo, aceptación de interacción y satisfacción posterior. No usar sólo «se parecen» como etiqueta de éxito. Separar ajuste de pesos y evaluación fuera de muestra.
5. Añadir backend, gestión de datos, consentimiento y visibilidad de perfiles cuando se pase a personas reales. Este prototipo no almacena ni transmite datos de usuarios.
6. Si se buscan parejas exclusivas o equipos, formular una segunda etapa de asignación con capacidades y objetivos explícitos. Un ranking recíproco no implica estabilidad de emparejamiento ni optimización global.

Para N candidatos y L hojas de coste constante, el barrido cuesta O(NL), más O(N log N) por ordenar. Comparar toda una comunidad es O(N²L). Jaccard añade el coste del tamaño de los conjuntos. El prototipo prioriza trazabilidad; todavía no incorpora índices ni optimización a escala.
