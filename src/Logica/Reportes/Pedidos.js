const { connectionString } = require('../Conexion/Conexion');
const Swal = require('sweetalert2');
const { ipcRenderer } = require('electron');

// Variables globales para los gráficos
let chartHojas = null;
let chartSKUs = null;
let chartFardos = null;

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

// Función para formatear fecha
function formatearFecha(fecha) {
    if (!fecha) return '';
    const date = new Date(fecha);
    const dia = String(date.getDate()).padStart(2, '0');
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const anio = date.getFullYear();
    return `${dia}/${mes}/${anio}`;
}

// Función para obtener fecha de hoy
function obtenerFechaHoy() {
    const hoy = new Date();
    return hoy.toISOString().split('T')[0];
}

// Cargar datos al iniciar
document.addEventListener('DOMContentLoaded', () => {
    // Establecer fechas por defecto (hoy)
    const hoy = obtenerFechaHoy();
    document.getElementById('fechaDesde').value = hoy;
    document.getElementById('fechaHasta').value = hoy;
    
    configurarEventos();
    cargarTodosLosDatos();
    
    // Actualizar datos cada 60 segundos
    setInterval(cargarTodosLosDatos, 60000);
});

// Configurar eventos
function configurarEventos() {
    // Botón refrescar
    document.getElementById('btnRefresh').addEventListener('click', async () => {
        const btn = document.getElementById('btnRefresh');
        const icon = btn.querySelector('i');
        
        icon.classList.add('fa-spin');
        await cargarTodosLosDatos();
        
        setTimeout(() => {
            icon.classList.remove('fa-spin');
        }, 1000);
    });
    
    // Botón filtrar
    document.getElementById('btnFiltrar').addEventListener('click', () => {
        cargarDatosPreparadores();
    });
    
    // Botón exportar Excel
    document.getElementById('btnExportExcel').addEventListener('click', () => {
        exportarExcel();
    });
}

// Cargar todos los datos
async function cargarTodosLosDatos() {
    await Promise.all([
        cargarEstadisticasDelDia(),
        cargarDatosPreparadores()
    ]);
}

// ========== CARGAR ESTADÍSTICAS DEL DÍA ==========
async function cargarEstadisticasDelDia() {
    try {
        const connection = await connectionString();
        const hoy = obtenerFechaHoy();
        
        // Pedidos por preparar hoy (Estado 4)
        let porPreparar = await connection.query(
            `SELECT COUNT(*) as Total 
            FROM pedidostienda_bodega 
            WHERE Estado = 4 
            AND DATE(Fecha) = ?`,
            [hoy]
        );
        porPreparar = normalizarResultado(porPreparar);
        const countPorPreparar = porPreparar.length > 0 ? porPreparar[0].Total : 0;
        
        // Pedidos en preparación (Estado 5)
        let enPreparacion = await connection.query(
            `SELECT COUNT(*) as Total 
            FROM pedidostienda_bodega 
            WHERE Estado = 5 AND NoHojas > 0`
        );
        enPreparacion = normalizarResultado(enPreparacion);
        const countEnPreparacion = enPreparacion.length > 0 ? enPreparacion[0].Total : 0;
        
        // Pedidos completados hoy (Estado 6)
        let completados = await connection.query(
            `SELECT COUNT(*) as Total 
            FROM pedidostienda_bodega 
            WHERE Estado = 6 
            AND DATE(Fecha) = ?`,
            [hoy]
        );
        completados = normalizarResultado(completados);
        const countCompletados = completados.length > 0 ? completados[0].Total : 0;
        
        await connection.close();
        
        // Actualizar cards
        document.getElementById('countPorPreparar').textContent = countPorPreparar;
        document.getElementById('countEnPreparacion').textContent = countEnPreparacion;
        document.getElementById('countCompletados').textContent = countCompletados;
        
    } catch (error) {
        console.error('Error al cargar estadísticas del día:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se pudieron cargar las estadísticas del día',
            background: '#1e293b',
            color: '#fff'
        });
    }
}

// ========== CARGAR DATOS DE PREPARADORES ==========
async function cargarDatosPreparadores() {
    try {
        const fechaDesde = document.getElementById('fechaDesde').value;
        const fechaHasta = document.getElementById('fechaHasta').value;
        
        if (!fechaDesde || !fechaHasta) {
            Swal.fire({
                icon: 'warning',
                title: 'Fechas requeridas',
                text: 'Por favor selecciona un rango de fechas',
                background: '#1e293b',
                color: '#fff'
            });
            return;
        }
        
        const connection = await connectionString();
        
        // Consulta para obtener datos agrupados por preparador (usando detallepedidostienda_bodega)
        let datos = await connection.query(
            `SELECT 
                IdUsuariopreparo,
                EmpleadoPreparador,
                COUNT(*) as TotalHojas,
                SUM(TotalSKUs) as TotalSKUs,
                SUM(TotalFardos) as TotalFardos,
                SUM(TotalPedidos) as TotalPedidos
            FROM (
                SELECT 
                    d.IdUsuariopreparo,
                    COALESCE(u.NombreCompleto, CONCAT(u.Nombres, ' ', u.Apellidos), d.IdUsuariopreparo) as EmpleadoPreparador,
                    d.IdConsolidado,
                    d.NoHoja,
                    COUNT(DISTINCT d.UPCProducto) as TotalSKUs,
                    SUM(d.Cantidad) as TotalFardos,
                    1 as TotalPedidos
                FROM detallepedidostienda_bodega d
                LEFT JOIN usuarios u ON d.IdUsuariopreparo = u.Id
                WHERE DATE(d.Fechahorapreparo) BETWEEN ? AND ?
                AND d.IdUsuariopreparo IS NOT NULL
                AND d.IdUsuariopreparo != ''
                AND d.IdUsuariopreparo != 0
                GROUP BY d.IdUsuariopreparo, u.NombreCompleto, u.Nombres, u.Apellidos, d.IdConsolidado, d.NoHoja
            ) as subquery
            GROUP BY IdUsuariopreparo, EmpleadoPreparador
            ORDER BY TotalHojas DESC`,
            [fechaDesde, fechaHasta]
        );
        
        await connection.close();
        
        datos = normalizarResultado(datos);
        
        // Renderizar tabla
        renderizarTabla(datos);
        
        // Generar gráficos
        generarGraficos(datos);
        
    } catch (error) {
        console.error('Error al cargar datos de preparadores:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'No se pudieron cargar los datos de preparadores',
            background: '#1e293b',
            color: '#fff'
        });
    }
}

// ========== RENDERIZAR TABLA ==========
function renderizarTabla(datos) {
    const tbody = document.getElementById('bodyPreparadores');
    
    if (datos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="loading-cell">
                    <div class="loading-message">
                        <i class="fas fa-inbox"></i>
                        <span>No hay datos para el rango de fechas seleccionado</span>
                    </div>
                </td>
            </tr>
        `;
        
        // Limpiar totales
        document.getElementById('totalHojas').textContent = '0';
        document.getElementById('totalSKUs').textContent = '0';
        document.getElementById('totalFardos').textContent = '0';
        document.getElementById('totalPedidos').textContent = '0';
        
        return;
    }
    
    tbody.innerHTML = '';
    
    let sumHojas = 0;
    let sumSKUs = 0;
    let sumFardos = 0;
    let sumPedidos = 0;
    
    datos.forEach(preparador => {
        const tr = document.createElement('tr');
        
        // Convertir a números para asegurar la suma correcta
        const hojas = parseInt(preparador.TotalHojas) || 0;
        const skus = parseFloat(preparador.TotalSKUs) || 0;
        const fardos = parseFloat(preparador.TotalFardos) || 0;
        const pedidos = parseInt(preparador.TotalPedidos) || 0;
        
        sumHojas += hojas;
        sumSKUs += skus;
        sumFardos += fardos;
        sumPedidos += pedidos;
        
        tr.innerHTML = `
            <td>${preparador.EmpleadoPreparador}</td>
            <td>${hojas.toLocaleString()}</td>
            <td>${skus.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${fardos.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${pedidos.toLocaleString()}</td>
        `;
        
        tbody.appendChild(tr);
    });
    
    // Actualizar totales con formato
    document.getElementById('totalHojas').textContent = sumHojas.toLocaleString();
    document.getElementById('totalSKUs').textContent = sumSKUs.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('totalFardos').textContent = sumFardos.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('totalPedidos').textContent = sumPedidos.toLocaleString();
}

// ========== GENERAR GRÁFICOS ==========
function generarGraficos(datos) {
    if (datos.length === 0) {
        // Si no hay datos, destruir gráficos existentes
        if (chartHojas) chartHojas.destroy();
        if (chartSKUs) chartSKUs.destroy();
        if (chartFardos) chartFardos.destroy();
        return;
    }
    
    // Preparar datos para los gráficos
    // Ordenar datos de mayor a menor para cada métrica
    const datosHojas = [...datos].sort((a, b) => (parseInt(b.TotalHojas) || 0) - (parseInt(a.TotalHojas) || 0));
    const datosSKUs = [...datos].sort((a, b) => (parseFloat(b.TotalSKUs) || 0) - (parseFloat(a.TotalSKUs) || 0));
    const datosFardos = [...datos].sort((a, b) => (parseFloat(b.TotalFardos) || 0) - (parseFloat(a.TotalFardos) || 0));
    
    // Preparar datos para gráfico de Hojas
    const preparadoresHojas = datosHojas.map(d => d.EmpleadoPreparador);
    const hojas = datosHojas.map(d => parseInt(d.TotalHojas) || 0);
    
    // Preparar datos para gráfico de SKUs
    const preparadoresSKUs = datosSKUs.map(d => d.EmpleadoPreparador);
    const skus = datosSKUs.map(d => parseFloat(d.TotalSKUs) || 0);
    
    // Preparar datos para gráfico de Fardos
    const preparadoresFardos = datosFardos.map(d => d.EmpleadoPreparador);
    const fardos = datosFardos.map(d => parseFloat(d.TotalFardos) || 0);
    
    // Colores para los gráficos
    const colores = [
        'rgba(59, 130, 246, 0.8)',   // Azul
        'rgba(16, 185, 129, 0.8)',   // Verde
        'rgba(245, 158, 11, 0.8)',   // Naranja
        'rgba(139, 92, 246, 0.8)',   // Morado
        'rgba(236, 72, 153, 0.8)',   // Rosa
        'rgba(34, 197, 94, 0.8)',    // Verde claro
        'rgba(251, 146, 60, 0.8)',   // Naranja claro
        'rgba(96, 165, 250, 0.8)',   // Azul claro
        'rgba(168, 85, 247, 0.8)',   // Morado claro
        'rgba(244, 114, 182, 0.8)'   // Rosa claro
    ];
    
    const coloresBorde = [
        'rgba(59, 130, 246, 1)',
        'rgba(16, 185, 129, 1)',
        'rgba(245, 158, 11, 1)',
        'rgba(139, 92, 246, 1)',
        'rgba(236, 72, 153, 1)',
        'rgba(34, 197, 94, 1)',
        'rgba(251, 146, 60, 1)',
        'rgba(96, 165, 250, 1)',
        'rgba(168, 85, 247, 1)',
        'rgba(244, 114, 182, 1)'
    ];
    
    // Configuración común para todos los gráficos
    const configComun = {
        type: 'bar',
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    left: 10,
                    right: 10,
                    top: 10,
                    bottom: 25
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(30, 41, 59, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#cbd5e1',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            return context.parsed.y.toLocaleString();
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#94a3b8',
                        font: {
                            size: 10
                        },
                        maxTicksLimit: 6,
                        padding: 5
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false,
                        lineWidth: 1
                    },
                    border: {
                        display: false
                    }
                },
                x: {
                    ticks: {
                        color: '#94a3b8',
                        font: {
                            size: 9
                        },
                        maxRotation: 0,
                        minRotation: 0,
                        autoSkip: false,
                        padding: 8,
                        callback: function(value, index) {
                            const label = this.getLabelForValue(value);
                            // Acortar nombres largos
                            if (label.length > 10) {
                                const partes = label.split(' ');
                                // Si tiene múltiples palabras, tomar las primeras 2
                                if (partes.length > 2) {
                                    return partes[0] + ' ' + partes[1];
                                }
                                return label.substring(0, 10) + '...';
                            }
                            return label;
                        }
                    },
                    grid: {
                        display: false,
                        drawBorder: false
                    },
                    border: {
                        display: false
                    }
                }
            },
            elements: {
                bar: {
                    borderWidth: 2,
                    borderRadius: 4
                }
            }
        }
    };
    
    // Gráfico 1: Hojas Preparadas
    const ctxHojas = document.getElementById('chartHojas');
    if (chartHojas) chartHojas.destroy();
    
    chartHojas = new Chart(ctxHojas, {
        ...configComun,
        data: {
            labels: preparadoresHojas,
            datasets: [{
                label: 'Hojas',
                data: hojas,
                backgroundColor: colores,
                borderColor: coloresBorde,
                borderWidth: 2
            }]
        }
    });
    
    // Gráfico 2: SKUs Preparados
    const ctxSKUs = document.getElementById('chartSKUs');
    if (chartSKUs) chartSKUs.destroy();
    
    chartSKUs = new Chart(ctxSKUs, {
        ...configComun,
        data: {
            labels: preparadoresSKUs,
            datasets: [{
                label: 'SKUs',
                data: skus,
                backgroundColor: colores,
                borderColor: coloresBorde,
                borderWidth: 2
            }]
        }
    });
    
    // Gráfico 3: Fardos Preparados
    const ctxFardos = document.getElementById('chartFardos');
    if (chartFardos) chartFardos.destroy();
    
    chartFardos = new Chart(ctxFardos, {
        ...configComun,
        data: {
            labels: preparadoresFardos,
            datasets: [{
                label: 'Fardos',
                data: fardos,
                backgroundColor: colores,
                borderColor: coloresBorde,
                borderWidth: 2
            }]
        }
    });
}

// ========== EXPORTAR A EXCEL ==========
function exportarExcel() {
    Swal.fire({
        title: 'Exportar a Excel',
        text: '¿Deseas exportar los datos actuales a Excel?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Exportar',
        cancelButtonText: 'Cancelar',
        background: '#1e293b',
        color: '#fff',
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#64748b'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const fechaDesde = document.getElementById('fechaDesde').value;
                const fechaHasta = document.getElementById('fechaHasta').value;
                
                const connection = await connectionString();
                
                let datos = await connection.query(
                    `SELECT 
                        EmpleadoPreparador as 'Preparador',
                        COUNT(*) as 'Total Hojas',
                        SUM(TotalSKUs) as 'Total SKUs',
                        SUM(TotalFardos) as 'Total Fardos',
                        SUM(TotalPedidos) as 'Total Pedidos'
                    FROM (
                        SELECT 
                            COALESCE(u.NombreCompleto, CONCAT(u.Nombres, ' ', u.Apellidos), d.IdUsuariopreparo) as EmpleadoPreparador,
                            d.IdConsolidado,
                            d.NoHoja,
                            COUNT(DISTINCT d.UPCProducto) as TotalSKUs,
                            SUM(d.Cantidad) as TotalFardos,
                            1 as TotalPedidos
                        FROM detallepedidostienda_bodega d
                        LEFT JOIN usuarios u ON d.IdUsuariopreparo = u.Id
                        WHERE DATE(d.Fechahorapreparo) BETWEEN ? AND ?
                        AND d.IdUsuariopreparo IS NOT NULL
                        AND d.IdUsuariopreparo != ''
                        AND d.IdUsuariopreparo != 0
                        GROUP BY d.IdUsuariopreparo, u.NombreCompleto, u.Nombres, u.Apellidos, d.IdConsolidado, d.NoHoja
                    ) as subquery
                    GROUP BY EmpleadoPreparador
                    ORDER BY 'Total Hojas' DESC`,
                    [fechaDesde, fechaHasta]
                );
                
                await connection.close();
                
                datos = normalizarResultado(datos);
                
                if (datos.length === 0) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Sin datos',
                        text: 'No hay datos para exportar',
                        background: '#1e293b',
                        color: '#fff'
                    });
                    return;
                }
                
                // Convertir a formato CSV
                const headers = Object.keys(datos[0]);
                let csv = headers.join(',') + '\n';
                
                datos.forEach(row => {
                    const values = headers.map(header => {
                        const value = row[header];
                        return typeof value === 'string' ? `"${value}"` : value;
                    });
                    csv += values.join(',') + '\n';
                });
                
                // Crear blob y descargar
                const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                const url = URL.createObjectURL(blob);
                
                const nombreArchivo = `Reporte_Preparadores_${fechaDesde}_${fechaHasta}.csv`;
                
                link.setAttribute('href', url);
                link.setAttribute('download', nombreArchivo);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                Swal.fire({
                    icon: 'success',
                    title: 'Exportado',
                    text: 'Los datos se han exportado correctamente',
                    background: '#1e293b',
                    color: '#fff',
                    timer: 2000,
                    showConfirmButton: false
                });
                
            } catch (error) {
                console.error('Error al exportar a Excel:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'No se pudo exportar el archivo',
                    background: '#1e293b',
                    color: '#fff'
                });
            }
        }
    });
}