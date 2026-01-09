# RosInterface v1.2

> **High-Performance RouterOS Automation A modern TypeScript and JavasScript Library for MikroTik interactions.**  
> Built with Reactive Streaming (onSnapshot), Circuit Breakers for fault tolerance, and an Offline Queue system.
> Transform raw RouterOS commands into synchronized, type-safe application state.

> **Automatización de Alto Rendimiento para RouterOS Una librería moderna en TypeScript y JavaScript para interactuar con MikroTik.**  
> Diseñada con Streaming Reactivo (onSnapshot), Circuit Breakers para tolerancia a fallos y un sistema de Cola Offline.
> Transforma comandos crudos de RouterOS en un estado de aplicación sincronizado y con tipado seguro.

[![npm version](https://img.shields.io/npm/v/rosinterface.svg?style=flat-square)](https://www.npmjs.com/package/rosinterface)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

---


## English Documentation

**RosInterface** is designed for **ISPs and mission-critical environments**.  
It focuses on **connection stability**, **router hardware protection**, and **efficient data access**, even under unstable network conditions.

---

### ✨ Key Features

- **Hardware Protection**  
  Built-in **Rate Limiter** with intelligent backoff to prevent RouterOS CPU saturation.

- **Offline-First Architecture**  
  Commands marked with `.persistent()` are automatically queued if the router is offline and synchronized once connectivity is restored.

- **Smart Caching**  
  Read operations are cached for **5 seconds (TTL)** to reduce redundant API calls and router load.

- **Source-Side Filtering**  
  Use `.findBy()` and `.findOne()` to filter data **directly on the router**, minimizing bandwidth and latency.

- **On-time changes**  
  Use `.collection()` and `.onSnapshot()` to get changes on real time **directly the router**, for to get new data without call to many times to your router.

- **Fault Tolerance (Circuit Breaker)**

  Implements the `Circuit Breaker` pattern. If the router stops responding or encounters critical errors, the library temporarily "cuts the circuit" to prevent the accumulation of failed requests and protect the stability of your Node.js server.

- **Native Observability**

  Built-in `.getMetrics()` method. Exports traffic statistics and router status directly in a format compatible with Prometheus and Grafana without the need for external plugins.

- **Transport Security**

  Full support for **TLS/SSL (SSL API)**, allowing secure encrypted connections over port 8729 (recommended to change this), ideal for managing routers over the public internet.

- **Fluent API**  
  Chainable, expressive syntax for clean and maintainable automation code.

- **CLI Code Generator**  
  Auto-generate TypeScript interfaces from your live router. No more guessing field names.

- **Differential Updates (onDiff)**  
  Receive atomic added, modified, and removed events instead of full arrays. Optimized for high-performance UIs.

- **Intelligent Throttling**  
  Control the flow of real-time data with "Leading + Trailing Edge" strategies.

---


---

### ✨ Important Considerations

#### Environment Variables (.env)

Create a `.env` file in the root directory of your project:

```text
MIKROTIK_HOST=ROUTER_IP
MIKROTIK_USER=admin
MIKROTIK_PASSWORD=your_password
MIKROTIK_PORT=8729
```

> ⚠️ **Security Notice**  
> The `allowInsecureConfig` flag is a **critical** security measure in RosInterface.  
> Prevents accidental exposure of credentials or use of unencrypted protocols in production.
>
> Use **only in controlled, local or test environments**.


>⚠️ **Performance Warning**
> 
> The `onSnapshot` function allows you to receive **real-time** router changes in RosInterface.
> To avoid negative performance impacts on low-spec devices, it is recommended to use it with **Resilience** enabled.
> 
> Use it **in moderation; excessive use of onSnapshot can negatively affect the performance of your devices**.


---


### Usage Examples

#### 1. Basic Connection

```ts
import { MikrotikClient } from 'rosinterface';

const client = new MikrotikClient({
    host: 'ROUTER_IP (LOCAL OR REMOTE)',
    user: 'admin',
    password: 'password',
    port: 8729, // We recommended change the default port
    useTLS: false, // Test only
    rateLimit: 50,
    allowInsecureConfig: true // Never in production or release
});

await client.connect();
```
---


#### 2. Recommended connection (Production/Release)

```ts
import { MikrotikClient } from 'rosinterface';
import 'dotenv/config';

const client = new MikrotikClient({
  host: process.env.MIKROTIK_HOST,
  user: process.env.MIKROTIK_USER,
  password: process.env.MIKROTIK_PASSWORD,
  port: Number(process.env.MIKROTIK_PORT) || 8729,
  useTLS: true, //Always use TLS between TLS v1.2 or TLS v1.3 deppend that your devices
  rateLimit: 50 //Here you adjust the number of requests per second you want it to support (Anti DDoS)
});

await client.connect();
```

---



#### 3. Optimized Read (select + findOne)

```ts
const user = await client.command('/ppp/secret')
  .select(['name', 'profile', 'last-logged-out'])
  .findOne({ name: 'john_doe' });

console.log(`User: ${user?.name}, Profile: ${user?.profile}`);
```

---

#### 4. Resilience with Persistence (Offline-Safe)

```ts
const result = await client.command('/ppp/secret')
  .persistent()
  .add({
    name: 'new_user',
    password: 'securePassword123',
    profile: 'default'
  });

if (result === 'QUEUED_OFFLINE') {
  console.log('Router unreachable. Task stored and will sync automatically.');
}
```


#### 5. Time-Limited Listener

```ts
// Start the subscription and store the cleanup function (unsubscribe)
const unsubscribe = client.collection('/ppp/secret')
    .onSnapshot((secrets) => {
        console.log(`Update received. Total users: ${secrets.length}`);
    });

// Set a timer to stop listening
setTimeout(() => {
    console.log('Time up. Stopping subscription...');

    // Stops the Router stream and clears local memory
    unsubscribe();

    // Optional: Close the connection if no further tasks are needed
    client.close();
}, 60000); // 60 seconds
```


#### 6. Persistent Listener (Always On)

```ts
// The client automatically handles Keep-Alive pings (every 10s)
// to prevent idle disconnects. No need to call 'unsubscribe'.

client.collection('/interface')
    .where('disabled', false) // Optional: Only active interfaces
    .onSnapshot((interfaces) => {
        // This callback will execute infinitely whenever a physical change
        // occurs on the router (cable unplugged, traffic state, rename, etc.)
        const downInterfaces = interfaces.filter(i => i.running === 'false');

        if (downInterfaces.length > 0) {
            console.alert(`ALERT: ${downInterfaces.length} interfaces are down.`);
        }
    });

// Important: Handle network errors to reconnect if power or internet is lost
client.on('close', () => {
    console.log('Connection lost. Restarting service in 5s...');
    setTimeout(() => connectAndListen(), 5000);
});
```



#### 7. Prometheus Metric

```ts
// 1. Define the map: Mikrotik Field -> Prometheus Metric
const metricsDef = [
    {
        name: 'mikrotik_iface_rx_total', // Final name in Prometheus
        help: 'Bytes received',          // Description
        type: 'counter',                 // Type: 'counter' or 'gauge'
        path: 'rx-byte',                 // Original field in RouterOS
        labels: ['name', 'type']         // Labels for filtering (e.g., wan, bridge)
    },
    {
        name: 'mikrotik_iface_tx_total',
        help: 'Bytes transmitted',
        type: 'counter',
        path: 'tx-byte',
        labels: ['name', 'type']
    }
];

// 2. Get the formatted plain text ready for Prometheus
// (Internally executes /interface/print and transforms the data)
const result = await client.getMetrics('/interface', metricsDef);

console.log(result);
```



#### 8. Type-Safe Realtime Stream (onDiff)

```ts
client.collection('/ppp/secret')
    .onSnapshot((data) => {
    // Check if we are in Diff Mode
    if ('added' in data) {
        // TypeScript automatically infers that 'data' is a SnapshotDiff!

        // Added items
        data.added.forEach(secret => console.log('New:', secret.name));

        // Modified items
        data.modified.forEach(secret => console.log('Modified:', secret.name));

        // Removed items
        data.removed.forEach(secret => console.log('Removed:', secret.name));
    }
    else {
        // If execution reaches here, .onDiff() was NOT used, so 'data' is a standard Array
        console.log('Full list size:', data.length);
    }
}).onDiff();
```


#### 9. Data Transformers With Print

```ts
// EXAMPLE 1: Using .toMap() for O(1) Lookup
// Scenario: Quickly finding a specific user by name without looping through an array.
client.command('/ppp/secret').print().then(result => {
    // Transform the array into a Dictionary (Map) indexed by 'name'
    const usersMap = result.toMap('name');

    // Instant access! No .find() required.
    const john = usersMap['john_doe'];
    if (john) {
        console.log(`User Found: ${john.profile}`);
    }
});

// EXAMPLE 2: Using .toGrouped() for Reporting
// Scenario: Grouping active connections by their service profile (e.g. 10mb, 50mb plans).
client.command('/ppp/active').print().then(result => {
    // Group users by the 'profile' property
    const byProfile = result.toGrouped('profile');

    console.log('--- Connected Users Summary ---');
    Object.keys(byProfile).forEach(profile => {
        console.log(`Plan ${profile}: ${byProfile[profile].length} users`);
    });
});

// EXAMPLE 3: Using .toPages() for Pagination
// Scenario: Displaying a large list of logs in a frontend table, page by page.
const PAGE_SIZE = 50;
const CURRENT_PAGE = 1;

client.command('/log').print().then(result => {
    // Get only the items for the first page
    const pageData = result.toPages(CURRENT_PAGE, PAGE_SIZE);

    console.log(`Showing ${pageData.length} logs (Page ${CURRENT_PAGE})`);
    pageData.forEach(log => console.log(`[${log.time}] ${log.message}`));
});

```


#### 10. CLI Codegen - Automatic Type Generation

> **OPTION A: Using .env file (Recommended for Security)**  
> Create a .env file with MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASS
> Run the command:
> > npm run codegen -- -p /ppp/secret -n ISecret
> 
> OPTION B: Manual Configuration (Quick Testing / CI)
> Pass connection details directly via flags. Use double quotes for passwords with special chars.
> >npm run codegen -- -p /ppp/secret -n ISecret --host ROUTER_IP --user admin --pass "secret123" --port 8728


```ts
// Usage A: Type-Safe Reading (Auto-complete for properties)
// Pass the interface <ISecret> to .collection() or .command()
client.collection<ISecret>('/ppp/secret').onSnapshot((diff) => {
    if ('added' in diff) {
        diff.added.forEach(secret => {
            // TypeScript knows 'profile' and 'service' exist!
            // If you type "secret.", your IDE will show all available fields.
            console.log(`New User: ${secret.name} (Plan: ${secret.profile})`);
        });
    }
});

// Usage B: Type-Safe Writing (Validation for .add)
async function createSecureUser() {
    const api = client.command<ISecret>('/ppp/secret');

    // TypeScript ensures you only pass valid fields defined in ISecret.
    // It prevents typos like 'passwrod' or using invalid profile names if unions were generated.
    await api.add({
        name: 'vip_user',
        password: 'secure_password',
        profile: 'default',
        service: 'pppoe',
        disabled: false
    });
}

```




---

## Documentación en Español

**RosInterface** está diseñado para **ISPs y entornos críticos**.  
Su objetivo es garantizar **estabilidad de conexión**, **protección del hardware MikroTik** y **consultas eficientes**, incluso con enlaces inestables.

---

### ✨ Características Principales

- **Protección del Hardware**  
  Limitador de tasa integrado con retroceso inteligente para evitar saturación de CPU.

- **Arquitectura Offline-First**  
  Los comandos con `.persistent()` se guardan en cola si el router no está disponible y se ejecutan automáticamente al reconectar.

- **Caché Inteligente**  
  Consultas con TTL de **5 segundos**, reduciendo llamadas innecesarias.

- **Filtrado en Origen**  
  `.findBy()` y `.findOne()` filtran directamente en RouterOS sin descargar tablas completas.

- **Cambios puntuales**  
  Usa `.collection()` y `.onSnapshot()` para obtener cambios en tiempo real **directamente desde el router**, para obtener datos nuevos, sin llamar a su router repetidamente.

- **Tolerancia a Fallos (Circuit Breaker)**  
  Implementa el patrón `Circuit Breaker` . Si el router deja de responder o da errores críticos, la librería "corta el circuito" temporalmente para evitar acumular peticiones fallidas y proteger la estabilidad de tu servidor Node.js.

- **Observabilidad Nativa**  
  Método `.getMetrics()`integrado. Exporta estadísticas de tráfico y estado del router directamente en formato compatible con Prometheus y Grafana sin necesidad de plugins externos.

- **Seguridad de Transporte**  
  Soporte completo para **TLS/SSL (API-SSL)**, permitiendo conexiones encriptadas seguras a través del puerto 8729 (Recomendado cambiar), ideal para administrar routers a través de internet pública.

- **API Fluida**  
  Sintaxis encadenable y clara.

- **Generador de código CLI**

  Genere automáticamente interfaces TypeScript desde su enrutador en vivo. Olvídese de adivinar los nombres de los campos.

- **Actualizaciones diferenciales (onDiff)**

  Reciba eventos atómicos de adición, modificación y eliminación en lugar de matrices completas. Optimizado para interfaces de usuario de alto rendimiento.

- **Limitación inteligente**

  Controle el flujo de datos en tiempo real con estrategias de vanguardia y vanguardia.

---

### ✨ Consideraciones Importantes

#### Variables de Entorno (.env)

Crea un archivo `.env` en el directorio raíz de tu proyecto:

```text
MIKROTIK_HOST=IP_DEL_ROUTER
MIKROTIK_USER=admin
MIKROTIK_PASSWORD=tu_contraseña
MIKROTIK_PORT=8729
```

> ⚠️ **Aviso de Seguridad**  
> La bandera `allowInsecureConfig` es una medida de seguridad **crítica** en RosInterface.  
> Previene la exposición accidental de credenciales o el uso de protocolos no cifrados en producción.
>
> Úsala **solo en entornos controlados, locales o de prueba**.


> ⚠️ **Aviso de Rendimiento**  
> La función `onSnapshot` permite recibir cambios en **tiempo real** del router en RosInterface.  
> Para evitar el impacto negativo de rendimiento en equipos con pocas prestaciones, se recomienda usarlo con **Resiliencia**.
>
> Úsala **con moderación, el abuso de onSnapshot puede afectar el rendimiento de tus equipos**.



---

### Ejemplos de Uso

#### 1. Conexión rápida (solo pruebas)

```ts
import { MikrotikClient } from 'rosinterface';

const client = new MikrotikClient({
  host: 'IP_DEL_ROUTER (LOCAL O REMOTO)',
  user: 'admin',
  password: 'password',
  port: 8729, // Se recomienda cambiar el puerto por defecto
  useTLS: false, // Solo pruebas
  rateLimit: 50,
  allowInsecureConfig: true // Nunca en producción
});

await client.connect();
```

---

#### 2. Conexión Recomendada (Producción)

```ts
import { MikrotikClient } from 'rosinterface';
import 'dotenv/config';

const client = new MikrotikClient({
  host: process.env.MIKROTIK_HOST,
  user: process.env.MIKROTIK_USER,
  password: process.env.MIKROTIK_PASSWORD,
  port: Number(process.env.MIKROTIK_PORT) || 8729,
  useTLS: true, //Utilice siempre TLS entre TLS v1.2 o TLS v1.3 dependiendo de sus dispositivos
  rateLimit: 50 //Aqui ajustas la cantidad de peticiones por segundo que deseas que soporte (Anti DDoS)
});

await client.connect();
```

---

#### 3. Lectura Optimizada

```ts
const user = await client.command('/ppp/secret')
  .select(['name', 'profile', 'last-logged-out'])
  .findOne({ name: 'john_doe' });

console.log(`User: ${user?.name}, Profile: ${user?.profile}`);
```

---

#### 4. Persistencia Offline

```ts
const result = await client.command('/ppp/secret')
  .persistent()
  .add({
    name: 'new_user',
    password: 'securePassword123',
    profile: 'default'
  });

if (result === 'QUEUED_OFFLINE') {
  console.log('Router unreachable. Task stored and will sync automatically.');
}
```


#### 5. Escuchar por un Tiempo Determinado (Time-Limited)

```ts
// Iniciar la suscripción y guardar la función de limpieza (unsubscribe)
const unsubscribe = client.collection('/ppp/secret')
    .onSnapshot((secrets) => {
        console.log(`Actualización recibida. Total usuarios: ${secrets.length}`);
    });

// Establecer un temporizador para detener la escucha
setTimeout(() => {
    console.log('Tiempo finalizado. Cerrando suscripción...');

    // Detiene el stream del Router y limpia la memoria local
    unsubscribe();

    // Opcional: Cerrar la conexión si ya no harás más tareas
    client.close();
}, 60000); // 60 segundos
```



#### 6. Escucha Persistente (Always On)

```ts
// Configuración para mantener la conexión viva (Keep-Alive)
// El cliente enviará pings internos cada 10s para evitar desconexiones por inactividad.
// No es necesario llamar a 'unsubscribe' ni poner timeouts.

client.collection('/interface')
    .where('disabled', false) // Opcional: Solo interfaces activas
    .onSnapshot((interfaces) => {
        // Este callback se ejecutará infinitamente cada vez que haya un cambio
        // físico en el router (cable desconectado, tráfico, cambio de nombre, etc.)
        const downInterfaces = interfaces.filter(i => i.running === 'false');

        if (downInterfaces.length > 0) {
            console.alert(`ALERTA: ${downInterfaces.length} interfaces caídas.`);
        }
    });

// Importante: Manejar errores de red para reconectar si se va la luz o internet
client.on('close', () => {
    console.log('Conexión perdida. Reiniciando servicio en 5s...');
    setTimeout(() => connectAndListen(), 5000);
});
```


#### 7. Métricas Prometheus

```ts
// 1. Define el mapeo: Campo Mikrotik -> Métrica Prometheus
const metricasDef = [
    {
        name: 'mikrotik_iface_rx_total', // Nombre final en Prometheus
        help: 'Bytes recibidos',         // Descripción
        type: 'counter',                 // Tipo: 'counter' o 'gauge'
        path: 'rx-byte',                 // Campo original en RouterOS
        labels: ['name', 'type']         // Etiquetas para filtrar (ej: wan, bridge)
    },
    {
        name: 'mikrotik_iface_tx_total',
        help: 'Bytes transmitidos',
        type: 'counter',
        path: 'tx-byte',
        labels: ['name', 'type']
    }
];

// 2. Obtén el texto formateado listo para Prometheus
// (Internamente ejecuta /interface/print y transforma los datos)
const resultado = await client.getMetrics('/interface', metricasDef);

console.log(resultado);
```

#### 8. Transmisión en tiempo real con seguridad de tipos (onDiff)

```ts
client.collection('/ppp/secret') // Sin <T>, se asume Record<string, any>
    .onSnapshot((data) => {
        // Verificar si estamos en modo Diff
        if ('added' in data) {
            // TypeScript infiere automáticamente que 'data' es un SnapshotDiff

            // Elementos Agregados
            data.added.forEach(secret => console.log('Nuevo:', secret.name));

            // Elementos Modificados
            data.modified.forEach(secret => console.log('Editado:', secret.name));

            // Elementos Eliminados
            data.removed.forEach(secret => console.log('Borrado:', secret.name));
        }
        else {
            // Si entra aquí, es que NO se usó .onDiff() y es un Array normal
            console.log('Tamaño lista completa:', data.length);
        }
    })
    .onDiff(); // <--- IMPORTANTE: Activa el modo diferencial
```


#### 9. Tranformadores de tipo de datos con Print

```ts
// EJEMPLO 1: Usando .toMap() para Búsqueda Instantánea O(1)
// Escenario: Encontrar rápidamente un usuario específico por nombre sin recorrer un array.
client.command('/ppp/secret').print().then(result => {
    // Transformar el array en un Diccionario (Map) indexado por 'name'
    const usersMap = result.toMap('name');

    // ¡Acceso instantáneo! No se requiere .find().
    const john = usersMap['john_doe'];
    if (john) {
        console.log(`Usuario Encontrado: ${john.profile}`);
    }
});


// EJEMPLO 2: Usando .toGrouped() para Reportes
// Escenario: Agrupar conexiones activas por su perfil de servicio (ej. planes de 10mb, 50mb).
client.command('/ppp/active').print().then(result => {
    // Agrupar usuarios por la propiedad 'profile'
    const byProfile = result.toGrouped('profile');

    console.log('--- Resumen de Usuarios Conectados ---');
    Object.keys(byProfile).forEach(profile => {
        console.log(`Plan ${profile}: ${byProfile[profile].length} usuarios`);
    });
});


// EJEMPLO 3: Usando .toPages() para Paginación
// Escenario: Mostrar una lista grande de logs en una tabla frontend, página por página.
const PAGE_SIZE = 50;
const CURRENT_PAGE = 1;

client.command('/log').print().then(result => {
    // Obtener solo los elementos para la primera página
    const pageData = result.toPages(CURRENT_PAGE, PAGE_SIZE);

    console.log(`Mostrando ${pageData.length} logs (Página ${CURRENT_PAGE})`);
    pageData.forEach(log => console.log(`[${log.time}] ${log.message}`));
});

```


#### 10. CLI Codegen - Generación Automática de Tipos

> **OPCIÓN A: Usando archivo .env (Recomendado por Seguridad)**  
> Crea un archivo .env con MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASS
> Ejecuta el comando:
> > npm run codegen -- -p /ppp/secret -n ISecret
>
> OPCIÓN B: Configuración Manual (Pruebas Rápidas / CI)
> PPasa los detalles de conexión directamente mediante banderas. Usa comillas dobles para contraseñas con caracteres especiales.
> >npm run codegen -- -p /ppp/secret -n ISecret --host ROUTER_IP --user admin --pass "secret123" --port 8728


```ts
// Uso A: Lectura con Tipado Seguro (Auto-completado para propiedades)
// Pasar la interfaz <ISecret> a .collection() o .command()
client.collection<ISecret>('/ppp/secret').onSnapshot((diff) => {
    if ('added' in diff) {
        diff.added.forEach(secret => {
            // ¡TypeScript sabe que 'profile' y 'service' existen!
            // Si escribes "secret.", tu IDE mostrará todos los campos disponibles.
            console.log(`Nuevo Usuario: ${secret.name} (Plan: ${secret.profile})`);
        });
    }
});

// Uso B: Escritura con Tipado Seguro (Validación para .add)
async function createSecureUser() {
    const api = client.command<ISecret>('/ppp/secret');

    // TypeScript asegura que solo pases campos válidos definidos en ISecret.
    // Previene errores tipográficos como 'passwrod' o usar nombres de perfil inválidos si se generaron uniones.
    await api.add({
        name: 'vip_user',
        password: 'secure_password',
        profile: 'default',
        service: 'pppoe',
        disabled: false
    });
}

```


---

## Author's Note / Nota del Autor

**English** 
>Thank you for choosing RosInterface for your automation needs. I built this library to solve the real-world challenges of managing MikroTik networks at scale. I hope it helps you build your systems.

Happy Coding!  
— **McBlockier**

**Español** 
> Gracias por elegir **RosInterface** para tus necesidades de automatización. Construí esta librería para resolver los desafíos reales de administrar redes MikroTik a escala. Espero te ayude mucho a construir tus sistemas .

¡Feliz Código!  
— **McBlockier**


---
