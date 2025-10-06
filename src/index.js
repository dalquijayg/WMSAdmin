const { app, BrowserWindow, ipcMain} = require('electron');
const path = require('path');


if (process.env.NODE_ENV !== 'production') {
    require('electron-reload')(__dirname);
}

let mainWindow;
let asignarHojasWindow = null;
let PedidosreportesWindow = null;

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
}
function createAsignarHojasWindow() {

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

// IPC Listener
ipcMain.on('open_asignar_hojas', () => {
    createAsignarHojasWindow();
});
function createPedidosReportesWindow() {

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
        title: 'WMS - Asignar Hojas',
        autoHideMenuBar: true,
        backgroundColor: '#1a1d23'
    });

    PedidosreportesWindow.loadURL(`file://${__dirname}/Vistas/Pedidos.html`);

    PedidosreportesWindow.on('closed', () => {
        PedidosreportesWindow = null;
    });
}

// IPC Listener
ipcMain.on('open_pedidos_reportes', () => {
    createPedidosReportesWindow();
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