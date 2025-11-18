const { connectionString } = require('../Conexion/Conexion');
const Swal = require('sweetalert2');
const { ipcRenderer } = require('electron');
const path = require('path');

// ========== VARIABLES GLOBALES ==========
let allPedidos = [];
let filteredPedidos = [];
let currentPage = 1;
let pageSize = 25;
let searchTimeout = null;

let autoRefreshInterval = null;
let autoRefreshEnabled = true;
let autoRefreshTime = 30000; // 30 segundos por defecto
let lastUpdateTime = null;


// ========== INICIALIZACIÓN ==========
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    loadUserInfo();
    setupEventListeners();
    await loadPedidos();
    startAutoRefresh();
}
function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    autoRefreshInterval = setInterval(async () => {
        if (autoRefreshEnabled) {
            await loadPedidos(true); // true = actualización silenciosa
        }
    }, autoRefreshTime);
    
    updateRefreshIndicator();
}
// ========== CARGAR INFORMACIÓN DEL USUARIO ==========
function loadUserInfo() {
    try {
        const userData = JSON.parse(localStorage.getItem('userData'));
        if (userData && userData.nombre) {
            document.getElementById('userName').textContent = userData.nombre;
        }
    } catch (error) {
        console.error('Error al cargar información del usuario:', error);
    }
}

// ========== CONFIGURAR EVENT LISTENERS ==========
function setupEventListeners() {
    // Botón volver
    document.getElementById('btnVolver').addEventListener('click', () => {
        stopAutoRefresh();
        window.location.href = path.join(__dirname, '../Vistas/Home.html');
    });

    // Búsqueda en tiempo real
    document.getElementById('searchInput').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            handleSearch(e.target.value);
        }, 300);
    });

    // Limpiar búsqueda
    document.getElementById('btnClearSearch').addEventListener('click', () => {
        document.getElementById('searchInput').value = '';
        handleSearch('');
    });

    // Actualizar
    document.getElementById('btnRefresh').addEventListener('click', async () => {
        await loadPedidos();
    });

    // Cambio de tamaño de página
    document.getElementById('pageSize').addEventListener('change', (e) => {
        pageSize = parseInt(e.target.value);
        currentPage = 1;
        renderTable();
    });

    // Controles de paginación
    document.getElementById('btnFirstPage').addEventListener('click', () => {
        currentPage = 1;
        renderTable();
    });

    document.getElementById('btnPrevPage').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
        }
    });

    document.getElementById('btnNextPage').addEventListener('click', () => {
        const totalPages = Math.ceil(filteredPedidos.length / pageSize);
        if (currentPage < totalPages) {
            currentPage++;
            renderTable();
        }
    });

    document.getElementById('btnLastPage').addEventListener('click', () => {
        currentPage = Math.ceil(filteredPedidos.length / pageSize);
        renderTable();
    });
}
function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}
// ========== CARGAR PEDIDOS DESDE LA BASE DE DATOS ==========
async function loadPedidos(silentUpdate = false) {
    if (!silentUpdate) {
        showLoading(true);
    }
    
    try {
        const connection = await connectionString();
        
        const query = `
            SELECT
                pedidostienda_bodega.IdPedidos, 
                pedidostienda_bodega.Fecha, 
                estadopedidotiendabodega.EstadoPedido, 
                pedidostienda_bodega.Estado,
                pedidostienda_bodega.NombreEmpresa, 
                pedidostienda_bodega.TotalCantidad, 
                pedidostienda_bodega.CantTarimas
            FROM
                pedidostienda_bodega
                INNER JOIN
                estadopedidotiendabodega
                ON 
                    pedidostienda_bodega.Estado = estadopedidotiendabodega.IdEstado
            WHERE
                pedidostienda_bodega.Estado IN (5,6)
                AND pedidostienda_bodega.Nohojas > 0
            ORDER BY 
                pedidostienda_bodega.Fecha DESC
        `;
        
        const result = await connection.query(query);
        
        // Obtener progreso de chequeo para cada pedido
        if (result.length > 0) {
            for (let pedido of result) {
                const queryProgreso = `
                    SELECT
                        COUNT(*) as TotalProductos,
                        SUM(CASE WHEN EstadoPreparacionproducto = 5 THEN 1 ELSE 0 END) as ProductosCheckeados
                    FROM
                        detallepedidostienda_bodega
                    WHERE
                        IdConsolidado = ?
                `;
                
                const progreso = await connection.query(queryProgreso, [pedido.IdPedidos]);
                
                if (progreso.length > 0) {
                    pedido.TotalProductos = progreso[0].TotalProductos || 0;
                    pedido.ProductosCheckeados = progreso[0].ProductosCheckeados || 0;
                    pedido.PorcentajeProgreso = pedido.TotalProductos > 0 
                        ? Math.round((pedido.ProductosCheckeados / pedido.TotalProductos) * 100) 
                        : 0;
                } else {
                    pedido.TotalProductos = 0;
                    pedido.ProductosCheckeados = 0;
                    pedido.PorcentajeProgreso = 0;
                }
            }
        }
        
        await connection.close();
        
        allPedidos = result;
        
        // Mantener el filtro actual si existe
        const searchInput = document.getElementById('searchInput');
        if (searchInput && searchInput.value.trim()) {
            handleSearch(searchInput.value.trim());
        } else {
            filteredPedidos = [...allPedidos];
        }
        
        updateStatistics();
        renderTable();
        
        // Actualizar tiempo de última actualización
        lastUpdateTime = new Date();
        updateRefreshIndicator();
        
        if (!silentUpdate) {
            showLoading(false);
        }
        
    } catch (error) {
        console.error('Error al cargar pedidos:', error);
        
        if (!silentUpdate) {
            showLoading(false);
            
            await Swal.fire({
                icon: 'error',
                title: 'Error de Conexión',
                text: 'No se pudieron cargar los pedidos. Por favor, intenta nuevamente.',
                confirmButtonText: 'Aceptar',
                confirmButtonColor: '#dc2626',
                background: '#1a1d23',
                color: '#ffffff'
            });
        }
    }
}

// ========== BÚSQUEDA INTELIGENTE ==========
function handleSearch(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        filteredPedidos = [...allPedidos];
    } else {
        const term = searchTerm.toLowerCase().trim();
        
        filteredPedidos = allPedidos.filter(pedido => {
            const empresa = pedido.NombreEmpresa.toLowerCase();
            
            // Búsqueda exacta
            if (empresa.includes(term)) {
                return true;
            }
            
            // Búsqueda por palabras individuales
            const palabrasBusqueda = term.split(/\s+/);
            const palabrasEmpresa = empresa.split(/\s+/);
            
            // Si todas las palabras de búsqueda están en alguna parte del nombre
            const todasLasPalabras = palabrasBusqueda.every(palabraBusqueda => 
                palabrasEmpresa.some(palabraEmpresa => 
                    palabraEmpresa.includes(palabraBusqueda)
                )
            );
            
            if (todasLasPalabras) {
                return true;
            }
            
            // Búsqueda por iniciales o abreviaturas
            const inicialesEmpresa = palabrasEmpresa
                .map(palabra => palabra.charAt(0))
                .join('');
            
            if (inicialesEmpresa.includes(term.replace(/\s+/g, ''))) {
                return true;
            }
            
            // Búsqueda sin espacios
            const empresaSinEspacios = empresa.replace(/\s+/g, '');
            const terminoSinEspacios = term.replace(/\s+/g, '');
            
            if (empresaSinEspacios.includes(terminoSinEspacios)) {
                return true;
            }
            
            return false;
        });
    }
    
    currentPage = 1;
    updateStatistics();
    renderTable();
}

// ========== ACTUALIZAR ESTADÍSTICAS ==========
function updateStatistics() {
    const totalPedidos = filteredPedidos.length;
    const totalTarimas = filteredPedidos.reduce((sum, p) => sum + (p.CantTarimas || 0), 0);
    const totalCantidad = filteredPedidos.reduce((sum, p) => sum + (p.TotalCantidad || 0), 0);
    
    document.getElementById('totalPedidos').textContent = totalPedidos.toLocaleString();
    document.getElementById('totalTarimas').textContent = totalTarimas.toLocaleString();
    document.getElementById('totalCantidad').textContent = totalCantidad.toLocaleString();
}

// ========== RENDERIZAR TABLA ==========
function renderTable() {
    const tbody = document.getElementById('pedidosTableBody');
    const noDataMessage = document.getElementById('noDataMessage');
    
    // Limpiar tabla
    tbody.innerHTML = '';
    
    // Verificar si hay datos
    if (filteredPedidos.length === 0) {
        noDataMessage.style.display = 'flex';
        updatePaginationInfo(0, 0, 0);
        return;
    }
    
    noDataMessage.style.display = 'none';
    
    // Calcular índices de paginación
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredPedidos.length);
    const paginatedData = filteredPedidos.slice(startIndex, endIndex);
    
    // Renderizar filas
    paginatedData.forEach(pedido => {
        const row = createTableRow(pedido);
        tbody.appendChild(row);
    });
    
    // Actualizar información de paginación
    updatePaginationInfo(startIndex + 1, endIndex, filteredPedidos.length);
    renderPaginationControls();
}

// ========== CREAR FILA DE TABLA ==========
function createTableRow(pedido) {
    const tr = document.createElement('tr');
    
    // Formatear fecha
    const fecha = new Date(pedido.Fecha);
    const fechaAjustada = new Date(fecha.getTime() + fecha.getTimezoneOffset() * 60000);
    const fechaFormateada = fechaAjustada.toLocaleDateString('es-GT', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    
    // Determinar clase de estado
    const estadoClass = `estado-${pedido.Estado}`;
    
    // Calcular progreso (si existe)
    const porcentajeProgreso = pedido.PorcentajeProgreso || 0;
    const productosCheckeados = pedido.ProductosCheckeados || 0;
    const totalProductos = pedido.TotalProductos || 0;
    
    // Color del progreso
    const getColorProgreso = (porcentaje) => {
        if (porcentaje === 0) return '#6b7280';
        if (porcentaje < 30) return '#ef4444';
        if (porcentaje < 70) return '#f59e0b';
        if (porcentaje < 100) return '#3b82f6';
        return '#10b981';
    };
    
    const colorProgreso = getColorProgreso(porcentajeProgreso);
    
    tr.innerHTML = `
        <td><strong>#${pedido.IdPedidos}</strong></td>
        <td>${fechaFormateada}</td>
        <td><span class="status-badge ${estadoClass}">${pedido.EstadoPedido}</span></td>
        <td><strong>${pedido.NombreEmpresa}</strong></td>
        <td>${pedido.TotalCantidad.toLocaleString()}</td>
        <td>${pedido.CantTarimas || 0}</td>
        <td>
            <div style="display: flex; flex-direction: column; gap: 6px; min-width: 150px;">
                <!-- Barra de progreso -->
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="flex: 1; background: rgba(255, 255, 255, 0.1); height: 8px; border-radius: 4px; overflow: hidden;">
                        <div style="
                            background: linear-gradient(90deg, ${colorProgreso}, ${colorProgreso}dd);
                            height: 100%;
                            width: ${porcentajeProgreso}%;
                            transition: width 0.5s ease;
                            border-radius: 4px;
                        "></div>
                    </div>
                    <span style="color: ${colorProgreso}; font-weight: 700; font-size: 0.8rem; min-width: 40px;">
                        ${porcentajeProgreso}%
                    </span>
                </div>
                <!-- Info de productos -->
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem;">
                    <span style="color: #10b981;">
                        <i class="fas fa-check-circle" style="margin-right: 3px;"></i>
                        ${productosCheckeados}
                    </span>
                    <span style="color: #9ca3af;">
                        <i class="fas fa-box" style="margin-right: 3px;"></i>
                        ${totalProductos}
                    </span>
                </div>
            </div>
        </td>
        <td>
            <button class="btn-asignar" data-id="${pedido.IdPedidos}">
                <i class="fas fa-pallet"></i>
                Asignar
            </button>
        </td>
    `;
    
    // Event listener para el botón de asignar
    const btnAsignar = tr.querySelector('.btn-asignar');
    btnAsignar.addEventListener('click', () => {
        handleAsignarTarimas(pedido);
    });
    
    return tr;
}

// ========== MANEJAR ASIGNACIÓN DE TARIMAS ==========
async function handleAsignarTarimas(pedido) {
    // Mostrar loading
    Swal.fire({
        title: 'Cargando tarimas...',
        html: `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 15px;">
                <div class="spinner" style="
                    border: 4px solid rgba(37, 99, 235, 0.1);
                    border-top: 4px solid #2563eb;
                    border-radius: 50%;
                    width: 50px;
                    height: 50px;
                    animation: spin 1s linear infinite;
                "></div>
            </div>
        `,
        showConfirmButton: false,
        allowOutsideClick: false,
        background: '#1a1d23',
        color: '#ffffff'
    });

    try {
        const connection = await connectionString();
        
        // Consulta para obtener tarimas
        const queryTarimas = `
            SELECT
                TarimasInventario.IdTarima, 
                TarimasInventario.IdPedido, 
                TarimasInventario.NoTarima,
                TarimasInventario.FechaCreacion, 
                TarimasInventario.FechaFinalizacion, 
                TarimasInventario.CantidadFardos, 
                TarimasInventario.CantidadSkus,
                TarimasInventario.IdUsuarioChequeo,
                TarimasInventario.FechaHoraInicio,
                TarimasInventario.FechaHoraFin,
                usuarios.NombreCompleto AS UsuarioChequeo
            FROM
                TarimasInventario
                LEFT JOIN usuarios ON TarimasInventario.IdUsuarioChequeo = usuarios.Id
            WHERE
                TarimasInventario.IdPedido = ? AND
                TarimasInventario.FechaCreacion IS NOT NULL AND
                TarimasInventario.FechaFinalizacion IS NOT NULL AND
                (TarimasInventario.FechaHoraInicio IS NULL OR TarimasInventario.FechaHoraFin IS NULL)
            ORDER BY
                TarimasInventario.NoTarima ASC
        `;
        
        const tarimas = await connection.query(queryTarimas, [pedido.IdPedidos]);
        
        // Si hay tarimas, obtener el progreso de chequeo para cada una
        if (tarimas.length > 0) {
            for (let tarima of tarimas) {
                const queryProgreso = `
                    SELECT
                        COUNT(*) as TotalProductos,
                        SUM(CASE WHEN EstadoPreparacionproducto = 5 THEN 1 ELSE 0 END) as ProductosCheckeados
                    FROM
                        detallepedidostienda_bodega
                    WHERE
                        NoTarima = ? AND
                        IdConsolidado = ?
                `;
                
                const progreso = await connection.query(queryProgreso, [tarima.NoTarima, pedido.IdPedidos]);
                
                if (progreso.length > 0) {
                    tarima.TotalProductos = progreso[0].TotalProductos || 0;
                    tarima.ProductosCheckeados = progreso[0].ProductosCheckeados || 0;
                    tarima.PorcentajeProgreso = tarima.TotalProductos > 0 
                        ? Math.round((tarima.ProductosCheckeados / tarima.TotalProductos) * 100) 
                        : 0;
                } else {
                    tarima.TotalProductos = 0;
                    tarima.ProductosCheckeados = 0;
                    tarima.PorcentajeProgreso = 0;
                }
            }
        }
        
        // Obtener progreso general del pedido
        const queryProgresoGeneral = `
            SELECT
                COUNT(*) as TotalProductosPedido,
                SUM(CASE WHEN EstadoPreparacionproducto = 5 THEN 1 ELSE 0 END) as ProductosCheckeadosPedido
            FROM
                detallepedidostienda_bodega
            WHERE
                IdConsolidado = ?
        `;
        
        const progresoGeneral = await connection.query(queryProgresoGeneral, [pedido.IdPedidos]);
        
        let progresoGeneralData = {
            totalProductos: 0,
            productosCheckeados: 0,
            porcentaje: 0
        };
        
        if (progresoGeneral.length > 0) {
            progresoGeneralData.totalProductos = progresoGeneral[0].TotalProductosPedido || 0;
            progresoGeneralData.productosCheckeados = progresoGeneral[0].ProductosCheckeadosPedido || 0;
            progresoGeneralData.porcentaje = progresoGeneralData.totalProductos > 0 
                ? Math.round((progresoGeneralData.productosCheckeados / progresoGeneralData.totalProductos) * 100) 
                : 0;
        }
        
        await connection.close();
        
        // Cerrar loading
        Swal.close();
        
        // Verificar si hay tarimas
        if (tarimas.length === 0) {
            await Swal.fire({
                icon: 'info',
                title: 'Sin Tarimas Disponibles',
                html: `
                    <div style="text-align: center; padding: 15px;">
                        <p style="color: #9ca3af; margin-bottom: 15px;">
                            El pedido <strong style="color: #3b82f6;">#${pedido.IdPedidos}</strong> no tiene tarimas disponibles para asignar.
                        </p>
                        <div style="background: rgba(16, 185, 129, 0.1); padding: 12px; border-radius: 8px; border-left: 4px solid #10b981; margin-bottom: 10px;">
                            <p style="color: #ffffff; margin: 0;"><strong>Empresa:</strong> ${pedido.NombreEmpresa}</p>
                        </div>
                        <div style="background: rgba(59, 130, 246, 0.1); padding: 10px; border-radius: 8px; margin-top: 10px;">
                            <p style="color: #9ca3af; font-size: 0.85rem; margin: 0;">
                                <i class="fas fa-info-circle" style="margin-right: 5px; color: #3b82f6;"></i>
                                Todas las tarimas finalizadas ya fueron chequeadas o están en proceso de chequeo.
                            </p>
                        </div>
                    </div>
                `,
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#2563eb',
                background: '#1a1d23',
                color: '#ffffff',
                width: '550px'
            });
            return;
        }
        
        // Mostrar modal con tarimas y progreso general
        mostrarModalTarimas(pedido, tarimas, progresoGeneralData);
        
    } catch (error) {
        console.error('Error al cargar tarimas:', error);
        
        Swal.fire({
            icon: 'error',
            title: 'Error al Cargar Tarimas',
            text: 'No se pudieron cargar las tarimas del pedido. Por favor, intenta nuevamente.',
            confirmButtonText: 'Aceptar',
            confirmButtonColor: '#dc2626',
            background: '#1a1d23',
            color: '#ffffff'
        });
    }
}
function mostrarModalTarimas(pedido, tarimas, progresoGeneral) {
    // Calcular totales
    const totalFardos = tarimas.reduce((sum, t) => sum + parseInt(t.CantidadFardos || 0), 0);
    const totalSkus = tarimas.reduce((sum, t) => sum + parseInt(t.CantidadSkus || 0), 0);
    
    // Contar tarimas asignadas y sin asignar
    const tarimasAsignadas = tarimas.filter(t => t.IdUsuarioChequeo).length;
    const tarimasSinAsignar = tarimas.length - tarimasAsignadas;
    
    // Determinar color del progreso general
    const getColorProgreso = (porcentaje) => {
        if (porcentaje === 0) return '#6b7280';
        if (porcentaje < 30) return '#ef4444';
        if (porcentaje < 70) return '#f59e0b';
        if (porcentaje < 100) return '#3b82f6';
        return '#10b981';
    };
    
    const colorProgresoGeneral = getColorProgreso(progresoGeneral.porcentaje);
    
    // Generar HTML de las tarimas
    const tarimasHTML = tarimas.map((tarima, index) => {
        // Formatear fechas correctamente sin ajuste de timezone
        const formatearFecha = (fechaString) => {
            const fecha = fechaString.split(' ')[0];
            const hora = fechaString.split(' ')[1];
            const [year, month, day] = fecha.split('-');
            const [hours, minutes] = hora.split(':');
            return `${day}/${month}/${year}, ${hours}:${minutes}`;
        };
        
        const fechaCreacionFormateada = formatearFecha(tarima.FechaCreacion);
        const fechaFinalizacionFormateada = formatearFecha(tarima.FechaFinalizacion);
        
        // Verificar si ya está asignada
        const yaAsignada = tarima.IdUsuarioChequeo ? true : false;
        
        // Color del progreso de la tarima
        const colorProgresoTarima = getColorProgreso(tarima.PorcentajeProgreso);
        
        return `
            <div class="tarima-item-compact" style="
                background: ${yaAsignada ? 'rgba(16, 185, 129, 0.05)' : 'rgba(255, 255, 255, 0.05)'};
                border: 1px solid ${yaAsignada ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.1)'};
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 10px;
                transition: all 0.3s ease;
            " data-tarima-id="${tarima.IdTarima}">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
                    <!-- Número de tarima -->
                    <div style="
                        background: linear-gradient(135deg, ${yaAsignada ? '#10b981' : '#2563eb'} 0%, ${yaAsignada ? '#059669' : '#3b82f6'} 100%);
                        width: 35px;
                        height: 35px;
                        border-radius: 6px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-weight: 700;
                        font-size: 0.85rem;
                        flex-shrink: 0;
                    ">${tarima.NoTarima}</div>
                    
                    <!-- Info básica -->
                    <div style="flex: 1; min-width: 0;">
                        <p style="color: #ffffff; font-weight: 600; margin: 0; font-size: 0.9rem;">
                            Tarima #${tarima.NoTarima}
                            ${yaAsignada ? '<span style="color: #34d399; font-size: 0.75rem; margin-left: 8px;"><i class="fas fa-check-circle"></i> Asignada</span>' : ''}
                        </p>
                    </div>
                    
                    <!-- Cantidades -->
                    <div style="display: flex; gap: 15px; flex-shrink: 0;">
                        <div style="text-align: center;">
                            <p style="color: #9ca3af; font-size: 0.7rem; margin: 0 0 3px 0;">Fardos</p>
                            <p style="color: #3b82f6; font-size: 1rem; font-weight: 700; margin: 0;">${parseInt(tarima.CantidadFardos || 0).toLocaleString()}</p>
                        </div>
                        <div style="text-align: center;">
                            <p style="color: #9ca3af; font-size: 0.7rem; margin: 0 0 3px 0;">SKUs</p>
                            <p style="color: #34d399; font-size: 1rem; font-weight: 700; margin: 0;">${parseInt(tarima.CantidadSkus || 0).toLocaleString()}</p>
                        </div>
                    </div>
                    
                    <!-- Botón Ver Detalle -->
                    <button 
                        class="btn-ver-detalle" 
                        data-tarima-no="${tarima.NoTarima}"
                        data-pedido-id="${pedido.IdPedidos}"
                        style="
                            padding: 6px 12px;
                            background: rgba(251, 191, 36, 0.15);
                            border: 1px solid rgba(251, 191, 36, 0.3);
                            border-radius: 6px;
                            color: #fbbf24;
                            font-weight: 600;
                            font-size: 0.7rem;
                            cursor: pointer;
                            transition: all 0.3s ease;
                            white-space: nowrap;
                        "
                        onmouseover="this.style.background='rgba(251, 191, 36, 0.25)'"
                        onmouseout="this.style.background='rgba(251, 191, 36, 0.15)'"
                    >
                        <i class="fas fa-eye"></i> Detalle
                    </button>
                </div>
                
                <!-- Barra de progreso de la tarima -->
                <div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <span style="color: #9ca3af; font-size: 0.7rem;">
                            <i class="fas fa-tasks" style="margin-right: 5px;"></i>Progreso de Chequeo
                        </span>
                        <span style="color: ${colorProgresoTarima}; font-size: 0.75rem; font-weight: 700;">
                            ${tarima.ProductosCheckeados}/${tarima.TotalProductos} (${tarima.PorcentajeProgreso}%)
                        </span>
                    </div>
                    <div style="background: rgba(255, 255, 255, 0.1); height: 8px; border-radius: 4px; overflow: hidden;">
                        <div style="
                            background: linear-gradient(90deg, ${colorProgresoTarima}, ${colorProgresoTarima}dd);
                            height: 100%;
                            width: ${tarima.PorcentajeProgreso}%;
                            transition: width 0.5s ease;
                            border-radius: 4px;
                        "></div>
                    </div>
                </div>
                
                <!-- Fechas -->
                <div style="display: flex; gap: 15px; margin-bottom: 10px; font-size: 0.7rem;">
                    <div style="flex: 1;">
                        <span style="color: #9ca3af;">
                            <i class="fas fa-clock" style="margin-right: 5px;"></i>Creación:
                        </span>
                        <span style="color: #ffffff; font-weight: 500; margin-left: 5px;">${fechaCreacionFormateada}</span>
                    </div>
                    <div style="flex: 1;">
                        <span style="color: #9ca3af;">
                            <i class="fas fa-check-circle" style="margin-right: 5px;"></i>Finalización:
                        </span>
                        <span style="color: #34d399; font-weight: 500; margin-left: 5px;">${fechaFinalizacionFormateada}</span>
                    </div>
                </div>
                
                ${yaAsignada ? `
                    <!-- Usuario ya asignado (solo lectura) -->
                    <div style="background: rgba(16, 185, 129, 0.15); padding: 12px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.3);">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <div style="flex: 1;">
                                <p style="color: #9ca3af; font-size: 0.75rem; margin: 0 0 5px 0;">
                                    <i class="fas fa-user-check" style="margin-right: 5px;"></i>Asignado a:
                                </p>
                                <p style="color: #34d399; font-size: 0.9rem; font-weight: 600; margin: 0;">
                                    ${tarima.UsuarioChequeo || 'Usuario no encontrado'}
                                </p>
                            </div>
                            <div style="background: rgba(16, 185, 129, 0.2); padding: 8px 12px; border-radius: 6px;">
                                <i class="fas fa-lock" style="color: #34d399; font-size: 1rem;"></i>
                            </div>
                        </div>
                    </div>
                ` : `
                    <!-- Búsqueda y asignación de usuario -->
                    <div style="background: rgba(37, 99, 235, 0.05); padding: 10px; border-radius: 6px; border: 1px solid rgba(37, 99, 235, 0.2);">
                        <label style="color: #9ca3af; font-size: 0.75rem; display: block; margin-bottom: 6px;">
                            <i class="fas fa-user-check" style="margin-right: 5px;"></i>Asignar a:
                        </label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <div style="flex: 1; position: relative;">
                                <input 
                                    type="text" 
                                    class="search-usuario-input" 
                                    data-tarima-id="${tarima.IdTarima}"
                                    placeholder="Buscar usuario..."
                                    style="
                                        width: 100%;
                                        padding: 8px 10px;
                                        background: rgba(255, 255, 255, 0.05);
                                        border: 1px solid rgba(255, 255, 255, 0.1);
                                        border-radius: 6px;
                                        color: #ffffff;
                                        font-size: 0.8rem;
                                        transition: all 0.3s ease;
                                    "
                                >
                                <!-- Contenedor de resultados -->
                                <div class="resultados-usuarios" data-tarima-id="${tarima.IdTarima}" style="
                                    position: absolute;
                                    top: 100%;
                                    left: 0;
                                    right: 0;
                                    background: #1a1d23;
                                    border: 1px solid rgba(37, 99, 235, 0.3);
                                    border-radius: 6px;
                                    margin-top: 5px;
                                    max-height: 200px;
                                    overflow-y: auto;
                                    z-index: 1000;
                                    display: none;
                                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
                                "></div>
                            </div>
                            <button 
                                class="btn-asignar-usuario" 
                                data-tarima-id="${tarima.IdTarima}"
                                disabled
                                style="
                                    padding: 8px 16px;
                                    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                                    border: none;
                                    border-radius: 6px;
                                    color: #ffffff;
                                    font-weight: 600;
                                    font-size: 0.75rem;
                                    cursor: pointer;
                                    transition: all 0.3s ease;
                                    white-space: nowrap;
                                    opacity: 0.5;
                                "
                            >
                                <i class="fas fa-check"></i> Asignar
                            </button>
                        </div>
                        <!-- Usuario seleccionado (oculto) -->
                        <input type="hidden" class="usuario-seleccionado-id" data-tarima-id="${tarima.IdTarima}" value="">
                        <div class="usuario-seleccionado-info" data-tarima-id="${tarima.IdTarima}" style="display: none; margin-top: 8px;">
                            <div style="background: rgba(16, 185, 129, 0.1); padding: 8px; border-radius: 6px; border-left: 3px solid #10b981;">
                                <p style="color: #34d399; font-size: 0.75rem; margin: 0;">
                                    <i class="fas fa-user-check" style="margin-right: 5px;"></i>
                                    <strong>Seleccionado:</strong> <span class="nombre-usuario-seleccionado"></span>
                                </p>
                            </div>
                        </div>
                    </div>
                `}
            </div>
        `;
    }).join('');
    
    Swal.fire({
        title: `Asignar Tarimas - Pedido #${pedido.IdPedidos}`,
        html: `
            <div style="text-align: left;">
                <!-- Información del Pedido -->
                <div style="background: rgba(37, 99, 235, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #2563eb;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <div>
                            <p style="color: #9ca3af; margin: 0 0 3px 0; font-size: 0.75rem;">Empresa</p>
                            <p style="color: #ffffff; margin: 0; font-weight: 600; font-size: 0.95rem;">${pedido.NombreEmpresa}</p>
                        </div>
                        <div style="text-align: right;">
                            <p style="color: #9ca3af; margin: 0 0 3px 0; font-size: 0.75rem;">Total Tarimas</p>
                            <p style="color: #3b82f6; margin: 0; font-weight: 700; font-size: 1.2rem;">${tarimas.length}</p>
                        </div>
                    </div>
                    <div style="display: flex; gap: 15px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
                        <div style="flex: 1;">
                            <p style="color: #9ca3af; font-size: 0.7rem; margin: 0 0 3px 0;">Asignadas</p>
                            <p style="color: #34d399; font-size: 1rem; font-weight: 700; margin: 0;">${tarimasAsignadas}</p>
                        </div>
                        <div style="flex: 1;">
                            <p style="color: #9ca3af; font-size: 0.7rem; margin: 0 0 3px 0;">Sin Asignar</p>
                            <p style="color: #f59e0b; font-size: 1rem; font-weight: 700; margin: 0;">${tarimasSinAsignar}</p>
                        </div>
                    </div>
                </div>
                
                <!-- Progreso General del Pedido -->
                <div style="background: linear-gradient(135deg, rgba(37, 99, 235, 0.15), rgba(16, 185, 129, 0.15)); padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 1px solid rgba(37, 99, 235, 0.3);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <h3 style="color: #ffffff; font-size: 0.9rem; margin: 0; font-weight: 600;">
                            <i class="fas fa-chart-line" style="margin-right: 8px; color: #3b82f6;"></i>
                            Progreso General del Pedido
                        </h3>
                        <span style="color: ${colorProgresoGeneral}; font-size: 1.1rem; font-weight: 700;">
                            ${progresoGeneral.porcentaje}%
                        </span>
                    </div>
                    <div style="background: rgba(255, 255, 255, 0.1); height: 12px; border-radius: 6px; overflow: hidden; margin-bottom: 8px;">
                        <div style="
                            background: linear-gradient(90deg, ${colorProgresoGeneral}, ${colorProgresoGeneral}dd);
                            height: 100%;
                            width: ${progresoGeneral.porcentaje}%;
                            transition: width 0.5s ease;
                            border-radius: 6px;
                            box-shadow: 0 0 10px ${colorProgresoGeneral}88;
                        "></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem;">
                        <span style="color: #9ca3af;">
                            <i class="fas fa-box" style="margin-right: 5px;"></i>
                            Productos chequeados: <strong style="color: #ffffff;">${progresoGeneral.productosCheckeados}</strong>
                        </span>
                        <span style="color: #9ca3af;">
                            Total: <strong style="color: #ffffff;">${progresoGeneral.totalProductos}</strong>
                        </span>
                    </div>
                </div>
                
                <!-- Estadísticas compactas -->
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 15px;">
                    <div style="background: rgba(37, 99, 235, 0.1); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid rgba(37, 99, 235, 0.2);">
                        <p style="color: #9ca3af; font-size: 0.7rem; margin: 0 0 5px 0;">Total Fardos</p>
                        <p style="color: #3b82f6; font-size: 1.3rem; font-weight: 700; margin: 0;">${totalFardos.toLocaleString()}</p>
                    </div>
                    <div style="background: rgba(16, 185, 129, 0.1); padding: 10px; border-radius: 6px; text-align: center; border: 1px solid rgba(16, 185, 129, 0.2);">
                        <p style="color: #9ca3af; font-size: 0.7rem; margin: 0 0 5px 0;">Total SKUs</p>
                        <p style="color: #34d399; font-size: 1.3rem; font-weight: 700; margin: 0;">${totalSkus.toLocaleString()}</p>
                    </div>
                </div>
                
                <!-- Lista de Tarimas -->
                <div style="max-height: 450px; overflow-y: auto; padding-right: 5px;">
                    ${tarimasHTML}
                </div>
            </div>
        `,
        width: '850px',
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-save"></i> Cerrar',
        cancelButtonText: '<i class="fas fa-times"></i> Cancelar',
        confirmButtonColor: '#2563eb',
        cancelButtonColor: '#6b7280',
        background: '#1a1d23',
        color: '#ffffff',
        didOpen: () => {
            // Configurar los event listeners para búsqueda de usuarios
            setupUsuarioSearch(tarimas);
            // Configurar los event listeners para ver detalle
            setupVerDetalle();
        }
    }).then((result) => {
        if (result.isConfirmed) {
            // Recargar la tabla
            loadPedidos();
        }
    });
}

// ========== CONFIGURAR BOTONES VER DETALLE ==========
function setupVerDetalle() {
    const buttons = document.querySelectorAll('.btn-ver-detalle');
    
    buttons.forEach(button => {
        button.addEventListener('click', async function() {
            const tarimaNo = this.dataset.tarimaNo;
            const pedidoId = this.dataset.pedidoId;
            
            await verDetalleTarima(tarimaNo, pedidoId);
        });
    });
}

// ========== VER DETALLE DE TARIMA ==========
async function verDetalleTarima(tarimaNo, pedidoId) {
    // Mostrar loading
    Swal.fire({
        title: `Cargando detalle Tarima #${tarimaNo}...`,
        html: `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 15px;">
                <div class="spinner" style="
                    border: 4px solid rgba(37, 99, 235, 0.1);
                    border-top: 4px solid #2563eb;
                    border-radius: 50%;
                    width: 50px;
                    height: 50px;
                    animation: spin 1s linear infinite;
                "></div>
            </div>
        `,
        showConfirmButton: false,
        allowOutsideClick: false,
        background: '#1a1d23',
        color: '#ffffff'
    });

    try {
        const connection = await connectionString();
        
        const query = `
            SELECT
                detallepedidostienda_bodega.UPC, 
                detallepedidostienda_bodega.Descripcion, 
                detallepedidostienda_bodega.Cantidad, 
                detallepedidostienda_bodega.CantConfirmada, 
                usuarios.NombreCompleto, 
                detallepedidostienda_bodega.Fechahorapreparo AS FechaPreparo
            FROM
                detallepedidostienda_bodega
                INNER JOIN
                usuarios
                ON 
                    detallepedidostienda_bodega.IdUsuariopreparo = usuarios.Id
            WHERE
                detallepedidostienda_bodega.NoTarima = ? AND
                detallepedidostienda_bodega.IdConsolidado = ?
            ORDER BY
                detallepedidostienda_bodega.Descripcion ASC
        `;
        
        const detalle = await connection.query(query, [tarimaNo, pedidoId]);
        await connection.close();
        
        // Cerrar loading
        Swal.close();
        
        // Verificar si hay detalle
        if (detalle.length === 0) {
            await Swal.fire({
                icon: 'info',
                title: 'Sin Detalle',
                html: `
                    <div style="text-align: center; padding: 15px;">
                        <p style="color: #9ca3af;">
                            La tarima <strong style="color: #3b82f6;">#${tarimaNo}</strong> no tiene productos registrados.
                        </p>
                    </div>
                `,
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#2563eb',
                background: '#1a1d23',
                color: '#ffffff'
            });
            return;
        }
        
        // Mostrar modal con detalle
        mostrarModalDetalleTarima(tarimaNo, detalle);
        
    } catch (error) {
        console.error('Error al cargar detalle de tarima:', error);
        
        Swal.fire({
            icon: 'error',
            title: 'Error al Cargar Detalle',
            text: 'No se pudo cargar el detalle de la tarima. Por favor, intenta nuevamente.',
            confirmButtonText: 'Aceptar',
            confirmButtonColor: '#dc2626',
            background: '#1a1d23',
            color: '#ffffff'
        });
    }
}

// ========== MOSTRAR MODAL DETALLE DE TARIMA ==========
function mostrarModalDetalleTarima(tarimaNo, detalle) {
    // Calcular totales
    const totalCantidad = detalle.reduce((sum, item) => sum + parseInt(item.Cantidad || 0), 0);
    const totalConfirmada = detalle.reduce((sum, item) => sum + parseInt(item.CantConfirmada || 0), 0);
    const totalProductos = detalle.length;
    
    // Formatear fecha (función auxiliar movida aquí para mejor acceso)
    const formatearFecha = (fechaString) => {
        if (!fechaString) return 'N/A';
        try {
            const partes = fechaString.toString().split(' ');
            if (partes.length < 2) return 'N/A';
            
            const fecha = partes[0];
            const hora = partes[1];
            
            const [year, month, day] = fecha.split('-');
            const [hours, minutes] = hora.split(':');
            
            return `${day}/${month}/${year}, ${hours}:${minutes}`;
        } catch (error) {
            console.error('Error al formatear fecha:', error);
            return 'N/A';
        }
    };
    
    // Generar HTML del detalle
    const detalleHTML = detalle.map((item, index) => {
        const fechaFormateada = formatearFecha(item.FechaPreparo);
        const diferencia = parseInt(item.CantConfirmada || 0) - parseInt(item.Cantidad || 0);
        const colorDiferencia = diferencia === 0 ? '#34d399' : (diferencia > 0 ? '#3b82f6' : '#ef4444');
        
        return `
            <div style="
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 10px;
                transition: all 0.3s ease;
            " onmouseover="this.style.background='rgba(255, 255, 255, 0.05)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.03)'">
                <!-- Número y UPC -->
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="
                            background: rgba(37, 99, 235, 0.2);
                            width: 30px;
                            height: 30px;
                            border-radius: 6px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-weight: 700;
                            font-size: 0.75rem;
                            color: #3b82f6;
                            flex-shrink: 0;
                        ">${index + 1}</div>
                        <div style="flex: 1; min-width: 0;">
                            <p style="color: #ffffff; font-weight: 600; margin: 0; font-size: 0.85rem;">${item.Descripcion || 'Sin descripción'}</p>
                            <p style="color: #9ca3af; margin: 3px 0 0 0; font-size: 0.75rem;">
                                <i class="fas fa-barcode" style="margin-right: 5px;"></i>${item.UPC || 'N/A'}
                            </p>
                        </div>
                    </div>
                </div>
                
                <!-- Cantidades -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 8px;">
                    <div style="background: rgba(37, 99, 235, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
                        <p style="color: #9ca3af; font-size: 0.7rem; margin: 0 0 3px 0;">Solicitado</p>
                        <p style="color: #3b82f6; font-size: 0.95rem; font-weight: 700; margin: 0;">${parseInt(item.Cantidad || 0).toLocaleString()}</p>
                    </div>
                    <div style="background: rgba(16, 185, 129, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
                        <p style="color: #9ca3af; font-size: 0.7rem; margin: 0 0 3px 0;">Confirmado</p>
                        <p style="color: #34d399; font-size: 0.95rem; font-weight: 700; margin: 0;">${parseInt(item.CantConfirmada || 0).toLocaleString()}</p>
                    </div>
                    <div style="background: rgba(255, 255, 255, 0.05); padding: 8px; border-radius: 6px; text-align: center;">
                        <p style="color: #9ca3af; font-size: 0.7rem; margin: 0 0 3px 0;">Diferencia</p>
                        <p style="color: ${colorDiferencia}; font-size: 0.95rem; font-weight: 700; margin: 0;">
                            ${diferencia > 0 ? '+' : ''}${diferencia}
                        </p>
                    </div>
                </div>
                
                <!-- Info adicional -->
                <div style="background: rgba(255, 255, 255, 0.02); padding: 8px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 0.7rem;">
                    <div>
                        <span style="color: #9ca3af;">
                            <i class="fas fa-user" style="margin-right: 5px;"></i>Preparado por:
                        </span>
                        <span style="color: #ffffff; font-weight: 500; margin-left: 5px;">${item.NombreCompleto || 'N/A'}</span>
                    </div>
                    <div>
                        <span style="color: #9ca3af;">
                            <i class="fas fa-clock" style="margin-right: 5px;"></i>
                        </span>
                        <span style="color: #ffffff; font-weight: 500;">${fechaFormateada}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    Swal.fire({
        title: `Detalle Tarima #${tarimaNo}`,
        html: `
            <div style="text-align: left;">
                <!-- Resumen -->
                <div style="background: rgba(251, 191, 36, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #f59e0b;">
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                        <div style="text-align: center;">
                            <p style="color: #9ca3af; font-size: 0.75rem; margin: 0 0 5px 0;">Total Productos</p>
                            <p style="color: #fbbf24; font-size: 1.2rem; font-weight: 700; margin: 0;">${totalProductos}</p>
                        </div>
                        <div style="text-align: center;">
                            <p style="color: #9ca3af; font-size: 0.75rem; margin: 0 0 5px 0;">Total Solicitado</p>
                            <p style="color: #3b82f6; font-size: 1.2rem; font-weight: 700; margin: 0;">${totalCantidad.toLocaleString()}</p>
                        </div>
                        <div style="text-align: center;">
                            <p style="color: #9ca3af; font-size: 0.75rem; margin: 0 0 5px 0;">Total Confirmado</p>
                            <p style="color: #34d399; font-size: 1.2rem; font-weight: 700; margin: 0;">${totalConfirmada.toLocaleString()}</p>
                        </div>
                    </div>
                </div>
                
                <!-- Lista de productos -->
                <div style="max-height: 500px; overflow-y: auto; padding-right: 5px;">
                    ${detalleHTML}
                </div>
            </div>
        `,
        width: '800px',
        confirmButtonText: '<i class="fas fa-times"></i> Cerrar',
        confirmButtonColor: '#6b7280',
        background: '#1a1d23',
        color: '#ffffff'
    });
}

function setupUsuarioSearch(tarimas) {
    const inputs = document.querySelectorAll('.search-usuario-input');
    
    inputs.forEach(input => {
        let searchTimeout = null;
        
        input.addEventListener('focus', function() {
            this.style.borderColor = 'rgba(37, 99, 235, 0.5)';
            this.style.background = 'rgba(255, 255, 255, 0.08)';
        });
        
        input.addEventListener('blur', function() {
            // Delay para permitir click en resultados
            setTimeout(() => {
                this.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                this.style.background = 'rgba(255, 255, 255, 0.05)';
            }, 200);
        });
        
        input.addEventListener('input', function() {
            const tarimaId = this.dataset.tarimaId;
            const searchTerm = this.value.trim();
            
            clearTimeout(searchTimeout);
            
            if (searchTerm.length < 2) {
                ocultarResultadosUsuarios(tarimaId);
                return;
            }
            
            searchTimeout = setTimeout(() => {
                buscarUsuarios(searchTerm, tarimaId);
            }, 300);
        });
        
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const tarimaId = this.dataset.tarimaId;
                const searchTerm = this.value.trim();
                if (searchTerm.length >= 2) {
                    buscarUsuarios(searchTerm, tarimaId);
                }
            }
        });
    });
    
    // Event listeners para botones de asignar
    const buttons = document.querySelectorAll('.btn-asignar-usuario');
    buttons.forEach(button => {
        button.addEventListener('click', function() {
            const tarimaId = this.dataset.tarimaId;
            const usuarioId = document.querySelector(`.usuario-seleccionado-id[data-tarima-id="${tarimaId}"]`).value;
            
            if (usuarioId) {
                asignarUsuarioATarima(tarimaId, usuarioId);
            }
        });
    });
}

// ========== BUSCAR USUARIOS ==========
async function buscarUsuarios(searchTerm, tarimaId) {
    try {
        const connection = await connectionString();
        
        const query = `
            SELECT
                usuarios.Id, 
                usuarios.NombreCompleto
            FROM
                usuarios
            WHERE
                usuarios.IdNivel = 4 AND
                usuarios.Activo = 1 AND
                usuarios.NombreCompleto IS NOT NULL
            ORDER BY
                usuarios.NombreCompleto ASC
        `;
        
        const usuarios = await connection.query(query);
        await connection.close();
        
        // Filtrar usuarios con búsqueda inteligente
        const term = searchTerm.toLowerCase();
        const usuariosFiltrados = usuarios.filter(usuario => {
            // Validar que el nombre no sea null o undefined
            if (!usuario.NombreCompleto) {
                return false;
            }
            
            const nombre = usuario.NombreCompleto.toLowerCase();
            
            // Búsqueda exacta
            if (nombre.includes(term)) {
                return true;
            }
            
            // Búsqueda por palabras individuales
            const palabrasBusqueda = term.split(/\s+/);
            const palabrasNombre = nombre.split(/\s+/);
            
            const todasLasPalabras = palabrasBusqueda.every(palabraBusqueda => 
                palabrasNombre.some(palabraNombre => 
                    palabraNombre.includes(palabraBusqueda)
                )
            );
            
            if (todasLasPalabras) {
                return true;
            }
            
            // Búsqueda por iniciales
            const inicialesNombre = palabrasNombre
                .map(palabra => palabra.charAt(0))
                .join('');
            
            if (inicialesNombre.includes(term.replace(/\s+/g, ''))) {
                return true;
            }
            
            // Búsqueda sin espacios
            const nombreSinEspacios = nombre.replace(/\s+/g, '');
            const terminoSinEspacios = term.replace(/\s+/g, '');
            
            if (nombreSinEspacios.includes(terminoSinEspacios)) {
                return true;
            }
            
            return false;
        });
        
        mostrarResultadosUsuarios(usuariosFiltrados, tarimaId);
        
    } catch (error) {
        console.error('Error al buscar usuarios:', error);
        
        // Mostrar mensaje de error al usuario
        const contenedor = document.querySelector(`.resultados-usuarios[data-tarima-id="${tarimaId}"]`);
        if (contenedor) {
            contenedor.innerHTML = `
                <div style="padding: 12px; text-align: center; color: #ef4444; font-size: 0.8rem;">
                    <i class="fas fa-exclamation-triangle"></i> Error al buscar usuarios
                </div>
            `;
            contenedor.style.display = 'block';
        }
    }
}

// ========== MOSTRAR RESULTADOS DE USUARIOS ==========
function mostrarResultadosUsuarios(usuarios, tarimaId) {
    const contenedor = document.querySelector(`.resultados-usuarios[data-tarima-id="${tarimaId}"]`);
    
    if (!contenedor) return;
    
    if (usuarios.length === 0) {
        contenedor.innerHTML = `
            <div style="padding: 12px; text-align: center; color: #9ca3af; font-size: 0.8rem;">
                <i class="fas fa-info-circle"></i> No se encontraron usuarios
            </div>
        `;
        contenedor.style.display = 'block';
        return;
    }
    
    const resultadosHTML = usuarios.map(usuario => `
        <div class="resultado-usuario-item" data-usuario-id="${usuario.Id}" data-usuario-nombre="${usuario.NombreCompleto}" data-tarima-id="${tarimaId}" style="
            padding: 10px 12px;
            cursor: pointer;
            transition: all 0.2s ease;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            font-size: 0.8rem;
        " onmouseover="this.style.background='rgba(37, 99, 235, 0.2)'" onmouseout="this.style.background='transparent'">
            <i class="fas fa-user" style="margin-right: 8px; color: #3b82f6;"></i>
            <span style="color: #ffffff;">${usuario.NombreCompleto}</span>
        </div>
    `).join('');
    
    contenedor.innerHTML = resultadosHTML;
    contenedor.style.display = 'block';
    
    // Event listeners para seleccionar usuario
    const items = contenedor.querySelectorAll('.resultado-usuario-item');
    items.forEach(item => {
        item.addEventListener('click', function() {
            const usuarioId = this.dataset.usuarioId;
            const usuarioNombre = this.dataset.usuarioNombre;
            const tarimaId = this.dataset.tarimaId;
            
            seleccionarUsuario(usuarioId, usuarioNombre, tarimaId);
        });
    });
}

// ========== OCULTAR RESULTADOS DE USUARIOS ==========
function ocultarResultadosUsuarios(tarimaId) {
    const contenedor = document.querySelector(`.resultados-usuarios[data-tarima-id="${tarimaId}"]`);
    if (contenedor) {
        contenedor.style.display = 'none';
        contenedor.innerHTML = '';
    }
}

// ========== SELECCIONAR USUARIO ==========
function seleccionarUsuario(usuarioId, usuarioNombre, tarimaId) {
    // Guardar el ID del usuario
    const inputHidden = document.querySelector(`.usuario-seleccionado-id[data-tarima-id="${tarimaId}"]`);
    inputHidden.value = usuarioId;
    
    // Actualizar el input de búsqueda
    const inputSearch = document.querySelector(`.search-usuario-input[data-tarima-id="${tarimaId}"]`);
    inputSearch.value = usuarioNombre;
    
    // Mostrar información del usuario seleccionado
    const infoDiv = document.querySelector(`.usuario-seleccionado-info[data-tarima-id="${tarimaId}"]`);
    const nombreSpan = infoDiv.querySelector('.nombre-usuario-seleccionado');
    nombreSpan.textContent = usuarioNombre;
    infoDiv.style.display = 'block';
    
    // Habilitar botón de asignar
    const button = document.querySelector(`.btn-asignar-usuario[data-tarima-id="${tarimaId}"]`);
    button.disabled = false;
    button.style.opacity = '1';
    button.style.cursor = 'pointer';
    
    // Ocultar resultados
    ocultarResultadosUsuarios(tarimaId);
}

// ========== ASIGNAR USUARIO A TARIMA ==========
async function asignarUsuarioATarima(tarimaId, usuarioId) {
    try {
        const connection = await connectionString();
        
        const query = `
            UPDATE TarimasInventario
            SET IdUsuarioChequeo = ?
            WHERE IdTarima = ?
        `;
        
        await connection.query(query, [usuarioId, tarimaId]);
        await connection.close();
        
        // Mostrar confirmación visual
        const tarimaItem = document.querySelector(`.tarima-item-compact[data-tarima-id="${tarimaId}"]`);
        tarimaItem.style.border = '2px solid #10b981';
        tarimaItem.style.background = 'rgba(16, 185, 129, 0.1)';
        
        const button = document.querySelector(`.btn-asignar-usuario[data-tarima-id="${tarimaId}"]`);
        button.innerHTML = '<i class="fas fa-check-double"></i> Asignado';
        button.style.background = 'linear-gradient(135deg, #059669 0%, #047857 100%)';
        button.disabled = true;
        button.style.cursor = 'not-allowed';
        
    } catch (error) {
        console.error('Error al asignar usuario:', error);
        
        await Swal.fire({
            icon: 'error',
            title: 'Error al Asignar',
            text: 'No se pudo asignar el usuario a la tarima. Por favor, intenta nuevamente.',
            confirmButtonText: 'Aceptar',
            confirmButtonColor: '#dc2626',
            background: '#1a1d23',
            color: '#ffffff'
        });
    }
}

// ========== GUARDAR TODAS LAS ASIGNACIONES ==========
async function guardarAsignaciones(pedido, tarimas) {
    // Verificar cuántas tarimas tienen usuario asignado
    let asignadas = 0;
    tarimas.forEach(tarima => {
        const usuarioId = document.querySelector(`.usuario-seleccionado-id[data-tarima-id="${tarima.IdTarima}"]`)?.value;
        if (usuarioId) {
            asignadas++;
        }
    });
    
    await Swal.fire({
        icon: 'success',
        title: '¡Asignaciones Guardadas!',
        html: `
            <div style="text-align: center; padding: 15px;">
                <p style="color: #9ca3af; margin-bottom: 15px;">
                    Se han procesado <strong style="color: #34d399;">${asignadas} de ${tarimas.length} tarimas</strong> 
                    del pedido <strong style="color: #3b82f6;">#${pedido.IdPedidos}</strong>
                </p>
                <div style="background: rgba(16, 185, 129, 0.1); padding: 12px; border-radius: 8px; border-left: 4px solid #10b981;">
                    <p style="color: #ffffff; margin: 0;"><strong>Empresa:</strong> ${pedido.NombreEmpresa}</p>
                </div>
            </div>
        `,
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#10b981',
        background: '#1a1d23',
        color: '#ffffff',
        width: '500px'
    });
    
    // Recargar la tabla
    await loadPedidos();
}
async function confirmarAsignacion(pedido, tarimas) {
    // Esta función se implementará después
    await Swal.fire({
        icon: 'success',
        title: '¡Asignación Confirmada!',
        html: `
            <div style="text-align: center; padding: 15px;">
                <p style="color: #9ca3af; margin-bottom: 15px;">
                    Se han asignado correctamente <strong style="color: #34d399;">${tarimas.length} tarimas</strong> 
                    al pedido <strong style="color: #3b82f6;">#${pedido.IdPedidos}</strong>
                </p>
                <div style="background: rgba(16, 185, 129, 0.1); padding: 12px; border-radius: 8px; border-left: 4px solid #10b981;">
                    <p style="color: #ffffff; margin: 0;"><strong>Empresa:</strong> ${pedido.NombreEmpresa}</p>
                </div>
            </div>
        `,
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#10b981',
        background: '#1a1d23',
        color: '#ffffff',
        width: '500px'
    });
}
// ========== ACTUALIZAR INFORMACIÓN DE PAGINACIÓN ==========
function updatePaginationInfo(from, to, total) {
    document.getElementById('showingFrom').textContent = from;
    document.getElementById('showingTo').textContent = to;
    document.getElementById('totalRecords').textContent = total;
}

// ========== RENDERIZAR CONTROLES DE PAGINACIÓN ==========
function renderPaginationControls() {
    const totalPages = Math.ceil(filteredPedidos.length / pageSize);
    const pageNumbersContainer = document.getElementById('pageNumbers');
    
    pageNumbersContainer.innerHTML = '';
    
    // Actualizar estado de botones
    document.getElementById('btnFirstPage').disabled = currentPage === 1;
    document.getElementById('btnPrevPage').disabled = currentPage === 1;
    document.getElementById('btnNextPage').disabled = currentPage === totalPages || totalPages === 0;
    document.getElementById('btnLastPage').disabled = currentPage === totalPages || totalPages === 0;
    
    if (totalPages === 0) return;
    
    // Lógica para mostrar números de página
    let startPage, endPage;
    
    if (totalPages <= 7) {
        // Mostrar todas las páginas si son 7 o menos
        startPage = 1;
        endPage = totalPages;
    } else {
        // Mostrar rango de páginas con elipsis
        if (currentPage <= 4) {
            startPage = 1;
            endPage = 5;
        } else if (currentPage >= totalPages - 3) {
            startPage = totalPages - 4;
            endPage = totalPages;
        } else {
            startPage = currentPage - 2;
            endPage = currentPage + 2;
        }
    }
    
    // Primera página
    if (startPage > 1) {
        pageNumbersContainer.appendChild(createPageButton(1));
        if (startPage > 2) {
            pageNumbersContainer.appendChild(createEllipsis());
        }
    }
    
    // Páginas del rango
    for (let i = startPage; i <= endPage; i++) {
        pageNumbersContainer.appendChild(createPageButton(i));
    }
    
    // Última página
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            pageNumbersContainer.appendChild(createEllipsis());
        }
        pageNumbersContainer.appendChild(createPageButton(totalPages));
    }
}

// ========== CREAR BOTÓN DE PÁGINA ==========
function createPageButton(pageNumber) {
    const button = document.createElement('button');
    button.className = 'page-number';
    button.textContent = pageNumber;
    
    if (pageNumber === currentPage) {
        button.classList.add('active');
    }
    
    button.addEventListener('click', () => {
        currentPage = pageNumber;
        renderTable();
    });
    
    return button;
}

// ========== CREAR ELIPSIS ==========
function createEllipsis() {
    const span = document.createElement('span');
    span.className = 'page-number';
    span.textContent = '...';
    span.style.cursor = 'default';
    span.style.pointerEvents = 'none';
    return span;
}

// ========== MOSTRAR/OCULTAR LOADING ==========
function showLoading(show) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    loadingOverlay.style.display = show ? 'flex' : 'none';
}
function updateRefreshIndicator() {
    const indicator = document.getElementById('autoRefreshIndicator');
    const lastUpdate = document.getElementById('lastUpdateTime');
    
    if (lastUpdateTime) {
        const now = new Date();
        const diff = Math.floor((now - lastUpdateTime) / 1000);
        
        let timeText = '';
        if (diff < 60) {
            timeText = `hace ${diff}s`;
        } else {
            const minutes = Math.floor(diff / 60);
            timeText = `hace ${minutes}m`;
        }
        
        lastUpdate.textContent = `Última actualización: ${timeText}`;
    } else {
        lastUpdate.textContent = 'Actualizando...';
    }
    
    if (autoRefreshEnabled) {
        indicator.innerHTML = '<i class="fas fa-circle" style="color: #10b981; margin-right: 5px; animation: pulse 2s infinite;"></i>Auto-actualización activa';
        indicator.style.color = '#10b981';
    } else {
        indicator.innerHTML = '<i class="fas fa-circle" style="color: #6b7280; margin-right: 5px;"></i>Auto-actualización pausada';
        indicator.style.color = '#6b7280';
    }
}
setInterval(() => {
    if (lastUpdateTime) {
        updateRefreshIndicator();
    }
}, 1000);