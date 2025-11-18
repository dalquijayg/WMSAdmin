const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configurar logging
log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs/main.log');
log.log("Versión de la App: " + app.getVersion());

if (process.env.NODE_ENV !== 'production') {
    require('electron-reload')(__dirname);
}

let mainWindow;
let asignarHojasWindow = null;
let PedidosreportesWindow = null;
let asignarTarimasWindow = null;
let reporteRechequeadoresWindow = null;

// Variable para controlar el estado de actualización
let updateInProgress = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, 'LogoWMS.ico'),
        autoHideMenuBar: true,
        width: 1200,
        height: 800
    });

    mainWindow.maximize();
    mainWindow.loadURL(`file://${__dirname}/Vistas/Login.html`);

    mainWindow.webContents.once('dom-ready', () => {
        // Solo verificar actualizaciones en producción
        if (process.env.NODE_ENV !== 'development') {
            autoUpdater.checkForUpdatesAndNotify();
        }
    });

    // Prevenir el cierre durante una actualización
    mainWindow.on('close', (event) => {
        if (updateInProgress) {
            event.preventDefault();
            dialog.showMessageBoxSync(mainWindow, {
                type: 'info',
                title: 'Actualización en progreso',
                message: 'No se puede cerrar la aplicación mientras se está actualizando. Por favor espera a que termine el proceso.',
                buttons: ['Entendido']
            });
        }
    });
}

// Función helper para mostrar alerta de actualización en progreso
function showUpdateInProgressDialog() {
    dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        title: 'Actualización en progreso',
        message: 'No se pueden abrir nuevas ventanas mientras se actualiza la aplicación. Por favor espera.',
        buttons: ['Entendido']
    });
}

function createAsignarHojasWindow() {
    if (updateInProgress) {
        showUpdateInProgressDialog();
        return;
    }

    if (asignarHojasWindow) {
        if (asignarHojasWindow.isMinimized()) asignarHojasWindow.restore();
        asignarHojasWindow.focus();
        return;
    }
    
    asignarHojasWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, 'Imagenes/logo-wms.png'),
        title: 'WMS - Asignar Hojas',
        autoHideMenuBar: true,
        backgroundColor: '#1a1d23'
    });

    asignarHojasWindow.loadURL(`file://${__dirname}/Vistas/AsignarPedidos.html`);
    
    asignarHojasWindow.on('closed', () => {
        asignarHojasWindow = null;
    });
}

function createPedidosReportesWindow() {
    if (updateInProgress) {
        showUpdateInProgressDialog();
        return;
    }

    if (PedidosreportesWindow) {
        if (PedidosreportesWindow.isMinimized()) PedidosreportesWindow.restore();
        PedidosreportesWindow.focus();
        return;
    }

    PedidosreportesWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, 'Imagenes/logo-wms.png'),
        title: 'WMS - Reportes de Pedidos',
        autoHideMenuBar: true,
        backgroundColor: '#1a1d23'
    });

    PedidosreportesWindow.loadURL(`file://${__dirname}/Vistas/Pedidos.html`);

    PedidosreportesWindow.on('closed', () => {
        PedidosreportesWindow = null;
    });
}
function createReporteRechequeadoresWindow() {
    if (updateInProgress) {
        showUpdateInProgressDialog();
        return;
    }

    if (reporteRechequeadoresWindow) {
        if (reporteRechequeadoresWindow.isMinimized()) reporteRechequeadoresWindow.restore();
        reporteRechequeadoresWindow.focus();
        return;
    }

    reporteRechequeadoresWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, 'Imagenes/logo-wms.png'),
        title: 'WMS - Reporte Rechequeadores',
        autoHideMenuBar: true,
        backgroundColor: '#1a1d23'
    });

    reporteRechequeadoresWindow.loadURL(`file://${__dirname}/Vistas/ReporteRechequeadores.html`);

    reporteRechequeadoresWindow.on('closed', () => {
        reporteRechequeadoresWindow = null;
    });
}
function createAsignarTarimasWindow() {
    if (updateInProgress) {
        showUpdateInProgressDialog();
        return;
    }

    if (asignarTarimasWindow) {
        if (asignarTarimasWindow.isMinimized()) asignarTarimasWindow.restore();
        asignarTarimasWindow.focus();
        return;
    }

    asignarTarimasWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, 'Imagenes/logo-wms.png'),
        title: 'Asignar tarimas',
        autoHideMenuBar: true,
        backgroundColor: '#1a1d23'
    });

    asignarTarimasWindow.loadURL(`file://${__dirname}/Vistas/AsignarTarimas.html`);

    asignarTarimasWindow.on('closed', () => {
        asignarTarimasWindow = null;
    });
}
// Configurar eventos del auto-updater
autoUpdater.on('checking-for-update', () => {
    log.info('Verificando actualizaciones...');
});

autoUpdater.on('update-available', (info) => {
    log.info("Actualización disponible:", info);
    updateInProgress = true;
    
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('update_available', {
            version: info.version,
            releaseNotes: info.releaseNotes,
            releaseDate: info.releaseDate
        });
    }
});

autoUpdater.on('update-not-available', (info) => {
    log.info('No hay actualizaciones disponibles:', info);
});

autoUpdater.on('error', (err) => {
    log.error('Error en auto-updater:', err);
    updateInProgress = false;
    
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('update_error', {
            message: err.message,
            stack: err.stack
        });
    }
});

autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Velocidad de descarga: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Descargado ' + progressObj.percent + '%';
    log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    log.info(log_message);
    
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('download_progress', {
            percent: Math.round(progressObj.percent),
            transferred: progressObj.transferred,
            total: progressObj.total,
            bytesPerSecond: progressObj.bytesPerSecond
        });
    }
});

autoUpdater.on('update-downloaded', (info) => {
    log.info("Actualización descargada:", info);
    updateInProgress = false;
    
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('update_downloaded', {
            version: info.version,
            releaseNotes: info.releaseNotes,
            releaseDate: info.releaseDate
        });
    }
});

// Manejar solicitud de reinicio
ipcMain.on('restart_app', () => {
    log.info("Reiniciando app para actualización...");
    autoUpdater.quitAndInstall();
});

// IPC Listeners
ipcMain.on('open_asignar_hojas', () => {
    createAsignarHojasWindow();
});

ipcMain.on('open_pedidos_reportes', () => {
    createPedidosReportesWindow();
});
ipcMain.on('open_asignar_tarimas', () => {
    createAsignarTarimasWindow();
});

ipcMain.on('open_reporte_rechequeadores', () => {
    createReporteRechequeadoresWindow();
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});