# Gestión Sostenible

Panel operativo para coordinar retiros, administrar clientes, seguir indicadores financieros y personalizar la marca con una experiencia unificada.

## Módulos principales
- **Inicio (`index.html`)**: tablero con KPIs de agenda, cartera, cobranzas y registro de acceso.
- **Retiros (`retiros.html`)**: agenda diaria con optimizador de rutas sobre Google Maps.
- **Clientes (`clientes-firestore.html`)**: mantenimiento de la cartera, exportaciones y carga masiva desde Excel/CSV.
- **Finanzas (`finanzas.html`)**: panel de cobranzas y asistente fiscal con guías de DGI/BPS.
- **Configuración (`configuracion.html`)**: perfil del responsable, teléfono verificado por SMS, cambio de contraseña y salud del almacenamiento.
- **Gestión de Cuentas (`usuarios.html`)**: alta/baja de cuentas de Control o Administrador, con correo de bienvenida automático y auditoría.
- **Temas (`temas.html`)**: personalización de logotipo y paleta aplicada a todo el entorno.
- **Landing plataforma (`landing.html`)**: página pública orientada a clientes con CTA al ingreso corporativo y a la demo guiada.
- **Landing demo (`landing-demo.html`)**: recorrido introductorio que sólo ofrece el acceso de prueba en modo lectura.

## Configuración segura
- Cargá las credenciales de Firebase mediante variables de entorno (`.env.example` como referencia) o con la meta etiqueta `gs:firebase-config`; el helper selecciona automáticamente la configuración según dominio.
- Definí `GS_ADMIN_API_BASE` en tu entorno o en Firebase Remote Config para que las acciones administrativas (alta/baja de usuarios) se ejecuten vía un backend con Admin SDK.
- Todos los HTML incluyen un Content-Security-Policy básico; ajustalo a tu dominio/CDN si servís fuentes o scripts adicionales.

## Personalización visual
- Subí un logotipo desde **Temas**; el sistema extrae colores dominantes y deriva la paleta completa.
- Los cambios se previsualizan al instante tanto en el módulo como en el shell principal gracias a la difusión por `BroadcastChannel` y un fallback `postMessage` para orígenes `file://` o navegadores sin canal compartido.
- Guardar el tema persiste la configuración en Firestore, la cachea en el navegador y la envía a todos los módulos embebidos.

## Seguridad reforzada
- **Verificación por SMS**: desde Configuración se puede iniciar la verificación telefónica y marcar el número como confiable para la cuenta.
- **Auditoría**: `gs-auth.js` registra inicios de sesión, cambios de perfil/contraseña y movimientos de usuarios para consultarlos desde Configuración.
- **Gestión de cuentas**: solo Administradores pueden crear, editar o eliminar usuarios; cada invitación dispara un correo de bienvenida y queda registrada.

## Importación masiva de clientes
- En Clientes existe una tarjeta “Importar desde Excel o CSV” que acepta `.xlsx`, `.xls` o `.csv`.
- Se puede previsualizar la información, validar columnas opcionales y confirmar la carga en lote mediante `gsAuth.importClients`.
- El proceso acepta hasta 600 filas por lote, limpia datos sospechosos y distribuye los registros en la colección `clientes`.

## Requisitos previos
1. Proyecto Firebase con Authentication (correo y teléfono), Firestore y Storage habilitados.
2. Dominios de despliegue agregados a **Authentication → Settings → Authorized domains**.
3. Plantillas de correo personalizadas en Firebase para notificar verificaciones o restablecimientos.
4. reCAPTCHA configurado en Phone Auth (inserta el dominio en la consola para que el widget funcione en Configuración).

## Despliegue en hosting gratuito
Si desplegás la app en un dominio nuevo (por ejemplo `gestion-sostenible.freemyip.com`) y el login no avanza, casi siempre es porque el dominio no está autorizado en Firebase Authentication. Agregalo en **Authentication → Settings → Authorized domains** y esperá unos segundos; no es posible reemplazar Firebase por un “JSON en disco” en hosting estático porque el navegador no puede escribir archivos en el servidor. Para demostraciones sin backend real usá `index.html?demo=1`, que levanta datos locales en modo sólo lectura.

### GitHub Pages
1. Subí el repositorio a GitHub.
2. En **Settings → Pages**, seleccioná la rama (ej. `main`) y la carpeta `/`.
3. Aguardá la URL `https://<usuario>.github.io/<repo>` y añadila a los dominios autorizados de Firebase.
4. Abrí la página publicada y probá el inicio de sesión.

### Netlify / Vercel
1. Creá una cuenta gratuita y conectá el repositorio.
2. Configurá “build command: none” y “publish directory: ./”.
3. Tras el primer deploy, agregá el dominio `*.netlify.app` o `*.vercel.app` (y los personalizados) en Firebase Authentication.
4. Validá el flujo de login y la carga de módulos.

### Firebase Hosting
1. Instalá la CLI (`npm install -g firebase-tools`) y ejecutá `firebase login`.
2. Dentro del proyecto corré `firebase init hosting`, elegí `gestion-sostenible` y definí la carpeta pública como `.`.
3. Desactivá rewrites si querés mantener cada HTML independiente.
4. Deploy con `firebase deploy --only hosting` y usá la URL `https://gestion-sostenible.web.app` (o similar).

> **Tip**: para pruebas locales podés ejecutar `npx serve .` y abrir `http://localhost:3000/index.html`. Si usás el esquema `file://`, el fallback con `postMessage` mantiene sincronizada la personalización de temas.
- **Modo demo**: `index.html?demo=1` levanta una sesión simulada con datos de ejemplo (clientes, retiros, finanzas, usuarios y auditoría). Todas las operaciones quedan en solo lectura para evaluar la app sin tocar la base productiva. Cerrar sesión redirige nuevamente al landing público.
- **Redirecciones de sesión**: la navegación completa permanece oculta hasta autenticarte; al cerrar sesión (demo o real) se vuelve a la landing correspondiente (`landing-demo.html` para sesiones demo, `landing.html` para cuentas reales).
- **Dominios autorizados**: si desplegás en un host nuevo (por ejemplo `gestion-sostenible.freemyip.com`) y el login muestra “El dominio no está autorizado”, agregá el dominio exacto en **Authentication → Settings → Authorized domains** de Firebase. Hasta hacerlo, el inicio de sesión no funcionará y podés usar el modo demo para mostrar la app.
- **Almacenamiento en JSON**: la app escribe en Firebase (Auth/Firestore/Storage); al servirse como sitio estático no puede persistir datos en archivos del servidor. Para pruebas sin backend, la sesión demo usa datos locales sólo de lectura; para conservar cambios reales es necesario apuntar a Firebase (o un backend compatible) con el dominio habilitado.
