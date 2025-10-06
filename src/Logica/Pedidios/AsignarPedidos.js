const { connectionString } = require('../Conexion/Conexion');
const Swal = require('sweetalert2');
const { ipcRenderer } = require('electron');

// Función auxiliar para normalizar resultados de query
function normalizarResultado(resultado) {
    if (Array.isArray(resultado)) {
        return resultado;
    }
    if (Array.isArray(resultado) && resultado.length > 0 && Array.isArray(resultado[0])) {
        return resultado[0];
    }
    if (resultado && resultado.rows) {
        return resultado.rows;
    }
    return [];
}

// Cargar datos al iniciar
document.addEventListener('DOMContentLoaded', () => {
    cargarDatos();
    configurarEventos();
    configurarTabs();
    
    // Actualizar datos cada 30 segundos
    setInterval(cargarDatos, 30000);
});

// Configurar sistema de pestañas
function configurarTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            
            // Remover active de todos los botones y contenidos
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Agregar active al botón y contenido seleccionado
            button.classList.add('active');
            document.getElementById(`tab-${targetTab}`).classList.add('active');
        });
    });
}

// Configurar eventos
function configurarEventos() {
    // Botón refrescar
    document.getElementById('btnRefresh').addEventListener('click', async () => {
        const btn = document.getElementById('btnRefresh');
        const icon = btn.querySelector('i');
        
        icon.classList.add('fa-spin');
        await cargarDatos();
        
        setTimeout(() => {
            icon.classList.remove('fa-spin');
        }, 1000);
    });
    
    // Botón cerrar
    document.getElementById('btnClose').addEventListener('click', () => {
        window.close();
    });
}

// Cargar todos los datos
async function cargarDatos() {
    await Promise.all([
        cargarPedidosPendientes(),
        cargarPedidosEnPreparacion()
    ]);
}

// Cargar pedidos pendientes (Estado 4)
async function cargarPedidosPendientes() {
    try {
        const connection = await connectionString();
        
        let pedidos = await connection.query(
            `SELECT
                pedidostienda_bodega.IdPedidos, 
                pedidostienda_bodega.Fecha, 
                pedidostienda_bodega.NombreEmpresa, 
                pedidostienda_bodega.TotalCantidad, 
                pedidostienda_bodega.Departamento
            FROM
                pedidostienda_bodega
            WHERE
                pedidostienda_bodega.Estado = 4
            ORDER BY pedidostienda_bodega.Fecha ASC`
        );
        
        await connection.close();
        
        pedidos = normalizarResultado(pedidos);
        
        // Actualizar contadores
        document.getElementById('countPendientes').textContent = pedidos.length;
        document.getElementById('badgePendientes').textContent = pedidos.length;
        
        // Renderizar tabla
        const tbody = document.getElementById('bodyPendientes');
        
        if (pedidos.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        <i class="fas fa-check-circle"></i>
                        <p>No hay pedidos pendientes por preparar</p>
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = '';
        
        pedidos.forEach(pedido => {
            const tr = document.createElement('tr');
            const fechaFormateada = formatearFecha(pedido.Fecha);
            
            tr.innerHTML = `
                <td class="cell-id">#${pedido.IdPedidos}</td>
                <td class="cell-date">${fechaFormateada}</td>
                <td class="cell-empresa">${pedido.NombreEmpresa}</td>
                <td>${pedido.Departamento}</td>
                <td class="cell-cantidad">${pedido.TotalCantidad} Fardos</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-iniciar" onclick="iniciarPedido(${pedido.IdPedidos})">
                            <i class="fas fa-play"></i>
                            Iniciar
                        </button>
                        <button class="btn-action btn-ver" onclick="verDetallePedido(${pedido.IdPedidos})">
                            <i class="fas fa-eye"></i>
                            Ver
                        </button>
                    </div>
                </td>
            `;
            
            tbody.appendChild(tr);
        });
        
    } catch (error) {
        console.error('Error al cargar pedidos pendientes:', error);
        const tbody = document.getElementById('bodyPendientes');
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Error al cargar pedidos pendientes</p>
                </td>
            </tr>
        `;
    }
}

// Cargar pedidos en preparación (Estado 5)
async function cargarPedidosEnPreparacion() {
    try {
        const connection = await connectionString();
        
        let pedidos = await connection.query(
            `SELECT
                pedidostienda_bodega.IdPedidos, 
                pedidostienda_bodega.Fecha, 
                pedidostienda_bodega.NombreEmpresa, 
                pedidostienda_bodega.TotalCantidad, 
                pedidostienda_bodega.Departamento,
                departamentos.Nombre as NombreDepartamento,
                pedidostienda_bodega.Nohojas
            FROM
                pedidostienda_bodega
                INNER JOIN departamentos ON pedidostienda_bodega.Departamento = departamentos.Id
            WHERE
                pedidostienda_bodega.Estado = 5
            ORDER BY pedidostienda_bodega.Fecha DESC`
        );
        
        pedidos = normalizarResultado(pedidos);
        
        // Obtener progreso de cada pedido basado en productos
        const pedidosConProgreso = await Promise.all(pedidos.map(async (pedido) => {
            // Contar total de SKUs del pedido
            const resultadoTotal = await connection.query(
                `SELECT COUNT(*) as total
                FROM detallepedidostienda_bodega
                WHERE IdConsolidado = ?`,
                [pedido.IdPedidos]
            );
            const totalSKUs = normalizarResultado(resultadoTotal)[0]?.total || 0;
            
            // Contar productos preparados (EstadoPreparacionproducto > 0)
            const resultadoPreparados = await connection.query(
                `SELECT COUNT(*) as total
                FROM detallepedidostienda_bodega
                WHERE IdConsolidado = ? AND EstadoPreparacionproducto > 0`,
                [pedido.IdPedidos]
            );
            const productosPreparados = normalizarResultado(resultadoPreparados)[0]?.total || 0;
            
            // Contar hojas en proceso (para el indicador visual)
            const resultadoEnProceso = await connection.query(
                `SELECT COUNT(*) as total
                FROM PreparacionPedidos
                WHERE IdPedido = ? AND FechaHoraInicio IS NOT NULL AND FechaHorafinalizo IS NULL`,
                [pedido.IdPedidos]
            );
            const hojasEnProceso = normalizarResultado(resultadoEnProceso)[0]?.total || 0;
            
            const porcentaje = totalSKUs > 0 ? Math.round((productosPreparados / totalSKUs) * 100) : 0;
            
            return {
                ...pedido,
                totalSKUs,
                productosPreparados,
                hojasEnProceso,
                porcentaje
            };
        }));
        
        await connection.close();
        
        // Actualizar contadores
        document.getElementById('countPreparacion').textContent = pedidosConProgreso.length;
        document.getElementById('badgePreparacion').textContent = pedidosConProgreso.length;
        
        // Renderizar tabla
        const tbody = document.getElementById('bodyPreparacion');
        
        if (pedidosConProgreso.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <i class="fas fa-inbox"></i>
                        <p>No hay pedidos en preparación actualmente</p>
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = '';
        
        pedidosConProgreso.forEach(pedido => {
            const tr = document.createElement('tr');
            const fechaFormateada = formatearFecha(pedido.Fecha);
            
            // Determinar color de la barra de progreso
            let colorBarra = '#6b7280';
            if (pedido.porcentaje === 100) {
                colorBarra = '#10b981';
            } else if (pedido.hojasEnProceso > 0 || pedido.productosPreparados > 0) {
                colorBarra = '#f59e0b';
            } else {
                colorBarra = '#2563eb';
            }
            
            tr.innerHTML = `
                <td class="cell-id">#${pedido.IdPedidos}</td>
                <td class="cell-date">${fechaFormateada}</td>
                <td class="cell-empresa">${pedido.NombreEmpresa}</td>
                <td>${pedido.NombreDepartamento || pedido.Departamento}</td>
                <td class="cell-cantidad">${pedido.TotalCantidad} items</td>
                <td class="cell-cantidad">${pedido.Nohojas || 0} hojas</td>
                <td>
                    <div style="min-width: 140px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-size: 0.75rem; color: #9ca3af;">
                                ${pedido.productosPreparados}/${pedido.totalSKUs} SKUs
                            </span>
                            <span style="font-size: 0.75rem; font-weight: 600; color: ${colorBarra};">
                                ${pedido.porcentaje}%
                            </span>
                        </div>
                        <div style="
                            width: 100%;
                            height: 6px;
                            background: rgba(255, 255, 255, 0.1);
                            border-radius: 3px;
                            overflow: hidden;
                        ">
                            <div style="
                                width: ${pedido.porcentaje}%;
                                height: 100%;
                                background: ${colorBarra};
                                border-radius: 3px;
                                transition: width 0.3s ease;
                            "></div>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-ver" onclick="verProgresoPreparacion(${pedido.IdPedidos})">
                            <i class="fas fa-chart-line"></i>
                            Ver Progreso
                        </button>
                        <button class="btn-action btn-asignar" onclick="abrirModalAsignarHojas(${pedido.IdPedidos})">
                            <i class="fas fa-tasks"></i>
                            Asignar Hojas
                        </button>
                    </div>
                </td>
            `;
            
            tbody.appendChild(tr);
        });
        
    } catch (error) {
        console.error('Error al cargar pedidos en preparación:', error);
        const tbody = document.getElementById('bodyPreparacion');
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Error al cargar pedidos en preparación</p>
                </td>
            </tr>
        `;
    }
}

// Abrir modal para asignar hojas
async function abrirModalAsignarHojas(idPedido) {
    try {
        // Mostrar loading
        Swal.fire({
            title: 'Cargando hojas...',
            html: `
                <div style="text-align: center;">
                    <div class="spinner" style="
                        border: 4px solid rgba(37, 99, 235, 0.1);
                        border-top: 4px solid #2563eb;
                        border-radius: 50%;
                        width: 50px;
                        height: 50px;
                        animation: spin 1s linear infinite;
                        margin: 0 auto;
                    "></div>
                </div>
            `,
            showConfirmButton: false,
            allowOutsideClick: false,
            background: '#1a1d23',
            color: '#ffffff'
        });
        
        const connection = await connectionString();
        
        // Obtener hojas del pedido
        let hojas = await connection.query(
            `SELECT
                usuarios.NombreCompleto, 
                PreparacionPedidos.Idpreparo as IdPreparacion,
                PreparacionPedidos.IdPedido, 
                PreparacionPedidos.NoHoja, 
                PreparacionPedidos.FechaHoraInicio, 
                PreparacionPedidos.FechaHorafinalizo, 
                PreparacionPedidos.Sucursal, 
                PreparacionPedidos.TotalSkus, 
                PreparacionPedidos.TotalFardos,
                PreparacionPedidos.IdUsuario
            FROM
                PreparacionPedidos
                LEFT JOIN usuarios ON PreparacionPedidos.IdUsuario = usuarios.Id
            WHERE
                PreparacionPedidos.IdPedido = ?
            ORDER BY PreparacionPedidos.NoHoja ASC`,
            [idPedido]
        );
        
        await connection.close();
        
        hojas = normalizarResultado(hojas);
        
        if (hojas.length === 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Sin hojas',
                text: 'Este pedido no tiene hojas generadas',
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#f59e0b',
                background: '#1a1d23',
                color: '#ffffff'
            });
            return;
        }
        
        // Generar HTML de las hojas
        const hojasHTML = hojas.map(hoja => {
            const preparadorAsignado = hoja.NombreCompleto || 'Sin asignar';
            
            let estadoBadge = '';
            let accionHTML = '';
            
            // Solo bloquear si está finalizada
            if (hoja.FechaHorafinalizo) {
                estadoBadge = '<span class="status-badge status-finalizado"><i class="fas fa-check-circle"></i> Finalizado</span>';
                accionHTML = '<span style="color: #10b981; font-size: 0.85rem;"><i class="fas fa-lock"></i> Completado</span>';
            } else if (hoja.FechaHoraInicio) {
                // En proceso pero puede reasignarse
                estadoBadge = '<span class="status-badge status-en-proceso"><i class="fas fa-spinner"></i> En proceso</span>';
                accionHTML = `
                    <button class="btn-action btn-reasignar" onclick="asignarHojaAPreparador(${hoja.IdPreparacion}, ${idPedido})">
                        <i class="fas fa-exchange-alt"></i> Reasignar
                    </button>
                `;
            } else if (hoja.IdUsuario) {
                // Asignado pero no iniciado
                estadoBadge = '<span class="status-badge badge-info"><i class="fas fa-user-clock"></i> Asignado</span>';
                accionHTML = `
                    <button class="btn-action btn-reasignar" onclick="asignarHojaAPreparador(${hoja.IdPreparacion}, ${idPedido})">
                        <i class="fas fa-exchange-alt"></i> Reasignar
                    </button>
                `;
            } else {
                // Sin asignar
                estadoBadge = '<span class="status-badge badge-warning"><i class="fas fa-clock"></i> Disponible</span>';
                accionHTML = `
                    <button class="btn-action btn-asignar-hoja" onclick="asignarHojaAPreparador(${hoja.IdPreparacion}, ${idPedido})">
                        <i class="fas fa-user-plus"></i> Asignar
                    </button>
                `;
            }
            
            return `
                <div class="hoja-item" style="
                    background: rgba(255, 255, 255, 0.03);
                    padding: 15px;
                    border-radius: 8px;
                    margin-bottom: 12px;
                    border-left: 3px solid ${hoja.FechaHorafinalizo ? '#10b981' : (hoja.FechaHoraInicio ? '#f59e0b' : (!hoja.IdUsuario ? '#6b7280' : '#2563eb'))};
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                        <div style="flex: 1; min-width: 200px;">
                            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                                <span style="font-weight: 600; font-size: 1.1rem; color: #2563eb;">
                                    Hoja ${hoja.NoHoja}
                                </span>
                                ${estadoBadge}
                            </div>
                            <div style="font-size: 0.85rem; color: #9ca3af;">
                                <i class="fas fa-box"></i> ${hoja.TotalSkus} SKUs | 
                                <i class="fas fa-cubes"></i> ${hoja.TotalFardos} Fardos
                            </div>
                            <div style="font-size: 0.85rem; color: #9ca3af; margin-top: 5px;">
                                <i class="fas fa-user"></i> Preparador: <strong style="color: #ffffff;">${preparadorAsignado}</strong>
                            </div>
                            ${hoja.FechaHoraInicio ? `
                                <div style="font-size: 0.75rem; color: #6b7280; margin-top: 5px;">
                                    <i class="fas fa-clock"></i> Iniciado: ${formatearFechaHora(hoja.FechaHoraInicio)}
                                </div>
                            ` : ''}
                        </div>
                        <div style="text-align: right;">
                            ${accionHTML}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        // Mostrar modal con las hojas
        Swal.fire({
            title: `Gestión de Hojas - Pedido #${idPedido}`,
            html: `
                <div style="max-height: 500px; overflow-y: auto; padding: 10px;">
                    <div style="background: rgba(245, 158, 11, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 16px; border-left: 4px solid #f59e0b;">
                        <p style="color: #f59e0b; font-size: 0.85rem; margin: 0;">
                            <i class="fas fa-info-circle"></i> Puedes reasignar hojas incluso si están en proceso. Solo las hojas finalizadas no pueden modificarse.
                        </p>
                    </div>
                    ${hojasHTML}
                </div>
            `,
            showConfirmButton: true,
            confirmButtonText: 'Cerrar',
            confirmButtonColor: '#6b7280',
            background: '#1a1d23',
            color: '#ffffff',
            width: '700px',
            customClass: {
                popup: 'swal2-no-scroll'
            }
        });
        
    } catch (error) {
        console.error('Error al cargar hojas:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se pudieron cargar las hojas del pedido',
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#dc2626',
            background: '#1a1d23',
            color: '#ffffff'
        });
    }
}

// Asignar hoja a preparador
async function asignarHojaAPreparador(idPreparacion, idPedido) {
    try {
        const connection = await connectionString();
        
        // Obtener preparadores activos
        let preparadores = await connection.query(
            `SELECT Id, NombreCompleto FROM usuarios 
             WHERE IdNivel = 3 AND Activo = 1
             ORDER BY NombreCompleto ASC`
        );
        
        await connection.close();
        
        preparadores = normalizarResultado(preparadores);
        
        // Filtrar preparadores que no tengan nombre nulo
        preparadores = preparadores.filter(p => p.NombreCompleto && p.NombreCompleto.trim() !== '');
        
        if (preparadores.length === 0) {
            await Swal.fire({
                icon: 'warning',
                title: 'Sin preparadores',
                text: 'No hay preparadores activos disponibles',
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#f59e0b',
                background: '#1a1d23',
                color: '#ffffff'
            });
            return;
        }
        
        const { value: idPreparador } = await Swal.fire({
            title: 'Asignar Preparador',
            html: `
                <div style="text-align: left; padding: 10px;">
                    <label style="display: block; margin-bottom: 8px; color: #9ca3af; font-size: 0.9rem;">
                        <i class="fas fa-search"></i> Buscar preparador:
                    </label>
                    <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                        <input 
                            type="text" 
                            id="inputBuscarPreparador" 
                            class="swal2-input" 
                            placeholder="Escribe el nombre del preparador..."
                            autocomplete="off"
                            style="
                                flex: 1;
                                padding: 12px; 
                                background: rgba(255,255,255,0.05); 
                                border: 1px solid rgba(255,255,255,0.1); 
                                border-radius: 8px; 
                                color: #ffffff; 
                                font-size: 0.95rem;
                                margin: 0;
                            "
                        >
                        <button 
                            id="btnBuscar" 
                            type="button"
                            style="
                                padding: 12px 20px;
                                background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
                                border: none;
                                border-radius: 8px;
                                color: white;
                                font-weight: 500;
                                cursor: pointer;
                                transition: all 0.3s ease;
                            "
                        >
                            <i class="fas fa-search"></i> Buscar
                        </button>
                    </div>
                    <div id="listaPreparadores" style="
                        max-height: 300px;
                        overflow-y: auto;
                        background: rgba(255,255,255,0.02);
                        border-radius: 8px;
                        padding: 8px;
                        display: none;
                    ">
                        <!-- Aquí se cargarán los resultados -->
                    </div>
                    <div id="mensajeInicial" style="
                        padding: 40px 20px;
                        text-align: center;
                        color: #6b7280;
                        background: rgba(255,255,255,0.02);
                        border-radius: 8px;
                    ">
                        <i class="fas fa-search" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 12px; display: block;"></i>
                        <p style="margin: 0; font-size: 0.9rem;">Escribe el nombre del preparador y presiona Enter o clic en Buscar</p>
                    </div>
                    <div id="mensajeSinResultados" style="
                        padding: 40px 20px;
                        text-align: center;
                        color: #f59e0b;
                        background: rgba(245, 158, 11, 0.05);
                        border-radius: 8px;
                        display: none;
                    ">
                        <i class="fas fa-exclamation-circle" style="font-size: 2.5rem; opacity: 0.5; margin-bottom: 12px; display: block;"></i>
                        <p style="margin: 0; font-size: 0.9rem;">No se encontraron preparadores con ese nombre</p>
                    </div>
                    <input type="hidden" id="preparadorSeleccionado" value="">
                    <div id="mensajeSeleccion" style="
                        margin-top: 12px;
                        padding: 10px;
                        background: rgba(37, 99, 235, 0.1);
                        border-radius: 6px;
                        color: #2563eb;
                        font-size: 0.85rem;
                        display: none;
                    ">
                        <i class="fas fa-check-circle"></i>
                        <span id="nombreSeleccionado"></span>
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Asignar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#2563eb',
            cancelButtonColor: '#6b7280',
            background: '#1a1d23',
            color: '#ffffff',
            width: '600px',
            didOpen: () => {
                const input = document.getElementById('inputBuscarPreparador');
                const btnBuscar = document.getElementById('btnBuscar');
                const lista = document.getElementById('listaPreparadores');
                const mensajeInicial = document.getElementById('mensajeInicial');
                const mensajeSinResultados = document.getElementById('mensajeSinResultados');
                const inputHidden = document.getElementById('preparadorSeleccionado');
                const mensajeSeleccion = document.getElementById('mensajeSeleccion');
                const nombreSeleccionado = document.getElementById('nombreSeleccionado');
                
                // Función de búsqueda inteligente
                function buscarPreparador() {
                    const termino = (input.value || '').toLowerCase().trim();
                    
                    // Ocultar mensajes
                    mensajeInicial.style.display = 'none';
                    mensajeSinResultados.style.display = 'none';
                    mensajeSeleccion.style.display = 'none';
                    inputHidden.value = '';
                    
                    if (termino === '') {
                        mensajeInicial.style.display = 'block';
                        lista.style.display = 'none';
                        return;
                    }
                    
                    // Eliminar espacios múltiples y crear patrón de búsqueda flexible
                    const palabrasBusqueda = termino.split(/\s+/).filter(p => p.length > 0);
                    
                    // Filtrar preparadores
                    const resultados = preparadores.filter(preparador => {
                        const nombreCompleto = (preparador.NombreCompleto || '').toLowerCase();
                        let coincide = false;
                        
                        // Método 1: Búsqueda por coincidencia de todas las palabras
                        const todasCoinciden = palabrasBusqueda.every(palabra => 
                            nombreCompleto.includes(palabra)
                        );
                        
                        if (todasCoinciden) {
                            coincide = true;
                        } else {
                            // Método 2: Búsqueda por iniciales
                            const palabrasNombre = nombreCompleto.split(/\s+/).filter(p => p.length > 0);
                            const iniciales = palabrasNombre.map(p => p.charAt(0)).join('');
                            
                            if (iniciales.includes(termino.replace(/\s+/g, ''))) {
                                coincide = true;
                            } else {
                                // Método 3: Búsqueda flexible (permite omitir palabras)
                                let indice = 0;
                                for (let palabra of palabrasBusqueda) {
                                    indice = nombreCompleto.indexOf(palabra, indice);
                                    if (indice === -1) break;
                                }
                                if (indice !== -1) {
                                    coincide = true;
                                }
                            }
                        }
                        
                        return coincide;
                    });
                    
                    // Mostrar resultados
                    if (resultados.length === 0) {
                        lista.style.display = 'none';
                        mensajeSinResultados.style.display = 'block';
                    } else {
                        lista.style.display = 'block';
                        lista.innerHTML = resultados.map(p => 
                            `<div class="preparador-option" data-id="${p.Id}" style="
                                padding: 12px 16px;
                                cursor: pointer;
                                border-radius: 6px;
                                transition: all 0.2s ease;
                                border: 1px solid transparent;
                                margin-bottom: 6px;
                                display: flex;
                                align-items: center;
                            ">
                                <i class="fas fa-user" style="color: #2563eb; margin-right: 8px;"></i>
                                <span>${p.NombreCompleto}</span>
                            </div>`
                        ).join('');
                        
                        // Agregar eventos a las opciones
                        const opciones = lista.querySelectorAll('.preparador-option');
                        opciones.forEach(opcion => {
                            opcion.addEventListener('click', () => {
                                // Quitar selección previa
                                opciones.forEach(o => {
                                    o.style.background = '';
                                    o.style.borderColor = 'transparent';
                                });
                                
                                // Marcar como seleccionado
                                opcion.style.background = 'rgba(37, 99, 235, 0.2)';
                                opcion.style.borderColor = '#2563eb';
                                
                                // Guardar ID seleccionado
                                const id = opcion.getAttribute('data-id');
                                const nombre = opcion.querySelector('span').textContent;
                                inputHidden.value = id;
                                
                                // Mostrar mensaje de selección
                                nombreSeleccionado.textContent = `Seleccionado: ${nombre}`;
                                mensajeSeleccion.style.display = 'block';
                            });
                            
                            // Hover effects
                            opcion.addEventListener('mouseenter', () => {
                                if (opcion.style.borderColor !== 'rgb(37, 99, 235)') {
                                    opcion.style.background = 'rgba(255, 255, 255, 0.05)';
                                }
                            });
                            
                            opcion.addEventListener('mouseleave', () => {
                                if (opcion.style.borderColor !== 'rgb(37, 99, 235)') {
                                    opcion.style.background = '';
                                }
                            });
                        });
                    }
                }
                
                // Event listener para el botón de búsqueda
                btnBuscar.addEventListener('click', buscarPreparador);
                
                // Event listener para Enter en el input
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        buscarPreparador();
                    }
                });
                
                // Hover effect para el botón
                btnBuscar.addEventListener('mouseenter', () => {
                    btnBuscar.style.transform = 'translateY(-2px)';
                    btnBuscar.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.3)';
                });
                
                btnBuscar.addEventListener('mouseleave', () => {
                    btnBuscar.style.transform = 'translateY(0)';
                    btnBuscar.style.boxShadow = 'none';
                });
                
                // Focus en el input
                input.focus();
            },
            preConfirm: () => {
                const idSeleccionado = document.getElementById('preparadorSeleccionado').value;
                if (!idSeleccionado) {
                    Swal.showValidationMessage('Debes buscar y seleccionar un preparador de la lista');
                    return false;
                }
                return idSeleccionado;
            }
        });
        
        if (idPreparador) {
            // Actualizar la asignación
            const conn = await connectionString();
            await conn.query(
                `UPDATE PreparacionPedidos 
                 SET IdUsuario = ?, FechaHoraInicio = NULL, FechaHorafinalizo = NULL
                 WHERE Idpreparo = ?`,
                [idPreparador, idPreparacion]
            );
            await conn.close();
            
            await Swal.fire({
                icon: 'success',
                title: '¡Hoja asignada!',
                text: 'La hoja ha sido asignada correctamente',
                timer: 2000,
                timerProgressBar: true,
                showConfirmButton: false,
                background: '#1a1d23',
                color: '#ffffff'
            });
            
            // Reabrir el modal actualizado
            await abrirModalAsignarHojas(idPedido);
        }
        
    } catch (error) {
        console.error('Error al asignar hoja:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se pudo asignar la hoja',
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#dc2626',
            background: '#1a1d23',
            color: '#ffffff'
        });
    }
}

// Iniciar pedido
async function iniciarPedido(idPedido) {
    try {
        const resultado = await Swal.fire({
            title: `¿Iniciar Pedido #${idPedido}?`,
            html: `
                <div style="text-align: center; padding: 10px;">
                    <p style="color: #9ca3af; margin-bottom: 15px;">
                        Se realizará la paginación automática del pedido y cambiará a estado "En Preparación"
                    </p>
                    <div style="background: rgba(16, 185, 129, 0.1); padding: 12px; border-radius: 8px; border-left: 4px solid #10b981;">
                        <p style="color: #10b981; font-size: 0.9rem; margin: 0;">
                            <i class="fas fa-info-circle"></i> El pedido se dividirá automáticamente en hojas de 25 Skus
                        </p>
                    </div>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '<i class="fas fa-play"></i> Iniciar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#6b7280',
            background: '#1a1d23',
            color: '#ffffff'
        });
        
        if (!resultado.isConfirmed) return;
        
        // Mostrar loading
        const loadingSwal = Swal.fire({
            title: 'Procesando pedido...',
            html: `
                <div style="text-align: center;">
                    <div class="spinner" style="
                        border: 4px solid rgba(16, 185, 129, 0.1);
                        border-top: 4px solid #10b981;
                        border-radius: 50%;
                        width: 50px;
                        height: 50px;
                        animation: spin 1s linear infinite;
                        margin: 0 auto;
                    "></div>
                    <p style="color: #9ca3af; margin-top: 15px; font-size: 0.9rem;">
                        Realizando paginación y asignando hojas...
                    </p>
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `,
            showConfirmButton: false,
            allowOutsideClick: false,
            background: '#1a1d23',
            color: '#ffffff'
        });
        
        const connection = await connectionString();
        
        // 1. Cambiar estado a 5 (En Preparación)
        await connection.query(
            'UPDATE pedidostienda_bodega SET Estado = 5 WHERE IdPedidos = ?',
            [idPedido]
        );
        
        // 2. Verificar si ya está paginado
        const paginadoResult = await connection.query(
            'SELECT Paginado FROM pedidostienda_bodega WHERE IdPedidos = ?',
            [idPedido]
        );
        const paginadoData = normalizarResultado(paginadoResult);
        const paginado = paginadoData[0]?.Paginado || 0;
        
        if (paginado === 0) {
            // 3. Ejecutar paginación automática
            await connection.query(`
                UPDATE detallepedidostienda_bodega d
                INNER JOIN (
                    SELECT 
                        PedidosNumerados.*,
                        CEILING(RowNum / 25.0) AS NumeroHoja
                    FROM (
                        SELECT 
                            PedidosDetallados.*,
                            @row_number := IF(@current_pedido = PedidosDetallados.IdPedidos, @row_number + 1, 1) AS RowNum,
                            @current_pedido := PedidosDetallados.IdPedidos
                        FROM (
                            SELECT
                                pedidostienda_bodega.IdPedidos, 
                                detallepedidostienda_bodega.UPC, 
                                detallepedidostienda_bodega.Descripcion, 
                                detallepedidostienda_bodega.Cantidad,
                                detallepedidostienda_bodega.Id AS DetalleId,
                                ubicacionesbodega.Id, 
                                ubicacionesbodega.Rack, 
                                ubicacionesbodega.Nivel, 
                                ubicacionesbodega.Descripcion AS Ubicacion,
                                ubicacionesbodega.Id as IdUbicacionBodega
                            FROM
                                pedidostienda_bodega
                                INNER JOIN detallepedidostienda_bodega ON pedidostienda_bodega.IdPedidos = detallepedidostienda_bodega.IdConsolidado
                                INNER JOIN productospaquetes ON detallepedidostienda_bodega.UPC = productospaquetes.UPCPaquete
                                INNER JOIN productos ON productospaquetes.Upc = productos.Upc
                                INNER JOIN ubicacionesbodega ON productos.IdUbicacionBodega = ubicacionesbodega.Id
                            WHERE
                                pedidostienda_bodega.IdPedidos = ?
                            ORDER BY 
                                Nivel ASC,
                                Id ASC
                        ) AS PedidosDetallados
                        CROSS JOIN (SELECT @current_pedido := 0, @row_number := 0) AS vars
                    ) AS PedidosNumerados
                ) AS t ON d.Id = t.DetalleId
                SET 
                    d.NoHoja = t.NumeroHoja,
                    d.IdUbicacionBodega = t.IdUbicacionBodega
                WHERE d.IdConsolidado = ?
            `, [idPedido, idPedido]);
            
            // 4. Insertar en PreparacionPedidos
            await connection.query(`
                INSERT INTO PreparacionPedidos (IdPedido, NoHoja, Sucursal, TotalSKUs, TotalFardos)
                SELECT 
                    d.IdConsolidado,
                    d.NoHoja,
                    p.NombreEmpresa,
                    COUNT(*) AS TotalSKUs,
                    SUM(d.Cantidad) AS TotalFardos
                FROM detallepedidostienda_bodega d
                INNER JOIN pedidostienda_bodega p ON p.IdPedidos = d.IdConsolidado
                WHERE d.IdConsolidado = ?
                GROUP BY d.IdConsolidado, d.NoHoja, p.NombreEmpresa
            `, [idPedido]);
            
            // 5. Actualizar pedidostienda_bodega con Paginado y Nohojas
            await connection.query(`
                UPDATE pedidostienda_bodega p
                SET p.Paginado = 1,
                    p.Nohojas = (
                        SELECT MAX(NoHoja)
                        FROM detallepedidostienda_bodega
                        WHERE IdConsolidado = ?
                    )
                WHERE p.IdPedidos = ?
            `, [idPedido, idPedido]);
        }
        
        await connection.close();
        
        loadingSwal.close();
        
        // Mostrar éxito
        await Swal.fire({
            icon: 'success',
            title: '¡Pedido iniciado!',
            html: `
                <div style="text-align: center;">
                    <p style="color: #9ca3af; margin-bottom: 10px;">
                        El pedido #${idPedido} ha sido procesado correctamente
                    </p>
                    <div style="background: rgba(16, 185, 129, 0.1); padding: 12px; border-radius: 8px; margin-top: 15px;">
                        <p style="color: #10b981; font-size: 0.9rem; margin: 0;">
                            <i class="fas fa-check-circle"></i> Ahora aparece en la sección "En Preparación"
                        </p>
                    </div>
                </div>
            `,
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            background: '#1a1d23',
            color: '#ffffff'
        });
        
        // Recargar datos y cambiar a la pestaña de preparación
        await cargarDatos();
        
        // Cambiar automáticamente a la pestaña "En Preparación"
        document.querySelector('[data-tab="preparacion"]').click();
        
    } catch (error) {
        console.error('Error al iniciar pedido:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error al procesar',
            html: `
                <div style="text-align: center;">
                    <p style="color: #9ca3af; margin-bottom: 15px;">
                        No se pudo iniciar el pedido
                    </p>
                    <div style="background: rgba(220, 38, 38, 0.1); padding: 12px; border-radius: 8px;">
                        <p style="color: #dc2626; font-size: 0.85rem; margin: 0; font-family: monospace;">
                            ${error.message}
                        </p>
                    </div>
                </div>
            `,
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#dc2626',
            background: '#1a1d23',
            color: '#ffffff'
        });
    }
}

// Función para ver detalle del pedido
async function verDetallePedido(idPedido) {
    await Swal.fire({
        icon: 'info',
        title: `Detalle del Pedido #${idPedido}`,
        html: '<p>Función en desarrollo...</p>',
        confirmButtonText: 'Cerrar',
        confirmButtonColor: '#2563eb',
        background: '#1a1d23',
        color: '#ffffff'
    });
}

// Funciones auxiliares
function formatearFecha(fecha) {
    const date = new Date(fecha);
    const opciones = { 
        year: 'numeric',
        month: 'short', 
        day: '2-digit',
        timeZone: 'America/Guatemala'
    };
    return date.toLocaleDateString('es-GT', opciones);
}

function formatearFechaHora(fecha) {
    if (!fecha) return '-';
    const date = new Date(fecha);
    const opciones = { 
        year: 'numeric', 
        month: 'short', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Guatemala'
    };
    return date.toLocaleDateString('es-GT', opciones);
}
// Ver progreso de preparación del pedido
async function verProgresoPreparacion(idPedido) {
    try {
        // Mostrar loading
        Swal.fire({
            title: 'Cargando progreso...',
            html: `
                <div style="text-align: center;">
                    <div class="spinner" style="
                        border: 4px solid rgba(37, 99, 235, 0.1);
                        border-top: 4px solid #2563eb;
                        border-radius: 50%;
                        width: 50px;
                        height: 50px;
                        animation: spin 1s linear infinite;
                        margin: 0 auto;
                    "></div>
                </div>
            `,
            showConfirmButton: false,
            allowOutsideClick: false,
            background: '#1a1d23',
            color: '#ffffff'
        });
        
        const connection = await connectionString();
        
        // Obtener hojas del pedido con información del preparador
        let hojas = await connection.query(
            `SELECT
                PreparacionPedidos.NoHoja,
                PreparacionPedidos.TotalSkus,
                PreparacionPedidos.TotalFardos,
                PreparacionPedidos.FechaHoraInicio,
                PreparacionPedidos.FechaHorafinalizo,
                PreparacionPedidos.IdUsuario,
                usuarios.NombreCompleto
            FROM
                PreparacionPedidos
                LEFT JOIN usuarios ON PreparacionPedidos.IdUsuario = usuarios.Id
            WHERE
                PreparacionPedidos.IdPedido = ?
            ORDER BY PreparacionPedidos.NoHoja ASC`,
            [idPedido]
        );
        
        hojas = normalizarResultado(hojas);
        
        if (hojas.length === 0) {
            await connection.close();
            Swal.fire({
                icon: 'warning',
                title: 'Sin hojas',
                text: 'Este pedido no tiene hojas generadas',
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#f59e0b',
                background: '#1a1d23',
                color: '#ffffff'
            });
            return;
        }
        
        // Obtener progreso de cada hoja
        const hojasConProgreso = await Promise.all(hojas.map(async (hoja) => {
            let productosPreparados = 0;
            
            if (hoja.IdUsuario) {
                // Si tiene usuario asignado, contar productos preparados
                const resultado = await connection.query(
                    `SELECT COUNT(*) as total
                    FROM detallepedidostienda_bodega
                    WHERE
                        detallepedidostienda_bodega.EstadoPreparacionproducto > 0 AND
                        detallepedidostienda_bodega.IdConsolidado = ? AND
                        detallepedidostienda_bodega.NoHoja = ?`,
                    [idPedido, hoja.NoHoja]
                );
                const resultadoNormalizado = normalizarResultado(resultado);
                productosPreparados = resultadoNormalizado[0]?.total || 0;
            }
            
            const totalProductos = hoja.TotalSkus;
            const porcentaje = totalProductos > 0 ? Math.round((productosPreparados / totalProductos) * 100) : 0;
            
            return {
                ...hoja,
                totalProductos,
                productosPreparados,
                porcentaje
            };
        }));
        
        await connection.close();
        
        // Generar HTML del progreso
        const hojasHTML = hojasConProgreso.map(hoja => {
            const tienePreparador = hoja.IdUsuario !== null;
            const preparadorNombre = hoja.NombreCompleto || 'Sin asignar';
            const estaFinalizada = hoja.FechaHorafinalizo !== null;
            const estaEnProceso = hoja.FechaHoraInicio !== null && !estaFinalizada;
            
            let estadoBadge = '';
            let colorBarra = '';
            
            if (estaFinalizada) {
                estadoBadge = '<span class="status-badge status-finalizado"><i class="fas fa-check-circle"></i> Finalizado</span>';
                colorBarra = '#10b981';
            } else if (estaEnProceso) {
                estadoBadge = '<span class="status-badge status-en-proceso"><i class="fas fa-spinner"></i> En proceso</span>';
                colorBarra = '#f59e0b';
            } else if (tienePreparador) {
                estadoBadge = '<span class="status-badge badge-info"><i class="fas fa-user-clock"></i> Asignado</span>';
                colorBarra = '#2563eb';
            } else {
                estadoBadge = '<span class="status-badge badge-warning"><i class="fas fa-clock"></i> Sin asignar</span>';
                colorBarra = '#6b7280';
            }
            
            const mensajeEstado = !tienePreparador ? `
                <div style="margin-top: 12px; padding: 12px; background: rgba(245, 158, 11, 0.1); border-radius: 6px; border-left: 3px solid #f59e0b;">
                    <i class="fas fa-exclamation-triangle" style="color: #f59e0b;"></i>
                    <span style="color: #f59e0b; font-size: 0.85rem; margin-left: 8px;">
                        No hay preparador asignado para esta hoja
                    </span>
                </div>
            ` : (!estaEnProceso && !estaFinalizada ? `
                <div style="margin-top: 12px; padding: 12px; background: rgba(107, 114, 128, 0.1); border-radius: 6px;">
                    <i class="fas fa-info-circle" style="color: #6b7280;"></i>
                    <span style="color: #9ca3af; font-size: 0.85rem; margin-left: 8px;">
                        Aún no se ha iniciado la preparación
                    </span>
                </div>
            ` : '');
            
            return `
                <div style="
                    background: rgba(255, 255, 255, 0.03);
                    padding: 16px;
                    border-radius: 10px;
                    margin-bottom: 14px;
                    border-left: 4px solid ${colorBarra};
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div>
                            <span style="font-weight: 600; font-size: 1.1rem; color: #2563eb;">
                                Hoja ${hoja.NoHoja}
                            </span>
                            ${estadoBadge}
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 0.85rem; color: #9ca3af;">
                                <i class="fas fa-user"></i> ${preparadorNombre}
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.85rem;">
                            <span style="color: #9ca3af;">Progreso</span>
                            <span style="color: #ffffff; font-weight: 600;">${hoja.productosPreparados} / ${hoja.totalProductos} SKUs (${hoja.porcentaje}%)</span>
                        </div>
                        <div style="
                            width: 100%;
                            height: 8px;
                            background: rgba(255, 255, 255, 0.1);
                            border-radius: 10px;
                            overflow: hidden;
                        ">
                            <div style="
                                width: ${hoja.porcentaje}%;
                                height: 100%;
                                background: linear-gradient(90deg, ${colorBarra}, ${colorBarra}dd);
                                border-radius: 10px;
                                transition: width 0.3s ease;
                            "></div>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 20px; font-size: 0.85rem; color: #9ca3af;">
                        <div>
                            <i class="fas fa-cubes"></i> ${hoja.TotalFardos} Fardos
                        </div>
                        ${hoja.FechaHoraInicio ? `
                            <div>
                                <i class="fas fa-clock"></i> Inicio: ${formatearFechaHora(hoja.FechaHoraInicio)}
                            </div>
                        ` : ''}
                        ${hoja.FechaHorafinalizo ? `
                            <div style="color: #10b981;">
                                <i class="fas fa-check"></i> Finalizado: ${formatearFechaHora(hoja.FechaHorafinalizo)}
                            </div>
                        ` : ''}
                    </div>
                    
                    ${mensajeEstado}
                </div>
            `;
        }).join('');
        
        // Calcular estadísticas generales
        const totalHojas = hojasConProgreso.length;
        const hojasFinalizadas = hojasConProgreso.filter(h => h.FechaHorafinalizo).length;
        const hojasEnProceso = hojasConProgreso.filter(h => h.FechaHoraInicio && !h.FechaHorafinalizo).length;
        const hojasSinAsignar = hojasConProgreso.filter(h => !h.IdUsuario).length;
        const progresoGeneral = Math.round((hojasFinalizadas / totalHojas) * 100);
        
        // Mostrar modal con el progreso
        Swal.fire({
            title: `Progreso de Preparación - Pedido #${idPedido}`,
            html: `
                <div style="padding: 10px;">
                    <!-- Resumen general -->
                    <div style="
                        background: linear-gradient(135deg, rgba(37, 99, 235, 0.1), rgba(59, 130, 246, 0.05));
                        padding: 16px;
                        border-radius: 10px;
                        margin-bottom: 20px;
                        border: 1px solid rgba(37, 99, 235, 0.2);
                    ">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 12px;">
                            <div style="text-align: center;">
                                <div style="font-size: 1.5rem; font-weight: 700; color: #10b981;">${hojasFinalizadas}</div>
                                <div style="font-size: 0.75rem; color: #9ca3af; text-transform: uppercase;">Finalizadas</div>
                            </div>
                            <div style="text-align: center;">
                                <div style="font-size: 1.5rem; font-weight: 700; color: #f59e0b;">${hojasEnProceso}</div>
                                <div style="font-size: 0.75rem; color: #9ca3af; text-transform: uppercase;">En Proceso</div>
                            </div>
                            <div style="text-align: center;">
                                <div style="font-size: 1.5rem; font-weight: 700; color: #6b7280;">${hojasSinAsignar}</div>
                                <div style="font-size: 0.75rem; color: #9ca3af; text-transform: uppercase;">Sin Asignar</div>
                            </div>
                        </div>
                        <div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.9rem;">
                                <span style="color: #9ca3af;">Progreso General</span>
                                <span style="color: #ffffff; font-weight: 600;">${progresoGeneral}%</span>
                            </div>
                            <div style="
                                width: 100%;
                                height: 10px;
                                background: rgba(255, 255, 255, 0.1);
                                border-radius: 10px;
                                overflow: hidden;
                            ">
                                <div style="
                                    width: ${progresoGeneral}%;
                                    height: 100%;
                                    background: linear-gradient(90deg, #2563eb, #3b82f6);
                                    border-radius: 10px;
                                "></div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Detalle de hojas -->
                    <div style="max-height: 500px; overflow-y: auto;">
                        ${hojasHTML}
                    </div>
                </div>
            `,
            showConfirmButton: true,
            confirmButtonText: 'Cerrar',
            confirmButtonColor: '#6b7280',
            background: '#1a1d23',
            color: '#ffffff',
            width: '900px',
            customClass: {
                popup: 'swal2-no-scroll'
            }
        });
        
    } catch (error) {
        console.error('Error al cargar progreso:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se pudo cargar el progreso de preparación',
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#dc2626',
            background: '#1a1d23',
            color: '#ffffff'
        });
    }
}

// Exportar la función
window.verProgresoPreparacion = verProgresoPreparacion;
// Exportar funciones globales
window.verDetallePedido = verDetallePedido;
window.iniciarPedido = iniciarPedido;
window.abrirModalAsignarHojas = abrirModalAsignarHojas;
window.asignarHojaAPreparador = asignarHojaAPreparador;