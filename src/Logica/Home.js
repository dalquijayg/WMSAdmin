const path = require('path');
const Swal = require('sweetalert2');
const { ipcRenderer } = require('electron');
const { connectionString } = require('../Conexion/Conexion');

// Verificar si hay datos de usuario al cargar
document.addEventListener('DOMContentLoaded', () => {
    verificarSesion();
    cargarDatosUsuario();
    configurarEventos();
    configurarMenuLateral();
    cargarDatosDashboard();
    
    // Actualizar datos cada 30 segundos
    setInterval(cargarDatosDashboard, 30000);
});

// Función para verificar si hay sesión activa
function verificarSesion() {
    const userData = localStorage.getItem('userData');
    
    if (!userData) {
        window.location.href = path.join(__dirname, '../Vistas/Login.html');
        return;
    }
}

// Cargar datos del usuario
function cargarDatosUsuario() {
    const userData = JSON.parse(localStorage.getItem('userData'));
    
    if (userData) {
        document.getElementById('userName').textContent = userData.nombre;
    }
}

// Función auxiliar para normalizar resultados de query
function normalizarResultado(resultado) {
    // Si es un array directamente, retornarlo
    if (Array.isArray(resultado)) {
        return resultado;
    }
    
    // Si es [rows, fields], retornar rows
    if (Array.isArray(resultado) && resultado.length > 0 && Array.isArray(resultado[0])) {
        return resultado[0];
    }
    
    // Si tiene propiedad rows
    if (resultado && resultado.rows) {
        return resultado.rows;
    }
    
    // Si no es ninguno, retornar array vacío
    return [];
}

// Cargar todos los datos del dashboard
async function cargarDatosDashboard() {
    try {
        await Promise.all([
            cargarEstadisticas(),
            cargarActividadReciente(),
            cargarPreparadoresActivos()
        ]);
    } catch (error) {
        console.error('Error al cargar datos del dashboard:', error);
    }
}

// Cargar estadísticas
async function cargarEstadisticas() {
    try {
        const connection = await connectionString();
        
        // Pedidos activos
        let pedidosActivos = await connection.query(
            `SELECT COUNT(*) as total FROM pedidostienda_bodega WHERE Estado IN (4, 5, 6)`
        );
        pedidosActivos = normalizarResultado(pedidosActivos);
        
        // Completados hoy
        let completadosHoy = await connection.query(
            `SELECT COUNT(*) as total FROM pedidostienda_bodega 
             WHERE Estado = 7 AND DATE(Fecha) = CURDATE()`
        );
        completadosHoy = normalizarResultado(completadosHoy);
        
        // Completados ayer
        let completadosAyer = await connection.query(
            `SELECT COUNT(*) as total FROM pedidostienda_bodega 
             WHERE Estado = 7 AND DATE(Fecha) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`
        );
        completadosAyer = normalizarResultado(completadosAyer);
        
        // Pendientes
        let pendientes = await connection.query(
            `SELECT COUNT(*) as total FROM pedidostienda_bodega WHERE Estado = 4`
        );
        pendientes = normalizarResultado(pendientes);
        
        // Preparadores activos
        let preparadores = await connection.query(
            `SELECT COUNT(*) as total FROM usuarios WHERE IdNivel = 3 AND Activo = 1`
        );
        preparadores = normalizarResultado(preparadores);
        
        await connection.close();
        
        // Actualizar estadísticas en el DOM
        document.getElementById('statPedidosActivos').textContent = pedidosActivos[0]?.total || 0;
        document.getElementById('statCompletadosHoy').textContent = completadosHoy[0]?.total || 0;
        document.getElementById('statPendientes').textContent = pendientes[0]?.total || 0;
        document.getElementById('statPreparadoresActivos').textContent = preparadores[0]?.total || 0;
        
        // Calcular porcentajes de cambio
        const cambioCompletados = calcularCambio(
            completadosHoy[0]?.total || 0, 
            completadosAyer[0]?.total || 0
        );
        actualizarCambio('changeCompletadosHoy', cambioCompletados);
        
    } catch (error) {
        console.error('Error al cargar estadísticas:', error);
    }
}

// Cargar actividad reciente
async function cargarActividadReciente() {
    try {
        const connection = await connectionString();
        
        let actividades = await connection.query(
            `SELECT 
                pedidostienda_bodega.IdPedidos,
                pedidostienda_bodega.Fecha,
                pedidostienda_bodega.Estado,
                estadopedidotiendabodega.EstadoPedido
            FROM pedidostienda_bodega
            INNER JOIN estadopedidotiendabodega 
                ON pedidostienda_bodega.Estado = estadopedidotiendabodega.IdEstado
            WHERE pedidostienda_bodega.Estado IN (4, 5, 6, 7)
            ORDER BY pedidostienda_bodega.Fecha DESC
            LIMIT 10`
        );
        
        await connection.close();
        
        actividades = normalizarResultado(actividades);
        
        const activityList = document.getElementById('activityList');
        
        if (!actividades || actividades.length === 0) {
            activityList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No hay actividad reciente</p>
                </div>
            `;
            return;
        }
        
        activityList.innerHTML = '';
        
        actividades.forEach(actividad => {
            const tiempoTranscurrido = calcularTiempoTranscurrido(actividad.Fecha);
            const { icon, clase } = obtenerIconoEstado(actividad.Estado);
            
            const activityItem = document.createElement('div');
            activityItem.className = 'activity-item';
            activityItem.innerHTML = `
                <div class="activity-icon ${clase}">
                    <i class="${icon}"></i>
                </div>
                <div class="activity-info">
                    <p class="activity-title">Pedido #${actividad.IdPedidos} - ${actividad.EstadoPedido}</p>
                    <span class="activity-time">${tiempoTranscurrido}</span>
                </div>
            `;
            
            activityList.appendChild(activityItem);
        });
        
    } catch (error) {
        console.error('Error al cargar actividad reciente:', error);
        document.getElementById('activityList').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Error al cargar actividades</p>
            </div>
        `;
    }
}

// Cargar preparadores activos
async function cargarPreparadoresActivos() {
    try {
        const connection = await connectionString();
        
        let preparadores = await connection.query(
            `SELECT 
                usuarios.Id,
                usuarios.NombreCompleto,
                usuarios.Usuario,
                (SELECT COUNT(*) 
                 FROM pedidostienda_bodega 
                 WHERE pedidostienda_bodega.Estado IN (5, 6) 
                 AND pedidostienda_bodega.NombreUsuario = usuarios.Usuario
                ) as pedidos_activos
            FROM usuarios
            WHERE usuarios.IdNivel = 3 AND usuarios.Activo = 1
            ORDER BY pedidos_activos DESC
            LIMIT 10`
        );
        
        await connection.close();
        
        preparadores = normalizarResultado(preparadores);
        
        const preparadoresList = document.getElementById('preparadoresList');
        
        if (!preparadores || preparadores.length === 0) {
            preparadoresList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users-slash"></i>
                    <p>No hay preparadores activos</p>
                </div>
            `;
            return;
        }
        
        preparadoresList.innerHTML = '';
        
        preparadores.forEach(preparador => {
            const preparadorItem = document.createElement('div');
            preparadorItem.className = 'preparador-item';
            
            const statusClass = preparador.pedidos_activos > 0 ? 'active' : 'break';
            const statusText = preparador.pedidos_activos > 0 ? 'Activo' : 'En descanso';
            
            preparadorItem.innerHTML = `
                <div class="preparador-avatar">
                    <i class="fas fa-user"></i>
                </div>
                <div class="preparador-info">
                    <p class="preparador-name">${preparador.NombreCompleto}</p>
                    <span class="preparador-status ${statusClass}">${statusText}</span>
                </div>
                <div class="preparador-stats">
                    <span class="badge">${preparador.pedidos_activos} pedidos</span>
                </div>
            `;
            
            preparadoresList.appendChild(preparadorItem);
        });
        
    } catch (error) {
        console.error('Error al cargar preparadores:', error);
        document.getElementById('preparadoresList').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Error al cargar preparadores</p>
            </div>
        `;
    }
}

// Funciones auxiliares
function calcularTiempoTranscurrido(fecha) {
    const ahora = new Date();
    const fechaPedido = new Date(fecha);
    const diferencia = Math.floor((ahora - fechaPedido) / 1000);
    
    if (diferencia < 60) {
        return 'Hace menos de 1 minuto';
    } else if (diferencia < 3600) {
        const minutos = Math.floor(diferencia / 60);
        return `Hace ${minutos} minuto${minutos > 1 ? 's' : ''}`;
    } else if (diferencia < 86400) {
        const horas = Math.floor(diferencia / 3600);
        return `Hace ${horas} hora${horas > 1 ? 's' : ''}`;
    } else {
        const dias = Math.floor(diferencia / 86400);
        return `Hace ${dias} día${dias > 1 ? 's' : ''}`;
    }
}

function obtenerIconoEstado(estado) {
    const estados = {
        4: { icon: 'fas fa-box', clase: 'info' },
        5: { icon: 'fas fa-clock', clase: 'warning' },
        6: { icon: 'fas fa-sync', clase: 'warning' },
        7: { icon: 'fas fa-check', clase: 'success' }
    };
    
    return estados[estado] || { icon: 'fas fa-question', clase: 'info' };
}

function calcularCambio(actual, anterior) {
    if (anterior === 0) {
        return actual > 0 ? 100 : 0;
    }
    return Math.round(((actual - anterior) / anterior) * 100);
}

function actualizarCambio(elementId, cambio) {
    const elemento = document.getElementById(elementId);
    if (!elemento) return;
    
    let iconClass = 'fa-minus';
    let changeClass = '';
    let texto = 'Sin cambios';
    
    if (cambio > 0) {
        iconClass = 'fa-arrow-up';
        changeClass = 'positive';
        texto = `${cambio}% vs ayer`;
    } else if (cambio < 0) {
        iconClass = 'fa-arrow-down';
        changeClass = 'negative';
        texto = `${Math.abs(cambio)}% vs ayer`;
    }
    
    elemento.className = `stat-change ${changeClass}`;
    elemento.innerHTML = `<i class="fas ${iconClass}"></i> ${texto}`;
}

// Configurar eventos
function configurarEventos() {
    const btnToggleSidebar = document.getElementById('btnToggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    
    btnToggleSidebar.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('show-mobile');
        } else {
            sidebar.classList.toggle('collapsed');
            mainContent.classList.toggle('full-width');
        }
    });
    
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            if (!sidebar.contains(e.target) && !btnToggleSidebar.contains(e.target)) {
                sidebar.classList.remove('show-mobile');
            }
        }
    });
    
    document.getElementById('btnLogout').addEventListener('click', confirmarCerrarSesion);
    
    // Event listeners para los submenús
    document.getElementById('menuAsignarHojas').addEventListener('click', (e) => {
        e.preventDefault();
        abrirAsignarHojas();
    });
    
    document.getElementById('menuAsignarTarimas').addEventListener('click', (e) => {
        e.preventDefault();
        abrirAsignarTarimas();
    });
    
    document.getElementById('menuReportes').addEventListener('click', (e) => {
        e.preventDefault();
        abrirPedidosReportes();
    });
    
    document.getElementById('menuReporteRechequeadores').addEventListener('click', (e) => {
        e.preventDefault();
        abrirReporteRechequeadores();
    });
}

// Configurar menú lateral
function configurarMenuLateral() {
    const menuItemsWithSubmenu = document.querySelectorAll('.nav-item.has-submenu');
    
    menuItemsWithSubmenu.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            const submenuId = item.getAttribute('data-submenu');
            const submenu = document.getElementById(`submenu-${submenuId}`);
            const isOpen = submenu.classList.contains('open');
            
            document.querySelectorAll('.submenu').forEach(sm => sm.classList.remove('open'));
            document.querySelectorAll('.nav-item.has-submenu').forEach(ni => ni.classList.remove('open'));
            
            if (!isOpen) {
                submenu.classList.add('open');
                item.classList.add('open');
            }
        });
    });
    
    document.querySelectorAll('.submenu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-item, .submenu-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

function abrirAsignarHojas() {
    ipcRenderer.send('open_asignar_hojas');
}
function abrirPedidosReportes() {
    ipcRenderer.send('open_pedidos_reportes');
}
async function confirmarCerrarSesion() {
    const result = await Swal.fire({
        title: '¿Cerrar sesión?',
        text: '¿Estás seguro de que deseas salir del sistema?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, cerrar sesión',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#6b7280',
        background: '#1a1d23',
        color: '#ffffff'
    });
    
    if (result.isConfirmed) {
        localStorage.removeItem('userData');
        
        await Swal.fire({
            icon: 'success',
            title: 'Sesión cerrada',
            text: 'Hasta pronto',
            timer: 1500,
            timerProgressBar: true,
            showConfirmButton: false,
            background: '#1a1d23',
            color: '#ffffff'
        });
        
        window.location.href = path.join(__dirname, '../Vistas/Login.html');
    }
}
// Función para verificar permisos de usuario
async function verificarPermiso(codigo) {
    try {
        const userData = JSON.parse(localStorage.getItem('userData'));
        if (!userData || !userData.id) {
            return false;
        }
        
        const connection = await connectionString();
        
        const resultado = await connection.query(
            `SELECT * FROM transacciones_sistema 
             WHERE IdUsuario = ? AND Codigo = ? AND Estado = 1`,
            [userData.id, codigo]
        );
        
        await connection.close();
        
        const permisos = normalizarResultado(resultado);
        return permisos.length > 0;
        
    } catch (error) {
        console.error('Error al verificar permisos:', error);
        return false;
    }
}
// Función para abrir ventana de Asignar Hojas
async function abrirAsignarHojas() {
    // Mostrar cargando
    const loadingSwal = Swal.fire({
        title: 'Verificando permisos...',
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
    
    // Verificar permiso (Código 200 para Asignar Hojas)
    const tienePermiso = await verificarPermiso(200);
    
    loadingSwal.close();
    
    if (tienePermiso) {
        // Si tiene permiso, abrir la ventana
        ipcRenderer.send('open_asignar_hojas');
    } else {
        // Si no tiene permiso, mostrar mensaje de error
        await Swal.fire({
            icon: 'error',
            title: 'Acceso Denegado',
            html: `
                <div style="text-align: center;">
                    <div style="font-size: 3rem; margin-bottom: 15px;">🔒</div>
                    <p style="color: #9ca3af; margin-bottom: 15px;">
                        No tienes permisos para acceder a esta sección.
                    </p>
                    <div style="background: rgba(220, 38, 38, 0.1); padding: 15px; border-radius: 8px; border-left: 4px solid #dc2626;">
                        <p style="color: #dc2626; font-size: 0.9rem; margin: 0;">
                            <strong>Código de permiso requerido:</strong> 200<br>
                            Contacta al administrador para solicitar acceso.
                        </p>
                    </div>
                </div>
            `,
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#dc2626',
            background: '#1a1d23',
            color: '#ffffff',
            width: '450px'
        });
    }
}
async function abrirPedidosReportes() {
    // Mostrar cargando
    const loadingSwal = Swal.fire({
        title: 'Verificando permisos...',
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
    
    // Verificar permiso (Código 200 para Asignar Hojas)
    const tienePermiso = await verificarPermiso(201);
    
    loadingSwal.close();
    
    if (tienePermiso) {
        // Si tiene permiso, abrir la ventana
        ipcRenderer.send('open_pedidos_reportes');
    } else {
        // Si no tiene permiso, mostrar mensaje de error
        await Swal.fire({
            icon: 'error',
            title: 'Acceso Denegado',
            html: `
                <div style="text-align: center;">
                    <div style="font-size: 3rem; margin-bottom: 15px;">🔒</div>
                    <p style="color: #9ca3af; margin-bottom: 15px;">
                        No tienes permisos para acceder a esta sección.
                    </p>
                    <div style="background: rgba(220, 38, 38, 0.1); padding: 15px; border-radius: 8px; border-left: 4px solid #dc2626;">
                        <p style="color: #dc2626; font-size: 0.9rem; margin: 0;">
                            <strong>Código de permiso requerido:</strong> 201<br>
                            Contacta al administrador para solicitar acceso.
                        </p>
                    </div>
                </div>
            `,
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#dc2626',
            background: '#1a1d23',
            color: '#ffffff',
            width: '450px'
        });
    }
}
// Función para abrir ventana de Asignar Tarimas
async function abrirAsignarTarimas() {
    const loadingSwal = Swal.fire({
        title: 'Verificando permisos...',
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
    
    // Verificar permiso (Código 202 para Asignar Tarimas)
    const tienePermiso = await verificarPermiso(202);
    
    loadingSwal.close();
    
    if (tienePermiso) {
        ipcRenderer.send('open_asignar_tarimas');
    } else {
        await Swal.fire({
            icon: 'error',
            title: 'Acceso Denegado',
            html: `
                <div style="text-align: center;">
                    <div style="font-size: 3rem; margin-bottom: 15px;">🔒</div>
                    <p style="color: #9ca3af; margin-bottom: 15px;">
                        No tienes permisos para acceder a esta sección.
                    </p>
                    <div style="background: rgba(220, 38, 38, 0.1); padding: 15px; border-radius: 8px; border-left: 4px solid #dc2626;">
                        <p style="color: #dc2626; font-size: 0.9rem; margin: 0;">
                            <strong>Código de permiso requerido:</strong> 202<br>
                            Contacta al administrador para solicitar acceso.
                        </p>
                    </div>
                </div>
            `,
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#dc2626',
            background: '#1a1d23',
            color: '#ffffff',
            width: '450px'
        });
    }
}

// Función para abrir ventana de Reporte Rechequeadores
async function abrirReporteRechequeadores() {
    const loadingSwal = Swal.fire({
        title: 'Verificando permisos...',
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
    
    // Verificar permiso (Código 203 para Reporte Rechequeadores)
    const tienePermiso = await verificarPermiso(203);
    
    loadingSwal.close();
    
    if (tienePermiso) {
        ipcRenderer.send('open_reporte_rechequeadores');
    } else {
        await Swal.fire({
            icon: 'error',
            title: 'Acceso Denegado',
            html: `
                <div style="text-align: center;">
                    <div style="font-size: 3rem; margin-bottom: 15px;">🔒</div>
                    <p style="color: #9ca3af; margin-bottom: 15px;">
                        No tienes permisos para acceder a esta sección.
                    </p>
                    <div style="background: rgba(220, 38, 38, 0.1); padding: 15px; border-radius: 8px; border-left: 4px solid #dc2626;">
                        <p style="color: #dc2626; font-size: 0.9rem; margin: 0;">
                            <strong>Código de permiso requerido:</strong> 203<br>
                            Contacta al administrador para solicitar acceso.
                        </p>
                    </div>
                </div>
            `,
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#dc2626',
            background: '#1a1d23',
            color: '#ffffff',
            width: '450px'
        });
    }
}